// ============================================================
// LAN Sync Plugin - 共享工具函数
// ============================================================

/** 支持同步的文件扩展名集合 */
export const SUPPORTED_EXTENSIONS = new Set([
	'md',
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
	'canvas',
	'base',
]);

/** 二进制文件扩展名集合（需 Base64 编码传输） */
export const BINARY_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'base',
]);

/**
 * 从文件路径提取扩展名（小写）
 */
export function getFileExtension(filePath: string): string {
	return filePath.includes('.') ? (filePath.split('.').pop() || '').toLowerCase() : '';
}

/**
 * 判断文件是否为二进制类型
 */
export function isBinaryFile(filePath: string): boolean {
	return BINARY_EXTENSIONS.has(getFileExtension(filePath));
}

/**
 * ArrayBuffer 转 Base64
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Base64 转 ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binaryString = atob(base64);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer;
}

/**
 * 确保文件的父目录存在（递归创建）
 * 适用于 Obsidian Vault 实例
 */
export async function ensureParentDir(vault: { getAbstractFileByPath: (path: string) => any; createFolder: (path: string) => Promise<any> }, filePath: string): Promise<void> {
	const lastSlash = filePath.lastIndexOf('/');
	if (lastSlash <= 0) return;
	const dirPath = filePath.substring(0, lastSlash);
	const parts = dirPath.split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!vault.getAbstractFileByPath(current)) {
			try {
				await vault.createFolder(current);
			} catch {
				// 并发创建时可能已存在，忽略
			}
		}
	}
}
