import { Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * 解绑确认弹窗
 */
export class UnbindConfirmModal extends Modal {
	private deviceAlias: string;
	private onConfirm: () => void;

	constructor(deviceAlias: string, onConfirm: () => void) {
		super(app);
		this.deviceAlias = deviceAlias;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('lan-sync-modal');

		contentEl.createEl('h3', { text: t('modal.unbindConfirm') });
		contentEl.createEl('p', {
			text: t('modal.unbindMessage', { name: this.deviceAlias }),
		});

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText(t('button.cancel'));
				btn.onClick(() => this.close());
			})
			.addButton((btn) => {
				btn.setButtonText(t('button.confirm'));
				btn.setWarning();
				btn.onClick(() => {
					this.onConfirm();
					this.close();
				});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
