import { requestUrl } from 'obsidian';
import type { INetworkTransport, DiscoveryMessage } from '../../types';

/**
 * 移动端网络传输层实现
 * 仅支持 HTTP Client（使用 Obsidian requestUrl），无 Server/UDP 能力
 */
export class MobileNetworkTransport implements INetworkTransport {

	/**
	 * 移动端不支持运行 HTTP Server
	 */
	async startServer(_port: number, _requestHandler: (req: any, res: any) => void): Promise<void> {
		console.warn('[LAN Sync] Mobile platform does not support HTTP server');
	}

	/**
	 * 移动端无 Server 可停止
	 */
	async stopServer(): Promise<void> {
		// no-op
	}

	/**
	 * 使用 Obsidian requestUrl 发送 HTTP 请求（跨平台，自动绕过 CORS）
	 */
	async sendRequest(url: string, options: RequestInit): Promise<any> {
		try {
			const response = await requestUrl({
				url,
				method: options.method || 'GET',
				headers: options.headers as Record<string, string> || {},
				body: typeof options.body === 'string' ? options.body : undefined,
				throw: false,
			});

			const contentType = response.headers['content-type'] || '';
			if (contentType.includes('application/json')) {
				// 使用 response.text 手动解析，避免 response.json 双重编码问题
				let data: any;
				try {
					data = JSON.parse(response.text);
				} catch {
					data = response.json;
				}
				// 防御性处理：若服务端意外双重编码，递归解包直到得到对象
				while (typeof data === 'string') {
					try { data = JSON.parse(data); } catch { break; }
				}
				return { status: response.status, data };
			}
			return { status: response.status, data: response.text };
		} catch (err) {
			console.error('[LAN Sync] Mobile requestUrl error:', err);
			throw err;
		}
	}

	/**
	 * 移动端不支持 UDP 发现
	 */
	async startDiscovery(_onMessage: (msg: DiscoveryMessage, address: string) => void): Promise<void> {
		console.warn('[LAN Sync] Mobile platform does not support UDP discovery');
	}

	/**
	 * 移动端无 UDP 可停止
	 */
	async stopDiscovery(): Promise<void> {
		// no-op
	}

	/**
	 * 移动端无法获取可靠局域网 IP（WebView 限制）
	 */
	getLocalIP(): string {
		return 'mobile';
	}

	/**
	 * 移动端不支持运行服务端
	 */
	isServerCapable(): boolean {
		return false;
	}
}
