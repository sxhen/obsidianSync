import * as http from 'http';
import type { WebSocketServer as WSServerType, WebSocket as WSType } from 'ws';

/**
 * WebSocket 服务（桌面端）
 * 提供长连接能力，替代 HTTP 轮询，用于实时通知和状态同步
 */
export class WebSocketService {
	private wss: WSServerType | null = null;
	private clients: Map<string, { ws: WSType; deviceId: string }> = new Map();
	private onMessage: ((deviceId: string, data: any) => void) | null = null;
	private onClientConnected: ((deviceId: string) => void) | null = null;
	private onClientDisconnected: ((deviceId: string) => void) | null = null;

	/**
	 * 设置消息回调
	 */
	setOnMessage(handler: (deviceId: string, data: any) => void): void {
		this.onMessage = handler;
	}

	/**
	 * 设置客户端连接回调
	 */
	setOnClientConnected(handler: (deviceId: string) => void): void {
		this.onClientConnected = handler;
	}

	/**
	 * 设置客户端断开回调
	 */
	setOnClientDisconnected(handler: (deviceId: string) => void): void {
		this.onClientDisconnected = handler;
	}

	/**
	 * 启动 WebSocket 服务器
	 * 挂载到现有 HTTP Server 上
	 */
	async start(server: http.Server): Promise<void> {
		try {
			// 动态 require，避免移动端加载时找不到 ws 模块
			const { WebSocketServer } = require('ws');
			const wss = new WebSocketServer({ server, path: '/ws' }) as WSServerType;
			this.wss = wss;

			wss.on('connection', (ws: WSType, req: http.IncomingMessage) => {
				this.handleConnection(ws, req);
			});

			console.log('[LAN Sync] WebSocket server started on /ws');
		} catch (err) {
			console.error('[LAN Sync] Failed to start WebSocket server:', err);
		}
	}

	/**
	 * 停止 WebSocket 服务器（主动关闭所有客户端连接）
	 */
	async stop(): Promise<void> {
		// 先主动关闭所有已连接的客户端，通知对端立即感知断连
		for (const [, client] of this.clients) {
			try {
				client.ws.close();
				console.log(`[LAN Sync] Actively closed WebSocket client: ${client.deviceId}`);
			} catch {
				// 忽略关闭时的错误
			}
		}
		this.clients.clear();

		if (this.wss) {
			this.wss.close();
			this.wss = null;
		}
	}

	/**
	 * 向指定设备发送消息
	 */
	sendToDevice(deviceId: string, data: any): boolean {
		const client = this.clients.get(deviceId);
		if (!client || client.ws.readyState !== 1) { // 1 = OPEN
			return false;
		}

		try {
			client.ws.send(JSON.stringify(data));
			return true;
		} catch (err) {
			console.error(`[LAN Sync] WebSocket send to ${deviceId} failed:`, err);
			return false;
		}
	}

	/**
	 * 广播消息给所有连接的客户端
	 */
	broadcast(data: any): void {
		const msg = JSON.stringify(data);
		for (const [, client] of this.clients) {
			if (client.ws.readyState === 1) {
				try {
					client.ws.send(msg);
				} catch (err) {
					console.error(`[LAN Sync] WebSocket broadcast to ${client.deviceId} failed:`, err);
				}
			}
		}
	}

	/**
	 * 获取在线客户端列表
	 */
	getConnectedDeviceIds(): string[] {
		return Array.from(this.clients.keys());
	}

	/**
	 * 处理新连接
	 */
	private handleConnection(ws: WSType, req: http.IncomingMessage): void {
		// 从 URL 参数获取设备 ID
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const deviceId = url.searchParams.get('deviceId') || `unknown-${Date.now()}`;

		this.clients.set(deviceId, { ws, deviceId });
		console.log(`[LAN Sync] WebSocket client connected: ${deviceId}`);
		this.onClientConnected?.(deviceId);

		ws.on('message', (raw: Buffer | string) => {
			try {
				const data = JSON.parse(raw.toString());
				this.onMessage?.(deviceId, data);
			} catch (err) {
				console.error('[LAN Sync] WebSocket message parse error:', err);
			}
		});

		ws.on('close', () => {
			this.clients.delete(deviceId);
			console.log(`[LAN Sync] WebSocket client disconnected: ${deviceId}`);
			this.onClientDisconnected?.(deviceId);
		});

		ws.on('error', (err: Error) => {
			console.error(`[LAN Sync] WebSocket error from ${deviceId}:`, err);
		});

		// 发送欢迎消息
		ws.send(JSON.stringify({
			type: 'welcome',
			deviceId,
			timestamp: Date.now(),
		}));
	}
}
