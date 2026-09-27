import type { INetworkTransport, DiscoveryMessage } from '../../types';

/**
 * 网络传输层抽象接口
 * 桌面端和移动端各自实现此接口，上层服务无需关心平台差异
 */
export abstract class NetworkTransportBase implements INetworkTransport {
	abstract startServer(port: number, requestHandler: (req: any, res: any) => void): Promise<void>;
	abstract stopServer(): Promise<void>;
	abstract sendRequest(url: string, options: RequestInit): Promise<any>;
	abstract startDiscovery(
		onMessage: (msg: DiscoveryMessage, address: string) => void
	): Promise<void>;
	abstract stopDiscovery(): Promise<void>;
	abstract getLocalIP(): string;
	abstract isServerCapable(): boolean;
}
