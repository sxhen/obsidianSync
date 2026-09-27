// ============================================================
// LAN Sync Plugin - 全局类型定义
// ============================================================

/** 设备平台类型 */
export type DevicePlatform = 'desktop' | 'mobile';

/** 设备信息 */
export interface DeviceInfo {
	id: string;
	alias: string;
	platform: DevicePlatform;
	port: number;
	address?: string;
	lastSeen: number;
	discoverable: boolean;
	/** 移动端手动添加的桌面设备 */
	isManual?: boolean;
}

/** 绑定组 */
export interface BindingGroup {
	id: string;
	devices: string[];
	vaultMappings: Record<string, string>;
	/** 缓存绑定组内各设备的别名（deviceId → alias），设备离线时仍可显示名称 */
	deviceAliases?: Record<string, string>;
	/** 缓存绑定组内各设备的平台类型（deviceId → 'desktop' | 'mobile'），设备离线时仍可显示类型 */
	devicePlatforms?: Record<string, 'desktop' | 'mobile'>;
	createdAt: number;
	/** 是否参与定时自动同步（默认 true） */
	autoSync?: boolean;
}

/** 同步记录（文件清单条目） */
export interface SyncRecord {
	filePath: string;
	lastModified: number;
	size: number;
	hash: string;
}

/** 文件变更类型 */
export type FileAction = 'add' | 'modify' | 'del';

/** 同步文件条目（含变更类型） */
export interface SyncFileEntry {
	path: string;
	action: FileAction;
}

/** 同步历史记录 */
export interface SyncHistoryRecord {
	id: string;
	type: 'send' | 'receive';
	sourceDeviceId: string;
	sourceDeviceAlias: string;
	targetBindingId: string;
	timestamp: number;
	files: SyncFileEntry[];
}

/** 黑名单条目 */
export interface BlacklistEntry {
	id: string;
	alias: string;
	platform: DevicePlatform;
}

/** 插件设置 */
export interface PluginSettings {
	deviceId: string;
	deviceAlias: string;
	syncIntervalMinutes: number;
	maxHistoryCopies: number;
	historyFolder: string;
	discoverable: boolean;
	autoRejectThreshold: number;
	blacklist: BlacklistEntry[];
	bindings: BindingGroup[];
	knownDevices: DeviceInfo[];
	manualDesktopDevices: DeviceInfo[];
	chunkSize: number;
	syncHistory: SyncHistoryRecord[];
	maxSyncHistory: number;
	/** 缓存对端设备的自动同步状态（bindingId → 对端是否开启自动同步） */
	remoteAutoSyncStatus: Record<string, boolean>;
}

/** 分享请求 */
export interface ShareRequest {
	fromDeviceId: string;
	fromDeviceAlias: string;
	fromDevicePlatform?: DevicePlatform;
	fileName: string;
	fileContent: string;
	filePath?: string;
}

/** 分享接收决策 */
export type ShareDecision = 'accept' | 'reject' | 'saveAs' | 'blacklist';

/** 验证码会话 */
export interface PairingSession {
	sessionId: string;
	fromDeviceId: string;
	fromDeviceAlias: string;
	code: string;
	createdAt: number;
	expiresAt: number;
}

/** 设备发现消息类型 */
export type DiscoveryMessageType = 'announce' | 'discover' | 'response' | 'goodbye';

/** 设备发现消息 */
export interface DiscoveryMessage {
	type: DiscoveryMessageType;
	device: DeviceInfo;
}

/** 同步清单响应 */
export interface ManifestResponse {
	deviceId: string;
	records: SyncRecord[];
	timestamp: number;
	/** 本端已删除的文件路径列表 */
	deletedFiles?: string[];
}

/** API 通用响应 */
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: string;
}

/** 网络传输层抽象接口 */
export interface INetworkTransport {
	startServer(port: number, requestHandler: (req: any, res: any) => void): Promise<void>;
	stopServer(): Promise<void>;
	sendRequest(url: string, options: RequestInit): Promise<any>;
	startDiscovery(
		onMessage: (msg: DiscoveryMessage, address: string) => void
	): Promise<void>;
	stopDiscovery(): Promise<void>;
	getLocalIP(): string;
	isServerCapable(): boolean;
}
