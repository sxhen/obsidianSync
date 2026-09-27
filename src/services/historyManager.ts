import type { Vault } from 'obsidian';
import { BINARY_EXTENSIONS, getFileExtension } from '../utils';

/**
 * 历史副本管理服务
 * 在文件被同步覆盖前，创建带时间戳的副本保存到隐藏目录
 */
export class HistoryManager {
	private vault: Vault;
	private historyFolder: string;
	private maxCopies: number;

	constructor(vault: Vault, historyFolder: string, maxCopies: number) {
		this.vault = vault;
		this.historyFolder = historyFolder;
		this.maxCopies = maxCopies;
	}

	/**
	 * 更新配置
	 */
	updateConfig(historyFolder: string, maxCopies: number): void {
		this.historyFolder = historyFolder;
		this.maxCopies = maxCopies;
	}

	/**
	 * 为指定文件创建历史副本
	 */
	async createCopy(filePath: string): Promise<string | null> {
		try {
			const file = this.vault.getAbstractFileByPath(filePath);
			if (!file) return null;

			const isBinary = BINARY_EXTENSIONS.has(getFileExtension(filePath));
			const timestamp = this.formatTimestamp(new Date());
			const historyPath = this.getHistoryPath(filePath, timestamp);

			// 确保历史目录存在
			const dirPath = this.getHistoryDir(filePath);
			await this.ensureDir(dirPath);

			// 写入副本（区分二进制/文本）
			if (isBinary) {
				const binaryContent = await this.vault.readBinary(file as any);
				await this.vault.createBinary(historyPath, binaryContent);
			} else {
				const content = await this.vault.read(file as any);
				await this.vault.create(historyPath, content);
			}

			// 清理旧副本
			await this.cleanupOldCopies(filePath);

			console.log(`[LAN Sync] History copy created: ${historyPath}`);
			return historyPath;
		} catch (err) {
			console.error(`[LAN Sync] Failed to create history copy for: ${filePath}`, err);
			return null;
		}
	}

	/**
	 * 获取文件在历史目录中的路径
	 * 保持与仓库一致的目录结构
	 */
	private getHistoryPath(filePath: string, timestamp: string): string {
		const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
		const baseName = filePath.includes('.')
			? filePath.substring(0, filePath.lastIndexOf('.'))
			: filePath;
		const name = `${baseName}_${timestamp}${ext}`;
		return `${this.historyFolder}/${name}`;
	}

	/**
	 * 获取文件对应的历史目录
	 */
	private getHistoryDir(filePath: string): string {
		const lastSlash = filePath.lastIndexOf('/');
		if (lastSlash > 0) {
			const subDir = filePath.substring(0, lastSlash);
			return `${this.historyFolder}/${subDir}`;
		}
		return this.historyFolder;
	}

	/**
	 * 确保目录存在（递归创建）
	 */
	private async ensureDir(dirPath: string): Promise<void> {
		const parts = dirPath.split('/');
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const existing = this.vault.getAbstractFileByPath(current);
			if (!existing) {
				try {
					await this.vault.createFolder(current);
				} catch {
					// 并发创建时可能已存在，忽略
				}
			}
		}
	}

	/**
	 * 清理超出数量限制的旧副本
	 */
	private async cleanupOldCopies(filePath: string): Promise<void> {
		try {
			const dirPath = this.getHistoryDir(filePath);
			const dir = this.vault.getAbstractFileByPath(dirPath);
			if (!dir) return;

			const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
			const baseName = filePath.includes('.')
				? filePath.substring(0, filePath.lastIndexOf('.'))
				: filePath;
			const prefix = `${baseName}_`;

			// 获取目录下匹配的文件
			const files = this.vault.getFiles().filter((f) => {
				return f.path.startsWith(dirPath + '/') &&
					f.name.startsWith(prefix.replace(/\//g, '')) &&
					f.name.endsWith(ext || '.md');
			});

			// 按时间排序，删除最旧的
			if (files.length > this.maxCopies) {
				files.sort((a, b) => a.stat.mtime - b.stat.mtime);
				const toDelete = files.slice(0, files.length - this.maxCopies);
				for (const file of toDelete) {
					await this.vault.delete(file);
				}
			}
		} catch (err) {
			console.error('[LAN Sync] Cleanup old copies error:', err);
		}
	}

	/**
	 * 格式化时间戳为文件名安全格式
	 */
	private formatTimestamp(date: Date): string {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		const h = String(date.getHours()).padStart(2, '0');
		const min = String(date.getMinutes()).padStart(2, '0');
		const s = String(date.getSeconds()).padStart(2, '0');
		return `${y}${m}${d}_${h}${min}${s}`;
	}
}
