import { Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/**
 * 验证码弹窗 - 展示验证码（发起方）或输入验证码（目标方）
 */
export class VerificationModal extends Modal {
	private mode: 'display' | 'input';
	private code: string;
	private deviceAlias: string;
	private onVerified: ((inputCode: string) => void) | null;
	private onCancel: (() => void) | null;

	constructor(
		mode: 'display' | 'input',
		code: string,
		deviceAlias: string,
		onVerified?: (inputCode: string) => void,
		onCancel?: () => void
	) {
		super(app);
		this.mode = mode;
		this.code = code;
		this.deviceAlias = deviceAlias;
		this.onVerified = onVerified || null;
		this.onCancel = onCancel || null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-modal');

		if (this.mode === 'display') {
			// 发起方：展示验证码
			contentEl.createEl('h2', { text: t('modal.verificationTitle') });
			contentEl.createEl('p', {
				text: t('modal.verificationDisplay', { name: this.deviceAlias }),
			});

			const codeEl = contentEl.createEl('div', {
				text: this.code,
				cls: 'lan-sync-verification-code',
			});

			contentEl.createEl('p', {
				text: t('modal.codeValidTime'),
				cls: 'lan-sync-muted',
			});
		} else {
			// 目标方：输入验证码
			contentEl.createEl('h2', { text: t('modal.pairRequest') });
			contentEl.createEl('p', {
				text: t('modal.pairRequestInput', { name: this.deviceAlias }),
			});

			let inputEl: HTMLInputElement;
			new Setting(contentEl).addText((text) => {
				inputEl = text.inputEl;
				inputEl.placeholder = t('modal.codePlaceholder');
				inputEl.maxLength = 6;
				inputEl.addClass('lan-sync-code-input');
			});

			new Setting(contentEl).addButton((btn) => {
				btn.setButtonText(t('modal.confirmBind'));
				btn.setCta();
				btn.onClick(() => {
					const inputCode = inputEl.value.trim();
					if (inputCode.length === 6) {
						this.close();
						this.onVerified?.(inputCode);
					}
				});
			});
		}

		new Setting(contentEl).addButton((btn) => {
			btn.setButtonText(t('button.cancel'));
			btn.onClick(() => {
				this.close();
				if (this.mode === 'input') {
					this.onCancel?.();
				}
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
