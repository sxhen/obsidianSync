import type { DeviceInfo, DiscoveryMessage, INetworkTransport, PluginSettings } from '../types';
import type { DesktopNetworkTransport } from './network/desktopNetwork';

const DEVICE_TIMEOUT_MS = 30_000; // 30秒无广播视为离线
const BROADCAST_INTERVAL_MS = 3_000; // 每3秒广播一次

/**
 * 设备发现服务
 * 桌面端：UDP 广播自动发现
 * 移动端：手动连接已知桌面设备
 */
export class DiscoveryService {
	private transport: INetworkTransport;
	private localDevice: DeviceInfo;
	private knownDevices: Map<string, DeviceInfo> = new Map();
	private broadcastInterval: ReturnType<typeof setInterval> | null = null;
	private cleanupInterval: ReturnType<typeof setInterval> | null = null;
	private onDevicesChanged: (() => void) | null = null;
	private onManualDevicesChanged: (() => void) | null = null;
	/** 获取受保护的设备 ID 集合（如有活跃 WebSocket 连接的设备不应被清理） */
	private getProtectedDeviceIds: (() => Set<string>) | null = null;
	/** 获取已绑定设备 ID 集合（已绑定设备不应被清理删除，仅标记离线） */
	private getBoundDeviceIds: (() => Set<string>) | null = null;

	/**
	 * 设置已绑定设备 ID 提供者（用于防止清理服务删除已绑定设备）
	 */
	setBoundDeviceIdsProvider(provider: () => Set<string>): void {
		this.getBoundDeviceIds = provider;
	}

	constructor(transport: INetworkTransport, localDevice: DeviceInfo) {
		this.transport = transport;
		this.localDevice = localDevice;
	}

	/**
	 * 设置设备列表变更回调
	 */
	setOnDevicesChanged(callback: () => void): void {
		this.onDevicesChanged = callback;
	}

	/**
	 * 设置手动设备列表变更回调（用于持久化到 data.json）
	 */
	setOnManualDevicesChanged(callback: () => void): void {
		this.onManualDevicesChanged = callback;
	}

	/**
	 * 从持久化数据恢复手动添加的桌面设备
	 */
	restoreManualDevices(devices: DeviceInfo[]): void {
		for (const device of devices) {
			// 恢复时标记为离线，后续健康检查会刷新状态
			this.knownDevices.set(device.id, { ...device, lastSeen: 0 });
		}
		if (devices.length > 0) {
			this.onDevicesChanged?.();
		}
	}

	/**
	 * 设置受保护设备 ID 查询函数（活跃 WebSocket 连接的设备不会被清理）
	 */
	setProtectedDeviceIdsProvider(provider: () => Set<string>): void {
		this.getProtectedDeviceIds = provider;
	}

	/**
	 * 启动设备发现
	 */
	async start(): Promise<void> {
		// 启动 UDP 发现（仅桌面端有效）
		await this.transport.startDiscovery((msg, address) => {
			this.handleDiscoveryMessage(msg, address);
		});

		// 定期广播自身存在
		this.broadcastInterval = setInterval(() => {
			this.broadcastAnnounce();
		}, BROADCAST_INTERVAL_MS);

		// 定期清理离线设备
		this.cleanupInterval = setInterval(() => {
			this.cleanupStaleDevices();
		}, 10_000);

		// 立即广播一次
		this.broadcastAnnounce();
	}

	/**
	 * 停止设备发现
	 */
	async stop(): Promise<void> {
		if (this.broadcastInterval) {
			clearInterval(this.broadcastInterval);
			this.broadcastInterval = null;
		}
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}
		await this.transport.stopDiscovery();
	}

	/**
	 * 获取所有已知设备
	 */
	getKnownDevices(): DeviceInfo[] {
		return Array.from(this.knownDevices.values());
	}

	/**
	 * 获取在线设备列表
	 */
	getOnlineDevices(): DeviceInfo[] {
		const now = Date.now();
		return this.getKnownDevices().filter(d => (now - d.lastSeen) < DEVICE_TIMEOUT_MS);
	}

	/**
	 * 注册远程设备（通过 WebSocket 连接的移动端设备）
	 */
	registerRemoteDevice(device: DeviceInfo): void {
		const existing = this.knownDevices.get(device.id);
		if (existing) {
			existing.lastSeen = Date.now();
		} else {
			this.knownDevices.set(device.id, { ...device, lastSeen: Date.now() });
		}
		this.onDevicesChanged?.();
	}

	/**
	 * 通过设备 ID 刷新 lastSeen（WebSocket 连接保活）
	 */
	refreshDeviceLastSeen(deviceId: string): void {
		const device = this.knownDevices.get(deviceId);
		if (device) {
			device.lastSeen = Date.now();
		}
	}

	/**
	 * 手动添加桌面设备（移动端使用）
	 * 通过 HTTP 获取真实设备信息，避免合成 ID 与真实 ID 不匹配
	 */
	async addManualDevice(address: string, port: number): Promise<DeviceInfo> {
		const baseUrl = `http://${address}:${port}`;

		// 尝试获取真实设备信息
		let deviceInfo: DeviceInfo;
		try {
			const resp = await fetch(`${baseUrl}/api/device`, {
				signal: AbortSignal.timeout(5000),
			});
			if (resp.ok) {
				const json = await resp.json();
				const data = json.data || json;
				deviceInfo = {
					...data,
					address,
					port,
					lastSeen: Date.now(),
					isManual: true,
				};
			} else {
				// 回退：使用合成 ID
				deviceInfo = {
					id: `manual-${address}-${port}`,
					alias: `设备(${address})`,
					platform: 'desktop',
					port,
					address,
					lastSeen: Date.now(),
					discoverable: true,
					isManual: true,
				};
			}
		} catch {
			// 回退：使用合成 ID
			deviceInfo = {
				id: `manual-${address}-${port}`,
				alias: `设备(${address})`,
				platform: 'desktop',
				port,
				address,
				lastSeen: Date.now(),
				discoverable: true,
				isManual: true,
			};
		}

		this.knownDevices.set(deviceInfo.id, deviceInfo);
		this.onDevicesChanged?.();
		// 通知外部持久化手动设备列表
		this.onManualDevicesChanged?.();
		return deviceInfo;
	}

	/**
	 * 广播设备公告
	 */
	private broadcastAnnounce(): void {
		if (!this.localDevice.discoverable) return;

		const msg: DiscoveryMessage = {
			type: 'announce',
			device: {
				...this.localDevice,
				lastSeen: Date.now(),
			},
		};

		// 桌面端通过 UDP 广播
		if ('broadcast' in this.transport && typeof (this.transport as DesktopNetworkTransport).broadcast === 'function') {
			(this.transport as DesktopNetworkTransport).broadcast(msg);
		}
	}

	/**
	 * 广播下线通知（插件卸载前调用，通知其他桌面端本端即将离线）
	 */
	broadcastGoodbye(): Promise<void> {
		const msg: DiscoveryMessage = {
			type: 'goodbye',
			device: {
				...this.localDevice,
				discoverable: false,
				lastSeen: 0,
			},
		};

		return new Promise((resolve) => {
			if ('broadcast' in this.transport && typeof (this.transport as DesktopNetworkTransport).broadcast === 'function') {
				const transport = this.transport as DesktopNetworkTransport;
				transport.broadcast(msg, () => {
					console.log('[LAN Sync] Broadcast goodbye sent');
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * 获取手动添加的桌面设备（用于持久化到 settings）
	 */
	getManualDevices(): DeviceInfo[] {
		return this.getKnownDevices().filter(d => d.isManual);
	}

	/**
	 * 删除手动添加的设备
	 */
	removeManualDevice(deviceId: string): boolean {
		const device = this.knownDevices.get(deviceId);
		if (device && device.isManual) {
			this.knownDevices.delete(deviceId);
			this.onDevicesChanged?.();
			this.onManualDevicesChanged?.();
			return true;
		}
		return false;
	}

	/**
	 * 更新设备 ID 和别名（用于 WebSocket 连接后获取到对端真实信息时）
	 * 将旧 ID 的设备条目迁移到新 ID，同时更新别名等字段
	 */
	updateDeviceIdAndAlias(oldId: string, newId: string, newAlias: string): boolean {
		const device = this.knownDevices.get(oldId);
		if (!device) return false;
		// ID 未变，仅更新别名
		if (oldId === newId) {
			device.alias = newAlias;
			this.onDevicesChanged?.();
			this.onManualDevicesChanged?.();
			return true;
		}
		// 删除旧条目，用新 ID 重新插入
		this.knownDevices.delete(oldId);
		device.id = newId;
		device.alias = newAlias;
		device.lastSeen = Date.now();
		this.knownDevices.set(newId, device);
		console.log(`[LAN Sync] Device ID updated: ${oldId} -> ${newId} (${newAlias})`);
		this.onDevicesChanged?.();
		this.onManualDevicesChanged?.();
		return true;
	}

	/**
	 * 从已知设备列表中移除指定设备（通用）
	 */
	removeDevice(deviceId: string): void {
		if (this.knownDevices.delete(deviceId)) {
			this.onDevicesChanged?.();
		}
	}

	/**
	 * 处理收到的发现消息
	 */
	private handleDiscoveryMessage(msg: DiscoveryMessage, address: string): void {
		// 忽略自身广播
		if (msg.device.id === this.localDevice.id) return;

		// 处理下线通知：立即标记设备离线
		if (msg.type === 'goodbye') {
			const existing = this.knownDevices.get(msg.device.id);
			if (existing) {
				existing.lastSeen = 0;
				console.log(`[LAN Sync] Received goodbye from: ${existing.alias} (${existing.id})`);
				this.onDevicesChanged?.();
			}
			return;
		}

		// 忽略不可发现的设备
		if (!msg.device.discoverable) return;

		const existing = this.knownDevices.get(msg.device.id);
		const updated: DeviceInfo = {
			...msg.device,
			address: msg.device.address || address,
			lastSeen: Date.now(),
			isManual: existing?.isManual, // 保留手动标记
		};

		if (!existing) {
			// 检查是否有手动设备匹配该地址，如果有则合并
			const matchedManual = this.findManualDeviceByAddress(updated.address || address);
			if (matchedManual) {
				// 用真实设备信息替换手动设备的合成信息
				this.knownDevices.delete(matchedManual.id);
				updated.isManual = true;
				this.knownDevices.set(updated.id, updated);
				console.log(`[LAN Sync] Manual device matched: ${matchedManual.alias} -> ${updated.alias}`);
				this.onManualDevicesChanged?.();
			} else {
				console.log(`[LAN Sync] Discovered new device: ${updated.alias} (${updated.id})`);
				this.knownDevices.set(updated.id, updated);
			}
		} else {
			this.knownDevices.set(updated.id, updated);
		}
		this.onDevicesChanged?.();
	}

	/**
	 * 根据地址查找手动添加的设备
	 */
	private findManualDeviceByAddress(address: string): DeviceInfo | undefined {
		for (const device of this.knownDevices.values()) {
			if (device.isManual && device.address === address) {
				return device;
			}
		}
		return undefined;
	}

	/**
	 * 清理超时设备
	 */
	private async cleanupStaleDevices(): Promise<void> {
		const now = Date.now();
		let changed = false;

		// 先刷新手动添加的设备（通过 HTTP 健康检查保活）
		for (const [id, device] of this.knownDevices) {
			if (device.isManual && device.address && device.port) {
				try {
					const resp = await fetch(`http://${device.address}:${device.port}/api/health`, {
						signal: AbortSignal.timeout(3000),
					});
					if (resp.ok) {
						device.lastSeen = now;
					}
				} catch {
					// 健康检查失败，不更新 lastSeen
				}
			}
		}

		for (const [id, device] of this.knownDevices) {
			// 受保护的设备（有活跃 WebSocket 连接）不删除，刷新 lastSeen
			const protectedIds = this.getProtectedDeviceIds?.() || new Set<string>();
			if (protectedIds.has(id)) {
				device.lastSeen = now;
				continue;
			}
			// 已绑定设备不删除，仅标记离线（保留别名和平台类型缓存）
			const boundIds = this.getBoundDeviceIds?.() || new Set<string>();
			if (boundIds.has(id)) {
				if (now - device.lastSeen > DEVICE_TIMEOUT_MS) {
					changed = true;
				}
				continue;
			}
			// 手动添加的设备不删除，仅标记离线
			if (device.isManual) {
				if (now - device.lastSeen > DEVICE_TIMEOUT_MS) {
					changed = true;
				}
				continue;
			}
			if (now - device.lastSeen > DEVICE_TIMEOUT_MS * 3) {
				// 超过90秒彻底移除
				this.knownDevices.delete(id);
				changed = true;
			} else if (now - device.lastSeen > DEVICE_TIMEOUT_MS) {
				// 超过30秒标记离线（通过 lastSeen 判断）
				changed = true;
			}
		}

		if (changed) {
			this.onDevicesChanged?.();
		}
	}
}
