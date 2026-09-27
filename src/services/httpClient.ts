import type { INetworkTransport, ApiResponse } from '../types';
import type { CryptoService } from './cryptoService';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;
const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024; // 5MB per chunk

/**
 * HTTP 客户端封装
 * 支持：分片传输 + AES-256-GCM 加密 + 自动重试
 */
export class HttpClient {
	private transport: INetworkTransport;
	private cryptoService: CryptoService | null = null;
	private chunkSize: number;

	constructor(transport: INetworkTransport, chunkSize = DEFAULT_CHUNK_SIZE) {
		this.transport = transport;
		this.chunkSize = chunkSize;
	}

	/**
	 * 设置加密服务（绑定后启用加密）
	 */
	setCryptoService(crypto: CryptoService): void {
		this.cryptoService = crypto;
	}

	/**
	 * 发送 GET 请求
	 */
	async get<T = any>(baseUrl: string, path: string, timeout = DEFAULT_TIMEOUT_MS): Promise<ApiResponse<T>> {
		return this.request<T>('GET', baseUrl, path, undefined, timeout);
	}

	/**
	 * 发送 POST 请求
	 */
	async post<T = any>(baseUrl: string, path: string, body: any, timeout = DEFAULT_TIMEOUT_MS): Promise<ApiResponse<T>> {
		return this.request<T>('POST', baseUrl, path, body, timeout);
	}

	/**
	 * 分片上传大文件内容
	 * 将内容切分为多个 chunk，每个 chunk 加密后传输
	 */
	async uploadChunked(
		baseUrl: string,
		uploadPath: string,
		filePath: string,
		content: string,
		metadata: Record<string, any> = {}
	): Promise<ApiResponse> {
		const contentBytes = new TextEncoder().encode(content);
		const totalSize = contentBytes.length;

		// 小文件直接传输
		if (totalSize <= this.chunkSize) {
			const payload = this.cryptoService?.hasKey()
				? this.cryptoService.encrypt(content)
				: content;
			return this.post(baseUrl, uploadPath, {
				filePath,
				content: payload,
				encrypted: this.cryptoService?.hasKey() || false,
				chunked: false,
				...metadata,
			});
		}

		// 大文件分片传输
		const totalChunks = Math.ceil(totalSize / this.chunkSize);
		const sessionId = `upload-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

		console.log(`[LAN Sync] Starting chunked upload: ${filePath} (${totalChunks} chunks)`);

		// 1. 发送分片初始化请求
		const initResult = await this.post(baseUrl, '/api/sync/upload/init', {
			sessionId,
			filePath,
			totalChunks,
			totalSize,
			encrypted: this.cryptoService?.hasKey() || false,
			...metadata,
		});

		if (!initResult.success) return initResult;

		// 2. 逐片上传
		for (let i = 0; i < totalChunks; i++) {
			const start = i * this.chunkSize;
			const end = Math.min(start + this.chunkSize, totalSize);
			const chunkBytes = contentBytes.slice(start, end);
			const chunkStr = new TextDecoder().decode(chunkBytes);

			// 加密每个分片
			const payload = this.cryptoService?.hasKey()
				? this.cryptoService.encrypt(chunkStr)
				: chunkStr;

			const chunkResult = await this.post(baseUrl, '/api/sync/upload/chunk', {
				sessionId,
				chunkIndex: i,
				data: payload,
			});

			if (!chunkResult.success) {
				console.error(`[LAN Sync] Chunk ${i}/${totalChunks} upload failed`);
				return chunkResult;
			}

			console.log(`[LAN Sync] Chunk ${i + 1}/${totalChunks} uploaded`);
		}

		// 3. 完成上传
		return this.post(baseUrl, '/api/sync/upload/complete', { sessionId });
	}

	/**
	 * 下载文件（支持服务端返回 { files: [...] } 格式）
	 */
	async downloadChunked(
		baseUrl: string,
		filePath: string
	): Promise<ApiResponse<{ content: string }>> {
		// 拉取文件（服务端返回 { files: [{ filePath, content, lastModified, isBinary }] }）
		const result = await this.post<{ files: Array<{ filePath: string; content: string; lastModified: number; isBinary?: boolean }> }>(
			baseUrl, '/api/sync/pull', { filePaths: [filePath] }
		);

		if (!result.success || !result.data) return result as any;

		// 从 files 数组中提取目标文件内容
		const fileEntry = result.data.files?.find(f => f.filePath === filePath);
		if (!fileEntry) {
			return { success: false, error: `File not found in pull response: ${filePath}` };
		}

		const content = this.cryptoService?.hasKey()
			? this.cryptoService.decrypt(fileEntry.content)
			: fileEntry.content;
		return { success: true, data: { content } };
	}

	/**
	 * 通用请求方法，带重试 + 加密
	 */
	private async request<T>(
		method: string,
		baseUrl: string,
		path: string,
		body?: any,
		timeout = DEFAULT_TIMEOUT_MS
	): Promise<ApiResponse<T>> {
		const url = `${baseUrl}${path}`;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			try {
				const options: RequestInit = {
					method,
					headers: { 'Content-Type': 'application/json' },
				};

				if (body !== undefined) {
					options.body = JSON.stringify(body);
				}

				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), timeout);
				options.signal = controller.signal;

				const result = await this.transport.sendRequest(url, options);
				clearTimeout(timeoutId);

				if (result.status >= 200 && result.status < 300) {
					// 服务端已将响应包装为 { success, data }，直接返回，避免双重包装
					let parsed = result.data;
					// 防御性处理：手机端 requestUrl 可能导致 JSON 多重编码，递归解包直到得到对象
					while (typeof parsed === 'string') {
						try { parsed = JSON.parse(parsed); } catch { break; }
					}
					return parsed as ApiResponse<T>;
				}

				return { success: false, error: `HTTP ${result.status}: ${JSON.stringify(result.data)}` };
			} catch (err: any) {
				lastError = err;
				if (attempt < MAX_RETRIES) {
					await this.sleep(1000 * Math.pow(2, attempt));
				}
			}
		}

		return { success: false, error: lastError?.message || 'Request failed' };
	}

	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}
}
