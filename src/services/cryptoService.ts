import * as crypto from 'crypto';
import type { DataAdapter, Vault } from 'obsidian';
import { SUPPORTED_EXTENSIONS, BINARY_EXTENSIONS, getFileExtension } from '../utils';

/**
 * 加密服务 - AES-256-GCM
 * 用于文件传输过程中的加密/解密
 * 密钥在设备绑定时协商生成，双方持有相同密钥
 */
export class CryptoService {
	private encryptionKey: Buffer | null = null;

	// ========== MD5 哈希缓存（进程内共享） ==========
	private static hashCache = new Map<string, { mtime: number; hash: string }>();

	/**
	 * 获取缓存的 MD5（仅当 mtime 匹配时返回）
	 */
	static getCachedHash(filePath: string, mtime: number): string | null {
		const entry = CryptoService.hashCache.get(filePath);
		if (entry && entry.mtime === mtime) return entry.hash;
		return null;
	}

	/**
	 * 缓存文件 MD5
	 */
	static setCachedHash(filePath: string, mtime: number, hash: string): void {
		CryptoService.hashCache.set(filePath, { mtime, hash });
	}

	/**
	 * 清空哈希缓存
	 */
	static clearHashCache(): void {
		CryptoService.hashCache.clear();
	}

	/**
	 * 获取缓存中所有文件路径（用于检测已删除文件）
	 */
	static getCachedPaths(): string[] {
		return [...CryptoService.hashCache.keys()];
	}

	/**
	 * 从磁盘加载哈希缓存（插件启动时调用）
	 */
	static async loadCache(adapter: DataAdapter, cachePath: string): Promise<void> {
		try {
			if (!await adapter.exists(cachePath)) return;
			const raw = await adapter.read(cachePath);
			const data = JSON.parse(raw) as Record<string, { mtime: number; hash: string }>;
			CryptoService.hashCache.clear();
			for (const [filePath, entry] of Object.entries(data)) {
				CryptoService.hashCache.set(filePath, entry);
			}
			console.log(`[LAN Sync] Hash cache loaded: ${CryptoService.hashCache.size} entries`);
		} catch (err) {
			console.warn('[LAN Sync] Failed to load hash cache:', err);
		}
	}

	/**
	 * 将哈希缓存保存到磁盘（插件注销时调用）
	 */
	static async saveCache(adapter: DataAdapter, cachePath: string): Promise<void> {
		try {
			const data: Record<string, { mtime: number; hash: string }> = {};
			for (const [filePath, entry] of CryptoService.hashCache) {
				data[filePath] = entry;
			}
			await adapter.write(cachePath, JSON.stringify(data));
			console.log(`[LAN Sync] Hash cache saved: ${CryptoService.hashCache.size} entries`);
		} catch (err) {
			console.warn('[LAN Sync] Failed to save hash cache:', err);
		}
	}

	/**
	 * 等待 vault 文件索引就绪（手机端文件扫描是异步分批的）
	 */
	private static async waitForVaultReady(vault: Vault, maxRetries = 5): Promise<void> {
		for (let i = 0; i < maxRetries; i++) {
			const files = vault.getFiles();
			if (files.length > 0) {
				console.log(`[LAN Sync] vault ready: ${files.length} files (attempt ${i + 1})`);
				return;
			}
			console.log(`[LAN Sync] vault not ready, waiting... (attempt ${i + 1}/${maxRetries})`);
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
		console.warn(`[LAN Sync] vault still empty after ${maxRetries} retries`);
	}

	/**
	 * 全量刷新缓存：清空后重新计算所有文件的 MD5
	 */
	static async refreshFull(vault: Vault): Promise<{ total: number; computed: number }> {
		// 手机端 vault.getFiles() 可能尚未就绪，等待重试
		await CryptoService.waitForVaultReady(vault);

		const allFiles = vault.getFiles();
		let computed = 0;
		let skippedExt = 0;
		let skippedObsidian = 0;
		let skippedStat = 0;
		let skippedError = 0;

		CryptoService.hashCache.clear();

		for (const file of allFiles) {
			const ext = getFileExtension(file.path);
			if (!SUPPORTED_EXTENSIONS.has(ext)) { skippedExt++; continue; }
			if (file.path.startsWith('.obsidian/')) { skippedObsidian++; continue; }
			const stat = await vault.adapter.stat(file.path);
			if (!stat) { skippedStat++; continue; }
			try {
				let hash: string;
				if (BINARY_EXTENSIONS.has(ext)) {
					const buf = await vault.readBinary(file as any);
					hash = CryptoService.computeMD5(buf);
				} else {
					const content = await vault.read(file as any);
					hash = CryptoService.computeMD5(content);
				}
				CryptoService.setCachedHash(file.path, stat.mtime, hash);
				computed++;
			} catch (e) {
				skippedError++;
				console.warn(`[LAN Sync] refreshFull: failed to process ${file.path}:`, e);
			}
		}
		console.log(`[LAN Sync] refreshFull: computed=${computed}, skippedExt=${skippedExt}, skippedObsidian=${skippedObsidian}, skippedStat=${skippedStat}, skippedError=${skippedError}`);
		return { total: computed, computed };
	}

	/**
	 * 增量刷新缓存：更新变更文件、清理已删除文件
	 */
	static async refreshIncremental(vault: Vault): Promise<{ total: number; computed: number; removed: number }> {
		// 手机端 vault.getFiles() 可能尚未就绪，等待重试
		await CryptoService.waitForVaultReady(vault);

		const allFiles = vault.getFiles();
		const currentPaths = new Set<string>();
		let computed = 0;

		for (const file of allFiles) {
			const ext = getFileExtension(file.path);
			if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
			if (file.path.startsWith('.obsidian/')) continue;
			const stat = await vault.adapter.stat(file.path);
			if (!stat) continue;
			currentPaths.add(file.path);

			// mtime 匹配则跳过
			if (CryptoService.getCachedHash(file.path, stat.mtime)) continue;

			try {
				let hash: string;
				if (BINARY_EXTENSIONS.has(ext)) {
					const buf = await vault.readBinary(file as any);
					hash = CryptoService.computeMD5(buf);
				} else {
					const content = await vault.read(file as any);
					hash = CryptoService.computeMD5(content);
				}
				CryptoService.setCachedHash(file.path, stat.mtime, hash);
				computed++;
			} catch { /* skip */ }
		}

		// 清理已不存在的文件缓存
		let removed = 0;
		for (const cachedPath of [...CryptoService.hashCache.keys()]) {
			if (!currentPaths.has(cachedPath)) {
				CryptoService.hashCache.delete(cachedPath);
				removed++;
			}
		}

		return { total: CryptoService.hashCache.size, computed, removed };
	}

	/**
	 * 计算文件内容的 MD5 哈希（十六进制字符串）
	 * 使用纯 JS 实现，兼容桌面端 (Node.js) 和手机端 (WebView)
	 */
	static computeMD5(content: string | Buffer | ArrayBuffer): string {
		let bytes: Uint8Array;
		if (typeof content === 'string') {
			bytes = new TextEncoder().encode(content);
		} else if (content instanceof ArrayBuffer) {
			bytes = new Uint8Array(content);
		} else {
			bytes = content as Uint8Array;
		}

		// Pre-process: pad message to 512-bit blocks
		const msgLen = bytes.length;
		const bitLen = msgLen * 8;
		// 需要填充: 1字节(0x80) + padding + 8字节(长度)，使总长度为 64 的倍数
		const padLen = ((55 - msgLen) % 64 + 64) % 64 + 1;
		const totalLen = msgLen + padLen + 8;
		const data = new Uint8Array(totalLen);
		data.set(bytes);
		data[msgLen] = 0x80;
		// 追加原始长度（位），64位小端序。JS的 >>> 以 32 为模，需分开处理高低 32 位
		const bitLenLo = bitLen | 0; // 低 32 位
		for (let i = 0; i < 4; i++) {
			data[totalLen - 8 + i] = (bitLenLo >>> (i * 8)) & 0xff;
		}
		// 高 32 位始终为 0（文件 < 512MB），data 已初始化为 0，无需写入

		// MD5 辅助函数
		const leftRotate = (x: number, c: number) => ((x << c) | (x >>> (32 - c))) | 0;

		// 预计算 T[i] = floor(2^32 * |sin(i+1)|)，硬编码避免浮点精度问题
		const T = new Int32Array([
			0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
			0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
			0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
			0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
			0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
			0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
			0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
			0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
			0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
			0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
			0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
			0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
			0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
			0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
			0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
			0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
		]);

		const s = [
			7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
			5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20, 5,  9, 14, 20,
			4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
			6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
		];

		let a0 = 0x67452301 | 0;
		let b0 = 0xefcdab89 | 0;
		let c0 = 0x98badcfe | 0;
		let d0 = 0x10325476 | 0;

		// 逐块处理（每块 64 字节 = 512 位）
		for (let offset = 0; offset < totalLen; offset += 64) {
			const M = new Int32Array(16);
			for (let j = 0; j < 16; j++) {
				const idx = offset + j * 4;
				M[j] = data[idx] | (data[idx + 1] << 8) | (data[idx + 2] << 16) | (data[idx + 3] << 24);
			}

			let A = a0, B = b0, C = c0, D = d0;

			for (let i = 0; i < 64; i++) {
				let F: number, g: number;
				if (i < 16) {
					F = (B & C) | (~B & D);
					g = i;
				} else if (i < 32) {
					F = (D & B) | (~D & C);
					g = (5 * i + 1) % 16;
				} else if (i < 48) {
					F = B ^ C ^ D;
					g = (3 * i + 5) % 16;
				} else {
					F = C ^ (B | ~D);
					g = (7 * i) % 16;
				}
				F = (F + A + T[i] + M[g]) | 0;
				A = D;
				D = C;
				C = B;
				B = (B + leftRotate(F, s[i])) | 0;
			}

			a0 = (a0 + A) | 0;
			b0 = (b0 + B) | 0;
			c0 = (c0 + C) | 0;
			d0 = (d0 + D) | 0;
		}

		// 转为十六进制字符串（小端序）
		const toHex = (n: number) => {
			let result = '';
			for (let i = 0; i < 4; i++) {
				result += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, '0');
			}
			return result;
		};
		return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
	}

	/**
	 * 从绑定会话生成共享密钥
	 * 使用绑定组 ID + 双方设备 ID 派生密钥
	 */
	deriveKey(bindingId: string, deviceIds: string[]): void {
		const material = [bindingId, ...deviceIds].sort().join(':');
		// 使用 SHA-256 派生 32 字节密钥
		this.encryptionKey = crypto.createHash('sha256').update(material).digest();
	}

	/**
	 * 从已有密钥恢复（从持久化数据加载）
	 */
	loadKey(keyHex: string): void {
		this.encryptionKey = Buffer.from(keyHex, 'hex');
	}

	/**
	 * 导出密钥（用于持久化）
	 */
	exportKey(): string | null {
		return this.encryptionKey?.toString('hex') || null;
	}

	/**
	 * 是否有可用密钥
	 */
	hasKey(): boolean {
		return this.encryptionKey !== null;
	}

	/**
	 * 加密数据
	 * 返回格式: iv(12) + authTag(16) + ciphertext
	 * 全部 base64 编码后传输
	 */
	encrypt(plaintext: string): string {
		if (!this.encryptionKey) throw new Error('Encryption key not set');

		const iv = crypto.randomBytes(12); // 96-bit IV for GCM
		const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

		let encrypted = cipher.update(plaintext, 'utf8');
		encrypted = Buffer.concat([encrypted, cipher.final()]);
		const authTag = cipher.getAuthTag();

		// 拼接 iv + authTag + ciphertext，然后 base64
		const combined = Buffer.concat([iv, authTag, encrypted]);
		return combined.toString('base64');
	}

	/**
	 * 解密数据
	 * 输入格式: base64(iv(12) + authTag(16) + ciphertext)
	 */
	decrypt(encryptedBase64: string): string {
		if (!this.encryptionKey) throw new Error('Encryption key not set');

		const combined = Buffer.from(encryptedBase64, 'base64');
		const iv = combined.subarray(0, 12);
		const authTag = combined.subarray(12, 28);
		const ciphertext = combined.subarray(28);

		const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(ciphertext);
		decrypted = Buffer.concat([decrypted, decipher.final()]);
		return decrypted.toString('utf8');
	}

	/**
	 * 加密 Buffer 数据（用于分片传输）
	 */
	encryptBuffer(data: Buffer): Buffer {
		if (!this.encryptionKey) throw new Error('Encryption key not set');

		const iv = crypto.randomBytes(12);
		const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

		let encrypted = cipher.update(data);
		encrypted = Buffer.concat([encrypted, cipher.final()]);
		const authTag = cipher.getAuthTag();

		return Buffer.concat([iv, authTag, encrypted]);
	}

	/**
	 * 解密 Buffer 数据
	 */
	decryptBuffer(data: Buffer): Buffer {
		if (!this.encryptionKey) throw new Error('Encryption key not set');

		const iv = data.subarray(0, 12);
		const authTag = data.subarray(12, 28);
		const ciphertext = data.subarray(28);

		const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
		decipher.setAuthTag(authTag);

		let decrypted = decipher.update(ciphertext);
		decrypted = Buffer.concat([decrypted, decipher.final()]);
		return decrypted;
	}
}
