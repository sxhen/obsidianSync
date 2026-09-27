import { Modal } from 'obsidian';
import { t } from '../i18n';

/**
 * 绑定请求通知弹窗（轻量级，模拟右上角通知）
 * 收到绑定请求后先弹出此通知，用户点击"查看"后再弹出验证码输入窗口
 */
export class PairRequestNotice extends Modal {
	private fromDeviceAlias: string;
	private sessionId: string;
	private onAccept: () => void;
	private onReject: () => void;

	constructor(
		fromDeviceAlias: string,
		sessionId: string,
		onAccept: () => void,
		onReject: () => void
	) {
		super(app);
		this.fromDeviceAlias = fromDeviceAlias;
		this.sessionId = sessionId;
		this.onAccept = onAccept;
		this.onReject = onReject;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-pair-notice');

		contentEl.createEl('h3', { text: `📱 ${t('modal.pairRequest')}` });
		contentEl.createEl('p', {
			text: t('modal.pairNotice', { name: this.fromDeviceAlias }),
		});

		const buttonRow = contentEl.createDiv({ cls: 'lan-sync-button-row' });

		buttonRow.createEl('button', { text: t('button.view') }).addEventListener('click', () => {
			this.close();
			this.onAccept();
		});

		const rejectBtn = buttonRow.createEl('button', { text: t('button.reject') });
		rejectBtn.addEventListener('click', () => {
			this.close();
			this.onReject();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	getSessionId(): string {
		return this.sessionId;
	}
}
