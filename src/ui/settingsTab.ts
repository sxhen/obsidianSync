import { PluginSettingTab, Setting, Platform, Notice, type ExtraButtonComponent } from 'obsidian';
import type LanSyncPlugin from '../main';
import type { SyncFileEntry } from '../types';
import { CryptoService } from '../services/cryptoService';
import { saveSettings } from '../settings';
import { DeviceListModal } from './deviceListModal';
import { BlacklistModal } from './blacklistModal';
import { UnbindConfirmModal } from './unbindConfirmModal';
import { SyncHistoryModal } from './syncHistoryModal';
import { AddDeviceModal } from './addDeviceModal';
import { t } from '../i18n';

/** 兼容旧格式：将 string[] 或 SyncFileEntry[] 统一为 SyncFileEntry[] */
function normalizeFiles(files: any[]): SyncFileEntry[] {
	return files.map(f => typeof f === 'string' ? { path: f, action: 'modify' as const } : f);
}

/**
 * 插件设置面板
 */
export class LanSyncSettingTab extends PluginSettingTab {
	plugin: LanSyncPlugin;
	private refreshTimer: ReturnType<typeof setInterval> | null = null;

	constructor(plugin: LanSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const isDesktop = Platform.isDesktopApp;

		// 启动定时刷新（用于更新在线/离线状态）
		this.startAutoRefresh();

		// ========== 1. 设备信息 ==========
		const deviceSection = this.createSection(containerEl, t('section.deviceInfo'));

		const deviceId = this.plugin.getLocalDeviceId();
		const maskedId = deviceId
			? `${deviceId.substring(0, 3)}****${deviceId.substring(deviceId.length - 4)}`
			: t('settings.uninitialized');

		let showFullId = false;
		let deviceIdText: HTMLInputElement | null = null;
		let toggleBtnRef: ExtraButtonComponent | null = null;

		const deviceIdSetting = new Setting(deviceSection)
			.setName(t('settings.deviceId'))
			.setDesc(t('settings.deviceIdDesc'))
			.addText((text) => {
				text.setValue(deviceId ? maskedId : t('settings.uninitialized'));
				text.setDisabled(true);
				deviceIdText = text.inputEl;
			});

		if (deviceId) {
			deviceIdSetting.addExtraButton((btn) => {
				btn.setIcon('eye').setTooltip(t('settings.showFullId'));
				toggleBtnRef = btn;
				btn.onClick(() => {
					showFullId = !showFullId;
					if (deviceIdText) {
						deviceIdText.value = showFullId ? deviceId : maskedId;
					}
					if (toggleBtnRef) {
						toggleBtnRef.setIcon(showFullId ? 'eye-off' : 'eye')
							.setTooltip(showFullId ? t('settings.hideFullId') : t('settings.showFullId'));
					}
				});
			});
		}

		new Setting(deviceSection)
			.setName(t('settings.deviceAlias'))
			.setDesc(t('settings.deviceAliasDesc'))
			.addText((text) => {
				text.setPlaceholder(t('settings.deviceAliasPlaceholder'));
				text.setValue(this.plugin.settings.deviceAlias);
				text.onChange(async (value) => {
					this.plugin.settings.deviceAlias = value;
					await saveSettings(this.plugin, this.plugin.settings);
				});
			});

		if (isDesktop) {
			new Setting(deviceSection)
				.setName(t('settings.discoverable'))
				.setDesc(t('settings.discoverableDesc'))
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings.discoverable);
					toggle.onChange(async (value) => {
						this.plugin.settings.discoverable = value;
						await saveSettings(this.plugin, this.plugin.settings);
					});
				});
		}

		// 刷新文件哈希缓存
		const cacheInfoDesc = t('settings.currentCache', { count: CryptoService.getCachedPaths().length });
		new Setting(deviceSection)
			.setName(t('settings.refreshCache'))
			.setDesc(t('settings.refreshCacheDesc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.incrementalRefresh'));
				btn.onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText(t('settings.refreshing'));
					try {
						const result = await CryptoService.refreshIncremental(this.app.vault);
						await CryptoService.saveCache(this.app.vault.adapter, `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/.lan-sync-hash-cache.json`);
						new Notice(t('settings.incrementalDone', { computed: result.computed, removed: result.removed, total: result.total }));
						this.display(); // 刷新设置页以更新缓存条数显示
					} catch (err) {
						new Notice(t('settings.incrementalFail'));
						console.error('[LAN Sync] Incremental refresh failed:', err);
					}
					btn.setDisabled(false);
					btn.setButtonText(t('settings.incrementalRefresh'));
				});
			})
			.addButton((btn) => {
				btn.setButtonText(t('settings.fullRefresh'));
				btn.onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText(t('settings.refreshing'));
					try {
						const result = await CryptoService.refreshFull(this.app.vault);
						await CryptoService.saveCache(this.app.vault.adapter, `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/.lan-sync-hash-cache.json`);
						new Notice(t('settings.fullDone', { total: result.total }));
						this.display();
					} catch (err) {
						new Notice(t('settings.fullFail'));
						console.error('[LAN Sync] Full refresh failed:', err);
					}
					btn.setDisabled(false);
					btn.setButtonText(t('settings.fullRefresh'));
				});
			});

		// ========== 2. 设备发现与绑定 ==========
		const discoverySection = this.createSection(containerEl, t('section.discoveryBinding'));

		// 移动端：手动添加设备按钮（放在查看设备前面）
		if (!isDesktop) {
			new Setting(discoverySection)
				.setName(t('settings.manualAdd'))
				.setDesc(t('settings.manualAddDesc'))
				.addButton((btn) => {
					btn.setButtonText(t('settings.manualAdd'));
					btn.onClick(() => {
						new AddDeviceModal(async (address, port) => {
							const device = await this.plugin.discoveryService?.addManualDevice(address, port);
							if (device) {
								this.plugin.connectToDeviceWebSocket(device);
								new Notice(t('notice.deviceAdded', { name: device.alias }));
							} else {
								new Notice(t('notice.addDeviceFailed'));
							}
							this.display();
						}).open();
					});
				});
		}

		new Setting(discoverySection)
			.setName(t('settings.viewDevices'))
			.setDesc(t('settings.viewDevicesDesc'))
			.addButton((btn) => {
				btn.setButtonText(t('settings.viewDevicesBtn'));
				btn.onClick(() => {
					const boundIds = this.plugin.getBoundDeviceIds();
					new DeviceListModal(
						() => this.plugin.getAllDisplayDevices(),
						async (device) => {
							if (!boundIds.has(device.id)) {
								await this.plugin.initiateBinding(device);
							}
						},
						boundIds,
						undefined,
						async (device) => {
							this.plugin.discoveryService?.removeManualDevice(device.id);
							new Notice(t('notice.deviceDeleted', { name: device.alias }));
							this.plugin.refreshSettingsTab();
						},
						false,
						(deviceId: string) =>
							(this.plugin.wsService?.getConnectedDeviceIds().includes(deviceId) ?? false)
							|| (this.plugin.wsClients.get(deviceId)?.connected() ?? false)
					).open();
				});
			});

		// 已绑定设备列表
		if (this.plugin.settings.bindings.length > 0) {
			discoverySection.createEl('h3', { text: t('section.boundDevices') });
			for (const binding of this.plugin.settings.bindings) {
				const allDevices = this.plugin.discoveryService?.getKnownDevices() || [];
				const deviceMap = new Map(allDevices.map(d => [d.id, d]));

				// 找出对方设备的别名（优先 discovery，其次 binding 缓存，最后 ID 截断）
				const otherDeviceId = binding.devices.find(id => id !== this.plugin.getLocalDeviceId());
				const otherDevice = otherDeviceId ? deviceMap.get(otherDeviceId) : null;
				const cachedAlias = binding.deviceAliases?.[otherDeviceId ?? ''];
				const otherAlias = otherDevice?.alias || cachedAlias || (otherDeviceId ? otherDeviceId.substring(0, 8) : t('device.unknownDevice'));
				// 设备类型（优先 discovery，其次 binding 缓存）
				const cachedPlatform = binding.devicePlatforms?.[otherDeviceId ?? ''];
				const platform = otherDevice?.platform || cachedPlatform || 'desktop';
				const platformIcon = platform === 'mobile' ? '📱' : '💻';

				// 判断在线状态（同时考虑 lastSeen 和 WebSocket 连接）
				const wsConnected = (this.plugin.wsService?.getConnectedDeviceIds().includes(otherDeviceId ?? '') ?? false)
					|| (this.plugin.wsClients.get(otherDeviceId ?? '')?.connected() ?? false);
				const isOnline = otherDevice ? (Date.now() - otherDevice.lastSeen <= 30000 || wsConnected) : false;

				const setting = new Setting(discoverySection)
					.setName(`${platformIcon} ${otherAlias}`);

				// 在标题前面插入在线/离线状态圆点
				const dot = setting.nameEl.createEl('span', {
					cls: `lan-sync-status-dot ${isOnline ? 'lan-sync-status-online' : 'lan-sync-status-offline'}`,
					text: isOnline ? '● ' : '○ '
				});
				dot.title = isOnline ? t('status.online') : t('status.offline');
				setting.nameEl.prepend(dot);

				const descEl = setting.descEl;
				descEl.empty();

				// 本方开启自动同步，但对方已关闭时显示提示
				const remoteStatus = this.plugin.settings.remoteAutoSyncStatus;
				if (binding.autoSync !== false && remoteStatus && remoteStatus[binding.id] === false) {
					descEl.createEl('span', { text: t('settings.remoteClosedSync'), cls: 'lan-sync-auto-sync-hint' });
				}

				// 自动同步开关
				setting.addToggle((toggle) => {
					toggle.setTooltip(t('settings.autoSync'));
					toggle.setValue(binding.autoSync !== false); // 默认开启
					toggle.onChange(async (value) => {
						binding.autoSync = value;
						await saveSettings(this.plugin, this.plugin.settings);
						this.plugin.refreshSettingsTab();
					});
				});

				// 同步按钮
				setting.addButton((btn) => {
					btn.setButtonText(t('settings.sync'));
					btn.setIcon('refresh-cw');
					btn.onClick(() => {
						this.plugin.syncEngine?.runSync(binding.id);
					});
				});

				// 解绑按钮 — 弹出二次确认
				setting.addButton((btn) => {
					btn.setButtonText(t('settings.unbind'));
					btn.setWarning();
					btn.onClick(() => {
						// 找出非本机设备的别名
						const otherDeviceIds = binding.devices.filter(
							(id) => id !== this.plugin.getLocalDeviceId()
						);
						const otherAliases = otherDeviceIds.map(id => {
							const known = deviceMap.get(id);
							return known?.alias || id.substring(0, 8);
						});
						const label = otherAliases.join(', ');

						new UnbindConfirmModal(label, async () => {
							// 通过 WebSocket 或 HTTP 通知其他设备移除本机
							for (const deviceId of otherDeviceIds) {
								this.plugin.sendUnbindNotification(deviceId);
							}

							// 本地移除绑定关系
							this.plugin.settings.bindings = this.plugin.settings.bindings.filter(
								(b) => b.id !== binding.id
							);
							await saveSettings(this.plugin, this.plugin.settings);

							// 清理无法通过任何方式判断状态的设备
							for (const deviceId of otherDeviceIds) {
								const device = this.plugin.discoveryService?.getKnownDevices().find(d => d.id === deviceId);
								if (!device) continue;

								const hasHttpEndpoint = !!(device.address && device.port);
								const hasWsConnection = this.plugin.wsClients.has(deviceId);

								if (!hasHttpEndpoint && !hasWsConnection) {
									this.plugin.discoveryService?.removeDevice(deviceId);
								}
							}

							new Notice(t('notice.unbindLocal'));
							this.plugin.refreshSettingsTab();
						}).open();
					});
				});
			}
		}

		// ========== 3. 同步设置（含同步历史） ==========
		const syncSection = this.createSection(containerEl, t('section.syncSettings'));

		new Setting(syncSection)
			.setName(t('settings.syncInterval'))
			.setDesc(t('settings.syncIntervalDesc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('1', t('settings.1min'));
				dropdown.addOption('3', t('settings.3min'));
				dropdown.addOption('5', t('settings.5min'));
				dropdown.addOption('10', t('settings.10min'));
				dropdown.addOption('15', t('settings.15min'));
				dropdown.addOption('30', t('settings.30min'));
				dropdown.setValue(String(this.plugin.settings.syncIntervalMinutes));
				dropdown.onChange(async (value) => {
					this.plugin.settings.syncIntervalMinutes = Number(value);
					await saveSettings(this.plugin, this.plugin.settings);
					this.plugin.syncEngine?.start(Number(value));
				});
			});

		new Setting(syncSection)
			.setName(t('settings.historyCopies'))
			.setDesc(t('settings.historyCopiesDesc'))
			.addText((text) => {
				text.setValue(String(this.plugin.settings.maxHistoryCopies));
				text.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.maxHistoryCopies = num;
						await saveSettings(this.plugin, this.plugin.settings);
					}
				});
			});

		new Setting(syncSection)
			.setName(t('settings.historyFolder'))
			.setDesc(t('settings.historyFolderDesc'))
			.addText((text) => {
				text.setValue(this.plugin.settings.historyFolder);
				text.onChange(async (value) => {
					this.plugin.settings.historyFolder = value;
					await saveSettings(this.plugin, this.plugin.settings);
				});
			});

		// ---------- 同步历史 ----------
		syncSection.createEl('h3', { text: t('section.syncHistory') });
		// 构建绑定组标签映射
		const bindingLabels = new Map<string, string>();
		for (const b of this.plugin.settings.bindings) {
			const allDevices = this.plugin.discoveryService?.getKnownDevices() || [];
			const deviceMap = new Map(allDevices.map(d => [d.id, d]));
			const aliases = b.devices.map(id => {
				if (id === this.plugin.getLocalDeviceId()) return t('history.localDevice');
				return deviceMap.get(id)?.alias || id.substring(0, 8);
			});
			bindingLabels.set(b.id, aliases.join(', '));
		}

		const recentHistory = this.plugin.settings.syncHistory.slice(0, 5);
		if (recentHistory.length === 0) {
			new Setting(syncSection)
				.setDesc(t('history.noRecords'));
		} else {
			const historyListEl = syncSection.createDiv({ cls: 'lan-sync-sync-history' });

			for (const record of recentHistory) {
				const itemEl = historyListEl.createDiv({ cls: 'lan-sync-sync-history-item' });

				const summaryEl = itemEl.createDiv({ cls: 'lan-sync-history-summary' });

				const typeIcon = record.type === 'send' ? t('history.send') : t('history.receive');
				summaryEl.createEl('span', {
					text: typeIcon,
					cls: record.type === 'send' ? 'lan-sync-type-send' : 'lan-sync-type-receive',
				});

				const bindingLabel = bindingLabels.get(record.targetBindingId) || record.targetBindingId.substring(0, 8);
				summaryEl.createEl('span', {
					text: `${record.sourceDeviceAlias} → ${bindingLabel}`,
					cls: 'lan-sync-history-info',
				});

				const timeStr = this.formatTime(record.timestamp);
				summaryEl.createEl('span', { text: timeStr, cls: 'lan-sync-muted' });
				const normalizedFiles = normalizeFiles(record.files);
				summaryEl.createEl('span', { text: t('history.fileCount', { count: normalizedFiles.length }), cls: 'lan-sync-muted' });

				// 点击展开文件列表
				summaryEl.style.cursor = 'pointer';
				summaryEl.addEventListener('click', () => {
					const existing = itemEl.querySelector('.lan-sync-file-list');
					if (existing) {
						existing.remove();
					} else {
						const fileListEl = itemEl.createDiv({ cls: 'lan-sync-file-list' });
						for (const fileEntry of normalizedFiles) {
							const rowEl = fileListEl.createDiv({ cls: 'lan-sync-file-item' });
							if (record.type === 'receive') {
								const actionLetter = fileEntry.action === 'add' ? 'A' : fileEntry.action === 'del' ? 'D' : 'M';
								const actionCls = fileEntry.action === 'add' ? 'lan-sync-action-add' : fileEntry.action === 'del' ? 'lan-sync-action-del' : 'lan-sync-action-modify';
								rowEl.createEl('span', { text: actionLetter, cls: `lan-sync-file-action ${actionCls}` });
								rowEl.createEl('span', { text: fileEntry.path, cls: 'lan-sync-file-path' });
							} else {
								rowEl.setText(fileEntry.path);
							}
						}
					}
				});
			}
		}

		// 查看更多按钮
		if (this.plugin.settings.syncHistory.length > 0) {
			new Setting(syncSection)
				.addButton((btn) => {
					btn.setButtonText(t('settings.viewMore'));
					btn.onClick(() => {
						new SyncHistoryModal(
							this.plugin.settings.syncHistory,
							bindingLabels
						).open();
					});
				});
		}

		// ========== 4. 黑名单 ==========
		const blacklistSection = this.createSection(containerEl, t('section.blacklist'));

		new Setting(blacklistSection)
			.setName(t('settings.manageBlacklist'))
			.setDesc(t('settings.blacklistCount', { count: this.plugin.settings.blacklist.length }))
			.addButton((btn) => {
				btn.setButtonText(t('settings.viewBlacklist'));
				btn.onClick(() => {
					new BlacklistModal(this.plugin.settings.blacklist, async (deviceId) => {
						await this.plugin.shareService?.removeFromBlacklist(
							deviceId,
							this.plugin.settings
						);
						this.plugin.refreshSettingsTab();
					}).open();
				});
			});

		new Setting(blacklistSection)
			.setName(t('settings.autoRejectThreshold'))
			.setDesc(t('settings.autoRejectThresholdDesc'))
			.addText((text) => {
				text.setValue(String(this.plugin.settings.autoRejectThreshold));
				text.onChange(async (value) => {
					const num = parseInt(value, 10);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.autoRejectThreshold = num;
						await saveSettings(this.plugin, this.plugin.settings);
					}
				});
			});

		// ========== 5. 服务状态 ==========
		if (isDesktop) {
			const statusSection = this.createSection(containerEl, t('section.serviceStatus'));

			new Setting(statusSection)
				.setName(t('settings.httpService'))
				.setDesc(t('settings.port', { port: 24532 }))
				.addText((text) => {
					text.setValue(this.plugin.transport?.isServerCapable() ? t('settings.running') : t('settings.notStarted'));
					text.setDisabled(true);
				});

			new Setting(statusSection)
				.setName(t('settings.udpService'))
				.setDesc(t('settings.port', { port: 24531 }))
				.addText((text) => {
					text.setValue(t('settings.running'));
					text.setDisabled(true);
				});
		}
	}

	/**
	 * 创建可折叠分区（缓存折叠状态）
	 */
	private createSection(containerEl: HTMLElement, title: string): HTMLElement {
		const detailsEl = containerEl.createEl('details', { cls: 'lan-sync-section' });
		const storageKey = `lan-sync-section-${title}`;

		// 恢复上次的折叠状态（默认展开）
		const savedState = localStorage.getItem(storageKey);
		if (savedState !== 'closed') {
			detailsEl.setAttribute('open', '');
		}

		detailsEl.createEl('summary', { text: title, cls: 'lan-sync-section-title' });

		// 监听折叠/展开，保存状态
		detailsEl.addEventListener('toggle', () => {
			const isOpen = detailsEl.hasAttribute('open');
			localStorage.setItem(storageKey, isOpen ? 'open' : 'closed');
		});

		return detailsEl;
	}

	/**
	 * 格式化时戳
	 */
	private formatTime(timestamp: number): string {
		const d = new Date(timestamp);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	/**
	 * 启动定时刷新（每 10 秒更新一次在线/离线状态）
	 */
	private startAutoRefresh(): void {
		this.stopAutoRefresh();
		this.refreshTimer = setInterval(() => {
			if (document.body.contains(this.containerEl)) {
				this.display();
			} else {
				this.stopAutoRefresh();
			}
		}, 10000);
	}

	private stopAutoRefresh(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	}

	hide(): void {
		this.stopAutoRefresh();
		super.hide();
	}
}
