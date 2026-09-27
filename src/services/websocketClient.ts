/**
 * WebSocket 客户端（跨平台）
 * 桌面端和移动端均可使用，用于连接桌面设备的 WebSocket 服务
 */
export class WebSocketClientService {
	private ws: WebSocket | null = null;
	private deviceId: string;
	private serverUrl: string;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private onMessage: ((data: any) => void) | null = null;
	private onConnected: (() => void) | null = null;
	private onDisconnected: (() => void) | null = null;
	private isConnected = false;
	private shouldReconnect = true;
	private lastPongTime = 0;
	private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(deviceId: string, serverAddress: string, serverPort: number) {
		this.deviceId = deviceId;
		this.serverUrl = `ws://${serverAddress}:${serverPort}/ws?deviceId=${deviceId}`;
	}

	/**
	 * 设置消息回调
	 */
	setOnMessage(handler: (data: any) => void): void {
		this.onMessage = handler;
	}

	/**
	 * 设置连接成功回调
	 */
	setOnConnected(handler: () => void): void {
		this.onConnected = handler;
	}

	/**
	 * 设置断开回调
	 */
	setOnDisconnected(handler: () => void): void {
		this.onDisconnected = handler;
	}

	/**
	 * 连接 WebSocket 服务器
	 */
	connect(): void {
		this.shouldReconnect = true;
		this.doConnect();
	}

	/**
	 * 断开连接
	 */
	disconnect(): void {
		this.shouldReconnect = false;
		this.clearTimers();

		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.isConnected = false;
	}

	/**
	 * 发送消息
	 */
	send(data: any): boolean {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			return false;
		}

		try {
			this.ws.send(JSON.stringify(data));
			return true;
		} catch (err) {
			console.error('[LAN Sync] WebSocket client send error:', err);
			return false;
		}
	}

	/**
	 * 是否已连接
	 */
	connected(): boolean {
		return this.isConnected;
	}

	/**
	 * 执行连接
	 */
	private doConnect(): void {
		try {
			this.ws = new WebSocket(this.serverUrl);

			this.ws.onopen = () => {
				this.isConnected = true;
				console.log('[LAN Sync] WebSocket client connected');
				this.onConnected?.();
				this.startHeartbeat();
			};

			this.ws.onmessage = (event: MessageEvent) => {
				try {
					const data = JSON.parse(event.data);
					if (data.type === 'pong') {
						this.lastPongTime = Date.now();
						this.clearPongTimeout();
						return;
					}
					this.onMessage?.(data);
				} catch (err) {
					console.error('[LAN Sync] WebSocket client message parse error:', err);
				}
			};

			this.ws.onclose = () => {
				this.isConnected = false;
				this.clearTimers();
				this.clearPongTimeout();
				console.log('[LAN Sync] WebSocket client disconnected');
				this.onDisconnected?.();

				if (this.shouldReconnect) {
					this.scheduleReconnect();
				}
			};

			this.ws.onerror = (err: Event) => {
				console.error('[LAN Sync] WebSocket client error:', err);
			};
		} catch (err) {
			console.error('[LAN Sync] WebSocket client connect error:', err);
			if (this.shouldReconnect) {
				this.scheduleReconnect();
			}
		}
	}

	/**
	 * 定时重连（指数退避，最大30秒）
	 */
	private scheduleReconnect(): void {
		if (this.reconnectTimer) return;

		const delay = Math.min(5000 * Math.pow(1.5, this.getReconnectAttempts()), 30000);
		console.log(`[LAN Sync] Reconnecting in ${delay}ms...`);

		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.reconnectAttempts++;
			this.doConnect();
		}, delay);
	}

	private reconnectAttempts = 0;

	private getReconnectAttempts(): number {
		return this.reconnectAttempts;
	}

	/**
	 * 心跳保活（每15秒发送一次，20秒未收到 pong 则主动断开）
	 */
	private startHeartbeat(): void {
		this.stopHeartbeat();
		this.lastPongTime = Date.now();
		this.heartbeatTimer = setInterval(() => {
			this.send({ type: 'ping', timestamp: Date.now() });
			// 启动 pong 超时检测：20秒内未收到 pong 则主动断开
			this.startPongTimeout();
		}, 15000);
	}

	private startPongTimeout(): void {
		this.clearPongTimeout();
		this.pongTimeoutTimer = setTimeout(() => {
			console.log('[LAN Sync] Pong timeout, closing connection');
			if (this.ws) {
				this.ws.close();
			}
		}, 20000);
	}

	private clearPongTimeout(): void {
		if (this.pongTimeoutTimer) {
			clearTimeout(this.pongTimeoutTimer);
			this.pongTimeoutTimer = null;
		}
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private clearTimers(): void {
		this.stopHeartbeat();
		this.clearPongTimeout();
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
	}
}
