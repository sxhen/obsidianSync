import type { PluginSettings, SyncHistoryRecord } from './types';
import type { Plugin } from 'obsidian';

export const DEFAULT_SETTINGS: PluginSettings = {
	deviceId: '',
	deviceAlias: '',
	syncIntervalMinutes: 15,
	maxHistoryCopies: 5,
	historyFolder: '.obsidian/.lan-sync-history',
	discoverable: true,
	autoRejectThreshold: 3,
	blacklist: [],
	bindings: [],
	knownDevices: [],
	manualDesktopDevices: [],
	chunkSize: 10 * 1024 * 1024, // 10MB
	syncHistory: [],
	maxSyncHistory: 100,
	remoteAutoSyncStatus: {},
};

export async function loadSettings(plugin: Plugin): Promise<PluginSettings> {
	const data = await plugin.loadData();
	const settings: PluginSettings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});

	// 向后兼容：旧版 blacklist 为 string[]，迁移为 BlacklistEntry[]
	if (settings.blacklist.length > 0 && typeof settings.blacklist[0] === 'string') {
		settings.blacklist = (settings.blacklist as unknown as string[]).map((id) => ({
			id,
			alias: id.substring(0, 8),
			platform: 'desktop' as const,
		}));
	}

	return settings;
}

export async function saveSettings(plugin: Plugin, settings: PluginSettings): Promise<void> {
	// syncHistory 独立存储，不写入 data.json
	const { syncHistory, ...rest } = settings as PluginSettings & { syncHistory: SyncHistoryRecord[] };
	await plugin.saveData(rest);
}

/** 获取插件数据目录路径（与 data.json 同级） */
export function getPluginDataDir(plugin: Plugin): string {
	return `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
}

/** 同步历史文件独立加载 */
export async function loadSyncHistory(plugin: Plugin): Promise<SyncHistoryRecord[]> {
	try {
		const path = `${getPluginDataDir(plugin)}/sync-history.json`;
		if (await plugin.app.vault.adapter.exists(path)) {
			const raw = await plugin.app.vault.adapter.read(path);
			return JSON.parse(raw) as SyncHistoryRecord[];
		}
	} catch (err) {
		console.warn('[LAN Sync] Failed to load sync history:', err);
	}
	return [];
}

/** 同步历史文件独立保存 */
export async function saveSyncHistory(plugin: Plugin, history: SyncHistoryRecord[]): Promise<void> {
	try {
		const path = `${getPluginDataDir(plugin)}/sync-history.json`;
		await plugin.app.vault.adapter.write(path, JSON.stringify(history));
	} catch (err) {
		console.warn('[LAN Sync] Failed to save sync history:', err);
	}
}
