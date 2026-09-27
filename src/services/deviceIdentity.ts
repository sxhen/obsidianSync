import type { PluginSettings } from '../types';
import { generateRandomAlias } from '../i18n';

function generateUUID(): string {
	// 简单的 UUID v4 生成
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * 获取或初始化设备身份
 * 首次调用时生成设备ID和随机别名，后续调用返回已有值
 */
export async function getOrCreateDeviceIdentity(
	settings: PluginSettings
): Promise<{ deviceId: string; alias: string }> {
	let deviceId = settings.deviceId;
	let alias = settings.deviceAlias;

	if (!deviceId) {
		deviceId = generateUUID();
		settings.deviceId = deviceId;
	}

	if (!alias) {
		alias = generateRandomAlias();
		settings.deviceAlias = alias;
	}

	return { deviceId, alias };
}
