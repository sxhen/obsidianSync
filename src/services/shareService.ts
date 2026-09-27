import type { Plugin, Vault, TFile } from 'obsidian';
import type { DeviceInfo, PluginSettings, BlacklistEntry, DevicePlatform } from '../types';
import { HttpClient } from './httpClient';
import { saveSettings } from '../settings';
import { isBinaryFile, arrayBufferToBase64, base64ToArrayBuffer, ensureParentDir } from '../utils';

/**
 * 笔记分享服务
 * 支持分享到已绑定设备（自动写入）和未绑定设备（需确认）
 */
export class ShareService {
	private plugin: Plugin;
	private vault: Vault;
	private httpClient: HttpClient;
	private localDeviceId: string;
	private localDeviceAlias: string;
	private localDevicePlatform: DevicePlatform;
	private rejectCounters: Map<string, { count: number; lastRejectAt: number }> = new Map();

	constructor(
		plugin: Plugin,
		vault: Vault,
		_transport: any,
		httpClient: HttpClient,
		localDeviceId: string,
		localDeviceAlias: string,
		localDevicePlatform: DevicePlatform = 'desktop'
	) {
		this.plugin = plugin;
		this.vault = vault;
		this.httpClient = httpClient;
		this.localDeviceId = localDeviceId;
		this.localDeviceAlias = localDeviceAlias;
		this.localDevicePlatform = localDevicePlatform;
	}

	/**
	 * 分享笔记到指定设备（支持文本和二进制文件）
	 */
	async shareNote(file: TFile, targetDevice: DeviceInfo, isBound: boolean): Promise<boolean> {
		const isBinary = isBinaryFile(file.path);

		let content: string;
		if (isBinary) {
			const binaryContent = await this.vault.readBinary(file);
			content = arrayBufferToBase64(binaryContent);
		} else {
			content = await this.vault.read(file);
		}

		const baseUrl = `http://${targetDevice.address}:${targetDevice.port}`;

		// 发送分享请求
		const result = await this.httpClient.post<{ received: boolean; rejected?: boolean }>(baseUrl, '/api/share', {
			fromDeviceId: this.localDeviceId,
			fromDeviceAlias: this.localDeviceAlias,
			fromDevicePlatform: this.localDevicePlatform,
			fileName: file.name,
			fileContent: content,
			filePath: file.path,
			isBound,
			isBinary,
		});

		// 对方黑名单拦截时，返回失败
		if (result.success && result.data?.rejected) {
			return false;
		}
		return result.success;
	}


	/**
	 * 直接加入黑名单（用户主动点击加入黑名单按钮）
	 */
	async addToBlacklist(deviceId: string, alias: string, platform: DevicePlatform, settings: PluginSettings): Promise<void> {
		if (!settings.blacklist.some((e) => e.id === deviceId)) {
			settings.blacklist.push({ id: deviceId, alias, platform });
			await saveSettings(this.plugin, settings);
		}
		this.rejectCounters.delete(deviceId);
	}

	/**
	 * 记录拒绝并检查是否应加入黑名单
	 */
	async recordReject(fromDeviceId: string, settings: PluginSettings, alias?: string, platform?: DevicePlatform): Promise<boolean> {
		const counter = this.rejectCounters.get(fromDeviceId) || { count: 0, lastRejectAt: 0 };
		counter.count++;
		counter.lastRejectAt = Date.now();
		this.rejectCounters.set(fromDeviceId, counter);

		// 达到阈值自动加入黑名单
		if (counter.count >= settings.autoRejectThreshold) {
			if (!settings.blacklist.some((e) => e.id === fromDeviceId)) {
				settings.blacklist.push({
					id: fromDeviceId,
					alias: alias || fromDeviceId.substring(0, 8),
					platform: platform || 'desktop',
				});
				await saveSettings(this.plugin, settings);
			}
			return true; // 已加入黑名单
		}
		return false;
	}

	/**
	 * 从黑名单移除
	 */
	async removeFromBlacklist(deviceId: string, settings: PluginSettings): Promise<void> {
		settings.blacklist = settings.blacklist.filter((e) => e.id !== deviceId);
		this.rejectCounters.delete(deviceId);
		await saveSettings(this.plugin, settings);
	}

	/**
	 * 保存分享的笔记（支持文本和二进制文件）
	 */
	async saveSharedNote(fileName: string, content: string, filePath?: string, isBinary?: boolean): Promise<void> {
		const targetPath = filePath || fileName;
		const existing = this.vault.getAbstractFileByPath(targetPath);

		if (isBinary) {
			const binaryContent = base64ToArrayBuffer(content);
			if (existing) {
				await this.vault.modifyBinary(existing as any, binaryContent);
			} else {
				await ensureParentDir(this.vault, targetPath);
				await this.vault.createBinary(targetPath, binaryContent);
			}
		} else {
			if (existing) {
				await this.vault.modify(existing as any, content);
			} else {
				await ensureParentDir(this.vault, targetPath);
				await this.vault.create(targetPath, content);
			}
		}
	}

	/**
	 * 另存为到指定路径（支持文本和二进制文件）
	 */
	async saveSharedNoteAs(fileName: string, content: string, targetPath: string, isBinary?: boolean): Promise<void> {
		const existing = this.vault.getAbstractFileByPath(targetPath);

		if (isBinary) {
			const binaryContent = base64ToArrayBuffer(content);
			if (existing) {
				await this.vault.modifyBinary(existing as any, binaryContent);
			} else {
				await ensureParentDir(this.vault, targetPath);
				await this.vault.createBinary(targetPath, binaryContent);
			}
		} else {
			if (existing) {
				await this.vault.modify(existing as any, content);
			} else {
				await ensureParentDir(this.vault, targetPath);
				await this.vault.create(targetPath, content);
			}
		}
	}
}
