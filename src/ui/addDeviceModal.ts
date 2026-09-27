import { Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * 手动添加桌面设备弹窗
 * 包含 IP 地址、端口输入框和添加按钮
 */
export class AddDeviceModal extends Modal {
	private onSubmit: (address: string, port: number) => void;
	private address = '';
	private port = '24532';

	constructor(onSubmit: (address: string, port: number) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-modal');

		contentEl.createEl('h2', { text: t('modal.addDevice') });
		contentEl.createEl('p', {
			text: t('modal.addDeviceDesc'),
			cls: 'lan-sync-muted',
		});

		new Setting(contentEl)
			.setName(t('modal.ipAddress'))
			.addText((text) => {
				text.setPlaceholder('192.168.1.100');
				text.onChange((value) => { this.address = value; });
			});

		new Setting(contentEl)
			.setName(t('modal.port'))
			.addText((text) => {
				text.setValue('24532');
				text.onChange((value) => { this.port = value; });
			});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText(t('button.add'));
				btn.setCta();
				btn.onClick(() => {
					if (this.address) {
						const portNum = Number(this.port) || 24532;
						this.close();
						this.onSubmit(this.address, portNum);
					}
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
