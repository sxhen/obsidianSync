import { Modal, Setting } from 'obsidian';
import type { ShareRequest } from '../types';
import { t } from '../i18n';

/**
 * 接收分享确认弹窗
 * 显示 "xxx给你分享了一份笔记" 并提供 拒绝/接收/另存为/加入黑名单 按钮
 */
export class ShareReceiveModal extends Modal {
	private request: ShareRequest;
	private isBound: boolean;
	private onDecision: (decision: 'accept' | 'reject' | 'saveAs' | 'blacklist', savePath?: string) => void;

	constructor(
		request: ShareRequest,
		onDecision: (decision: 'accept' | 'reject' | 'saveAs' | 'blacklist', savePath?: string) => void,
		isBound: boolean = false
	) {
		super(app);
		this.request = request;
		this.isBound = isBound;
		this.onDecision = onDecision;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-modal');

		contentEl.createEl('h2', { text: t('modal.shareReceived') });
		contentEl.createEl('p', {
			text: t('modal.shareFrom', { name: this.request.fromDeviceAlias }),
			cls: 'lan-sync-share-msg',
		});
		contentEl.createEl('p', {
			text: this.request.fileName,
			cls: 'lan-sync-share-filename',
		});

		// 另存为路径输入（默认隐藏）
		let savePathInput: HTMLInputElement | null = null;
		const saveAsContainer = contentEl.createDiv({ cls: 'lan-sync-save-as-container' });
		saveAsContainer.style.display = 'none';
		new Setting(saveAsContainer)
			.setName(t('modal.savePath'))
			.addText((text) => {
				savePathInput = text.inputEl;
				text.setPlaceholder(t('modal.savePathPlaceholder', { name: this.request.fileName }));
				text.setValue(t('modal.savePathPlaceholder', { name: this.request.fileName }));
			});

		// 按钮行
		const buttonRow = contentEl.createDiv({ cls: 'lan-sync-button-row' });

		const rejectBtn = buttonRow.createEl('button', { text: t('button.reject') });
		rejectBtn.addEventListener('click', () => {
			this.close();
			this.onDecision('reject');
		});

		const acceptBtn = buttonRow.createEl('button', { text: t('button.accept') });
		acceptBtn.addClass('mod-cta');
		acceptBtn.addEventListener('click', () => {
			this.close();
			this.onDecision('accept');
		});

		const saveAsBtn = buttonRow.createEl('button', { text: t('button.saveAs') });
		saveAsBtn.addEventListener('click', () => {
			if (saveAsContainer.style.display === 'none') {
				saveAsContainer.style.display = '';
			} else {
				const path = savePathInput?.value?.trim() || t('modal.savePathPlaceholder', { name: this.request.fileName });
				this.close();
				this.onDecision('saveAs', path);
			}
		});

		const blacklistBtn = buttonRow.createEl('button', { text: t('button.blacklist') });
		blacklistBtn.addClass('mod-warning');
		blacklistBtn.addEventListener('click', () => {
			this.close();
			this.onDecision('blacklist');
		});

		// 已绑定设备不显示加入黑名单按钮
		if (this.isBound) {
			blacklistBtn.style.display = 'none';
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
