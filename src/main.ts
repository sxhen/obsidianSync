import { Plugin, Platform, Notice, TFile, TFolder, Menu } from 'obsidian';
import type { PluginSettings, INetworkTransport, DeviceInfo, BindingGroup, PairingSession } from './types';
import { loadSettings, saveSettings, loadSyncHistory, saveSyncHistory } from './settings';
import { getOrCreateDeviceIdentity } from './services/deviceIdentity';
import { DesktopNetworkTransport } from './services/network/desktopNetwork';
import { MobileNetworkTransport } from './services/network/mobileNetwork';
import { DiscoveryService } from './services/discoveryService';
import { HttpClient } from './services/httpClient';
import { HttpApiServer } from './services/network/httpServer';
import { PairingService } from './services/pairingService';
import { HistoryManager } from './services/historyManager';
import { SyncEngine } from './services/syncEngine';
import { ShareService } from './services/shareService';
import { CryptoService } from './services/cryptoService';
import { WebSocketService } from './services/websocketService';
import { WebSocketClientService } from './services/websocketClient';
import { LanSyncSettingTab } from './ui/settingsTab';
import type { SyncHistoryRecord } from './types';
import { t } from './i18n';
import { SUPPORTED_EXTENSIONS, BINARY_EXTENSIONS, getFileExtension, isBinaryFile, arrayBufferToBase64, base64ToArrayBuffer, ensureParentDir } from './utils';

const HTTP_PORT = 24532;

export default class LanSyncPlugin extends Plugin {
	settings!: PluginSettings;
	transport!: INetworkTransport;
	discoveryService!: DiscoveryService;
	httpClient!: HttpClient;
	httpApiServer!: HttpApiServer;
	pairingService!: PairingService;
	historyManager!: HistoryManager;
	syncEngine!: SyncEngine;
	shareService!: ShareService;
	cryptoService!: CryptoService;
	wsService!: WebSocketService;
	wsClients: Map<string, WebSocketClientService> = new Map();
	settingsTab: LanSyncSettingTab | null = null;
	private statusBarEl: HTMLElement | null = null;
	private ribbonIconEl: HTMLElement | null = null;

	/** 发起方：跟踪待处理的绑定请求（用于对方拒绝时关闭验证码弹窗） */
	private pendingPairRequests: Map<string, { modal: any; targetDevice: DeviceInfo }> = new Map();

	private localDeviceId = '';

	/**
	 * 刷新设置面板（数据变更后调用）
	 */
	refreshSettingsTab(): void {
		this.settingsTab?.display();
	}

	/**
	 * 记录同步历史
	 */
	addSyncHistory(record: SyncHistoryRecord): void {
		this.settings.syncHistory.unshift(record);
		if (this.settings.syncHistory.length > this.settings.maxSyncHistory) {
			this.settings.syncHistory = this.settings.syncHistory.slice(0, this.settings.maxSyncHistory);
		}
		saveSyncHistory(this, this.settings.syncHistory);
		this.refreshSettingsTab();
	}

	getLocalDeviceId(): string {
		return this.localDeviceId;
	}

	/**
	 * 获取已绑定设备 ID 集合（不含本机）
	 */
	getBoundDeviceIds(): Set<string> {
		const boundIds = new Set<string>();
		for (const g of this.settings.bindings) {
			if (g.devices.includes(this.localDeviceId)) {
				for (const id of g.devices) {
					if (id !== this.localDeviceId) boundIds.add(id);
				}
			}
		}
		return boundIds;
	}

	/**
	 * 获取所有可展示的设备（已发现 + WebSocket 已连接 + 已绑定但未发现的）
	 */
	getAllDisplayDevices(): DeviceInfo[] {
		const discovered = this.discoveryService?.getKnownDevices() || [];
		const discoveredIds = new Set(discovered.map(d => d.id));
		const result: DeviceInfo[] = [...discovered];

		// 补充 WebSocket 已连接但未在发现服务中的设备
		if (this.isDesktop && this.wsService) {
			for (const deviceId of this.wsService.getConnectedDeviceIds()) {
				if (deviceId === this.localDeviceId) continue;
				if (discoveredIds.has(deviceId)) continue;
				discoveredIds.add(deviceId);
				result.push({
					id: deviceId,
					alias: t('device.connectedDevice', { id: deviceId.substring(0, 8) }),
					platform: 'mobile',
					port: 0,
					lastSeen: Date.now(),
					discoverable: false,
				});
			}
		}

		// 从绑定组中找出未发现的非本机设备
		for (const binding of this.settings.bindings) {
			for (const deviceId of binding.devices) {
				if (deviceId === this.localDeviceId) continue;
				if (discoveredIds.has(deviceId)) continue;
				discoveredIds.add(deviceId);
				const cachedAlias = binding.deviceAliases?.[deviceId];
				result.push({
					id: deviceId,
					alias: cachedAlias || t('device.boundDevice', { id: deviceId.substring(0, 8) }),
					platform: 'desktop',
					port: 0,
					lastSeen: 0,
					discoverable: false,
				});
			}
		}

		return result;
	}
	private localDeviceAlias = '';
	private isDesktop = false;

	async onload(): Promise<void> {
		this.isDesktop = Platform.isDesktopApp;
		// 1. 加载设置
		this.settings = await loadSettings(this);

		// 1.5 加载 MD5 哈希缓存
		await CryptoService.loadCache(this.app.vault.adapter, `${this.app.vault.configDir}/plugins/${this.manifest.id}/.lan-sync-hash-cache.json`);

		// 1.6 加载同步历史（独立文件）
		this.settings.syncHistory = await loadSyncHistory(this);

		// 2. 初始化设备身份
		const identity = await getOrCreateDeviceIdentity(this.settings);
		this.localDeviceId = identity.deviceId;
		this.localDeviceAlias = identity.alias;
		await saveSettings(this, this.settings);

		// 3. 初始化网络传输层
		this.transport = this.isDesktop
			? new DesktopNetworkTransport()
			: new MobileNetworkTransport();

		// 4. 初始化加密服务
		this.cryptoService = new CryptoService();

		// 5. 初始化各服务
		this.httpClient = new HttpClient(this.transport, this.settings.chunkSize);
		this.httpClient.setCryptoService(this.cryptoService);
		this.historyManager = new HistoryManager(
			this.app.vault,
			this.settings.historyFolder,
			this.settings.maxHistoryCopies
		);

		// 5. 创建设备信息
		const localDevice: DeviceInfo = {
			id: this.localDeviceId,
			alias: this.localDeviceAlias,
			platform: this.isDesktop ? 'desktop' : 'mobile',
			port: this.isDesktop ? HTTP_PORT : 0,
			address: this.isDesktop ? this.transport.getLocalIP() : undefined,
			lastSeen: Date.now(),
			discoverable: this.settings.discoverable,
		};

		// 6. 初始化设备发现
		this.discoveryService = new DiscoveryService(this.transport, localDevice);
		this.discoveryService.setOnDevicesChanged(() => {
			// 设备列表变更，刷新设置页面以更新在线/离线状态
			console.log(`[LAN Sync] Known devices: ${this.discoveryService.getKnownDevices().length}`);
			this.refreshSettingsTab();
		});

		// 6.5 从绑定缓存中恢复设备别名到 knownDevices（设备离线时仍可显示名称）
		for (const binding of this.settings.bindings) {
			this.restoreAliasesFromBinding(binding);
		}

		// 6.6 移动端：恢复已缓存的手动添加桌面设备
		if (!this.isDesktop && this.settings.manualDesktopDevices.length > 0) {
			this.discoveryService.restoreManualDevices(this.settings.manualDesktopDevices);
		}

		// 6.6 设置手动设备变更回调，持久化到 data.json
		this.discoveryService.setOnManualDevicesChanged(async () => {
			this.settings.manualDesktopDevices = this.discoveryService.getManualDevices().map(d => ({
				id: d.id,
				alias: d.alias,
				platform: d.platform,
				port: d.port,
				address: d.address,
				lastSeen: d.lastSeen,
				discoverable: d.discoverable,
				isManual: true,
			}));
			await saveSettings(this, this.settings);
		});

		// 7. 初始化绑定服务
		this.pairingService = new PairingService(
			this, this.transport, this.httpClient,
			this.localDeviceId, this.localDeviceAlias
		);

		// 8. 初始化分享服务
		this.shareService = new ShareService(
			this, this.app.vault, this.transport, this.httpClient,
			this.localDeviceId, this.localDeviceAlias,
			this.isDesktop ? 'desktop' : 'mobile'
		);

		// 9. 初始化同步引擎（传入加密服务）
		this.syncEngine = new SyncEngine(
			this, this.app.vault, this.transport, this.httpClient,
			this.historyManager, this.localDeviceId, this.cryptoService
		);
		this.syncEngine.setOnSyncComplete((record) => {
			this.addSyncHistory(record);
		});

		// 10. 启动服务（桌面端）
		if (this.isDesktop) {
			await this.startDesktopServices(localDevice);
			// 有活跃 WebSocket 连接的设备不应被清理服务移除
			this.discoveryService.setProtectedDeviceIdsProvider(() => {
				return new Set(this.wsService?.getConnectedDeviceIds() || []);
			});
		}

		// 10.1 已绑定设备不应被清理服务删除（仅标记离线，保留别名和平台类型缓存）
		this.discoveryService.setBoundDeviceIdsProvider(() => {
			const boundIds = new Set<string>();
			for (const binding of this.settings.bindings) {
				for (const deviceId of binding.devices) {
					if (deviceId !== this.localDeviceId) {
						boundIds.add(deviceId);
					}
				}
			}
			return boundIds;
		});

		// 10.5 将 WebSocket 服务引用注入同步引擎
		this.syncEngine.setWebSocketServices(this.wsService, this.wsClients);
		// 10.6 将设备发现服务注入同步引擎
		this.syncEngine.setDiscoveryService(this.discoveryService);

		// 11. 启动设备发现
		await this.discoveryService.start();

		// 11.5 移动端：连接到已知的手动设备 WebSocket
		if (!this.isDesktop) {
			for (const device of this.discoveryService.getKnownDevices()) {
				if (device.isManual && device.address && device.port) {
					this.connectToDeviceWebSocket(device);
				}
			}
		}

		// 11.6 启动时立即探查已绑定设备的在线状态
		await this.probeBoundDevices();

		// 12. 启动定时同步
		this.syncEngine.start(this.settings.syncIntervalMinutes);

		// 13. 注册设置面板
		this.settingsTab = new LanSyncSettingTab(this);
		this.addSettingTab(this.settingsTab);

		// 14. 注册文件/文件夹右键菜单 - 分享
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (file instanceof TFile || file instanceof TFolder) {
					menu.addItem((item) => {
						item
							.setTitle(t('menu.shareToDevice'))
							.setIcon('share')
							.onClick(async () => {
								await this.showShareMenu(file);
							});
					});
				}
			})
		);

		// 15. 注册命令
		this.addCommand({
			id: 'lan-sync-view-devices',
			name: t('command.viewDevices'),
			callback: () => {
				const { DeviceListModal } = require('./ui/deviceListModal');
				const boundIds = this.getBoundDeviceIds();
				new DeviceListModal(
					() => this.getAllDisplayDevices(),
					(device: DeviceInfo) => {
						if (!boundIds.has(device.id)) {
							this.initiateBinding(device);
						}
					},
					boundIds,
					undefined,
					async (device: DeviceInfo) => {
						this.discoveryService.removeManualDevice(device.id);
						new Notice(t('notice.deviceDeleted', { name: device.alias }));
					},
					false,
					(deviceId: string) =>
						(this.wsService?.getConnectedDeviceIds().includes(deviceId) ?? false)
						|| (this.wsClients.get(deviceId)?.connected() ?? false)
				).open();
			},
		});

		this.addCommand({
			id: 'lan-sync-sync-now',
			name: t('command.syncNow'),
			callback: () => {
				this.syncEngine.runSync();
			},
		});

		if (this.isDesktop) {
			// 桌面端：使用状态栏
			const statusBarEl = this.addStatusBarItem();
			statusBarEl.addClass('lan-sync-statusbar');
			this.statusBarEl = statusBarEl;
			this.updateStatusBar();

			// 点击状态栏弹出菜单
			statusBarEl.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.showStatusBarMenu(statusBarEl);
			});
		} else {
			// 移动端：使用 ribbon 图标（手机端无状态栏）
			this.ribbonIconEl = this.addRibbonIcon('wifi', 'LAN Sync', (evt: MouseEvent) => {
				this.showStatusBarMenu(this.ribbonIconEl!);
			});
			this.ribbonIconEl.addClass('lan-sync-ribbon-icon');
			this.updateStatusBar();
		}

		console.log(`[LAN Sync] Plugin loaded (platform: ${this.isDesktop ? 'desktop' : 'mobile'}, device: ${this.localDeviceAlias})`);
	}

	async onunload(): Promise<void> {
		// 保存 MD5 哈希缓存
		await CryptoService.saveCache(this.app.vault.adapter, `${this.app.vault.configDir}/plugins/${this.manifest.id}/.lan-sync-hash-cache.json`);
		// 保存同步历史
		await saveSyncHistory(this, this.settings.syncHistory);

		this.syncEngine?.stop();
		// 在停止发现服务前，广播下线通知给其他桌面端（等待 UDP 发送完成）
		if (this.isDesktop && this.discoveryService) {
			await this.discoveryService.broadcastGoodbye();
		}
		this.discoveryService?.stop();
		this.httpApiServer?.stop();
		this.wsService?.stop();
		for (const [, client] of this.wsClients) {
			client.disconnect();
		}
		this.wsClients.clear();
		console.log('[LAN Sync] Plugin unloaded');
	}

	/**
	 * 启动桌面端服务（HTTP Server + API 路由注册）
	 */
	private async startDesktopServices(localDevice: DeviceInfo): Promise<void> {
		this.httpApiServer = new HttpApiServer(this.transport);

		// 注册 API 路由
		this.httpApiServer.registerRoute('GET', '/api/device', async () => {
			return localDevice;
		});

		this.httpApiServer.registerRoute('GET', '/api/health', async () => {
			return { status: 'ok', deviceId: this.localDeviceId, timestamp: Date.now() };
		});

		this.httpApiServer.registerRoute('POST', '/api/pair/request', async (body) => {
			const resultSessionId = this.handleIncomingPairRequest(body.fromDeviceId, body.fromDeviceAlias, body.sessionId, body.code, body.fromDevicePlatform);
			return { sessionId: resultSessionId || body.sessionId };
		});

		this.httpApiServer.registerRoute('POST', '/api/pair/verify', async (body) => {
			const valid = this.pairingService.verifyCode(body.sessionId, body.code);
			return { valid };
		});

		this.httpApiServer.registerRoute('POST', '/api/pair/confirm', async (body) => {
			await this.pairingService.handleRemoteConfirm(body.binding, this.settings);
			this.closePendingModalForDevice(body.fromDeviceId);
			new Notice(t('notice.bindSuccess'));
			return {};
		});

		this.httpApiServer.registerRoute('POST', '/api/pair/reject', async (body) => {
			this.handlePairRejected(body.sessionId);
			return {};
		});

		this.httpApiServer.registerRoute('POST', '/api/pair/cancel', async (body) => {
			// 发起方取消绑定，静默清理会话
			this.pairingService.cancelSession(body.sessionId);
			return {};
		});

		// 通用消息接收端点（HTTP 回退通道，用于桌面端之间的消息传递）
		this.httpApiServer.registerRoute('POST', '/api/message', async (body) => {
			if (body.type === 'pair-confirmed') {
				// 目标方确认绑定，发起方保存绑定关系并关闭弹窗
				this.ensureBindingSaved(body.binding);
				const otherDeviceId = body.binding.devices.find((id: string) => id !== this.localDeviceId);
				if (otherDeviceId) this.closePendingModalForDevice(otherDeviceId);
			} else if (body.type === 'pair-rejected') {
				this.handlePairRejected(body.sessionId);
			} else if (body.type === 'pair-cancelled') {
				this.pairingService.cancelSession(body.sessionId);
				new Notice(t('notice.pairCancelled'));
			} else if (body.type === 'unbind-notify') {
				this.handleUnbindNotify(body.fromDeviceId);
			}
			return {};
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/manifest', async () => {
			const allFiles = this.app.vault.getFiles();
			const records: Array<{ filePath: string; lastModified: number; size: number; hash: string }> = [];
			for (const file of allFiles) {
				const ext = getFileExtension(file.path);
				if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
				if (file.path.startsWith('.obsidian/')) continue;
				let hash = CryptoService.getCachedHash(file.path, file.stat.mtime);
				if (!hash) {
					try {
						if (BINARY_EXTENSIONS.has(ext)) {
							const buf = await this.app.vault.readBinary(file as any);
							hash = CryptoService.computeMD5(buf);
						} else {
							const content = await this.app.vault.read(file as any);
							hash = CryptoService.computeMD5(content);
						}
						CryptoService.setCachedHash(file.path, file.stat.mtime, hash);
					} catch { continue; }
				}
				records.push({
					filePath: file.path,
					lastModified: file.stat.mtime,
					size: file.stat.size,
					hash,
				});
			}
			const currentPaths = new Set(records.map(r => r.filePath));
			const deletedFiles = CryptoService.getCachedPaths().filter(p => !p.startsWith('.obsidian/') && !currentPaths.has(p));
			return { deviceId: this.localDeviceId, records, timestamp: Date.now(), autoSyncBindings: this.buildAutoSyncBindingsMap(), deletedFiles };
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/pull', async (body) => {
			const files: Array<{ filePath: string; content: string; lastModified: number; isBinary?: boolean }> = [];
			for (const filePath of body.filePaths || []) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file) {
					const isBinary = isBinaryFile(filePath);
					let content: string;
					if (isBinary) {
						const binaryContent = await this.app.vault.readBinary(file as any);
						content = arrayBufferToBase64(binaryContent);
					} else {
						content = await this.app.vault.read(file as any);
					}
					files.push({
						filePath,
						content,
						lastModified: (file as any).stat.mtime,
						isBinary,
					});
				}
			}
			return { files };
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/push', async (body) => {
			for (const file of body.files || []) {
				const existing = this.app.vault.getAbstractFileByPath(file.filePath);
				if (file.isBinary) {
					const binaryContent = base64ToArrayBuffer(file.content);
					if (existing) {
						if (await this.isFileContentSame(file.filePath, file.content, true)) {
							continue;
						}
						await this.historyManager.createCopy(file.filePath);
						await this.app.vault.modifyBinary(existing as any, binaryContent);
					} else {
						await ensureParentDir(this.app.vault, file.filePath);
						await this.app.vault.createBinary(file.filePath, binaryContent);
					}
				} else {
					if (existing) {
						if (await this.isFileContentSame(file.filePath, file.content, false)) {
							continue;
						}
						await this.historyManager.createCopy(file.filePath);
						await this.app.vault.modify(existing as any, file.content);
					} else {
						await ensureParentDir(this.app.vault, file.filePath);
						await this.app.vault.create(file.filePath, file.content);
					}
				}
			}
			return { received: body.files?.length || 0 };
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/delete', async (body) => {
			const deleted: string[] = [];
			for (const filePath of body.filePaths || []) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (file) {
					try {
						await this.historyManager.createCopy(filePath);
						await this.app.vault.delete(file);
						deleted.push(filePath);
					} catch (err) {
						console.warn('[LAN Sync] Failed to delete synced file:', filePath, err);
					}
				}
			}
			return { success: true, deleted };
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/history', async (body) => {
			for (const record of body.records || []) {
				this.addSyncHistory(record);
			}
			return { success: true };
		});

		this.httpApiServer.registerRoute('POST', '/api/share', async (body) => {
			// 黑名单设备直接拒绝，不弹窗
			if (this.settings.blacklist.some((e) => e.id === body.fromDeviceId)) {
				new Notice(t('notice.blacklistedDeviceRejected'));
				return { received: true, rejected: true };
			}
			// 始终弹出分享接收确认窗口（无论是否绑定）
			setTimeout(() => {
				const { ShareReceiveModal } = require('./ui/shareReceiveModal');
				const request = {
					fromDeviceId: body.fromDeviceId,
					fromDeviceAlias: body.fromDeviceAlias,
					fromDevicePlatform: body.fromDevicePlatform || 'desktop' as const,
					fileName: body.fileName,
					fileContent: body.fileContent,
					filePath: body.filePath,
					isBinary: body.isBinary || false,
				};
				new ShareReceiveModal(request, async (decision: string, savePath?: string) => {
					if (decision === 'accept') {
						await this.shareService.saveSharedNote(request.fileName, request.fileContent, request.filePath, request.isBinary);
						new Notice(t('notice.fileReceived', { name: request.fileName }));
					} else if (decision === 'saveAs' && savePath) {
						await this.shareService.saveSharedNoteAs(request.fileName, request.fileContent, savePath, request.isBinary);
						new Notice(t('notice.fileSavedAs', { path: savePath }));
					} else if (decision === 'blacklist') {
						await this.shareService.addToBlacklist(request.fromDeviceId, request.fromDeviceAlias, request.fromDevicePlatform, this.settings);
						new Notice(t('notice.shareRejectedBlacklist'));
					} else {
						await this.shareService.recordReject(request.fromDeviceId, this.settings, request.fromDeviceAlias, request.fromDevicePlatform);
						new Notice(t('notice.shareRejected'));
					}
				}, this.getBoundDeviceIds().has(request.fromDeviceId)).open();
			}, 100);
			return { received: true };
		});

		// 分片上传 API 路由
		const uploadSessions = new Map<string, { filePath: string; totalChunks: number; chunks: string[]; metadata: any }>();

		this.httpApiServer.registerRoute('POST', '/api/sync/upload/init', async (body) => {
			uploadSessions.set(body.sessionId, {
				filePath: body.filePath,
				totalChunks: body.totalChunks,
				chunks: [],
				metadata: body,
			});
			return { sessionId: body.sessionId };
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/upload/chunk', async (body) => {
			const session = uploadSessions.get(body.sessionId);
			if (!session) return { error: 'Session not found' };
			session.chunks[body.chunkIndex] = body.data;
			return { chunkIndex: body.chunkIndex, received: true };
		});

		this.httpApiServer.registerRoute('POST', '/api/sync/upload/complete', async (body) => {
			const session = uploadSessions.get(body.sessionId);
			if (!session) return { error: 'Session not found' };

			// 拼接分片并解密（如果加密传输）
			const fullContent = session.chunks.join('');
			const content = this.cryptoService.hasKey()
				? this.cryptoService.decrypt(fullContent)
				: fullContent;

			const existing = this.app.vault.getAbstractFileByPath(session.filePath);
			if (existing) {
				if (await this.isFileContentSame(session.filePath, content, false)) {
					// 内容未变更，跳过
				} else {
					await this.historyManager.createCopy(session.filePath);
					await this.app.vault.modify(existing as any, content);
				}
			} else {
				await ensureParentDir(this.app.vault, session.filePath);
				await this.app.vault.create(session.filePath, content);
			}

			uploadSessions.delete(body.sessionId);
			return { received: true, filePath: session.filePath };
		});

		await this.httpApiServer.start(HTTP_PORT);

		// 启动 WebSocket 服务（挂载到 HTTP Server）
		this.wsService = new WebSocketService();
		const httpServer = this.httpApiServer.getHttpServer();
		if (httpServer) {
			await this.wsService.start(httpServer);
		}

		// 设置 WebSocket 消息处理
		this.wsService.setOnMessage((deviceId, data) => {
			// 每次收到消息都刷新设备 lastSeen
			this.discoveryService.refreshDeviceLastSeen(deviceId);

			if (data.type === 'ping') {
				this.wsService.sendToDevice(deviceId, { type: 'pong' });
			} else if (data.type === 'sync-trigger') {
				this.syncEngine.runSync();
			} else if (data.type === 'device-info') {
				// 移动端通过 WebSocket 注册设备信息
				const deviceInfo: DeviceInfo = {
					...data.device,
					lastSeen: Date.now(),
				};
				this.discoveryService.registerRemoteDevice(deviceInfo);
				console.log(`[LAN Sync] Registered remote device via WS: ${deviceInfo.alias} (${deviceInfo.id})`);
				// 回复桌面端真实设备信息，供移动端更新缓存
				this.wsService.sendToDevice(deviceId, {
					type: 'device-info-response',
					device: {
						id: this.localDeviceId,
						alias: this.localDeviceAlias,
						platform: 'desktop',
					},
				});
				this.refreshSettingsTab();
			} else if (data.type === 'unbind-notify') {
				// 收到其他设备的解绑通知
				this.handleUnbindNotify(deviceId);
			} else if (data.type === 'pair-rejected') {
				// 发起方收到对方拒绝绑定的通知
				this.handlePairRejected(data.sessionId);
			} else if (data.type === 'pair-confirmed') {
				// 目标方确认绑定，发起方保存绑定关系并关闭弹窗
				this.ensureBindingSaved(data.binding);
				const otherDeviceId = data.binding.devices.find((id: string) => id !== this.localDeviceId);
				if (otherDeviceId) this.closePendingModalForDevice(otherDeviceId);
			} else if (data.type === 'pair-request') {
				// 移动端通过 WebSocket 发起绑定请求
				this.handleIncomingPairRequest(data.fromDeviceId, data.fromDeviceAlias, data.sessionId, data.code, data.fromDevicePlatform);
			} else if (data.type === 'pair-cancelled') {
				// 目标方收到发起方取消绑定的通知
				this.pairingService.cancelSession(data.sessionId);
				new Notice(t('notice.pairCancelled'));
			} else if (
				data.type === 'sync-manifest-response' ||
				data.type === 'sync-pull-response' ||
				data.type === 'sync-push-ack'
			) {
				// 手机端对桌面端同步请求的响应，路由到同步引擎
				this.syncEngine.handleWsSyncResponse(data);
			} else if (data.type === 'sync-manifest-request') {
				// 手机端请求桌面端的文件清单
				this.handleSyncManifestRequest(deviceId, data.requestId);
			} else if (data.type === 'sync-pull-request') {
				// 手机端请求桌面端拉取文件（桌面端发送文件给手机端）
				this.handleSyncPullRequest(deviceId, data.requestId, data.filePaths);
			} else if (data.type === 'sync-push') {
				// 手机端推送文件到桌面端
				this.handleSyncPush(deviceId, data.requestId, data.files);
			} else if (data.type === 'sync-delete') {
				// 手机端请求删除文件
				(async () => {
					const deleted: string[] = [];
					for (const filePath of data.filePaths || []) {
						const file = this.app.vault.getAbstractFileByPath(filePath);
						if (file) {
							try {
								await this.historyManager.createCopy(filePath);
								await this.app.vault.delete(file);
								deleted.push(filePath);
							} catch (err) {
								console.warn('[LAN Sync] Failed to delete synced file:', filePath, err);
							}
						}
					}
					this.sendToDeviceMessage(deviceId, { type: 'sync-delete-ack', requestId: data.requestId, success: true, deleted: deleted.length });
				})();
			} else if (data.type === 'sync-history') {
				// 手机端发来的同步历史记录
				for (const record of data.records || []) {
					this.addSyncHistory(record);
				}
			} else if (data.type === 'share-rejected') {
				// 对方黑名单拦截，分享被拒绝
				new Notice(t('notice.shareRejectedByReceiver', { name: data.fileName }));
			}
		});

		this.wsService.setOnClientConnected((deviceId) => {
			console.log(`[LAN Sync] WebSocket client connected: ${deviceId}`);
			// 请求客户端发送设备信息
			this.wsService.sendToDevice(deviceId, { type: 'request-device-info' });
		});

		this.wsService.setOnClientDisconnected((deviceId) => {
			console.log(`[LAN Sync] WebSocket client disconnected: ${deviceId}`);
			// 标记设备为离线
			const device = this.discoveryService.getKnownDevices().find(d => d.id === deviceId);
			if (device) {
				device.lastSeen = 0;
			}
			// 立即刷新设置页面以更新在线/离线状态
			this.refreshSettingsTab();
		});
	}

	/**
	 * 发起设备绑定流程
	 */
	async initiateBinding(targetDevice: DeviceInfo): Promise<void> {
		let session: PairingSession;

		// 优先使用 WebSocket（如果与目标设备有活跃连接），否则回退到 HTTP
		session = this.pairingService.createSession();
		// 检查 WebSocket 连接：桌面端用 wsService（服务端），手机端用 wsClients（客户端）
		const connectedIds = new Set(this.wsService?.getConnectedDeviceIds() || []);
		for (const [id] of this.wsClients) connectedIds.add(id);

		if (connectedIds.has(targetDevice.id)) {
			// WebSocket 可达，通过 WebSocket 发送绑定请求
			const pairRequestData = {
				type: 'pair-request',
				sessionId: session.sessionId,
				fromDeviceId: this.localDeviceId,
				fromDeviceAlias: this.localDeviceAlias,
				fromDevicePlatform: this.isDesktop ? 'desktop' : 'mobile',
				code: session.code,
			};
			const wsSent = this.wsService?.sendToDevice(targetDevice.id, pairRequestData)
				?? this.wsClients.get(targetDevice.id)?.send(pairRequestData);
			if (!wsSent) {
				new Notice(t('notice.bindFailed'));
				this.pairingService.cancelSession(session.sessionId);
				return;
			}
		} else if (targetDevice.address && targetDevice.port) {
			// WebSocket 不可达，回退到 HTTP
			const result = await this.httpClient.post(
				`http://${targetDevice.address}:${targetDevice.port}`,
				'/api/pair/request',
				{
					sessionId: session.sessionId,
					fromDeviceId: this.localDeviceId,
					fromDeviceAlias: this.localDeviceAlias,
					fromDevicePlatform: this.isDesktop ? 'desktop' : 'mobile',
					code: session.code,
				}
			);
			if (!result.success) {
				new Notice(t('notice.bindFailed'));
				this.pairingService.cancelSession(session.sessionId);
				return;
			}
		} else {
			new Notice(t('notice.bindFailed'));
			this.pairingService.cancelSession(session.sessionId);
			return;
		}

		const { VerificationModal } = require('./ui/verificationModal');
		const modal = new VerificationModal(
			'display', session.code, targetDevice.alias,
			undefined,
			() => {
				// 发起方点击取消 → 通知对方关闭通知弹窗
				this.pairingService.cancelSession(session.sessionId);
				this.pendingPairRequests.delete(session.sessionId);
				clearInterval(checkInterval);
				clearTimeout(timeout);
				this.notifyPairCancelled(targetDevice, session.sessionId);
			}
		);
		modal.open();

		// 记录待处理请求（对方拒绝时可通过此引用关闭弹窗）
		this.pendingPairRequests.set(session.sessionId, { modal, targetDevice });

		// 轮询检测绑定是否完成或对方是否拒绝
		const checkInterval = setInterval(() => {
			const isBound = this.settings.bindings.some(
				(g) => g.devices.includes(targetDevice.id) && g.devices.includes(this.localDeviceId)
			);
			if (isBound) {
				clearInterval(checkInterval);
				clearTimeout(timeout);
				this.pendingPairRequests.delete(session.sessionId);
				modal.close();
				new Notice(t('notice.bindWithDevice', { name: targetDevice.alias }));
				this.refreshSettingsTab();
				this.updateStatusBar();
			} else if (!this.pairingService.hasSession(session.sessionId)) {
				// 会话被取消（对方拒绝或超时）
				clearInterval(checkInterval);
				clearTimeout(timeout);
				this.pendingPairRequests.delete(session.sessionId);
				modal.close();
				new Notice(t('notice.deviceRejected', { name: targetDevice.alias }));
			}
		}, 2000);

		// 5分钟后超时停止轮询并清理
		const timeout = setTimeout(() => {
			clearInterval(checkInterval);
			this.pendingPairRequests.delete(session.sessionId);
		}, 5 * 60 * 1000);
	}

	/**
	 * 显示分享菜单（支持文件或文件夹）
	 */
	private async showShareMenu(fileOrFolder: TFile | TFolder): Promise<void> {
		const devices = this.getAllDisplayDevices();
		if (devices.length === 0) {
			new Notice(t('notice.noDeviceFound'));
			return;
		}

		const boundIds = this.getBoundDeviceIds();
		const isFolder = fileOrFolder instanceof TFolder;
		const displayName = fileOrFolder.name;

		const { DeviceListModal } = require('./ui/deviceListModal');
		new DeviceListModal(devices, async (device: DeviceInfo) => {
			const isBound = boundIds.has(device.id);
			let successCount = 0;
			let failCount = 0;

			// 获取要分享的文件列表
			const filesToShare: TFile[] = [];
			if (isFolder) {
				// 文件夹：遍历获取所有支持的文件
				const folder = fileOrFolder as TFolder;
				this.collectShareableFiles(folder, filesToShare);
			} else {
				filesToShare.push(fileOrFolder as TFile);
			}

			if (filesToShare.length === 0) {
				new Notice(t('notice.noShareableFiles'));
				return;
			}

			// 优先使用 WebSocket（如果与目标设备有活跃连接），否则回退到 HTTP
			const connectedIds = new Set(this.wsService?.getConnectedDeviceIds() || []);
			const useWs = connectedIds.has(device.id);

			// 逐个发送文件
			for (const file of filesToShare) {
				let success = false;

				if (useWs) {
					const isBinary = isBinaryFile(file.path);
					let content: string;
					if (isBinary) {
						const binaryContent = await this.app.vault.readBinary(file as any);
						content = arrayBufferToBase64(binaryContent);
					} else {
						content = await this.app.vault.read(file);
					}
					success = this.wsService!.sendToDevice(device.id, {
						type: 'share-request',
						request: {
							fromDeviceId: this.localDeviceId,
							fromDeviceAlias: this.localDeviceAlias,
							fromDevicePlatform: this.isDesktop ? 'desktop' : 'mobile',
							fileName: file.name,
							fileContent: content,
							filePath: file.path,
							isBinary,
						},
					});
				} else if (device.address && device.port) {
					// WebSocket 不可达，回退到 HTTP
					success = await this.shareService.shareNote(file, device, isBound);
				} else {
					new Notice(t('notice.deviceUnreachable', { name: device.alias }));
				}

				if (success) {
					successCount++;
				} else {
					failCount++;
				}
			}

			if (failCount === 0) {
				new Notice(t('notice.shareSuccess', { count: successCount, name: device.alias }));
			} else {
				new Notice(t('notice.sharePartial', { success: successCount, fail: failCount }));
			}
		}, boundIds, t('button.share'), undefined, true,
			(deviceId: string) =>
				(this.wsService?.getConnectedDeviceIds().includes(deviceId) ?? false)
				|| (this.wsClients.get(deviceId)?.connected() ?? false)
		).open();
	}

	/**
	 * 递归收集文件夹下所有可分享的文件（md、图片、canvas）
	 */
	private collectShareableFiles(folder: TFolder, result: TFile[]): void {
		for (const child of folder.children) {
			if (child instanceof TFile) {
				const childExt = getFileExtension(child.path);
				if (SUPPORTED_EXTENSIONS.has(childExt)) {
					result.push(child);
				}
			} else if (child instanceof TFolder) {
				this.collectShareableFiles(child, result);
			}
		}
	}


	/**
	 * 更新状态栏图标（绿色=在线，灰色=离线）
	 */
	updateStatusBar(): void {
		const hasBindings = this.settings.bindings.length > 0;
		const icon = hasBindings ? '🟢' : '⚪';
		const text = `${icon} LAN Sync`;
		if (this.statusBarEl) {
			this.statusBarEl.setText(text);
		}
		if (this.ribbonIconEl) {
			// ribbon 图标通过 tooltip + CSS class 反映状态
			this.ribbonIconEl.setAttribute('aria-label', `LAN Sync${hasBindings ? ` (${t('status.bound')})` : ` (${t('status.unbound')})`}`);
			this.ribbonIconEl.toggleClass('lan-sync-bound', hasBindings);
		}
	}

	/**
	 * 点击状态栏弹出菜单：显示绑定组 + 同步图标 + 设置入口
	 */
	showStatusBarMenu(anchorEl: HTMLElement): void {
		const menu = new Menu();

		if (this.settings.bindings.length === 0) {
			menu.addItem((item) => {
				item.setTitle(t('status.noBindings'));
				item.setDisabled(true);
			});
		} else {
			for (const binding of this.settings.bindings) {
				const allDevices = this.discoveryService?.getKnownDevices() || [];
				const deviceMap = new Map(allDevices.map(d => [d.id, d]));
				// 找出对方设备
				const otherDeviceId = binding.devices.find(id => id !== this.localDeviceId);
				const otherDevice = otherDeviceId ? deviceMap.get(otherDeviceId) : null;
				// 别名优先级：discovery > binding 缓存 > ID 截断
				const cachedAlias = binding.deviceAliases?.[otherDeviceId ?? ''];
				const otherAlias = otherDevice?.alias || cachedAlias || (otherDeviceId ? otherDeviceId.substring(0, 8) : t('device.unknownDevice'));
				// 设备类型（优先 discovery，其次 binding 缓存）
				const cachedPlatform = binding.devicePlatforms?.[otherDeviceId ?? ''];
				const platform = otherDevice?.platform || cachedPlatform || 'desktop';
				const platformIcon = platform === 'mobile' ? '📱' : '💻';

				// 判断在线状态（同时考虑 lastSeen 和 WebSocket 连接）
				const wsConnected = otherDeviceId
					? ((this.wsService?.getConnectedDeviceIds().includes(otherDeviceId) ?? false) ||
						(this.wsClients.get(otherDeviceId)?.connected() ?? false))
					: false;
				const isOnline = otherDevice
					? (Date.now() - otherDevice.lastSeen <= 30000 || wsConnected)
					: false;

				menu.addItem((item) => {
					item.setTitle(isOnline ? ` ${platformIcon} ${otherAlias}` : ` ${platformIcon} ${otherAlias}（${t('status.offline')}）`);
					if (!isOnline) {
						item.setDisabled(true);
					} else {
						item.onClick(() => {
							this.syncEngine.runSync(binding.id);
						});
					}
				});
			}
		}

		// 分隔线
		menu.addSeparator();

		// 设置入口
		menu.addItem((item) => {
			item.setTitle(t('button.settings'));
			item.onClick(() => {
				// 打开插件设置页面
				const appAny = this.app as any;
				if (appAny.setting) {
					appAny.setting.open();
					setTimeout(() => {
						appAny.setting.openTabById('lan-sync');
					}, 50);
				}
			});
		});

		const rect = anchorEl.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.top });
	}

	/**
	 * 处理收到的绑定请求（公共逻辑，HTTP 和 WebSocket 入口复用）
	 * 返回 sessionId 供调用方使用，若已绑定则返回 null
	 */
	private handleIncomingPairRequest(fromDeviceId: string, fromDeviceAlias: string, sessionId: string, code: string, fromDevicePlatform?: 'desktop' | 'mobile'): string | null {
		// 检查是否已绑定
		const existingBinding = this.settings.bindings.find(
			(g) => g.devices.includes(this.localDeviceId) && g.devices.includes(fromDeviceId)
		);
		if (existingBinding) {
			this.sendToDeviceMessage(fromDeviceId, { type: 'pair-confirmed', binding: existingBinding });
			return null;
		}

		const session = this.pairingService.handleIncomingPairRequest({ sessionId, fromDeviceId, fromDeviceAlias, code });

		// 异步弹窗（不阻塞当前响应）
		setTimeout(() => {
			const { PairRequestNotice } = require('./ui/pairRequestNotice');
			const { VerificationModal } = require('./ui/verificationModal');

			new PairRequestNotice(
				fromDeviceAlias,
				session.sessionId,
				() => {
					new VerificationModal(
						'input', session.code, fromDeviceAlias,
						async (inputCode: string) => {
							const valid = this.pairingService.verifyCode(session.sessionId, inputCode);
							if (valid) {
								const binding: BindingGroup = {
									id: `bg-${Date.now()}`,
									devices: [this.localDeviceId, fromDeviceId],
									vaultMappings: {
										[this.localDeviceId]: '',
										[fromDeviceId]: '',
									},
									deviceAliases: {
										[this.localDeviceId]: this.localDeviceAlias,
										[fromDeviceId]: fromDeviceAlias,
									},
									devicePlatforms: {
										[this.localDeviceId]: this.isDesktop ? 'desktop' : 'mobile',
										[fromDeviceId]: fromDevicePlatform || 'desktop',
									},
									createdAt: Date.now(),
								};
								this.settings.bindings.push(binding);
								await saveSettings(this, this.settings);
								new Notice(t('notice.bindSuccess'));
								this.refreshSettingsTab();
								this.sendToDeviceMessage(fromDeviceId, { type: 'pair-confirmed', binding });
							} else {
								new Notice(t('notice.codeError'));
							}
						},
						() => {
							this.pairingService.cancelSession(session.sessionId);
							this.sendPairRejection(fromDeviceId, session.sessionId);
							new Notice(t('notice.rejectedBind', { name: fromDeviceAlias }));
						}
					).open();
				},
				() => {
					this.pairingService.cancelSession(session.sessionId);
					this.sendPairRejection(fromDeviceId, session.sessionId);
					new Notice(t('notice.rejectedBind', { name: fromDeviceAlias }));
				}
			).open();
		}, 100);

		return session.sessionId;
	}

	/**
	 * 确保绑定关系已保存到本地（如果已存在相同绑定则跳过）
	 */
	private async ensureBindingSaved(binding: BindingGroup): Promise<void> {
		const alreadyExists = this.settings.bindings.some(
			(g) => g.id === binding.id || (
				g.devices.includes(this.localDeviceId) &&
				binding.devices.every(d => g.devices.includes(d))
			)
		);
		if (!alreadyExists) {
			this.settings.bindings.push(binding);
			await saveSettings(this, this.settings);
			this.refreshSettingsTab();
			this.updateStatusBar();
		}
		// 无论是否新增，都将缓存别名同步到 knownDevices
		this.restoreAliasesFromBinding(binding);
	}

	/**
	 * 从绑定组的 deviceAliases 缓存中恢复设备信息到 knownDevices
	 * 确保设备离线时仍能显示正确别名和平台类型
	 */
	private restoreAliasesFromBinding(binding: BindingGroup): void {
		if (!binding.deviceAliases || !this.discoveryService) return;
		for (const [deviceId, alias] of Object.entries(binding.deviceAliases)) {
			if (deviceId === this.localDeviceId) continue;
			const platform = binding.devicePlatforms?.[deviceId] || 'desktop';
			const existing = this.discoveryService.getKnownDevices().find(d => d.id === deviceId);
			if (existing) {
				// 设备已存在，更新别名和平台类型（防止信息丢失或过期）
				existing.alias = alias;
				existing.platform = platform;
			} else {
				// 设备不在 knownDevices 中，以缓存信息创建离线条目
				this.discoveryService.registerRemoteDevice({
					id: deviceId,
					alias,
					platform,
					port: 0,
					lastSeen: 0,
					discoverable: false,
				});
			}
		}
	}

	/**
	 * 关闭指定设备的待处理验证码弹窗
	 */
	private closePendingModalForDevice(deviceId: string): void {
		for (const [sessionId, pending] of this.pendingPairRequests) {
			if (pending.targetDevice.id === deviceId) {
				pending.modal.close();
				this.pendingPairRequests.delete(sessionId);
			}
		}
	}

	/**
	 * 处理对方拒绝绑定（发起方收到拒绝通知时调用）
	 */
	private handlePairRejected(sessionId: string): void {
		const pending = this.pendingPairRequests.get(sessionId);
		if (pending) {
			pending.modal.close();
			this.pendingPairRequests.delete(sessionId);
			this.pairingService.cancelSession(sessionId);
			new Notice(t('notice.deviceRejected', { name: pending.targetDevice.alias }));
		}
	}

	/**
	 * 发送绑定拒绝通知给发起方
	 * 自动选择 WebSocket 或 HTTP 通道
	 */
	private sendPairRejection(fromDeviceId: string, sessionId: string): void {
		this.sendToDeviceMessage(fromDeviceId, {
			type: 'pair-rejected',
			sessionId,
		});
	}

	/**
	 * 通用消息发送：优先 WebSocket，回退到 HTTP
	 * 适用于桌面端与桌面端、桌面端与手机端之间的消息传递
	 */
	private sendToDeviceMessage(targetDeviceId: string, data: any): boolean {
		// 优先尝试 WebSocket（服务端：目标是已连接的手机端）
		const wsSent = this.wsService?.sendToDevice(targetDeviceId, data);
		if (wsSent) return true;

		// 回退到 HTTP（目标是桌面端）
		const device = this.discoveryService?.getKnownDevices().find(d => d.id === targetDeviceId);
		if (device?.address && device?.port) {
			const baseUrl = `http://${device.address}:${device.port}`;
			this.httpClient.post(baseUrl, '/api/message', data);
			return true;
		}

		return false;
	}

	/**
	 * 发送解绑通知：优先 WebSocket，回退到 HTTP
	 */
	sendUnbindNotification(targetDeviceId: string): void {
		this.sendToDeviceMessage(targetDeviceId, {
			type: 'unbind-notify',
			fromDeviceId: this.localDeviceId,
		});
	}

	/**
	 * 发起方取消绑定时通知目标方
	 */
	private notifyPairCancelled(targetDevice: DeviceInfo, sessionId: string): void {
		this.sendToDeviceMessage(targetDevice.id, { type: 'pair-cancelled', sessionId });
	}

	/**
	 * 处理收到解绑通知：从绑定组中移除该设备
	 */
	private async handleUnbindNotify(deviceId: string): Promise<void> {
		for (const binding of this.settings.bindings) {
			if (!binding.devices.includes(deviceId)) continue;

			// 从绑定组中移除该设备
			binding.devices = binding.devices.filter(id => id !== deviceId);

			// 如果绑定组仅剩本机，删除整个绑定组
			if (binding.devices.length <= 1) {
				this.settings.bindings = this.settings.bindings.filter(b => b.id !== binding.id);
			}
		}

		await saveSettings(this, this.settings);
		new Notice(t('notice.unbindDone'));
		this.refreshSettingsTab();
	}

	// ========== WebSocket 同步请求处理（桌面端响应手机端请求） ==========

	/**
	 * 构建绑定组的自动同步状态映射（bindingId → autoSync）
	 */
	private buildAutoSyncBindingsMap(): Record<string, boolean> {
		const map: Record<string, boolean> = {};
		for (const binding of this.settings.bindings) {
			if (binding.devices.includes(this.localDeviceId)) {
				map[binding.id] = binding.autoSync !== false;
			}
		}
		return map;
	}

	/**
	 * 处理手机端发来的清单请求，返回本地文件清单
	 */
	private async handleSyncManifestRequest(deviceId: string, requestId: string): Promise<void> {
		const allFiles = this.app.vault.getFiles();
		const records: Array<{ filePath: string; lastModified: number; size: number; hash: string }> = [];
		for (const file of allFiles) {
			const ext = getFileExtension(file.path);
			if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
			if (file.path.startsWith('.obsidian/')) continue;
			let hash = CryptoService.getCachedHash(file.path, file.stat.mtime);
			if (!hash) {
				try {
					if (BINARY_EXTENSIONS.has(ext)) {
						const buf = await this.app.vault.readBinary(file as any);
						hash = CryptoService.computeMD5(buf);
					} else {
						const content = await this.app.vault.read(file as any);
						hash = CryptoService.computeMD5(content);
					}
					CryptoService.setCachedHash(file.path, file.stat.mtime, hash);
				} catch { continue; }
			}
			records.push({ filePath: file.path, lastModified: file.stat.mtime, size: file.stat.size, hash });
		}
		const currentPaths = new Set(records.map(r => r.filePath));
		const deletedFiles = CryptoService.getCachedPaths().filter(p => !p.startsWith('.obsidian/') && !currentPaths.has(p));
		this.sendToDeviceMessage(deviceId, {
			type: 'sync-manifest-response',
			requestId,
			success: true,
			records,
			deletedFiles,
			autoSyncBindings: this.buildAutoSyncBindingsMap(),
		});
	}

	/**
	 * 处理手机端发来的拉取请求，读取文件并发送
	 */
	private async handleSyncPullRequest(deviceId: string, requestId: string, filePaths: string[]): Promise<void> {
		const files: Array<{ filePath: string; content: string; lastModified: number; isBinary?: boolean }> = [];

		for (const filePath of filePaths || []) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!file) continue;

			const isBinary = isBinaryFile(filePath);
			let content: string;
			if (isBinary) {
				const binaryContent = await this.app.vault.readBinary(file as any);
				content = arrayBufferToBase64(binaryContent);
			} else {
				content = await this.app.vault.read(file as any);
			}
			files.push({
				filePath,
				content,
				lastModified: (file as any).stat.mtime,
				isBinary,
			});
		}

		this.sendToDeviceMessage(deviceId, {
			type: 'sync-pull-response',
			requestId,
			success: true,
			files,
		});
	}

	/**
	 * 检查文件内容是否与给定内容相同（用于避免无变更时创建历史副本）
	 */
	private async isFileContentSame(filePath: string, content: string, isBinary: boolean): Promise<boolean> {
		try {
			if (isBinary) {
				const existing = await this.app.vault.readBinary(this.app.vault.getAbstractFileByPath(filePath) as any);
				return arrayBufferToBase64(existing) === content;
			} else {
				const existing = await this.app.vault.read(this.app.vault.getAbstractFileByPath(filePath) as any);
				return existing === content;
			}
		} catch {
			return false;
		}
	}

	/**
	 * 处理手机端推送的文件，写入本地仓库并确认
	 */
	private async handleSyncPush(deviceId: string, requestId: string, files: any[]): Promise<void> {
		for (const file of files || []) {
			const existing = this.app.vault.getAbstractFileByPath(file.filePath);
			if (file.isBinary) {
				const binaryContent = base64ToArrayBuffer(file.content);
				if (existing) {
					if (await this.isFileContentSame(file.filePath, file.content, true)) {
						continue;
					}
					await this.historyManager.createCopy(file.filePath);
					await this.app.vault.modifyBinary(existing as any, binaryContent);
				} else {
					await ensureParentDir(this.app.vault, file.filePath);
					await this.app.vault.createBinary(file.filePath, binaryContent);
				}
			} else {
				if (existing) {
					if (await this.isFileContentSame(file.filePath, file.content, false)) {
						continue;
					}
					await this.historyManager.createCopy(file.filePath);
					await this.app.vault.modify(existing as any, file.content);
				} else {
					await ensureParentDir(this.app.vault, file.filePath);
					await this.app.vault.create(file.filePath, file.content);
				}
			}
		}

		this.sendToDeviceMessage(deviceId, {
			type: 'sync-push-ack',
			requestId,
			success: true,
			received: files?.length || 0,
		});
	}

	/**
	 * 更新设置并持久化
	 */
	async updateSettings(partial: Partial<PluginSettings>): Promise<void> {
		Object.assign(this.settings, partial);
		await saveSettings(this, this.settings);
		this.refreshSettingsTab();
	}

	/**
	 * 移动端：通过 WebSocket 连接到桌面设备并注册自身
	 */
	connectToDeviceWebSocket(device: DeviceInfo): void {
		if (this.isDesktop || !device.address || !device.port) return;

		// 避免重复连接
		if (this.wsClients.has(device.id)) return;

		const client = new WebSocketClientService(
			this.localDeviceId,
			device.address,
			device.port
		);

		client.setOnConnected(() => {
			console.log(`[LAN Sync] Connected to desktop device: ${device.alias}`);
			// 发送本地设备信息给桌面端注册
			client.send({
				type: 'device-info',
				device: {
					id: this.localDeviceId,
					alias: this.localDeviceAlias,
					platform: 'mobile',
					port: 0,
					lastSeen: Date.now(),
					discoverable: true,
				},
			});
		});

		client.setOnMessage((data) => {
			if (data.type === 'request-device-info') {
				// 桌面端请求设备信息，重新发送
				client.send({
					type: 'device-info',
					device: {
						id: this.localDeviceId,
						alias: this.localDeviceAlias,
						platform: 'mobile',
						port: 0,
						lastSeen: Date.now(),
						discoverable: true,
					},
				});
			} else if (data.type === 'device-info-response') {
				// 桌面端回复真实设备信息，更新缓存
				const realId = data.device?.id;
				const realAlias = data.device?.alias;
				if (realId && realAlias && device.id !== realId) {
					const oldId = device.id;
					// 更新 discovery service 中的设备 ID 和别名
					this.discoveryService.updateDeviceIdAndAlias(oldId, realId, realAlias);
					// 更新 wsClients 映射的 key
					this.wsClients.delete(oldId);
					this.wsClients.set(realId, client);
					// 更新 device 对象（闭包引用，后续断连等回调会使用新 ID）
					device.id = realId;
					device.alias = realAlias;
					console.log(`[LAN Sync] Device identity updated: ${oldId} -> ${realId} (${realAlias})`);
					this.refreshSettingsTab();
				}
			} else if (data.type === 'pair-confirmed') {
				// 目标方（桌面端）确认绑定，发起方（手机端）保存绑定并关闭弹窗
				this.ensureBindingSaved(data.binding);
				const otherDeviceId = data.binding.devices.find((id: string) => id !== this.localDeviceId);
				if (otherDeviceId) this.closePendingModalForDevice(otherDeviceId);
			} else if (data.type === 'pair-request') {
				// 桌面端通过 WebSocket 发起绑定请求（手机端无 HTTP 服务器）
				// 检查是否已绑定：如果已与发起方绑定，直接返回已有绑定关系
				const existingBinding = this.settings.bindings.find(
					(g) => g.devices.includes(this.localDeviceId) && g.devices.includes(data.fromDeviceId)
				);
				if (existingBinding) {
					client.send({ type: 'pair-confirmed', binding: existingBinding });
					return;
				}

				const session = this.pairingService.handleIncomingPairRequest(data);
				const { PairRequestNotice } = require('./ui/pairRequestNotice');
				const { VerificationModal } = require('./ui/verificationModal');

				new PairRequestNotice(
					data.fromDeviceAlias,
					session.sessionId,
					() => {
						// 用户点击“查看” → 弹出验证码输入窗口
						new VerificationModal(
							'input', session.code, data.fromDeviceAlias,
							async (inputCode: string) => {
								const valid = this.pairingService.verifyCode(session.sessionId, inputCode);
								if (valid) {
									// 目标方保存绑定关系
									const binding: BindingGroup = {
										id: `bg-${Date.now()}`,
										devices: [this.localDeviceId, data.fromDeviceId],
										vaultMappings: {
											[this.localDeviceId]: '',
											[data.fromDeviceId]: '',
										},
										deviceAliases: {
											[this.localDeviceId]: this.localDeviceAlias,
											[data.fromDeviceId]: data.fromDeviceAlias,
										},
										devicePlatforms: {
											[this.localDeviceId]: this.isDesktop ? 'desktop' : 'mobile',
											[data.fromDeviceId]: data.fromDevicePlatform || 'desktop',
										},
										createdAt: Date.now(),
									};
									this.settings.bindings.push(binding);
									await saveSettings(this, this.settings);
									new Notice(t('notice.bindSuccess'));
									this.refreshSettingsTab();
									this.updateStatusBar();
									// 通知发起方绑定完成（发起方仅关闭弹窗，不重复保存）
									client.send({ type: 'pair-confirmed', binding });
								} else {
									new Notice(t('notice.codeError'));
								}
							},
							() => {
								// 用户在验证码弹窗点击“取消” → 拒绝
								this.pairingService.cancelSession(session.sessionId);
								client.send({ type: 'pair-rejected', sessionId: session.sessionId });
								new Notice(t('notice.rejectedBind', { name: data.fromDeviceAlias }));
							}
						).open();
					},
					() => {
						// 用户在通知弹窗点击“拒绝”
						this.pairingService.cancelSession(session.sessionId);
						client.send({ type: 'pair-rejected', sessionId: session.sessionId });
						new Notice(t('notice.rejectedBind', { name: data.fromDeviceAlias }));
					}
				).open();
			} else if (data.type === 'share-request') {
				// 黑名单设备直接拒绝，不弹窗
				if (this.settings.blacklist.some((e) => e.id === data.request.fromDeviceId)) {
					new Notice(t('notice.blacklistedDeviceRejected'));
					client.send({ type: 'share-rejected', fileName: data.request.fileName });
					return;
				}
				// 桌面端通过 WebSocket 推送分享
				const { ShareReceiveModal } = require('./ui/shareReceiveModal');
				const request = data.request;
				new ShareReceiveModal(request, async (decision: string, savePath?: string) => {
					if (decision === 'accept') {
						await this.shareService.saveSharedNote(request.fileName, request.fileContent, request.filePath, request.isBinary);
						new Notice(t('notice.fileReceived', { name: request.fileName }));
					} else if (decision === 'saveAs' && savePath) {
						await this.shareService.saveSharedNoteAs(request.fileName, request.fileContent, savePath, request.isBinary);
						new Notice(t('notice.fileSavedAs', { path: savePath }));
					} else if (decision === 'blacklist') {
						await this.shareService.addToBlacklist(request.fromDeviceId, request.fromDeviceAlias, request.fromDevicePlatform || 'desktop', this.settings);
						new Notice(t('notice.shareRejectedBlacklist'));
					} else {
						await this.shareService.recordReject(request.fromDeviceId, this.settings, request.fromDeviceAlias, request.fromDevicePlatform || 'desktop');
						new Notice(t('notice.shareRejected'));
					}
				}, this.getBoundDeviceIds().has(request.fromDeviceId)).open();
			} else if (data.type === 'pair-rejected') {
				// 桌面端通知绑定被拒绝
				this.handlePairRejected(data.sessionId);
			} else if (data.type === 'pair-cancelled') {
				// 桌面端通知发起方已取消
				this.pairingService.cancelSession(data.sessionId);
				new Notice(t('notice.pairCancelled'));
			} else if (data.type === 'unbind-notify') {
				// 桌面端通知解绑
				this.handleUnbindNotify(data.fromDeviceId);
			} else if (
				data.type === 'sync-manifest-response' ||
				data.type === 'sync-pull-response' ||
				data.type === 'sync-push-ack'
			) {
				// 桌面端对手机端同步请求的响应，路由到同步引擎
				this.syncEngine.handleWsSyncResponse(data);
			} else if (data.type === 'sync-manifest-request') {
				// 桌面端请求手机端的文件清单
				(async () => {
					const allFiles = this.app.vault.getFiles();
					const records: Array<{ filePath: string; lastModified: number; size: number; hash: string }> = [];
					for (const file of allFiles) {
						const ext = getFileExtension(file.path);
						if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
						if (file.path.startsWith('.obsidian/')) continue;
						let hash = CryptoService.getCachedHash(file.path, file.stat.mtime);
						if (!hash) {
							try {
								if (BINARY_EXTENSIONS.has(ext)) {
									const buf = await this.app.vault.readBinary(file as any);
									hash = CryptoService.computeMD5(buf);
								} else {
									const content = await this.app.vault.read(file as any);
									hash = CryptoService.computeMD5(content);
								}
								CryptoService.setCachedHash(file.path, file.stat.mtime, hash);
							} catch { continue; }
						}
						records.push({
							filePath: file.path,
							lastModified: file.stat.mtime,
							size: file.stat.size,
							hash,
						});
					}
					const currentPaths = new Set(records.map(r => r.filePath));
					const deletedFiles = CryptoService.getCachedPaths().filter(p => !p.startsWith('.obsidian/') && !currentPaths.has(p));
					client.send({ type: 'sync-manifest-response', requestId: data.requestId, success: true, records, deletedFiles, autoSyncBindings: this.buildAutoSyncBindingsMap() });
				})();
			} else if (data.type === 'sync-pull-request') {
				// 桌面端请求手机端发送文件
				(async () => {
					const files: Array<{ filePath: string; content: string; lastModified: number; isBinary?: boolean }> = [];
					for (const filePath of data.filePaths || []) {
						const file = this.app.vault.getAbstractFileByPath(filePath);
						if (!file) continue;
						const isBinary = isBinaryFile(filePath);
						let content: string;
						if (isBinary) {
							const binaryContent = await this.app.vault.readBinary(file as any);
							content = arrayBufferToBase64(binaryContent);
						} else {
							content = await this.app.vault.read(file as any);
						}
						files.push({ filePath, content, lastModified: (file as any).stat.mtime, isBinary });
					}
					client.send({ type: 'sync-pull-response', requestId: data.requestId, success: true, files });
				})();
			} else if (data.type === 'sync-push') {
				// 桌面端推送文件到手机端
				(async () => {
					for (const file of data.files || []) {
						const existing = this.app.vault.getAbstractFileByPath(file.filePath);
						if (file.isBinary) {
							const binaryContent = base64ToArrayBuffer(file.content);
							if (existing) {
								await this.app.vault.modifyBinary(existing as any, binaryContent);
							} else {
								await ensureParentDir(this.app.vault, file.filePath);
								await this.app.vault.createBinary(file.filePath, binaryContent);
							}
						} else {
							if (existing) {
								await this.app.vault.modify(existing as any, file.content);
							} else {
								await ensureParentDir(this.app.vault, file.filePath);
								await this.app.vault.create(file.filePath, file.content);
							}
						}
					}
					client.send({ type: 'sync-push-ack', requestId: data.requestId, success: true, received: data.files?.length || 0 });
				})();
			} else if (data.type === 'sync-delete') {
				// 桌面端请求删除手机端文件
				(async () => {
					const deleted: string[] = [];
					for (const filePath of data.filePaths || []) {
						const file = this.app.vault.getAbstractFileByPath(filePath);
						if (file) {
							try {
								await this.historyManager.createCopy(filePath);
								await this.app.vault.delete(file);
								deleted.push(filePath);
							} catch (err) {
								console.warn('[LAN Sync] Failed to delete synced file:', filePath, err);
							}
						}
					}
					client.send({ type: 'sync-delete-ack', requestId: data.requestId, success: true, deleted: deleted.length });
				})();
			} else if (data.type === 'sync-history') {
				// 桌面端发来的同步历史记录
				for (const record of data.records || []) {
					this.addSyncHistory(record);
				}
			}
		});

		client.setOnDisconnected(() => {
			console.log(`[LAN Sync] Disconnected from desktop device: ${device.alias}`);
			this.wsClients.delete(device.id);
			// 立即标记设备为离线，无需等待清理服务
			const knownDevice = this.discoveryService?.getKnownDevices().find(d => d.id === device.id);
			if (knownDevice) {
				knownDevice.lastSeen = 0;
			}
			this.refreshSettingsTab();
		});

		this.wsClients.set(device.id, client);
		client.connect();
	}

	/**
	 * 启动时立即探查已绑定设备的在线状态
	 * 1. 先将所有绑定设备标记为离线
	 * 2. 桌面端：对桌面设备发 HTTP 健康检查，对手机设备检查 WebSocket 连接
	 * 3. 移动端：对桌面设备尝试建立 WebSocket 连接
	 */
	private async probeBoundDevices(): Promise<void> {
		console.log('[LAN Sync] Probing bound devices on startup...');
		const probedIds = new Set<string>();

		// 第一步：将所有绑定设备标记为离线，然后刷新 UI
		for (const binding of this.settings.bindings) {
			for (const deviceId of binding.devices) {
				if (deviceId === this.localDeviceId) continue;
				const device = this.discoveryService.getKnownDevices().find(d => d.id === deviceId);
				if (device) {
					device.lastSeen = 0;
				}
			}
		}
		this.refreshSettingsTab();

		// 第二步：逐个探查
		for (const binding of this.settings.bindings) {
			for (const deviceId of binding.devices) {
				if (deviceId === this.localDeviceId) continue;
				if (probedIds.has(deviceId)) continue;
				probedIds.add(deviceId);

				const cachedAlias = binding.deviceAliases?.[deviceId] || deviceId.substring(0, 8);
				const existing = this.discoveryService.getKnownDevices().find(d => d.id === deviceId);

				if (this.isDesktop) {
					if (existing?.address && existing?.port) {
						// 桌面设备：HTTP 健康检查
						try {
							const resp = await fetch(`http://${existing.address}:${existing.port}/api/health`, {
								signal: AbortSignal.timeout(3000),
							});
							if (resp.ok) {
								existing.lastSeen = Date.now();
								console.log(`[LAN Sync] Probed ${cachedAlias}: online via HTTP`);
							} else {
								console.log(`[LAN Sync] Probed ${cachedAlias}: offline (HTTP ${resp.status})`);
							}
						} catch {
							console.log(`[LAN Sync] Probed ${cachedAlias}: offline (HTTP failed)`);
						}
					} else {
						// 手机设备：检查 WebSocket 连接状态
						const wsConnected = this.wsService?.getConnectedDeviceIds().includes(deviceId) ?? false;
						if (wsConnected) {
							if (existing) existing.lastSeen = Date.now();
							console.log(`[LAN Sync] Probed ${cachedAlias}: online via WebSocket`);
						} else {
							console.log(`[LAN Sync] Probed ${cachedAlias}: offline (no WebSocket)`);
						}
					}
				} else {
					// 移动端：对桌面设备尝试建立 WebSocket 连接
					if (existing?.address && existing?.port && !this.wsClients.has(deviceId)) {
						console.log(`[LAN Sync] Probing ${cachedAlias}: attempting WebSocket connection`);
						this.connectToDeviceWebSocket(existing);
					} else if (this.wsClients.has(deviceId)) {
						console.log(`[LAN Sync] Probed ${cachedAlias}: online (WebSocket already connected)`);
					} else {
						console.log(`[LAN Sync] Probed ${cachedAlias}: offline (no address/port)`);
					}
				}
			}
		}
	}
}
