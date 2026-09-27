import { Modal, Setting } from 'obsidian';
import type { BlacklistEntry } from '../types';
import { t } from '../i18n';

/**
 * 黑名单管理弹窗
 */
export class BlacklistModal extends Modal {
	private blacklistedDevices: BlacklistEntry[];
	private onRemove: (deviceId: string) => void;

	constructor(
		blacklistedDevices: BlacklistEntry[],
		onRemove: (deviceId: string) => void
	) {
		super(app);
		this.blacklistedDevices = blacklistedDevices;
		this.onRemove = onRemove;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-modal');

		contentEl.createEl('h2', { text: t('modal.blacklist') });

		if (this.blacklistedDevices.length === 0) {
			contentEl.createEl('p', {
				text: t('modal.blacklistEmpty'),
				cls: 'lan-sync-muted',
			});
		} else {
			const listEl = contentEl.createDiv({ cls: 'lan-sync-blacklist' });

			for (const device of this.blacklistedDevices) {
				const itemEl = listEl.createDiv({ cls: 'lan-sync-blacklist-item' });
				const platformLabel = t(`platform.${device.platform}` as any);
				itemEl.createEl('span', {
					text: `${device.alias}（${platformLabel}）`,
					cls: 'lan-sync-device-alias',
				});

				const removeBtn = itemEl.createEl('button', { text: t('button.remove') });
				removeBtn.addEventListener('click', () => {
					this.onRemove(device.id);
					itemEl.remove();
					if (listEl.children.length === 0) {
						listEl.replaceWith(
							contentEl.createEl('p', { text: t('modal.blacklistEmpty'), cls: 'lan-sync-muted' })
						);
					}
				});
			}
		}

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText(t('button.close'));
			btn.onClick(() => this.close());
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
