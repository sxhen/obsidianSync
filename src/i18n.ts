/**
 * LAN Sync 国际化 (i18n) 模块
 * 支持语言：简体中文(zh)、英语(en)、繁体中文(zh-TW)、法语(fr)、日语(ja)、韩语(ko)
 * 根据 Obsidian 语言设置自动切换
 */

// ============================================================
// 语言检测
// ============================================================

export function getCurrentLang(): string {
	// 1. Obsidian 将语言存储在 localStorage
	const obsidianLang = window.localStorage?.getItem('language');
	if (obsidianLang) return normalizeLang(obsidianLang);

	// 2. moment.locale()（Obsidian 会设置）
	try {
		const m = (window as any).moment?.();
		if (m?.locale) return normalizeLang(m.locale());
	} catch { /* ignore */ }

	// 3. navigator.language 兜底
	if (typeof navigator !== 'undefined' && navigator.language) {
		return normalizeLang(navigator.language);
	}

	return 'zh';
}

function normalizeLang(raw: string): string {
	const lang = raw.toLowerCase().replace('_', '-');
	if (lang === 'zh-tw' || lang === 'zh-hk' || lang.startsWith('zh-tw') || lang.startsWith('zh-hk')) return 'zh-TW';
	if (lang.startsWith('zh')) return 'zh';
	if (lang.startsWith('fr')) return 'fr';
	if (lang.startsWith('ja')) return 'ja';
	if (lang.startsWith('ko')) return 'ko';
	if (lang.startsWith('en')) return 'en';
	return 'zh';
}

// ============================================================
// t() 翻译函数
// ============================================================

export function t(key: string, params?: Record<string, string | number>): string {
	const lang = getCurrentLang();
	const dict = translations[lang] || translations['zh'];
	let text = dict[key] || translations['zh'][key] || key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
		}
	}
	return text;
}

// ============================================================
// 翻译字典
// ============================================================

type TranslationDict = Record<string, string>;

const zh: TranslationDict = {
	// --- 分区标题 ---
	'section.deviceInfo': '设备信息',
	'section.discoveryBinding': '设备发现与绑定',
	'section.syncSettings': '同步设置',
	'section.syncHistory': '同步历史',
	'section.blacklist': '黑名单',
	'section.serviceStatus': '服务状态',
	'section.boundDevices': '已绑定设备',

	// --- 设备信息设置 ---
	'settings.deviceId': '设备 ID',
	'settings.deviceIdDesc': '唯一标识符（不可修改）',
	'settings.uninitialized': '未初始化',
	'settings.showFullId': '显示完整 ID',
	'settings.hideFullId': '隐藏完整 ID',
	'settings.deviceAlias': '设备别名',
	'settings.deviceAliasDesc': '局域网中显示的名称（需唯一）',
	'settings.deviceAliasPlaceholder': '例如: 快乐的书签',
	'settings.discoverable': '可被发现',
	'settings.discoverableDesc': '允许其他设备发现本设备',
	'settings.refreshCache': '刷新文件缓存',
	'settings.refreshCacheDesc': '重建文件 MD5 哈希缓存（增量仅更新变更文件，全量清空重算）',
	'settings.incrementalRefresh': '增量刷新',
	'settings.fullRefresh': '全量刷新',
	'settings.refreshing': '刷新中...',
	'settings.currentCache': '当前缓存: {{count}} 条记录',
	'settings.incrementalDone': 'LAN Sync: 增量刷新完成，计算 {{computed}} 个，清理 {{removed}} 个，缓存共 {{total}} 条',
	'settings.incrementalFail': 'LAN Sync: 增量刷新失败',
	'settings.fullDone': 'LAN Sync: 全量刷新完成，共计算 {{total}} 个文件',
	'settings.fullFail': 'LAN Sync: 全量刷新失败',

	// --- 设备发现与绑定 ---
	'settings.manualAdd': '手动添加',
	'settings.manualAddDesc': '通过 IP 地址和端口添加桌面设备',
	'settings.viewDevices': '查看局域网设备',
	'settings.viewDevicesDesc': '浏览当前发现的所有设备',
	'settings.viewDevicesBtn': '查看设备',
	'settings.autoSync': '自动同步',
	'settings.sync': '同步',
	'settings.unbind': '解绑',
	'settings.remoteClosedSync': '（对方已关闭自动同步）',

	// --- 同步设置 ---
	'settings.syncInterval': '同步间隔',
	'settings.syncIntervalDesc': '自动同步的时间间隔（分钟）',
	'settings.1min': '1 分钟',
	'settings.3min': '3 分钟',
	'settings.5min': '5 分钟',
	'settings.10min': '10 分钟',
	'settings.15min': '15 分钟',
	'settings.30min': '30 分钟',
	'settings.historyCopies': '历史副本数量',
	'settings.historyCopiesDesc': '每个文件保留的历史副本数量',
	'settings.historyFolder': '历史副本目录',
	'settings.historyFolderDesc': '历史副本保存的隐藏目录路径',
	'settings.viewMore': '查看更多',

	// --- 黑名单 ---
	'settings.manageBlacklist': '管理黑名单',
	'settings.blacklistCount': '已拉黑 {{count}} 台设备',
	'settings.viewBlacklist': '查看黑名单',
	'settings.autoRejectThreshold': '自动拉黑阈值',
	'settings.autoRejectThresholdDesc': '连续拒绝同一设备分享请求多少次后自动拉黑',

	// --- 服务状态 ---
	'settings.httpService': 'HTTP 服务',
	'settings.port': '端口: {{port}}',
	'settings.running': '运行中',
	'settings.notStarted': '未启动',
	'settings.udpService': 'UDP 发现服务',

	// --- 同步历史 ---
	'history.noRecords': '暂无同步记录。',
	'history.send': '↑ 发送',
	'history.receive': '↓ 接收',
	'history.fileCount': '{{count}} 个文件',
	'history.localDevice': '本机',

	// --- 状态 ---
	'status.online': '在线',
	'status.offline': '离线',
	'status.noBindings': '暂无绑定设备',
	'status.bound': '已绑定',
	'status.unbound': '未绑定',

	// --- 按钮 ---
	'button.close': '关闭',
	'button.cancel': '取消',
	'button.confirm': '确认',
	'button.bind': '绑定',
	'button.share': '分享',
	'button.delete': '删除',
	'button.remove': '移除',
	'button.view': '查看',
	'button.reject': '拒绝',
	'button.accept': '接收',
	'button.saveAs': '另存为',
	'button.add': '添加',
	'button.blacklist': '加入黑名单',
	'button.settings': '⚙ 设置',

	// --- 弹窗 ---
	'modal.deviceList': '局域网设备',
	'modal.noDeviceFound': '未发现其他设备。请确保其他设备已开启并设置为"可被发现"。',
	'modal.verificationTitle': '设备绑定验证',
	'modal.verificationDisplay': '请在 "{{name}}" 上输入以下验证码：',
	'modal.codeValidTime': '验证码5分钟内有效',
	'modal.pairRequest': '绑定请求',
	'modal.pairRequestInput': '"{{name}}" 请求与你绑定，请输入对方屏幕上显示的验证码：',
	'modal.codePlaceholder': '请输入6位验证码',
	'modal.confirmBind': '确认绑定',
	'modal.pairNotice': '"{{name}}" 请求与你绑定设备',
	'modal.shareReceived': '收到笔记分享',
	'modal.shareFrom': '"{{name}}" 给你分享了一份笔记：',
	'modal.savePath': '保存路径',
	'modal.savePathPlaceholder': '例如: 分享/{{name}}',
	'modal.unbindConfirm': '确认解绑',
	'modal.unbindMessage': '确认要与 "{{name}}" 解绑吗？解绑后双方将无法自动同步。',
	'modal.blacklist': '黑名单管理',
	'modal.blacklistEmpty': '黑名单为空',
	'modal.addDevice': '手动添加设备',
	'modal.addDeviceDesc': '输入桌面设备的 IP 地址和端口',
	'modal.ipAddress': 'IP 地址',
	'modal.port': '端口',
	'modal.bindVault': '与 "{{name}}" 绑定仓库',
	'modal.localVault': '本地仓库',
	'modal.localVaultDesc': '选择本设备的仓库',
	'modal.remoteVault': '远程仓库',
	'modal.remoteVaultDesc': '选择 "{{name}}" 上的仓库',

	// --- 通知 ---
	'notice.bindSuccess': 'LAN Sync: 绑定成功',
	'notice.bindWithDevice': 'LAN Sync: 与 "{{name}}" 绑定成功',
	'notice.bindFailed': 'LAN Sync: 无法连接到目标设备，请确保设备在线',
	'notice.deviceRejected': 'LAN Sync: "{{name}}" 拒绝了您的绑定请求',
	'notice.pairCancelled': 'LAN Sync: 对方已取消绑定请求',
	'notice.codeError': 'LAN Sync: 验证码错误，绑定失败',
	'notice.rejectedBind': 'LAN Sync: 已拒绝 "{{name}}" 的绑定请求',
	'notice.unbindDone': 'LAN Sync: 远端设备已解绑',
	'notice.unbindLocal': 'LAN Sync: 已解绑',
	'notice.noDeviceFound': 'LAN Sync: 未发现其他设备',
	'notice.noShareableFiles': 'LAN Sync: 未找到可分享的文件',
	'notice.deviceUnreachable': 'LAN Sync: 设备 "{{name}}" 当前不可达',
	'notice.shareSuccess': 'LAN Sync: 已分享 {{count}} 个文件到 "{{name}}"',
	'notice.sharePartial': 'LAN Sync: 成功 {{success}} 个，失败 {{fail}} 个',
	'notice.deviceDeleted': 'LAN Sync: 已删除 "{{name}}"',
	'notice.deviceAdded': 'LAN Sync: 已添加 "{{name}}"',
	'notice.addDeviceFailed': 'LAN Sync: 添加设备失败，请检查地址和端口',
	'notice.fileReceived': 'LAN Sync: 已接收 "{{name}}"',
	'notice.fileSavedAs': 'LAN Sync: 已另存为 "{{path}}"',
	'notice.shareRejected': 'LAN Sync: 已拒绝分享',
	'notice.shareRejectedBlacklist': 'LAN Sync: 已拒绝并记录',
	'notice.blacklistedDeviceRejected': 'LAN Sync: 该设备已在黑名单中，已自动拒绝',
	'notice.shareRejectedByReceiver': 'LAN Sync: 对方已拒绝接收「{{name}}」',
	'notice.remoteAutoSyncOff': 'LAN Sync: 对方已关闭自动同步，跳过同步',
	'notice.syncFileCountZero': 'LAN Sync: 同步文件数量: 0',
	'notice.syncComplete': 'LAN Sync: 已从 "{{name}}" 同步 {{count}} 个文件',

	// --- 设备 ---
	'device.connectedDevice': '已连接设备({{id}})',
	'device.boundDevice': '已绑定设备({{id}})',
	'device.unknownDevice': '未知设备',
	'device.unknownDeviceId': '未知设备({{id}})',

	'platform.desktop': '桌面端',
	'platform.mobile': '移动端',

	// --- 命令 ---
	'command.viewDevices': '查看局域网设备',
	'command.syncNow': '立即同步',

	// --- 菜单 ---
	'menu.shareToDevice': '分享到设备...',
};

// ============================================================
// English
// ============================================================

const en: TranslationDict = {
	// --- Section headers ---
	'section.deviceInfo': 'Device Info',
	'section.discoveryBinding': 'Device Discovery & Binding',
	'section.syncSettings': 'Sync Settings',
	'section.syncHistory': 'Sync History',
	'section.blacklist': 'Blacklist',
	'section.serviceStatus': 'Service Status',
	'section.boundDevices': 'Bound Devices',

	// --- Device info settings ---
	'settings.deviceId': 'Device ID',
	'settings.deviceIdDesc': 'Unique identifier (not modifiable)',
	'settings.uninitialized': 'Not initialized',
	'settings.showFullId': 'Show full ID',
	'settings.hideFullId': 'Hide full ID',
	'settings.deviceAlias': 'Device Alias',
	'settings.deviceAliasDesc': 'Name displayed on LAN (must be unique)',
	'settings.deviceAliasPlaceholder': 'e.g. Happy Bookmark',
	'settings.discoverable': 'Discoverable',
	'settings.discoverableDesc': 'Allow other devices to discover this device',
	'settings.refreshCache': 'Refresh File Cache',
	'settings.refreshCacheDesc': 'Rebuild file MD5 hash cache (incremental updates changed files only, full recalculates all)',
	'settings.incrementalRefresh': 'Incremental',
	'settings.fullRefresh': 'Full Refresh',
	'settings.refreshing': 'Refreshing...',
	'settings.currentCache': 'Current cache: {{count}} records',
	'settings.incrementalDone': 'LAN Sync: Incremental refresh done, computed {{computed}}, cleaned {{removed}}, total {{total}}',
	'settings.incrementalFail': 'LAN Sync: Incremental refresh failed',
	'settings.fullDone': 'LAN Sync: Full refresh done, computed {{total}} files',
	'settings.fullFail': 'LAN Sync: Full refresh failed',

	// --- Device discovery & binding ---
	'settings.manualAdd': 'Manual Add',
	'settings.manualAddDesc': 'Add a desktop device by IP address and port',
	'settings.viewDevices': 'View LAN Devices',
	'settings.viewDevicesDesc': 'Browse all discovered devices',
	'settings.viewDevicesBtn': 'View Devices',
	'settings.autoSync': 'Auto Sync',
	'settings.sync': 'Sync',
	'settings.unbind': 'Unbind',
	'settings.remoteClosedSync': '(Remote has disabled auto sync)',

	// --- Sync settings ---
	'settings.syncInterval': 'Sync Interval',
	'settings.syncIntervalDesc': 'Time interval for automatic sync (minutes)',
	'settings.1min': '1 minute',
	'settings.3min': '3 minutes',
	'settings.5min': '5 minutes',
	'settings.10min': '10 minutes',
	'settings.15min': '15 minutes',
	'settings.30min': '30 minutes',
	'settings.historyCopies': 'History Copies',
	'settings.historyCopiesDesc': 'Number of history copies to keep per file',
	'settings.historyFolder': 'History Folder',
	'settings.historyFolderDesc': 'Hidden folder path for history copies',
	'settings.viewMore': 'View More',

	// --- Blacklist ---
	'settings.manageBlacklist': 'Manage Blacklist',
	'settings.blacklistCount': '{{count}} device(s) blacklisted',
	'settings.viewBlacklist': 'View Blacklist',
	'settings.autoRejectThreshold': 'Auto Blacklist Threshold',
	'settings.autoRejectThresholdDesc': 'Auto blacklist after rejecting share requests from the same device this many times',

	// --- Service status ---
	'settings.httpService': 'HTTP Service',
	'settings.port': 'Port: {{port}}',
	'settings.running': 'Running',
	'settings.notStarted': 'Not started',
	'settings.udpService': 'UDP Discovery Service',

	// --- Sync history ---
	'history.noRecords': 'No sync records yet.',
	'history.send': '↑ Sent',
	'history.receive': '↓ Received',
	'history.fileCount': '{{count}} file(s)',
	'history.localDevice': 'Local',

	// --- Status ---
	'status.online': 'Online',
	'status.offline': 'Offline',
	'status.noBindings': 'No bound devices',
	'status.bound': 'Bound',
	'status.unbound': 'Unbound',

	// --- Buttons ---
	'button.close': 'Close',
	'button.cancel': 'Cancel',
	'button.confirm': 'Confirm',
	'button.bind': 'Bind',
	'button.share': 'Share',
	'button.delete': 'Delete',
	'button.remove': 'Remove',
	'button.view': 'View',
	'button.reject': 'Reject',
	'button.accept': 'Accept',
	'button.saveAs': 'Save As',
	'button.add': 'Add',
	'button.blacklist': 'Add to Blacklist',
	'button.settings': '⚙ Settings',

	// --- Modals ---
	'modal.deviceList': 'LAN Devices',
	'modal.noDeviceFound': 'No other devices found. Please make sure other devices are turned on and set to "Discoverable".',
	'modal.verificationTitle': 'Device Binding Verification',
	'modal.verificationDisplay': 'Please enter the following verification code on "{{name}}":',
	'modal.codeValidTime': 'Code valid for 5 minutes',
	'modal.pairRequest': 'Binding Request',
	'modal.pairRequestInput': '"{{name}}" requests to bind with you. Please enter the code shown on their screen:',
	'modal.codePlaceholder': 'Enter 6-digit code',
	'modal.confirmBind': 'Confirm Binding',
	'modal.pairNotice': '"{{name}}" requests to bind devices with you',
	'modal.shareReceived': 'Note Shared',
	'modal.shareFrom': '"{{name}}" shared a note with you:',
	'modal.savePath': 'Save Path',
	'modal.savePathPlaceholder': 'e.g. Shared/{{name}}',
	'modal.unbindConfirm': 'Confirm Unbind',
	'modal.unbindMessage': 'Are you sure you want to unbind from "{{name}}"? Both sides will no longer auto sync.',
	'modal.blacklist': 'Blacklist Manager',
	'modal.blacklistEmpty': 'Blacklist is empty',
	'modal.addDevice': 'Add Device Manually',
	'modal.addDeviceDesc': 'Enter the IP address and port of the desktop device',
	'modal.ipAddress': 'IP Address',
	'modal.port': 'Port',
	'modal.bindVault': 'Bind Vault with "{{name}}"',
	'modal.localVault': 'Local Vault',
	'modal.localVaultDesc': 'Select vault on this device',
	'modal.remoteVault': 'Remote Vault',
	'modal.remoteVaultDesc': 'Select vault on "{{name}}"',

	// --- Notices ---
	'notice.bindSuccess': 'LAN Sync: Binding successful',
	'notice.bindWithDevice': 'LAN Sync: Bound with "{{name}}"',
	'notice.bindFailed': 'LAN Sync: Cannot connect to target device, please make sure it is online',
	'notice.deviceRejected': 'LAN Sync: "{{name}}" rejected your binding request',
	'notice.pairCancelled': 'LAN Sync: The other party has cancelled the binding request',
	'notice.codeError': 'LAN Sync: Verification code error, binding failed',
	'notice.rejectedBind': 'LAN Sync: Rejected "{{name}}" binding request',
	'notice.unbindDone': 'LAN Sync: Remote device has been unbound',
	'notice.unbindLocal': 'LAN Sync: Unbound',
	'notice.noDeviceFound': 'LAN Sync: No other devices found',
	'notice.noShareableFiles': 'LAN Sync: No shareable files found',
	'notice.deviceUnreachable': 'LAN Sync: Device "{{name}}" is currently unreachable',
	'notice.shareSuccess': 'LAN Sync: Shared {{count}} file(s) to "{{name}}"',
	'notice.sharePartial': 'LAN Sync: {{success}} succeeded, {{fail}} failed',
	'notice.deviceDeleted': 'LAN Sync: Deleted "{{name}}"',
	'notice.deviceAdded': 'LAN Sync: Added "{{name}}"',
	'notice.addDeviceFailed': 'LAN Sync: Failed to add device, please check address and port',
	'notice.fileReceived': 'LAN Sync: Received "{{name}}"',
	'notice.fileSavedAs': 'LAN Sync: Saved as "{{path}}"',
	'notice.shareRejected': 'LAN Sync: Share rejected',
	'notice.shareRejectedBlacklist': 'LAN Sync: Rejected and blacklisted',
	'notice.blacklistedDeviceRejected': 'LAN Sync: Device is blacklisted, auto-rejected',
	'notice.shareRejectedByReceiver': 'LAN Sync: Receiver rejected "{{name}}"',
	'notice.remoteAutoSyncOff': 'LAN Sync: Remote has disabled auto sync, skipping',
	'notice.syncFileCountZero': 'LAN Sync: Sync files: 0',
	'notice.syncComplete': 'LAN Sync: Synced {{count}} file(s) from "{{name}}"',

	// --- Device ---
	'device.connectedDevice': 'Connected Device({{id}})',
	'device.boundDevice': 'Bound Device({{id}})',
	'device.unknownDevice': 'Unknown Device',
	'device.unknownDeviceId': 'Unknown Device({{id}})',

	'platform.desktop': 'Desktop',
	'platform.mobile': 'Mobile',

	// --- Commands ---
	'command.viewDevices': 'View LAN Devices',
	'command.syncNow': 'Sync Now',

	// --- Menu ---
	'menu.shareToDevice': 'Share to device...',
};

// ============================================================
// 繁体中文 (zh-TW)
// ============================================================

const zhTW: TranslationDict = {
	'section.deviceInfo': '裝置資訊',
	'section.discoveryBinding': '裝置探索與綁定',
	'section.syncSettings': '同步設定',
	'section.syncHistory': '同步歷史',
	'section.blacklist': '黑名單',
	'section.serviceStatus': '服務狀態',
	'section.boundDevices': '已綁定裝置',

	'settings.deviceId': '裝置 ID',
	'settings.deviceIdDesc': '唯一識別碼（不可修改）',
	'settings.uninitialized': '未初始化',
	'settings.showFullId': '顯示完整 ID',
	'settings.hideFullId': '隱藏完整 ID',
	'settings.deviceAlias': '裝置別名',
	'settings.deviceAliasDesc': '區域網路中顯示的名稱（需唯一）',
	'settings.deviceAliasPlaceholder': '例如：快樂的書籤',
	'settings.discoverable': '可被探索',
	'settings.discoverableDesc': '允許其他裝置探索本裝置',
	'settings.refreshCache': '重新整理檔案快取',
	'settings.refreshCacheDesc': '重建檔案 MD5 雜湊快取（增量僅更新變更檔案，全量清空重算）',
	'settings.incrementalRefresh': '增量重新整理',
	'settings.fullRefresh': '全量重新整理',
	'settings.refreshing': '重新整理中...',
	'settings.currentCache': '目前快取：{{count}} 筆記錄',
	'settings.incrementalDone': 'LAN Sync：增量重新整理完成，計算 {{computed}} 個，清理 {{removed}} 個，快取共 {{total}} 筆',
	'settings.incrementalFail': 'LAN Sync：增量重新整理失敗',
	'settings.fullDone': 'LAN Sync：全量重新整理完成，共計算 {{total}} 個檔案',
	'settings.fullFail': 'LAN Sync：全量重新整理失敗',

	'settings.manualAdd': '手動新增',
	'settings.manualAddDesc': '透過 IP 位址和連接埠新增桌面裝置',
	'settings.viewDevices': '檢視區域網路裝置',
	'settings.viewDevicesDesc': '瀏覽目前探索的所有裝置',
	'settings.viewDevicesBtn': '檢視裝置',
	'settings.autoSync': '自動同步',
	'settings.sync': '同步',
	'settings.unbind': '解除綁定',
	'settings.remoteClosedSync': '（對方已關閉自動同步）',

	'settings.syncInterval': '同步間隔',
	'settings.syncIntervalDesc': '自動同步的時間間隔（分鐘）',
	'settings.1min': '1 分鐘',
	'settings.3min': '3 分鐘',
	'settings.5min': '5 分鐘',
	'settings.10min': '10 分鐘',
	'settings.15min': '15 分鐘',
	'settings.30min': '30 分鐘',
	'settings.historyCopies': '歷史副本數量',
	'settings.historyCopiesDesc': '每個檔案保留的歷史副本數量',
	'settings.historyFolder': '歷史副本目錄',
	'settings.historyFolderDesc': '歷史副本儲存的隱藏目錄路徑',
	'settings.viewMore': '檢視更多',

	'settings.manageBlacklist': '管理黑名單',
	'settings.blacklistCount': '已封鎖 {{count}} 台裝置',
	'settings.viewBlacklist': '檢視黑名單',
	'settings.autoRejectThreshold': '自動封鎖閾值',
	'settings.autoRejectThresholdDesc': '連續拒絕同一裝置分享請求多少次後自動封鎖',

	'settings.httpService': 'HTTP 服務',
	'settings.port': '連接埠：{{port}}',
	'settings.running': '執行中',
	'settings.notStarted': '未啟動',
	'settings.udpService': 'UDP 探索服務',

	'history.noRecords': '暫無同步記錄。',
	'history.send': '↑ 傳送',
	'history.receive': '↓ 接收',
	'history.fileCount': '{{count}} 個檔案',
	'history.localDevice': '本機',

	'status.online': '上線',
	'status.offline': '離線',
	'status.noBindings': '暫無綁定裝置',
	'status.bound': '已綁定',
	'status.unbound': '未綁定',

	'button.close': '關閉',
	'button.cancel': '取消',
	'button.confirm': '確認',
	'button.bind': '綁定',
	'button.share': '分享',
	'button.delete': '刪除',
	'button.remove': '移除',
	'button.view': '檢視',
	'button.reject': '拒絕',
	'button.accept': '接收',
	'button.saveAs': '另存新檔',
	'button.add': '新增',
	'button.blacklist': '加入黑名單',
	'button.settings': '⚙ 設定',

	'modal.deviceList': '區域網路裝置',
	'modal.noDeviceFound': '未發現其他裝置。請確保其他裝置已開啟並設定為「可被探索」。',
	'modal.verificationTitle': '裝置綁定驗證',
	'modal.verificationDisplay': '請在「{{name}}」上輸入以下驗證碼：',
	'modal.codeValidTime': '驗證碼 5 分鐘內有效',
	'modal.pairRequest': '綁定請求',
	'modal.pairRequestInput': '「{{name}}」請求與你綁定，請輸入對方螢幕上顯示的驗證碼：',
	'modal.codePlaceholder': '請輸入 6 位驗證碼',
	'modal.confirmBind': '確認綁定',
	'modal.pairNotice': '「{{name}}」請求與你綁定裝置',
	'modal.shareReceived': '收到筆記分享',
	'modal.shareFrom': '「{{name}}」給你分享了一份筆記：',
	'modal.savePath': '儲存路徑',
	'modal.savePathPlaceholder': '例如：分享/{{name}}',
	'modal.unbindConfirm': '確認解除綁定',
	'modal.unbindMessage': '確認要與「{{name}}」解除綁定嗎？解除綁定後雙方將無法自動同步。',
	'modal.blacklist': '黑名單管理',
	'modal.blacklistEmpty': '黑名單為空',
	'modal.addDevice': '手動新增裝置',
	'modal.addDeviceDesc': '輸入桌面裝置的 IP 位址和連接埠',
	'modal.ipAddress': 'IP 位址',
	'modal.port': '連接埠',
	'modal.bindVault': '與「{{name}}」綁定倉庫',
	'modal.localVault': '本機倉庫',
	'modal.localVaultDesc': '選擇本裝置的倉庫',
	'modal.remoteVault': '遠端倉庫',
	'modal.remoteVaultDesc': '選擇「{{name}}」上的倉庫',

	'notice.bindSuccess': 'LAN Sync：綁定成功',
	'notice.bindWithDevice': 'LAN Sync：與「{{name}}」綁定成功',
	'notice.bindFailed': 'LAN Sync：無法連線到目標裝置，請確保裝置在線上',
	'notice.deviceRejected': 'LAN Sync：「{{name}}」拒絕了您的綁定請求',
	'notice.pairCancelled': 'LAN Sync：對方已取消綁定請求',
	'notice.codeError': 'LAN Sync：驗證碼錯誤，綁定失敗',
	'notice.rejectedBind': 'LAN Sync：已拒絕「{{name}}」的綁定請求',
	'notice.unbindDone': 'LAN Sync：遠端裝置已解除綁定',
	'notice.unbindLocal': 'LAN Sync：已解除綁定',
	'notice.noDeviceFound': 'LAN Sync：未發現其他裝置',
	'notice.noShareableFiles': 'LAN Sync：未找到可分享的檔案',
	'notice.deviceUnreachable': 'LAN Sync：裝置「{{name}}」目前無法連線',
	'notice.shareSuccess': 'LAN Sync：已分享 {{count}} 個檔案到「{{name}}」',
	'notice.sharePartial': 'LAN Sync：成功 {{success}} 個，失敗 {{fail}} 個',
	'notice.deviceDeleted': 'LAN Sync：已刪除「{{name}}」',
	'notice.deviceAdded': 'LAN Sync：已新增「{{name}}」',
	'notice.addDeviceFailed': 'LAN Sync：新增裝置失敗，請檢查位址和連接埠',
	'notice.fileReceived': 'LAN Sync：已接收「{{name}}」',
	'notice.fileSavedAs': 'LAN Sync：已另存為「{{path}}」',
	'notice.shareRejected': 'LAN Sync：已拒絕分享',
	'notice.shareRejectedBlacklist': 'LAN Sync：已拒絕並記錄',
	'notice.blacklistedDeviceRejected': 'LAN Sync：該設備已在黑名單中，已自動拒絕',
	'notice.shareRejectedByReceiver': 'LAN Sync：對方已拒絕接收「{{name}}」',
	'notice.remoteAutoSyncOff': 'LAN Sync：對方已關閉自動同步，跳過同步',
	'notice.syncFileCountZero': 'LAN Sync：同步檔案數量：0',
	'notice.syncComplete': 'LAN Sync：已從「{{name}}」同步 {{count}} 個檔案',

	'device.connectedDevice': '已連線裝置({{id}})',
	'device.boundDevice': '已綁定裝置({{id}})',
	'device.unknownDevice': '未知裝置',
	'device.unknownDeviceId': '未知裝置({{id}})',

	'platform.desktop': '桌面端',
	'platform.mobile': '行動端',

	'command.viewDevices': '檢視區域網路裝置',
	'command.syncNow': '立即同步',

	'menu.shareToDevice': '分享到裝置...',
};

// ============================================================
// Français (fr)
// ============================================================

const fr: TranslationDict = {
	'section.deviceInfo': 'Infos appareil',
	'section.discoveryBinding': 'Découverte & liaison',
	'section.syncSettings': 'Paramètres de sync',
	'section.syncHistory': 'Historique de sync',
	'section.blacklist': 'Liste noire',
	'section.serviceStatus': 'État du service',
	'section.boundDevices': 'Appareils liés',

	'settings.deviceId': 'ID de l\'appareil',
	'settings.deviceIdDesc': 'Identifiant unique (non modifiable)',
	'settings.uninitialized': 'Non initialisé',
	'settings.showFullId': 'Afficher l\'ID complet',
	'settings.hideFullId': 'Masquer l\'ID complet',
	'settings.deviceAlias': 'Alias de l\'appareil',
	'settings.deviceAliasDesc': 'Nom affiché sur le réseau (doit être unique)',
	'settings.deviceAliasPlaceholder': 'ex : Signet Joyeux',
	'settings.discoverable': 'Découvrable',
	'settings.discoverableDesc': 'Permettre aux autres appareils de découvrir cet appareil',
	'settings.refreshCache': 'Rafraîchir le cache',
	'settings.refreshCacheDesc': 'Reconstruire le cache de hachage MD5 (incrémental met à jour les fichiers modifiés, complet recalcule tout)',
	'settings.incrementalRefresh': 'Incrémental',
	'settings.fullRefresh': 'Complet',
	'settings.refreshing': 'Rafraîchissement...',
	'settings.currentCache': 'Cache actuel : {{count}} enregistrements',
	'settings.incrementalDone': 'LAN Sync : Rafraîchissement incrémental terminé, calculé {{computed}}, nettoyé {{removed}}, total {{total}}',
	'settings.incrementalFail': 'LAN Sync : Échec du rafraîchissement incrémental',
	'settings.fullDone': 'LAN Sync : Rafraîchissement complet terminé, {{total}} fichiers calculés',
	'settings.fullFail': 'LAN Sync : Échec du rafraîchissement complet',

	'settings.manualAdd': 'Ajout manuel',
	'settings.manualAddDesc': 'Ajouter un appareil bureau par adresse IP et port',
	'settings.viewDevices': 'Voir les appareils du réseau',
	'settings.viewDevicesDesc': 'Parcourir tous les appareils découverts',
	'settings.viewDevicesBtn': 'Voir les appareils',
	'settings.autoSync': 'Sync auto',
	'settings.sync': 'Sync',
	'settings.unbind': 'Délier',
	'settings.remoteClosedSync': '(L\'autre a désactivé la sync auto)',

	'settings.syncInterval': 'Intervalle de sync',
	'settings.syncIntervalDesc': 'Intervalle de temps pour la sync automatique (minutes)',
	'settings.1min': '1 minute',
	'settings.3min': '3 minutes',
	'settings.5min': '5 minutes',
	'settings.10min': '10 minutes',
	'settings.15min': '15 minutes',
	'settings.30min': '30 minutes',
	'settings.historyCopies': 'Copies d\'historique',
	'settings.historyCopiesDesc': 'Nombre de copies d\'historique à conserver par fichier',
	'settings.historyFolder': 'Dossier d\'historique',
	'settings.historyFolderDesc': 'Chemin du dossier caché pour les copies d\'historique',
	'settings.viewMore': 'Voir plus',

	'settings.manageBlacklist': 'Gérer la liste noire',
	'settings.blacklistCount': '{{count}} appareil(s) en liste noire',
	'settings.viewBlacklist': 'Voir la liste noire',
	'settings.autoRejectThreshold': 'Seuil d\'auto-blacklist',
	'settings.autoRejectThresholdDesc': 'Mettre en liste noire après avoir rejeté les partages d\'un même appareil ce nombre de fois',

	'settings.httpService': 'Service HTTP',
	'settings.port': 'Port : {{port}}',
	'settings.running': 'En cours',
	'settings.notStarted': 'Non démarré',
	'settings.udpService': 'Service de découverte UDP',

	'history.noRecords': 'Aucun enregistrement de sync.',
	'history.send': '↑ Envoyé',
	'history.receive': '↓ Reçu',
	'history.fileCount': '{{count}} fichier(s)',
	'history.localDevice': 'Local',

	'status.online': 'En ligne',
	'status.offline': 'Hors ligne',
	'status.noBindings': 'Aucun appareil lié',
	'status.bound': 'Lié',
	'status.unbound': 'Non lié',

	'button.close': 'Fermer',
	'button.cancel': 'Annuler',
	'button.confirm': 'Confirmer',
	'button.bind': 'Lier',
	'button.share': 'Partager',
	'button.delete': 'Supprimer',
	'button.remove': 'Retirer',
	'button.view': 'Voir',
	'button.reject': 'Rejeter',
	'button.accept': 'Accepter',
	'button.saveAs': 'Enregistrer sous',
	'button.add': 'Ajouter',
	'button.blacklist': 'Ajouter à la liste noire',
	'button.settings': '⚙ Paramètres',

	'modal.deviceList': 'Appareils du réseau',
	'modal.noDeviceFound': 'Aucun autre appareil trouvé. Veuillez vous assurer que les autres appareils sont allumés et configurés sur "Découvrable".',
	'modal.verificationTitle': 'Vérification de liaison',
	'modal.verificationDisplay': 'Veuillez entrer le code de vérification suivant sur "{{name}}" :',
	'modal.codeValidTime': 'Code valide pendant 5 minutes',
	'modal.pairRequest': 'Demande de liaison',
	'modal.pairRequestInput': '"{{name}}" demande à se lier avec vous. Veuillez entrer le code affiché sur son écran :',
	'modal.codePlaceholder': 'Entrez le code à 6 chiffres',
	'modal.confirmBind': 'Confirmer la liaison',
	'modal.pairNotice': '"{{name}}" demande à lier les appareils avec vous',
	'modal.shareReceived': 'Note partagée',
	'modal.shareFrom': '"{{name}}" a partagé une note avec vous :',
	'modal.savePath': 'Chemin d\'enregistrement',
	'modal.savePathPlaceholder': 'ex : Partagé/{{name}}',
	'modal.unbindConfirm': 'Confirmer la déliaison',
	'modal.unbindMessage': 'Êtes-vous sûr de vouloir délier "{{name}}" ? Les deux parties ne pourront plus se synchroniser automatiquement.',
	'modal.blacklist': 'Gestionnaire de liste noire',
	'modal.blacklistEmpty': 'La liste noire est vide',
	'modal.addDevice': 'Ajouter un appareil manuellement',
	'modal.addDeviceDesc': 'Entrez l\'adresse IP et le port de l\'appareil bureau',
	'modal.ipAddress': 'Adresse IP',
	'modal.port': 'Port',
	'modal.bindVault': 'Lier le coffre avec "{{name}}"',
	'modal.localVault': 'Coffre local',
	'modal.localVaultDesc': 'Sélectionner le coffre de cet appareil',
	'modal.remoteVault': 'Coffre distant',
	'modal.remoteVaultDesc': 'Sélectionner le coffre sur "{{name}}"',

	'notice.bindSuccess': 'LAN Sync : Liaison réussie',
	'notice.bindWithDevice': 'LAN Sync : Lié avec "{{name}}"',
	'notice.bindFailed': 'LAN Sync : Impossible de se connecter à l\'appareil cible, veuillez vérifier qu\'il est en ligne',
	'notice.deviceRejected': 'LAN Sync : "{{name}}" a rejeté votre demande de liaison',
	'notice.pairCancelled': 'LAN Sync : L\'autre partie a annulé la demande de liaison',
	'notice.codeError': 'LAN Sync : Erreur de code de vérification, liaison échouée',
	'notice.rejectedBind': 'LAN Sync : Demande de liaison de "{{name}}" rejetée',
	'notice.unbindDone': 'LAN Sync : L\'appareil distant a été délié',
	'notice.unbindLocal': 'LAN Sync : Délié',
	'notice.noDeviceFound': 'LAN Sync : Aucun autre appareil trouvé',
	'notice.noShareableFiles': 'LAN Sync : Aucun fichier partageable trouvé',
	'notice.deviceUnreachable': 'LAN Sync : L\'appareil "{{name}}" est actuellement inaccessible',
	'notice.shareSuccess': 'LAN Sync : {{count}} fichier(s) partagé(s) avec "{{name}}"',
	'notice.sharePartial': 'LAN Sync : {{success}} réussi(s), {{fail}} échoué(s)',
	'notice.deviceDeleted': 'LAN Sync : "{{name}}" supprimé',
	'notice.deviceAdded': 'LAN Sync : "{{name}}" ajouté',
	'notice.addDeviceFailed': 'LAN Sync : Échec de l\'ajout de l\'appareil, veuillez vérifier l\'adresse et le port',
	'notice.fileReceived': 'LAN Sync : "{{name}}" reçu',
	'notice.fileSavedAs': 'LAN Sync : Enregistré sous "{{path}}"',
	'notice.shareRejected': 'LAN Sync : Partage rejeté',
	'notice.shareRejectedBlacklist': 'LAN Sync : Rejeté et mis en liste noire',
	'notice.blacklistedDeviceRejected': 'LAN Sync : Appareil dans la liste noire, rejeté automatiquement',
	'notice.shareRejectedByReceiver': 'LAN Sync : Le destinataire a rejeté « {{name}} »',
	'notice.remoteAutoSyncOff': 'LAN Sync : L\'autre a désactivé la sync auto, passage',
	'notice.syncFileCountZero': 'LAN Sync : Fichiers synchronisés : 0',
	'notice.syncComplete': 'LAN Sync : {{count}} fichier(s) synchronisé(s) depuis "{{name}}"',

	'device.connectedDevice': 'Appareil connecté({{id}})',
	'device.boundDevice': 'Appareil lié({{id}})',
	'device.unknownDevice': 'Appareil inconnu',
	'device.unknownDeviceId': 'Appareil inconnu({{id}})',

	'platform.desktop': 'Bureau',
	'platform.mobile': 'Mobile',

	'command.viewDevices': 'Voir les appareils du réseau',
	'command.syncNow': 'Sync maintenant',

	'menu.shareToDevice': 'Partager vers l\'appareil...',
};

// ============================================================
// 日本語 (ja)
// ============================================================

const ja: TranslationDict = {
	'section.deviceInfo': 'デバイス情報',
	'section.discoveryBinding': 'デバイス検出とバインド',
	'section.syncSettings': '同期設定',
	'section.syncHistory': '同期履歴',
	'section.blacklist': 'ブラックリスト',
	'section.serviceStatus': 'サービス状態',
	'section.boundDevices': 'バインド済みデバイス',

	'settings.deviceId': 'デバイス ID',
	'settings.deviceIdDesc': '一意の識別子（変更不可）',
	'settings.uninitialized': '未初期化',
	'settings.showFullId': '完全な ID を表示',
	'settings.hideFullId': '完全な ID を非表示',
	'settings.deviceAlias': 'デバイスエイリアス',
	'settings.deviceAliasDesc': 'LAN で表示される名前（一意である必要があります）',
	'settings.deviceAliasPlaceholder': '例：幸せなしおり',
	'settings.discoverable': '検出可能',
	'settings.discoverableDesc': '他のデバイスがこのデバイスを検出できるようにする',
	'settings.refreshCache': 'ファイルキャッシュを更新',
	'settings.refreshCacheDesc': 'MD5 ハッシュキャッシュを再構築（増分は変更ファイルのみ更新、全量は全て再計算）',
	'settings.incrementalRefresh': '増分更新',
	'settings.fullRefresh': '全量更新',
	'settings.refreshing': '更新中...',
	'settings.currentCache': '現在のキャッシュ：{{count}} 件',
	'settings.incrementalDone': 'LAN Sync：増分更新完了、{{computed}} 件計算、{{removed}} 件削除、合計 {{total}} 件',
	'settings.incrementalFail': 'LAN Sync：増分更新に失敗しました',
	'settings.fullDone': 'LAN Sync：全量更新完了、{{total}} ファイルを計算',
	'settings.fullFail': 'LAN Sync：全量更新に失敗しました',

	'settings.manualAdd': '手動追加',
	'settings.manualAddDesc': 'IP アドレスとポートでデスクトップデバイスを追加',
	'settings.viewDevices': 'LAN デバイスを表示',
	'settings.viewDevicesDesc': '検出されたすべてのデバイスを参照',
	'settings.viewDevicesBtn': 'デバイスを表示',
	'settings.autoSync': '自動同期',
	'settings.sync': '同期',
	'settings.unbind': 'バインド解除',
	'settings.remoteClosedSync': '（相手が自動同期をオフにしています）',

	'settings.syncInterval': '同期間隔',
	'settings.syncIntervalDesc': '自動同期の間隔（分）',
	'settings.1min': '1 分',
	'settings.3min': '3 分',
	'settings.5min': '5 分',
	'settings.10min': '10 分',
	'settings.15min': '15 分',
	'settings.30min': '30 分',
	'settings.historyCopies': '履歴コピー数',
	'settings.historyCopiesDesc': 'ファイルごとに保持する履歴コピーの数',
	'settings.historyFolder': '履歴コピーフォルダ',
	'settings.historyFolderDesc': '履歴コピーを保存する隠しフォルダのパス',
	'settings.viewMore': 'もっと見る',

	'settings.manageBlacklist': 'ブラックリスト管理',
	'settings.blacklistCount': '{{count}} 台のデバイスをブロック中',
	'settings.viewBlacklist': 'ブラックリストを表示',
	'settings.autoRejectThreshold': '自動ブラックリスト閾値',
	'settings.autoRejectThresholdDesc': '同じデバイスからの共有リクエストを連続してこの回数拒否すると自動的にブラックリストに追加',

	'settings.httpService': 'HTTP サービス',
	'settings.port': 'ポート：{{port}}',
	'settings.running': '実行中',
	'settings.notStarted': '未起動',
	'settings.udpService': 'UDP 検出サービス',

	'history.noRecords': '同期記録はありません。',
	'history.send': '↑ 送信',
	'history.receive': '↓ 受信',
	'history.fileCount': '{{count}} ファイル',
	'history.localDevice': 'ローカル',

	'status.online': 'オンライン',
	'status.offline': 'オフライン',
	'status.noBindings': 'バインド済みデバイスなし',
	'status.bound': 'バインド済み',
	'status.unbound': '未バインド',

	'button.close': '閉じる',
	'button.cancel': 'キャンセル',
	'button.confirm': '確認',
	'button.bind': 'バインド',
	'button.share': '共有',
	'button.delete': '削除',
	'button.remove': '除去',
	'button.view': '表示',
	'button.reject': '拒否',
	'button.accept': '受信',
	'button.saveAs': '名前を付けて保存',
	'button.add': '追加',
	'button.blacklist': 'ブラックリストに追加',
	'button.settings': '⚙ 設定',

	'modal.deviceList': 'LAN デバイス',
	'modal.noDeviceFound': '他のデバイスが見つかりません。他のデバイスの電源が入っており、「検出可能」に設定されていることを確認してください。',
	'modal.verificationTitle': 'デバイスバインド認証',
	'modal.verificationDisplay': '「{{name}}」で以下の認証コードを入力してください：',
	'modal.codeValidTime': '認証コードは 5 分間有効です',
	'modal.pairRequest': 'バインドリクエスト',
	'modal.pairRequestInput': '「{{name}}」がバインドをリクエストしています。相手の画面に表示されている認証コードを入力してください：',
	'modal.codePlaceholder': '6桁の認証コードを入力',
	'modal.confirmBind': 'バインドを確認',
	'modal.pairNotice': '「{{name}}」がデバイスとのバインドをリクエストしています',
	'modal.shareReceived': 'ノート共有を受信',
	'modal.shareFrom': '「{{name}}」がノートを共有しました：',
	'modal.savePath': '保存パス',
	'modal.savePathPlaceholder': '例：共有/{{name}}',
	'modal.unbindConfirm': 'バインド解除の確認',
	'modal.unbindMessage': '「{{name}}」とのバインドを解除しますか？解除後、双方は自動同期できなくなります。',
	'modal.blacklist': 'ブラックリスト管理',
	'modal.blacklistEmpty': 'ブラックリストは空です',
	'modal.addDevice': 'デバイスを手動で追加',
	'modal.addDeviceDesc': 'デスクトップデバイスの IP アドレスとポートを入力',
	'modal.ipAddress': 'IP アドレス',
	'modal.port': 'ポート',
	'modal.bindVault': '「{{name}}」とボールトをバインド',
	'modal.localVault': 'ローカルボールト',
	'modal.localVaultDesc': 'このデバイスのボールトを選択',
	'modal.remoteVault': 'リモートボールト',
	'modal.remoteVaultDesc': '「{{name}}」のボールトを選択',

	'notice.bindSuccess': 'LAN Sync：バインド成功',
	'notice.bindWithDevice': 'LAN Sync：「{{name}}」とバインド成功',
	'notice.bindFailed': 'LAN Sync：対象デバイスに接続できません。オンラインであることを確認してください',
	'notice.deviceRejected': 'LAN Sync：「{{name}}」がバインドリクエストを拒否しました',
	'notice.pairCancelled': 'LAN Sync：相手がバインドリクエストをキャンセルしました',
	'notice.codeError': 'LAN Sync：認証コードエラー、バインド失敗',
	'notice.rejectedBind': 'LAN Sync：「{{name}}」のバインドリクエストを拒否しました',
	'notice.unbindDone': 'LAN Sync：リモートデバイスのバインドが解除されました',
	'notice.unbindLocal': 'LAN Sync：バインド解除しました',
	'notice.noDeviceFound': 'LAN Sync：他のデバイスが見つかりません',
	'notice.noShareableFiles': 'LAN Sync：共有可能なファイルが見つかりません',
	'notice.deviceUnreachable': 'LAN Sync：デバイス「{{name}}」は現在接続できません',
	'notice.shareSuccess': 'LAN Sync：{{count}} ファイルを「{{name}}」に共有しました',
	'notice.sharePartial': 'LAN Sync：{{success}} 件成功、{{fail}} 件失敗',
	'notice.deviceDeleted': 'LAN Sync：「{{name}}」を削除しました',
	'notice.deviceAdded': 'LAN Sync：「{{name}}」を追加しました',
	'notice.addDeviceFailed': 'LAN Sync：デバイスの追加に失敗しました。アドレスとポートを確認してください',
	'notice.fileReceived': 'LAN Sync：「{{name}}」を受信しました',
	'notice.fileSavedAs': 'LAN Sync：「{{path}}」として保存しました',
	'notice.shareRejected': 'LAN Sync：共有を拒否しました',
	'notice.shareRejectedBlacklist': 'LAN Sync：拒否して記録しました',
	'notice.blacklistedDeviceRejected': 'LAN Sync：このデバイスはブラックリストにあるため、自動拒否しました',
	'notice.shareRejectedByReceiver': 'LAN Sync：相手が「{{name}}」の受信を拒否しました',
	'notice.remoteAutoSyncOff': 'LAN Sync：相手が自動同期をオフにしています、スキップします',
	'notice.syncFileCountZero': 'LAN Sync：同期ファイル数：0',
	'notice.syncComplete': 'LAN Sync：「{{name}}」から {{count}} ファイルを同期しました',

	'device.connectedDevice': '接続済みデバイス({{id}})',
	'device.boundDevice': 'バインド済みデバイス({{id}})',
	'device.unknownDevice': '不明なデバイス',
	'device.unknownDeviceId': '不明なデバイス({{id}})',

	'platform.desktop': 'デスクトップ',
	'platform.mobile': 'モバイル',

	'command.viewDevices': 'LAN デバイスを表示',
	'command.syncNow': '今すぐ同期',

	'menu.shareToDevice': 'デバイスに共有...',
};

// ============================================================
// 한국어 (ko)
// ============================================================

const ko: TranslationDict = {
	'section.deviceInfo': '장치 정보',
	'section.discoveryBinding': '장치 검색 및 바인딩',
	'section.syncSettings': '동기화 설정',
	'section.syncHistory': '동기화 기록',
	'section.blacklist': '블랙리스트',
	'section.serviceStatus': '서비스 상태',
	'section.boundDevices': '바인딩된 장치',

	'settings.deviceId': '장치 ID',
	'settings.deviceIdDesc': '고유 식별자 (수정 불가)',
	'settings.uninitialized': '초기화되지 않음',
	'settings.showFullId': '전체 ID 표시',
	'settings.hideFullId': '전체 ID 숨기기',
	'settings.deviceAlias': '장치 별명',
	'settings.deviceAliasDesc': 'LAN에 표시되는 이름 (고유해야 함)',
	'settings.deviceAliasPlaceholder': '예: 행복한 책갈피',
	'settings.discoverable': '검색 가능',
	'settings.discoverableDesc': '다른 장치가 이 장치를 검색할 수 있도록 허용',
	'settings.refreshCache': '파일 캐시 새로고침',
	'settings.refreshCacheDesc': 'MD5 해시 캐시 재구축 (증분은 변경 파일만 업데이트, 전체는 모두 재계산)',
	'settings.incrementalRefresh': '증분 새로고침',
	'settings.fullRefresh': '전체 새로고침',
	'settings.refreshing': '새로고침 중...',
	'settings.currentCache': '현재 캐시: {{count}}개 기록',
	'settings.incrementalDone': 'LAN Sync: 증분 새로고침 완료, {{computed}}개 계산, {{removed}}개 정리, 총 {{total}}개',
	'settings.incrementalFail': 'LAN Sync: 증분 새로고침 실패',
	'settings.fullDone': 'LAN Sync: 전체 새로고침 완료, {{total}}개 파일 계산',
	'settings.fullFail': 'LAN Sync: 전체 새로고침 실패',

	'settings.manualAdd': '수동 추가',
	'settings.manualAddDesc': 'IP 주소와 포트로 데스크톱 장치 추가',
	'settings.viewDevices': 'LAN 장치 보기',
	'settings.viewDevicesDesc': '검색된 모든 장치 탐색',
	'settings.viewDevicesBtn': '장치 보기',
	'settings.autoSync': '자동 동기화',
	'settings.sync': '동기화',
	'settings.unbind': '바인딩 해제',
	'settings.remoteClosedSync': '(상대가 자동 동기화를 껐습니다)',

	'settings.syncInterval': '동기화 간격',
	'settings.syncIntervalDesc': '자동 동기화 시간 간격 (분)',
	'settings.1min': '1분',
	'settings.3min': '3분',
	'settings.5min': '5분',
	'settings.10min': '10분',
	'settings.15min': '15분',
	'settings.30min': '30분',
	'settings.historyCopies': '기록 사본 수',
	'settings.historyCopiesDesc': '파일당 보관할 기록 사본의 수',
	'settings.historyFolder': '기록 사본 폴더',
	'settings.historyFolderDesc': '기록 사본이 저장되는 숨김 폴더 경로',
	'settings.viewMore': '더 보기',

	'settings.manageBlacklist': '블랙리스트 관리',
	'settings.blacklistCount': '{{count}}개 장치 차단됨',
	'settings.viewBlacklist': '블랙리스트 보기',
	'settings.autoRejectThreshold': '자동 블랙리스트 임계값',
	'settings.autoRejectThresholdDesc': '같은 장치의 공유 요청을 이 횟수 연속 거부하면 자동으로 블랙리스트에 추가',

	'settings.httpService': 'HTTP 서비스',
	'settings.port': '포트: {{port}}',
	'settings.running': '실행 중',
	'settings.notStarted': '시작되지 않음',
	'settings.udpService': 'UDP 검색 서비스',

	'history.noRecords': '동기화 기록이 없습니다.',
	'history.send': '↑ 보냄',
	'history.receive': '↓ 받음',
	'history.fileCount': '{{count}}개 파일',
	'history.localDevice': '로컬',

	'status.online': '온라인',
	'status.offline': '오프라인',
	'status.noBindings': '바인딩된 장치 없음',
	'status.bound': '바인딩됨',
	'status.unbound': '바인딩 해제됨',

	'button.close': '닫기',
	'button.cancel': '취소',
	'button.confirm': '확인',
	'button.bind': '바인딩',
	'button.share': '공유',
	'button.delete': '삭제',
	'button.remove': '제거',
	'button.view': '보기',
	'button.reject': '거부',
	'button.accept': '수락',
	'button.saveAs': '다른 이름으로 저장',
	'button.add': '추가',
	'button.blacklist': '블랙리스트에 추가',
	'button.settings': '⚙ 설정',

	'modal.deviceList': 'LAN 장치',
	'modal.noDeviceFound': '다른 장치를 찾을 수 없습니다. 다른 장치의 전원이 켜져 있고 "검색 가능"으로 설정되어 있는지 확인하세요.',
	'modal.verificationTitle': '장치 바인딩 인증',
	'modal.verificationDisplay': '"{{name}}"에서 다음 인증 코드를 입력하세요:',
	'modal.codeValidTime': '인증 코드는 5분간 유효합니다',
	'modal.pairRequest': '바인딩 요청',
	'modal.pairRequestInput': '"{{name}}"이(가) 바인딩을 요청합니다. 상대방 화면에 표시된 인증 코드를 입력하세요:',
	'modal.codePlaceholder': '6자리 인증 코드 입력',
	'modal.confirmBind': '바인딩 확인',
	'modal.pairNotice': '"{{name}}"이(가) 장치 바인딩을 요청합니다',
	'modal.shareReceived': '노트 공유 수신',
	'modal.shareFrom': '"{{name}}"이(가) 노트를 공유했습니다:',
	'modal.savePath': '저장 경로',
	'modal.savePathPlaceholder': '예: 공유/{{name}}',
	'modal.unbindConfirm': '바인딩 해제 확인',
	'modal.unbindMessage': '"{{name}}"과(와) 바인딩을 해제하시겠습니까? 해제 후 양쪽 모두 자동 동기화할 수 없습니다.',
	'modal.blacklist': '블랙리스트 관리',
	'modal.blacklistEmpty': '블랙리스트가 비어 있습니다',
	'modal.addDevice': '수동으로 장치 추가',
	'modal.addDeviceDesc': '데스크톱 장치의 IP 주소와 포트 입력',
	'modal.ipAddress': 'IP 주소',
	'modal.port': '포트',
	'modal.bindVault': '"{{name}}"과(와) 볼트 바인딩',
	'modal.localVault': '로컬 볼트',
	'modal.localVaultDesc': '이 장치의 볼트 선택',
	'modal.remoteVault': '원격 볼트',
	'modal.remoteVaultDesc': '"{{name}}"의 볼트 선택',

	'notice.bindSuccess': 'LAN Sync: 바인딩 성공',
	'notice.bindWithDevice': 'LAN Sync: "{{name}}"과(와) 바인딩 성공',
	'notice.bindFailed': 'LAN Sync: 대상 장치에 연결할 수 없습니다. 온라인 상태인지 확인하세요',
	'notice.deviceRejected': 'LAN Sync: "{{name}}"이(가) 바인딩 요청을 거부했습니다',
	'notice.pairCancelled': 'LAN Sync: 상대방이 바인딩 요청을 취소했습니다',
	'notice.codeError': 'LAN Sync: 인증 코드 오류, 바인딩 실패',
	'notice.rejectedBind': 'LAN Sync: "{{name}}"의 바인딩 요청을 거부했습니다',
	'notice.unbindDone': 'LAN Sync: 원격 장치의 바인딩이 해제되었습니다',
	'notice.unbindLocal': 'LAN Sync: 바인딩 해제됨',
	'notice.noDeviceFound': 'LAN Sync: 다른 장치를 찾을 수 없습니다',
	'notice.noShareableFiles': 'LAN Sync: 공유 가능한 파일을 찾을 수 없습니다',
	'notice.deviceUnreachable': 'LAN Sync: 장치 "{{name}}"이(가) 현재 연결할 수 없습니다',
	'notice.shareSuccess': 'LAN Sync: {{count}}개 파일을 "{{name}}"에 공유했습니다',
	'notice.sharePartial': 'LAN Sync: {{success}}개 성공, {{fail}}개 실패',
	'notice.deviceDeleted': 'LAN Sync: "{{name}}" 삭제됨',
	'notice.deviceAdded': 'LAN Sync: "{{name}}" 추가됨',
	'notice.addDeviceFailed': 'LAN Sync: 장치 추가 실패, 주소와 포트를 확인하세요',
	'notice.fileReceived': 'LAN Sync: "{{name}}" 수신됨',
	'notice.fileSavedAs': 'LAN Sync: "{{path}}"(으)로 저장됨',
	'notice.shareRejected': 'LAN Sync: 공유 거부됨',
	'notice.shareRejectedBlacklist': 'LAN Sync: 거부 및 기록됨',
	'notice.blacklistedDeviceRejected': 'LAN Sync: 블랙리스트에 있는 기기가 자동으로 거부됨',
	'notice.shareRejectedByReceiver': 'LAN Sync: 상대방이 "{{name}}" 수신을 거부했습니다',
	'notice.remoteAutoSyncOff': 'LAN Sync: 상대가 자동 동기화를 껐습니다, 건너뜁니다',
	'notice.syncFileCountZero': 'LAN Sync: 동기화 파일 수: 0',
	'notice.syncComplete': 'LAN Sync: "{{name}}"에서 {{count}}개 파일 동기화 완료',

	'device.connectedDevice': '연결된 장치({{id}})',
	'device.boundDevice': '바인딩된 장치({{id}})',
	'device.unknownDevice': '알 수 없는 장치',
	'device.unknownDeviceId': '알 수 없는 장치({{id}})',

	'platform.desktop': '데스크톱',
	'platform.mobile': '모바일',

	'command.viewDevices': 'LAN 장치 보기',
	'command.syncNow': '지금 동기화',

	'menu.shareToDevice': '장치에 공유...',
};

// ============================================================
// 翻译字典注册表
// ============================================================

const translations: Record<string, TranslationDict> = {
	'zh': zh,
	'en': en,
	'zh-TW': zhTW,
	'fr': fr,
	'ja': ja,
	'ko': ko,
};

// ============================================================
// 随机别名词汇表（按语言分组）
// ============================================================

interface AliasWords {
	adjectives: string[];
	nouns: string[];
	/** 组合格式，{{adj}}=形容词，{{noun}}=名词 */
	format: string;
}

const aliasWordsMap: Record<string, AliasWords> = {
	'zh': {
		adjectives: ['快乐', '勤奋', '聪明', '安静', '活泼', '温柔', '勇敢', '善良', '温暖', '阳光', '自由', '浪漫', '优雅', '坚韧', '豁达', '从容', '灵动', '沉静', '明朗', '柔和', '热烈', '深邃', '朴素', '绚烂', '清新', '恬淡', '高远', '细腻', '豪放', '婉约'],
		nouns: ['书签', '笔记', '日记', '墨水瓶', '羽毛笔', '灯塔', '星辰', '微风', '溪流', '山峦', '云朵', '彩虹', '篝火', '雪花', '露珠', '朝霞', '晚风', '松林', '竹简', '砚台', '纸鸢', '风铃', '港湾', '琴弦', '画布', '诗行', '篇章', '书页', '信笺'],
		format: '{{adj}}的{{noun}}',
	},
	'en': {
		adjectives: ['Happy', 'Diligent', 'Clever', 'Quiet', 'Lively', 'Gentle', 'Brave', 'Kind', 'Warm', 'Sunny', 'Free', 'Romantic', 'Elegant', 'Resilient', 'Calm', 'Serene', 'Bright', 'Soft', 'Passionate', 'Profound', 'Simple', 'Vivid', 'Fresh', 'Peaceful', 'Noble', 'Delicate', 'Bold', 'Graceful'],
		nouns: ['Bookmark', 'Note', 'Diary', 'Inkwell', 'Quill', 'Lighthouse', 'Star', 'Breeze', 'Stream', 'Mountain', 'Cloud', 'Rainbow', 'Bonfire', 'Snowflake', 'Dewdrop', 'Sunrise', 'Twilight', 'Pine', 'Bamboo', 'Inkstone', 'Kite', 'Chime', 'Harbor', 'String', 'Canvas', 'Verse', 'Chapter', 'Page', 'Letter'],
		format: '{{adj}} {{noun}}',
	},
	'zh-TW': {
		adjectives: ['快樂', '勤奮', '聰明', '安靜', '活潑', '溫柔', '勇敢', '善良', '溫暖', '陽光', '自由', '浪漫', '優雅', '堅韌', '豁達', '從容', '靈動', '沉靜', '明朗', '柔和', '熱烈', '深邃', '樸素', '絢爛', '清新', '恬淡', '高遠', '細膩', '豪放', '婉約'],
		nouns: ['書籤', '筆記', '日記', '墨水瓶', '羽毛筆', '燈塔', '星辰', '微風', '溪流', '山巒', '雲朵', '彩虹', '篝火', '雪花', '露珠', '朝霞', '晚風', '松林', '竹簡', '硯台', '紙鳶', '風鈴', '港灣', '琴弦', '畫布', '詩行', '篇章', '書頁', '信箋'],
		format: '{{adj}}的{{noun}}',
	},
	'fr': {
		adjectives: ['Joyeux', 'Diligent', 'Intelligent', 'Calme', 'Vif', 'Doux', 'Brave', 'Gentil', 'Chaleureux', 'Ensoleillé', 'Libre', 'Romantique', 'Élégant', 'Résistant', 'Serein', 'Tranquille', 'Brillant', 'Tendre', 'Passionné', 'Profond', 'Simple', 'Vivant', 'Frais', 'Paisible', 'Noble', 'Délicat', 'Audacieux', 'Gracieux'],
		nouns: ['Signet', 'Note', 'Journal', 'Encrier', 'Plume', 'Phare', 'Étoile', 'Brise', 'Ruisseau', 'Montagne', 'Nuage', 'Arc-en-ciel', 'Feu de camp', 'Flocon', 'Rosée', 'Aurore', 'Crépuscule', 'Pin', 'Bambou', 'Parchemin', 'Cerf-volant', 'Carillon', 'Havre', 'Lyre', 'Toile', 'Vers', 'Chapitre', 'Page', 'Lettre'],
		format: '{{adj}} {{noun}}',
	},
	'ja': {
		adjectives: ['楽しい', '勤勉な', '賢い', '静かな', '活発な', '優しい', '勇敢な', '親切な', '温かい', '明るい', '自由な', 'ロマンチックな', '優雅な', '忍耐強い', '達観した', '落ち着いた', '輝く', '柔らかな', '情熱的な', '深遠な', '素朴な', '鮮やかな', '爽やかな', '穏やかな', '高貴な', '繊細な', '大胆な', '麗しい'],
		nouns: ['しおり', 'ノート', '日記', 'インク壺', '羽根ペン', '灯台', '星', '微風', '小川', '山', '雲', '虹', '焚き火', '雪の結晶', '露', '朝焼け', '夕風', '松林', '竹簡', '硯', '凧', '風鈴', '港', '琴の糸', 'キャンバス', '詩', '章', 'ページ', '手紙'],
		format: '{{adj}}{{noun}}',
	},
	'ko': {
		adjectives: ['행복한', '근면한', '똑똑한', '조용한', '활발한', '부드러운', '용감한', '친절한', '따뜻한', '밝은', '자유로운', '낭만적인', '우아한', '견고한', '활달한', '평온한', '빛나는', '명랑한', '열정적인', '심오한', '소박한', '화려한', '상쾌한', '평화로운', '고귀한', '섬세한', '대담한', '청아한'],
		nouns: ['책갈피', '노트', '일기', '잉크병', '깃펜', '등대', '별', '미풍', '시내', '산', '구름', '무지개', '모닥불', '눈송이', '이슬', '노을', '석양', '소나무', '대나무', '벼루', '연', '풍경', '항구', '거문고', '캔버스', '시', '장', '페이지', '편지'],
		format: '{{adj}} {{noun}}',
	},
};

function randomPick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 根据当前语言生成随机设备别名
 */
export function generateRandomAlias(): string {
	const lang = getCurrentLang();
	const words = aliasWordsMap[lang] || aliasWordsMap['zh'];
	const adj = randomPick(words.adjectives);
	const noun = randomPick(words.nouns);
	return words.format.replace('{{adj}}', adj).replace('{{noun}}', noun);
}
