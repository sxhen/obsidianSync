import { Notice } from 'obsidian';
import type { Plugin, Vault } from 'obsidian';
import type {
	BindingGroup,
	DeviceInfo,
	SyncRecord,
	SyncFileEntry,
	SyncHistoryRecord,
	ManifestResponse,
	PluginSettings,
	INetworkTransport,
} from '../types';
import { HttpClient } from './httpClient';
import { HistoryManager } from './historyManager';
import { saveSettings } from '../settings';
import { CryptoService } from './cryptoService';
import { t } from '../i18n';
import { SUPPORTED_EXTENSIONS, BINARY_EXTENSIONS, getFileExtension, arrayBufferToBase64, ensureParentDir } from '../utils';
import type { WebSocketService } from './websocketService';
import type { WebSocketClientService } from './websocketClient';
import type { DiscoveryService } from './discoveryService';

/**
 * 同步引擎
 * 定时检查绑定组内设备仓库变更，以最新修改时间为准进行增量同步
 */
export class SyncEngine {
	private plugin: Plugin;
	private vault: Vault;
	private transport: INetworkTransport;
	private httpClient: HttpClient;
	private historyManager: HistoryManager;
	private syncInterval: ReturnType<typeof setInterval> | null = null;
	private isSyncing = false;
	private localDeviceId: string;
	private onSyncComplete: ((record: SyncHistoryRecord) => void) | null = null;

	// WebSocket 传输（用于手机端等无 HTTP 服务的设备）
	private wsService: WebSocketService | null = null;
	private wsClients: Map<string, WebSocketClientService> | null = null;
	private discoveryService: DiscoveryService | null = null;
	private pendingWsRequests = new Map<string, { resolve: (data: any) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();

	constructor(
		plugin: Plugin,
		vault: Vault,
		transport: INetworkTransport,
		httpClient: HttpClient,
		historyManager: HistoryManager,
		localDeviceId: string,
		_cryptoService?: any
	) {
		this.plugin = plugin;
		this.vault = vault;
		this.transport = transport;
		this.httpClient = httpClient;
		this.historyManager = historyManager;
		this.localDeviceId = localDeviceId;
	}

	/**
	 * 设置同步完成回调
	 */
	setOnSyncComplete(callback: (record: SyncHistoryRecord) => void): void {
		this.onSyncComplete = callback;
	}

	/**
	 * 设置 WebSocket 服务引用（由 main.ts 在初始化后调用）
	 */
	setWebSocketServices(wsService: WebSocketService, wsClients: Map<string, WebSocketClientService>): void {
		this.wsService = wsService;
		this.wsClients = wsClients;
	}

	/**
	 * 设置设备发现服务引用（由 main.ts 在初始化后调用）
	 */
	setDiscoveryService(discoveryService: DiscoveryService): void {
		this.discoveryService = discoveryService;
	}

	/**
	 * 从发现服务或 settings 中查找设备信息
	 */
	private findDevice(settings: PluginSettings, deviceId: string): DeviceInfo | undefined {
		if (this.discoveryService) {
			const device = this.discoveryService.getKnownDevices().find(d => d.id === deviceId);
			if (device) return device;
		}
		return settings.knownDevices.find(d => d.id === deviceId);
	}

	/**
	 * 判断设备是否在线
	 * 同时考虑 lastSeen 时间戳和 WebSocket 连接状态：
	 * - 对于 HTTP 设备（桌面端），依赖 lastSeen（30秒阈值）
	 * - 对于 WebSocket 设备（手机端），如果有活跃的 WS 连接也视为在线
	 */
	private isDeviceOnline(deviceId: string, device: DeviceInfo): boolean {
		// 传统 lastSeen 检查
		if (Date.now() - device.lastSeen <= 30000) return true;
		// WebSocket 连接检查（手机端等 WS-only 设备）
		if (this.wsService && this.wsService.getConnectedDeviceIds().includes(deviceId)) return true;
		if (this.wsClients) {
			const client = this.wsClients.get(deviceId);
			if (client?.connected()) return true;
		}
		return false;
	}

	/**
	 * 处理收到的 WebSocket 同步响应（由 main.ts 调用）
	 */
	handleWsSyncResponse(data: any): void {
		if (!data.requestId) return;
		const pending = this.pendingWsRequests.get(data.requestId);
		if (pending) {
			clearTimeout(pending.timer);
			this.pendingWsRequests.delete(data.requestId);
			pending.resolve(data);
		}
	}

	/**
	 * 启动定时同步
	 */
	start(intervalMinutes: number): void {
		this.stop();
		const ms = intervalMinutes * 60 * 1000;
		this.syncInterval = setInterval(() => {
			this.runAutoSync();
		}, ms);
		console.log(`[LAN Sync] Sync engine started, interval: ${intervalMinutes}min`);
	}

	/**
	 * 停止定时同步
	 */
	stop(): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
	}

	/**
	 * 定时自动同步（只处理 autoSync=true 的绑定组）
	 */
	async runAutoSync(): Promise<void> {
		if (this.isSyncing) {
			console.log('[LAN Sync] Sync already in progress, skipping');
			return;
		}

		this.isSyncing = true;
		try {
			const settings = (await this.plugin.loadData()) as PluginSettings;
			if (!settings?.bindings?.length) return;

			for (const binding of settings.bindings) {
				if (!binding.devices.includes(this.localDeviceId)) continue;
				// 定时同步只处理开启了自动同步的绑定组（默认开启）
				if (binding.autoSync === false) continue;
				await this.syncBindingGroup(binding, settings, true);
			}
		} catch (err) {
			console.error('[LAN Sync] Auto sync error:', err);
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * 手动触发一次同步（同步所有绑定组，不受 autoSync 开关影响）
	 */
	async runSync(bindingId?: string): Promise<void> {
		if (this.isSyncing) {
			console.log('[LAN Sync] Sync already in progress, skipping');
			return;
		}

		this.isSyncing = true;
		try {
			const settings = (await this.plugin.loadData()) as PluginSettings;
			if (!settings?.bindings?.length) return;

			for (const binding of settings.bindings) {
				// 只处理包含自身的绑定组
				if (!binding.devices.includes(this.localDeviceId)) continue;
				// 如果指定了 bindingId，只同步该绑定组
				if (bindingId && binding.id !== bindingId) continue;
				await this.syncBindingGroup(binding, settings, false);
			}
		} catch (err) {
			console.error('[LAN Sync] Sync error:', err);
		} finally {
			this.isSyncing = false;
		}
	}

	// ========== WebSocket 传输辅助方法 ==========

	/**
	 * 判断设备是否仅支持 WebSocket（无 HTTP 服务）
	 */
	private isWsOnlyDevice(device: DeviceInfo): boolean {
		return !device.port || device.port === 0;
	}

	/**
	 * 获取向指定设备发送 WebSocket 消息的方法
	 */
	private getDeviceWsSend(deviceId: string): ((data: any) => boolean) | null {
		// 尝试桌面端 WebSocket 服务端（目标是已连接的手机端）
		if (this.wsService) {
			const send = (data: any) => this.wsService!.sendToDevice(deviceId, data);
			// 测试是否可达
			if (this.wsService.getConnectedDeviceIds().includes(deviceId)) {
				return send;
			}
		}
		// 尝试 WebSocket 客户端连接（目标是桌面端）
		if (this.wsClients) {
			const client = this.wsClients.get(deviceId);
			if (client?.connected()) {
				return (data: any) => client.send(data);
			}
		}
		return null;
	}

	/**
	 * 通过 WebSocket 发送请求并等待响应（带超时）
	 */
	private async sendWsRequest(deviceId: string, data: any, timeoutMs = 30000): Promise<any> {
		const wsSend = this.getDeviceWsSend(deviceId);
		if (!wsSend) {
			return { success: false, error: 'No WebSocket connection to device' };
		}

		const requestId = `ws-req-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
		data.requestId = requestId;

		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.pendingWsRequests.delete(requestId);
				resolve({ success: false, error: 'WebSocket request timeout' });
			}, timeoutMs);

			this.pendingWsRequests.set(requestId, {
				resolve,
				reject: () => resolve({ success: false, error: 'WebSocket request rejected' }),
				timer,
			});

			if (!wsSend(data)) {
				clearTimeout(timer);
				this.pendingWsRequests.delete(requestId);
				resolve({ success: false, error: 'WebSocket send failed' });
			}
		});
	}

	/**
	 * 通过 WebSocket 获取远程设备清单（含自动同步状态）
	 */
	private async fetchManifestWs(deviceId: string): Promise<{ records: SyncRecord[]; autoSyncBindings?: Record<string, boolean>; deletedFiles?: string[] } | null> {
		const result = await this.sendWsRequest(deviceId, { type: 'sync-manifest-request' });
		if (result.success && result.records) {
			return { records: result.records, autoSyncBindings: result.autoSyncBindings, deletedFiles: result.deletedFiles };
		}
		console.warn(`[LAN Sync] Failed to fetch manifest from ${deviceId} via WS:`, result.error);
		return null;
	}

	/**
	 * 通过 WebSocket 拉取远程文件
	 */
	private async pullFilesWs(
		deviceId: string,
		filePaths: string[]
	): Promise<Array<{ filePath: string; content: string; isBinary?: boolean }>> {
		const result = await this.sendWsRequest(
			deviceId,
			{ type: 'sync-pull-request', filePaths },
			120000 // 文件传输给更长超时
		);
		if (result.success && result.files) {
			return result.files;
		}
		console.warn(`[LAN Sync] Failed to pull files from ${deviceId} via WS:`, result.error);
		return [];
	}

	/**
	 * 通过 WebSocket 推送文件到远程设备
	 */
	private async pushFilesWs(
		deviceId: string,
		files: Array<{ filePath: string; content: string; lastModified: number; isBinary?: boolean }>
	): Promise<boolean> {
		const result = await this.sendWsRequest(
			deviceId,
			{ type: 'sync-push', files },
			120000
		);
		return result.success === true;
	}

	// ========== 删除同步相关方法 ==========

	/**
	 * 检测本地已删除的文件（对比 hash 缓存与当前清单）
	 */
	private detectDeletedFiles(currentManifest: SyncRecord[]): string[] {
		const currentPaths = new Set(currentManifest.map(r => r.filePath));
		const deleted: string[] = [];
		const supportedExtensions = SUPPORTED_EXTENSIONS;

		for (const filePath of CryptoService.getCachedPaths()) {
			if (filePath.startsWith('.obsidian/')) continue;
			const ext = getFileExtension(filePath);
			if (!supportedExtensions.has(ext)) continue;
			if (!currentPaths.has(filePath)) {
				deleted.push(filePath);
			}
		}
		return deleted;
	}

	/**
	 * 处理对端发来的删除列表：备份后删除本地对应文件（并行处理）
	 */
	private async processRemoteDeletions(filePaths: string[]): Promise<string[]> {
		const results = await Promise.all(
			filePaths.map(async (filePath): Promise<string | null> => {
				const file = this.vault.getAbstractFileByPath(filePath);
				if (!file) return null;
				try {
					await this.historyManager.createCopy(filePath);
					await this.vault.delete(file);
					console.log(`[LAN Sync] Deleted synced file: ${filePath}`);
					return filePath;
				} catch (err) {
					console.warn(`[LAN Sync] Failed to delete file: ${filePath}`, err);
					return null;
				}
			})
		);
		return results.filter((p): p is string => p !== null);
	}

	/**
	 * 将本地删除列表发送给对端设备
	 */
	private async sendDeletionsToDevice(deviceId: string, deletedFiles: string[], settings: PluginSettings): Promise<boolean> {
		if (deletedFiles.length === 0) return true;
		const device = this.findDevice(settings, deviceId);
		if (!device) return false;

		if (this.isWsOnlyDevice(device)) {
			const result = await this.sendWsRequest(deviceId, { type: 'sync-delete', filePaths: deletedFiles });
			return result.success === true;
		} else {
			const baseUrl = `http://${device.address}:${device.port}`;
			const result = await this.httpClient.post(baseUrl, '/api/sync/delete', { filePaths: deletedFiles });
			return result.success === true;
		}
	}

	/**
	 * 将同步历史记录发送给对端设备保存
	 */
	private async sendSyncHistoryToDevice(deviceId: string, records: SyncHistoryRecord[], settings: PluginSettings): Promise<void> {
		if (records.length === 0) return;
		const device = this.findDevice(settings, deviceId);
		if (!device) {
			console.warn(`[LAN Sync] sendSyncHistoryToDevice: device ${deviceId} not found`);
			return;
		}

		if (this.isWsOnlyDevice(device)) {
			const wsSend = this.getDeviceWsSend(deviceId);
			if (wsSend) {
				wsSend({ type: 'sync-history', records });
			} else {
				console.warn(`[LAN Sync] No WS connection to send history to ${device.alias}`);
			}
		} else {
			const baseUrl = `http://${device.address}:${device.port}`;
			await this.httpClient.post(baseUrl, '/api/sync/history', { records });
		}
	}

	/**
	 * 同步单个绑定组
	 * @param isAutoSync 是否为定时自动同步（用于检查对端是否关闭了自动同步）
	 */
	private async syncBindingGroup(binding: BindingGroup, settings: PluginSettings, isAutoSync: boolean): Promise<void> {
		const otherDevices = binding.devices.filter((id) => id !== this.localDeviceId);
		if (otherDevices.length === 0) return;

		// 1. 收集所有在线设备的文件清单
		const manifests = new Map<string, SyncRecord[]>();
		const deletedFilesMap = new Map<string, string[]>();
		// 记录因对方关闭自动同步而跳过的设备（推送阶段也需跳过）
		const remoteAutoSyncSkipped = new Set<string>();

		// 加入本地清单
		const localManifest = await this.buildLocalManifest();
		manifests.set(this.localDeviceId, localManifest);

		// 检测本地已删除的文件（对比 hash 缓存）
		const localDeleted = this.detectDeletedFiles(localManifest);

		// 获取远程设备清单（根据设备类型选择 HTTP 或 WebSocket）
		for (const deviceId of otherDevices) {
			const device = this.findDevice(settings, deviceId);
			if (!device) continue;
			if (!this.isDeviceOnline(deviceId, device)) continue; // 离线跳过

			let records: SyncRecord[] | null = null;
			let remoteAutoSyncBindings: Record<string, boolean> | undefined;
			let remoteDeletedFiles: string[] = [];

			if (this.isWsOnlyDevice(device)) {
				// WebSocket 传输（手机端等无 HTTP 服务的设备）
				const manifestResult = await this.fetchManifestWs(deviceId);
				if (manifestResult) {
					records = manifestResult.records;
					remoteAutoSyncBindings = manifestResult.autoSyncBindings;
					remoteDeletedFiles = manifestResult.deletedFiles || [];
					// console.log(`[LAN Sync] WS manifest result: records=${records.length}, autoSyncBindings=${JSON.stringify(remoteAutoSyncBindings)}`);
				} else {
					console.warn(`[LAN Sync] WS manifest fetch returned null for ${device.alias}`);
				}
			} else {
				// HTTP 传输（桌面端）
				const baseUrl = `http://${device.address}:${device.port}`;
				const result = await this.httpClient.post<ManifestResponse & { autoSyncBindings?: Record<string, boolean>; deletedFiles?: string[] }>(
					baseUrl, '/api/sync/manifest', {}
				);
				// console.log(`[LAN Sync] HTTP manifest result: success=${result.success}, hasData=${!!result.data}, autoSyncBindings=${JSON.stringify(result.data?.autoSyncBindings)}`);
				if (result.success && result.data) {
					records = result.data.records;
					remoteAutoSyncBindings = result.data.autoSyncBindings;
					remoteDeletedFiles = result.data.deletedFiles || [];
				}
			}

			// 缓存对端自动同步状态（无论手动/自动同步都更新，以便设置页面显示）
			if (remoteAutoSyncBindings) {
				if (remoteAutoSyncBindings[binding.id] !== undefined) {
					if (!settings.remoteAutoSyncStatus) settings.remoteAutoSyncStatus = {};
					settings.remoteAutoSyncStatus[binding.id] = remoteAutoSyncBindings[binding.id];
					await saveSettings(this.plugin, settings);
					// 同步回插件主引用，确保设置页面读到最新值
					(this.plugin as any).settings.remoteAutoSyncStatus = settings.remoteAutoSyncStatus;
					(this.plugin as any).refreshSettingsTab?.();
				}
			}

			// 自动同步时检查对端是否关闭了该绑定组的自动同步
			if (isAutoSync && remoteAutoSyncBindings && remoteAutoSyncBindings[binding.id] === false) {
				console.log(`[LAN Sync] Remote device ${device.alias} has disabled auto-sync for binding ${binding.id}, skipping`);
				new Notice(t('notice.remoteAutoSyncOff'));
				remoteAutoSyncSkipped.add(deviceId);
				continue;
			}

			if (records) {
				manifests.set(deviceId, records);
			}

			// 收集对端删除列表（延迟到清单收集完成后统一处理，避免阻塞）
			if (remoteDeletedFiles.length > 0) {
				deletedFilesMap.set(deviceId, remoteDeletedFiles);
			}
		}

		// 1.5 异步处理删除（不阻塞清单对比和文件推送）
		const deletionPromise = (async () => {
			// 发送本地删除列表给各对端
			if (localDeleted.length > 0) {
				const sendPromises = otherDevices
					.filter(id => {
						if (remoteAutoSyncSkipped.has(id)) return false;
						const d = this.findDevice(settings, id);
						return d && this.isDeviceOnline(id, d);
					})
					.map(id => this.sendDeletionsToDevice(id, localDeleted, settings));
				await Promise.all(sendPromises);
			}
			// 处理对端的删除列表（并行备份+删除）
			for (const [deviceId, filePaths] of deletedFilesMap) {
				const actuallyDeleted = await this.processRemoteDeletions(filePaths);
				deletedFilesMap.set(deviceId, actuallyDeleted);
				if (actuallyDeleted.length > 0) {
					const device = this.findDevice(settings, deviceId);
					console.log(`[LAN Sync] Processed ${actuallyDeleted.length} remote deletions from ${device?.alias || deviceId.substring(0, 8)}`);
				}
			}
		})();

		// 2. 对比文件清单，找出需要拉取的文件（排除本端已删除的文件）
		const filesToSync = this.computeDiff(manifests, localDeleted);

		// 3. 如果既没有需要拉取也没有需要推送的文件，弹出提示并返回
		if (filesToSync.length === 0) {
			// 检查是否有需要推送的文件（对所有设备，离线设备视为空清单）
			const localRecordsForCheck = manifests.get(this.localDeviceId) || [];
			let hasFilesToPush = false;
			for (const deviceId of otherDevices) {
				if (remoteAutoSyncSkipped.has(deviceId)) continue;
				const device = this.findDevice(settings, deviceId);
				if (!device) continue;
				const remoteRecords = manifests.get(deviceId) || [];
				if (this.computePushFiles(localRecordsForCheck, remoteRecords).length > 0) {
					hasFilesToPush = true;
					break;
				}
			}
			if (!hasFilesToPush) {
				new Notice(t('notice.syncFileCountZero'));
				return;
			}
		}

		console.log(`[LAN Sync] Found ${filesToSync.length} files to sync`);

		// 4. 从源设备拉取文件（根据源设备类型选择 HTTP 或 WebSocket）
		const syncedFiles: SyncFileEntry[] = [];
		// 按源设备分组，减少 WS 请求次数
		const pullGroups = new Map<string, string[]>(); // sourceDeviceId -> filePaths
		for (const fileSync of filesToSync) {
			const device = this.findDevice(settings, fileSync.sourceDeviceId);
			if (!device) continue;

			if (this.isWsOnlyDevice(device)) {
				// WS 设备：按源分组，一次性拉取
				if (!pullGroups.has(fileSync.sourceDeviceId)) {
					pullGroups.set(fileSync.sourceDeviceId, []);
				}
				pullGroups.get(fileSync.sourceDeviceId)!.push(fileSync.filePath);
			} else {
				// HTTP 设备：逐个拉取
				const baseUrl = `http://${device.address}:${device.port}`;
				const result = await this.httpClient.downloadChunked(baseUrl, fileSync.filePath);
				if (result.success && result.data) {
					const action = this.vault.getAbstractFileByPath(fileSync.filePath) ? 'modify' : 'add';
					await this.applyFile(fileSync.filePath, result.data.content, fileSync.lastModified);
					syncedFiles.push({ path: fileSync.filePath, action });
				}
			}
		}
		// 批量拉取 WS 设备文件
		for (const [sourceDeviceId, filePaths] of pullGroups) {
			const files = await this.pullFilesWs(sourceDeviceId, filePaths);
			for (const f of files) {
				const fileSync = filesToSync.find(fs => fs.filePath === f.filePath);
				const lastModified = fileSync?.lastModified || Date.now();
				const action = this.vault.getAbstractFileByPath(f.filePath) ? 'modify' : 'add';
				await this.applyFile(f.filePath, f.content, lastModified);
				syncedFiles.push({ path: f.filePath, action });
			}
		}

		// 5. 推送本地较新的文件到其他在线设备
		const localRecords = manifests.get(this.localDeviceId) || [];
		const pushedFilesMap = new Map<string, SyncFileEntry[]>(); // deviceId -> SyncFileEntry[]

		for (const deviceId of otherDevices) {
			const device = this.findDevice(settings, deviceId);
			if (!device) continue;
			if (remoteAutoSyncSkipped.has(deviceId)) {
				continue;
			}
			const isOnline = this.isDeviceOnline(deviceId, device);
			if (!isOnline) {
				continue;
			}

			const remoteRecords = manifests.get(deviceId) || [];
			const remotePathSet = new Set(remoteRecords.map(r => r.filePath));
			const filesToPush = this.computePushFiles(localRecords, remoteRecords);
			if (filesToPush.length === 0) continue;

			const pushFiles: Array<{ filePath: string; content: string; lastModified: number; isBinary?: boolean }> = [];
			const pushEntries: SyncFileEntry[] = [];

			for (const pf of filesToPush) {
				const file = this.vault.getAbstractFileByPath(pf.filePath);
				if (!file) continue;

				const binaryExtensions = BINARY_EXTENSIONS;
				const fileExt = getFileExtension(pf.filePath);
				const isBinary = binaryExtensions.has(fileExt);

				let content: string;
				if (isBinary) {
					const binaryContent = await this.vault.readBinary(file as any);
					content = arrayBufferToBase64(binaryContent);
				} else {
					content = await this.vault.read(file as any);
				}

				pushFiles.push({
					filePath: pf.filePath,
					content,
					lastModified: pf.lastModified,
					isBinary,
				});
				pushEntries.push({ path: pf.filePath, action: remotePathSet.has(pf.filePath) ? 'modify' : 'add' });
			}

			if (pushFiles.length > 0) {
				let pushSuccess = false;
				if (this.isWsOnlyDevice(device)) {
					// WebSocket 推送
					const wsSend = this.getDeviceWsSend(deviceId);
					pushSuccess = await this.pushFilesWs(deviceId, pushFiles);
				} else {
					// HTTP 推送
					const baseUrl = `http://${device.address}:${device.port}`;
					const pushResult = await this.httpClient.post(baseUrl, '/api/sync/push', { files: pushFiles });
					pushSuccess = pushResult.success;
				}
				if (pushSuccess) {
					pushedFilesMap.set(deviceId, pushEntries);
				} else {
					console.warn(`[LAN Sync] Failed to push ${pushFiles.length} files to ${device.alias}`);
				}
			}
		}

		// 等待删除处理完成（删除操作已异步执行，此处仅确保在历史记录前完成）
		await deletionPromise;

		// 6. 记录同步历史（拉取、推送、删除分别记录）
		const localAlias = this.findDevice(settings, this.localDeviceId)?.alias || this.localDeviceId.substring(0, 8);

		// 按源设备分组拉取的文件
		const syncedByDevice = new Map<string, SyncFileEntry[]>();
		for (const entry of syncedFiles) {
			const fileSync = filesToSync.find(f => f.filePath === entry.path);
			const sourceId = fileSync?.sourceDeviceId || '';
			if (!syncedByDevice.has(sourceId)) syncedByDevice.set(sourceId, []);
			syncedByDevice.get(sourceId)!.push(entry);
		}

		// 合并拉取和删除到本端接收历史（均为 receive 类型）
		const receiveByDevice = new Map<string, SyncFileEntry[]>();
		for (const [sourceId, entries] of syncedByDevice) {
			receiveByDevice.set(sourceId, [...entries]);
		}
		for (const [deviceId, deletedPaths] of deletedFilesMap) {
			const delEntries: SyncFileEntry[] = deletedPaths.map(p => ({ path: p, action: 'del' as const }));
			const existing = receiveByDevice.get(deviceId);
			if (existing) {
				existing.push(...delEntries);
			} else {
				receiveByDevice.set(deviceId, delEntries);
			}
		}

		// 记录本端接收历史（拉取 + 删除）
		for (const [sourceId, fileEntries] of receiveByDevice) {
			if (fileEntries.length === 0 || !this.onSyncComplete) continue;
			const sourceDevice = this.findDevice(settings, sourceId);

			const record: SyncHistoryRecord = {
				id: `sh-${Date.now()}-${sourceId.substring(0, 4)}`,
				type: 'receive',
				sourceDeviceId: sourceId,
				sourceDeviceAlias: sourceDevice?.alias || sourceId.substring(0, 8),
				targetBindingId: binding.id,
				timestamp: Date.now(),
				files: fileEntries,
			};
			this.onSyncComplete(record);
		}

		const totalReceived = syncedFiles.length + [...deletedFilesMap.values()].reduce((sum, arr) => sum + arr.length, 0);
		if (totalReceived > 0) {
			const primarySourceId = [...syncedByDevice.keys()][0] || [...deletedFilesMap.keys()][0] || '';
			const primarySource = this.findDevice(settings, primarySourceId);
			new Notice(t('notice.syncComplete', { name: primarySource?.alias || primarySourceId.substring(0, 8), count: totalReceived }));
		}

		// 记录本端推送历史
		for (const [deviceId, pushedEntries] of pushedFilesMap) {
			if (pushedEntries.length === 0 || !this.onSyncComplete) continue;
			const device = this.findDevice(settings, deviceId);

			const record: SyncHistoryRecord = {
				id: `sh-${Date.now()}-${deviceId.substring(0, 4)}`,
				type: 'send',
				sourceDeviceId: deviceId,
				sourceDeviceAlias: device?.alias || deviceId.substring(0, 8),
				targetBindingId: binding.id,
				timestamp: Date.now(),
				files: pushedEntries,
			};
			this.onSyncComplete(record);
		}

		// 7. 将同步历史记录发送给对端设备保存
		// 原则：sourceDeviceId 始终指向对方设备，type 表示本端动作方向
		const remoteHistoryMap = new Map<string, SyncHistoryRecord[]>();

		// 本端拉取 → 对端记录"↑ 发送 对方(即本端)"
		for (const fileSync of filesToSync) {
			const sourceId = fileSync.sourceDeviceId;
			if (sourceId === this.localDeviceId) continue;
			if (!remoteHistoryMap.has(sourceId)) remoteHistoryMap.set(sourceId, []);
			const existing = remoteHistoryMap.get(sourceId)!;
			const entry: SyncFileEntry = {
				path: fileSync.filePath,
				action: syncedFiles.find(sf => sf.path === fileSync.filePath)?.action || 'modify',
			};
			if (existing.length === 0) {
				existing.push({
					id: `sh-${Date.now()}-r-${sourceId.substring(0, 4)}`,
					type: 'send',
					sourceDeviceId: this.localDeviceId,
					sourceDeviceAlias: localAlias,
					targetBindingId: binding.id,
					timestamp: Date.now(),
					files: [entry],
				});
			} else {
				existing[0].files.push(entry);
			}
		}

		// 本端推送 → 对端记录"↓ 接收 对方(即本端)"
		for (const [deviceId, pushedEntries] of pushedFilesMap) {
			if (pushedEntries.length === 0) continue;
			remoteHistoryMap.set(deviceId, [{
				id: `sh-${Date.now()}-r-${deviceId.substring(0, 4)}`,
				type: 'receive',
				sourceDeviceId: this.localDeviceId,
				sourceDeviceAlias: localAlias,
				targetBindingId: binding.id,
				timestamp: Date.now(),
				files: [...pushedEntries],
			}]);
		}

		// 本端删除 → 对端记录"↓ 接收 对方(即本端)"（删除文件列表追加到已有接收记录或新建）
		for (const [deviceId, deletedPaths] of deletedFilesMap) {
			if (deletedPaths.length === 0) continue;
			const delEntries: SyncFileEntry[] = deletedPaths.map(p => ({ path: p, action: 'del' as const }));
			const existing = remoteHistoryMap.get(deviceId);
			if (existing && existing.length > 0 && existing[0].type === 'receive') {
				existing[0].files.push(...delEntries);
			} else {
				remoteHistoryMap.set(deviceId, [{
					id: `sh-${Date.now()}-rd-${deviceId.substring(0, 4)}`,
					type: 'receive',
					sourceDeviceId: this.localDeviceId,
					sourceDeviceAlias: localAlias,
					targetBindingId: binding.id,
					timestamp: Date.now(),
					files: delEntries,
				}]);
			}
		}

		// 发送给各对端设备
		for (const [deviceId, records] of remoteHistoryMap) {
			await this.sendSyncHistoryToDevice(deviceId, records, settings);
		}
	}

	/**
	 * 构建本地文件清单（支持 md、图片、canvas）
	 */
	private async buildLocalManifest(): Promise<SyncRecord[]> {
		const records: SyncRecord[] = [];
		const allFiles = this.vault.getFiles();
	
		for (const file of allFiles) {
			const ext = getFileExtension(file.path);
			if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
			if (file.path.startsWith('.obsidian/')) continue;
	
			const stat = await this.vault.adapter.stat(file.path);
			if (!stat) continue;

			let hash = CryptoService.getCachedHash(file.path, stat.mtime);
			if (!hash) {
				try {
					if (BINARY_EXTENSIONS.has(ext)) {
						const buf = await this.vault.readBinary(file as any);
						hash = CryptoService.computeMD5(buf);
					} else {
						const content = await this.vault.read(file as any);
						hash = CryptoService.computeMD5(content);
					}
					CryptoService.setCachedHash(file.path, stat.mtime, hash);
				} catch {
					continue;
				}
			}

			records.push({
				filePath: file.path,
				lastModified: stat.mtime,
				size: stat.size,
				hash,
			});
		}
	
		return records;
	}

	/**
	 * 对比各设备文件清单，返回需要同步的文件列表
	 * 策略：以拥有最晚 mtime 的设备为源
	 * 排除本端已删除的文件（避免重命名后旧文件被重新拉回）
	 */
	private computeDiff(
		manifests: Map<string, SyncRecord[]>,
		localDeletedFiles?: string[]
	): Array<{ filePath: string; sourceDeviceId: string; lastModified: number }> {
		const result: Array<{ filePath: string; sourceDeviceId: string; lastModified: number }> = [];
		const deletedSet = new Set(localDeletedFiles || []);

		// 构建全局文件 -> 各设备版本映射（含 hash 用于内容一致性判断）
		const fileVersions = new Map<string, Array<{ deviceId: string; mtime: number; hash: string }>>();

		for (const [deviceId, records] of manifests) {
			for (const record of records) {
				if (!fileVersions.has(record.filePath)) {
					fileVersions.set(record.filePath, []);
				}
				fileVersions.get(record.filePath)!.push({
					deviceId,
					mtime: record.lastModified,
					hash: record.hash,
				});
			}
		}

		// 对每个文件，找到最新版本，如果本地不是最新则需要同步
		for (const [filePath, versions] of fileVersions) {
			// 本端已删除的文件不再拉回（可能是重命名操作）
			if (deletedSet.has(filePath)) continue;

			versions.sort((a, b) => b.mtime - a.mtime);
			const latest = versions[0];

			const localVersion = versions.find((v) => v.deviceId === this.localDeviceId);
			if (!localVersion || localVersion.mtime < latest.mtime) {
				// MD5 一致时视为内容相同，跳过拉取
				if (localVersion && localVersion.hash === latest.hash) continue;
				result.push({
					filePath,
					sourceDeviceId: latest.deviceId,
					lastModified: latest.mtime,
				});
			}
		}

		return result;
	}

	/**
	 * 对比本地与远程清单，返回本地较新需要推送的文件列表
	 */
	private computePushFiles(
		localRecords: SyncRecord[],
		remoteRecords: SyncRecord[]
	): Array<{ filePath: string; lastModified: number }> {
		const remoteMap = new Map<string, { mtime: number; hash: string }>();
		for (const r of remoteRecords) {
			remoteMap.set(r.filePath, { mtime: r.lastModified, hash: r.hash });
		}

		const result: Array<{ filePath: string; lastModified: number }> = [];
		for (const local of localRecords) {
			const remote = remoteMap.get(local.filePath);
			// 远程没有该文件，或本地更新
			if (remote === undefined || local.lastModified > remote.mtime) {
				// MD5 一致时视为内容相同，跳过推送
				if (remote !== undefined && local.hash === remote.hash) continue;
				result.push({ filePath: local.filePath, lastModified: local.lastModified });
			}
		}
		return result;
	}


	/**
	 * 将同步文件写入本地仓库（仅在内容变更时创建历史副本并写入）
	 */
	private async applyFile(filePath: string, content: string, lastModified: number): Promise<void> {
		try {
			const existingFile = this.vault.getAbstractFileByPath(filePath);

			if (existingFile) {
				// 对比内容，仅在内容变更时才备份并写入
				const ext = getFileExtension(filePath);
				let isContentSame = false;

				if (BINARY_EXTENSIONS.has(ext)) {
					// 二进制文件：将现有内容转为 base64 对比
					try {
						const existingBinary = await this.vault.readBinary(existingFile as any);
						const existingBase64 = arrayBufferToBase64(existingBinary);
						isContentSame = existingBase64 === content;
					} catch { /* 读取失败则视为内容不同 */ }
				} else {
					// 文本文件：直接对比字符串
					try {
						const existingContent = await this.vault.read(existingFile as any);
						isContentSame = existingContent === content;
					} catch { /* 读取失败则视为内容不同 */ }
				}

				if (isContentSame) {
					console.log(`[LAN Sync] Skipped unchanged file: ${filePath}`);
					return;
				}

				// 内容已变更，创建历史副本后写入
				await this.historyManager.createCopy(filePath);
				await this.vault.modify(existingFile as any, content);
			} else {
				// 新文件，确保父目录存在后创建
				await ensureParentDir(this.vault, filePath);
				await this.vault.create(filePath, content);
			}
		} catch (err: any) {
			const errMsg = err?.message || String(err);
			const contentLen = typeof content === 'string' ? content.length : 'undefined';
			console.error(`[LAN Sync] Failed to apply file: ${filePath} (content length: ${contentLen})`, errMsg);
		}
	}
}
