import * as dgram from 'dgram';
import * as http from 'http';
import * as os from 'os';
import type { INetworkTransport, DiscoveryMessage } from '../../types';

const UDP_PORT = 24531;
const BROADCAST_ADDR = '255.255.255.255';

/**
 * 桌面端网络传输层实现
 * 完整支持：UDP 广播发现 + HTTP Server + HTTP Client
 */
export class DesktopNetworkTransport implements INetworkTransport {
	private udpSocket: dgram.Socket | null = null;
	httpServer: http.Server | null = null;
	private broadcastInterval: ReturnType<typeof setInterval> | null = null;

	/**
	 * 启动 HTTP 服务器
	 */
	async startServer(port: number, requestHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<void> {
		return new Promise((resolve, reject) => {
			this.httpServer = http.createServer((req, res) => {
				// 添加 CORS 头
				res.setHeader('Access-Control-Allow-Origin', '*');
				res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
				res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

				if (req.method === 'OPTIONS') {
					res.writeHead(204);
					res.end();
					return;
				}

				requestHandler(req, res);
			});

			this.httpServer.on('error', (err) => {
				console.error('[LAN Sync] HTTP server error:', err);
				reject(err);
			});

			this.httpServer.listen(port, '0.0.0.0', () => {
				console.log(`[LAN Sync] HTTP server listening on port ${port}`);
				resolve();
			});
		});
	}

	/**
	 * 停止 HTTP 服务器
	 */
	async stopServer(): Promise<void> {
		return new Promise((resolve) => {
			if (this.httpServer) {
				this.httpServer.close(() => {
					this.httpServer = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * 发送 HTTP 请求（桌面端直接用 fetch）
	 */
	async sendRequest(url: string, options: RequestInit): Promise<any> {
		const response = await fetch(url, options);
		const contentType = response.headers.get('content-type') || '';
		if (contentType.includes('application/json')) {
			return { status: response.status, data: await response.json() };
		}
		return { status: response.status, data: await response.text() };
	}

	/**
	 * 启动 UDP 广播发现
	 * @param onMessage 收到消息时的回调
	 */
	async startDiscovery(
		onMessage: (msg: DiscoveryMessage, address: string) => void
	): Promise<void> {
		return new Promise((resolve, reject) => {
			try {
				this.udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

				this.udpSocket.on('error', (err) => {
					console.error('[LAN Sync] UDP socket error:', err);
					reject(err);
				});

				this.udpSocket.on('message', (msg, rinfo) => {
					try {
						const parsed: DiscoveryMessage = JSON.parse(msg.toString());
						onMessage(parsed, rinfo.address);
					} catch (e) {
						console.error('[LAN Sync] Failed to parse discovery message:', e);
					}
				});

				this.udpSocket.bind(UDP_PORT, () => {
					this.udpSocket!.setBroadcast(true);
					console.log(`[LAN Sync] UDP discovery listening on port ${UDP_PORT}`);
					resolve();
				});
			} catch (err) {
				reject(err);
			}
		});
	}

	/**
	 * 发送 UDP 广播消息
	 * @param onSent 可选回调，消息发出后调用
	 */
	broadcast(data: DiscoveryMessage, onSent?: () => void): void {
		if (!this.udpSocket) return;
		const message = Buffer.from(JSON.stringify(data));
		this.udpSocket.send(message, 0, message.length, UDP_PORT, BROADCAST_ADDR, (err) => {
			if (err) {
				console.error('[LAN Sync] UDP broadcast error:', err);
			}
			onSent?.();
		});
	}

	/**
	 * 停止 UDP 发现
	 */
	async stopDiscovery(): Promise<void> {
		if (this.broadcastInterval) {
			clearInterval(this.broadcastInterval);
			this.broadcastInterval = null;
		}
		return new Promise((resolve) => {
			if (this.udpSocket) {
				this.udpSocket.close(() => {
					this.udpSocket = null;
					resolve();
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * 获取本机局域网 IP 地址
	 */
	getLocalIP(): string {
		const interfaces = os.networkInterfaces();
		for (const name of Object.keys(interfaces)) {
			const iface = interfaces[name];
			if (!iface) continue;
			for (const info of iface) {
				if (info.family === 'IPv4' && !info.internal) {
					return info.address;
				}
			}
		}
		return '127.0.0.1';
	}

	/**
	 * 桌面端支持运行服务端
	 */
	isServerCapable(): boolean {
		return true;
	}
}
