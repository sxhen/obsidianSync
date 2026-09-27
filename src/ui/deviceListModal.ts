import { Modal, Setting } from 'obsidian';
import type { DeviceInfo } from '../types';
import { t } from '../i18n';

/**
 * 设备列表弹窗 - 展示发现的设备，点击按钮触发绑定或分享
 */
export class DeviceListModal extends Modal {
	private getDevices: () => DeviceInfo[];
	private onSelect: (device: DeviceInfo) => void;
	private onDelete?: (device: DeviceInfo) => void;
	private boundDeviceIds: Set<string>;
	private actionLabel: string;
	private shareMode: boolean;
	private isWsConnected?: (deviceId: string) => boolean;

	constructor(
		getDevices: (() => DeviceInfo[]) | DeviceInfo[],
		onSelect: (device: DeviceInfo) => void,
		boundDeviceIds?: Set<string>,
		actionLabel?: string,
		onDelete?: (device: DeviceInfo) => void,
		shareMode?: boolean,
		isWsConnected?: (deviceId: string) => boolean
	) {
		super(app);
		this.getDevices = Array.isArray(getDevices) ? () => getDevices : getDevices;
		this.onSelect = onSelect;
		this.boundDeviceIds = boundDeviceIds || new Set();
		this.actionLabel = actionLabel || '';
		this.onDelete = onDelete;
		this.shareMode = shareMode || false;
		this.isWsConnected = isWsConnected;
	}

	onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-modal');

		const devices = this.getDevices();

		contentEl.createEl('h2', { text: t('modal.deviceList') });

		if (devices.length === 0) {
			contentEl.createEl('p', {
				text: t('modal.noDeviceFound'),
				cls: 'lan-sync-muted',
			});
		} else {
			const listEl = contentEl.createDiv({ cls: 'lan-sync-device-list' });

			for (const device of devices) {
				const now = Date.now();
				const wsOnline = this.isWsConnected?.(device.id) ?? false;
				const isOnline = (now - device.lastSeen) < 30000 || wsOnline;
				const statusText = isOnline ? t('status.online') : t('status.offline');
				const statusCls = isOnline ? 'lan-sync-status-online' : 'lan-sync-status-offline';

				const itemEl = listEl.createDiv({ cls: 'lan-sync-device-item' });

				const infoEl = itemEl.createDiv({ cls: 'lan-sync-device-info' });
				infoEl.createEl('span', { text: device.alias, cls: 'lan-sync-device-alias' });
				infoEl.createEl('span', {
					text: ` (${device.platform})`,
					cls: 'lan-sync-muted',
				});
				infoEl.createEl('span', {
					text: statusText,
					cls: `lan-sync-status ${statusCls}`,
				});

				const actionEl = itemEl.createDiv({ cls: 'lan-sync-device-action' });

				// 手动添加的设备显示删除按钮
				if (device.isManual && this.onDelete) {
					const delBtn = actionEl.createEl('button', { text: t('button.delete') });
					delBtn.classList.add('lan-sync-btn-warning');
					delBtn.addEventListener('click', () => {
						this.onDelete!(device);
						this.render();
					});
				}

				const isBound = this.boundDeviceIds.has(device.id);

				// 分享模式：所有设备都显示分享按钮
				// 查看模式：未绑定设备显示绑定按钮，已绑定设备不显示按钮
				if (this.shareMode) {
					const btn = actionEl.createEl('button', { text: this.actionLabel || t('button.share') });
					btn.addEventListener('click', () => {
						this.close();
						this.onSelect(device);
					});
				} else if (!isBound) {
					const btn = actionEl.createEl('button', { text: t('button.bind') });
					btn.addEventListener('click', () => {
						this.close();
						this.onSelect(device);
					});
				}
			}
		}

		// 关闭按钮
		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText(t('button.close'));
			btn.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
