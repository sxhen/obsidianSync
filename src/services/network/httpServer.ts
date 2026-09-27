import * as http from 'http';
import type { INetworkTransport } from '../../types';

/**
 * HTTP API 路由处理器
 * 桌面端专用，负责解析请求并分发到对应业务逻辑
 */
export class HttpApiServer {
	private transport: INetworkTransport;
	private routeHandlers: Map<string, (body: any, req: http.IncomingMessage) => Promise<any>> = new Map();
	private httpServer: http.Server | null = null;

	constructor(transport: INetworkTransport) {
		this.transport = transport;
	}

	/**
	 * 获取底层 HTTP Server 实例（用于挂载 WebSocket）
	 */
	getHttpServer(): http.Server | null {
		return this.httpServer;
	}

	/**
	 * 注册 API 路由
	 */
	registerRoute(method: string, path: string, handler: (body: any, req: http.IncomingMessage) => Promise<any>): void {
		const key = `${method.toUpperCase()} ${path}`;
		this.routeHandlers.set(key, handler);
	}

	/**
	 * 启动 HTTP 服务器
	 */
	async start(port: number): Promise<void> {
		await this.transport.startServer(port, (req, res) => this.handleRequest(req, res));
		// 保存 http.Server 引用（从 transport 中获取）
		if ('httpServer' in this.transport) {
			this.httpServer = (this.transport as any).httpServer || null;
		}
	}

	/**
	 * 停止 HTTP 服务器
	 */
	async stop(): Promise<void> {
		await this.transport.stopServer();
	}

	/**
	 * 请求分发与处理
	 */
	private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
		const method = req.method || 'GET';
		const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
		const path = url.pathname;
		const key = `${method} ${path}`;

		const handler = this.routeHandlers.get(key);
		if (!handler) {
			res.writeHead(404, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ success: false, error: 'Not found' }));
			return;
		}

		try {
			// 读取请求体
			let body: any = null;
			if (method === 'POST' || method === 'PUT') {
				body = await this.readBody(req);
				try {
					body = JSON.parse(body);
				} catch {
					// body 可能不是 JSON，保持原样
				}
			}

			const result = await handler(body, req);
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ success: true, data: result }));
		} catch (err: any) {
			console.error(`[LAN Sync] API error [${key}]:`, err);
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ success: false, error: err.message || 'Internal error' }));
		}
	}

	/**
	 * 读取请求体
	 */
	private readBody(req: http.IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			req.on('data', (chunk: Buffer) => chunks.push(chunk));
			req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
			req.on('error', reject);
		});
	}
}
