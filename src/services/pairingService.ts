import type { Plugin } from 'obsidian';
import type {
	BindingGroup,
	DeviceInfo,
	PairingSession,
	PluginSettings,
} from '../types';
import { HttpClient } from './httpClient';
import { saveSettings } from '../settings';

const PAIRING_CODE_LENGTH = 6;
const PAIRING_CODE_EXPIRY_MS = 5 * 60 * 1000; // 5分钟过期

function generateCode(): string {
	return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateSessionId(): string {
	return `pair-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * 设备绑定服务
 * 处理绑定请求发起、验证码生成/校验、绑定关系保存
 */
export class PairingService {
	private plugin: Plugin;
	private httpClient: HttpClient;
	private localDeviceId: string;
	private localDeviceAlias: string;
	private activeSessions: Map<string, PairingSession> = new Map();

	constructor(
		plugin: Plugin,
		transport: any,
		httpClient: HttpClient,
		localDeviceId: string,
		localDeviceAlias: string
	) {
		this.plugin = plugin;
		this.httpClient = httpClient;
		this.localDeviceId = localDeviceId;
		this.localDeviceAlias = localDeviceAlias;
	}

	/**
	 * 创建本地会话（不发送请求，由调用方自行发送）
	 */
	createSession(): PairingSession {
		const code = generateCode();
		const session: PairingSession = {
			sessionId: generateSessionId(),
			fromDeviceId: this.localDeviceId,
			fromDeviceAlias: this.localDeviceAlias,
			code,
			createdAt: Date.now(),
			expiresAt: Date.now() + PAIRING_CODE_EXPIRY_MS,
		};
		this.activeSessions.set(session.sessionId, session);
		return session;
	}

	/**
	 * 处理收到的绑定请求（目标设备侧）
	 * 返回验证码供用户确认
	 */
	handleIncomingPairRequest(data: {
		sessionId: string;
		fromDeviceId: string;
		fromDeviceAlias: string;
		code: string;
	}): PairingSession {
		const session: PairingSession = {
			sessionId: data.sessionId,
			fromDeviceId: data.fromDeviceId,
			fromDeviceAlias: data.fromDeviceAlias,
			code: data.code,
			createdAt: Date.now(),
			expiresAt: Date.now() + PAIRING_CODE_EXPIRY_MS,
		};

		this.activeSessions.set(session.sessionId, session);
		return session;
	}

	/**
	 * 验证码校验（目标设备输入验证码后调用）
	 */
	verifyCode(sessionId: string, inputCode: string): boolean {
		const session = this.activeSessions.get(sessionId);
		if (!session) return false;
		if (Date.now() > session.expiresAt) {
			this.activeSessions.delete(sessionId);
			return false;
		}
		return session.code === inputCode;
	}

	/**
	 * 处理远程确认绑定（收到 pair/confirm 时调用）
	 */
	async handleRemoteConfirm(
		binding: BindingGroup,
		settings: PluginSettings
	): Promise<void> {
		// 更新本地绑定组列表
		const existingIdx = settings.bindings.findIndex((g) => g.id === binding.id);
		if (existingIdx >= 0) {
			settings.bindings[existingIdx] = binding;
		} else {
			settings.bindings.push(binding);
		}
		await saveSettings(this.plugin, settings);
	}

	/**
	 * 清理过期会话
	 */
	cleanupExpiredSessions(): void {
		const now = Date.now();
		for (const [id, session] of this.activeSessions) {
			if (now > session.expiresAt) {
				this.activeSessions.delete(id);
			}
		}
	}

	/**
	 * 取消会话（用户拒绝绑定请求时调用）
	 */
	cancelSession(sessionId: string): void {
		this.activeSessions.delete(sessionId);
	}

	/**
	 * 检查会话是否仍然活跃
	 */
	hasSession(sessionId: string): boolean {
		return this.activeSessions.has(sessionId);
	}
}
