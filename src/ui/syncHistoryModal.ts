import { Modal, Setting } from 'obsidian';
import type { SyncHistoryRecord, SyncFileEntry } from '../types';
import { t } from '../i18n';

/** 兼容旧格式：将 string[] 或 SyncFileEntry[] 统一为 SyncFileEntry[] */
function normalizeFiles(files: any[]): SyncFileEntry[] {
	return files.map(f => typeof f === 'string' ? { path: f, action: 'modify' as const } : f);
}

/**
 * 同步历史弹窗 — 展示全部同步历史，支持点击展开文件列表
 */
export class SyncHistoryModal extends Modal {
	private records: SyncHistoryRecord[];
	private bindingLabels: Map<string, string>;
	private expandedIds: Set<string> = new Set();

	constructor(records: SyncHistoryRecord[], bindingLabels: Map<string, string>) {
		super(app);
		this.records = records;
		this.bindingLabels = bindingLabels;
	}

	onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lan-sync-modal');

		contentEl.createEl('h2', { text: t('section.syncHistory') });

		if (this.records.length === 0) {
			contentEl.createEl('p', {
				text: t('history.noRecords'),
				cls: 'lan-sync-muted',
			});
		} else {
			const listEl = contentEl.createDiv({ cls: 'lan-sync-sync-history' });

			for (const record of this.records) {
				const itemEl = listEl.createDiv({ cls: 'lan-sync-sync-history-item' });

				// 摘要行
				const summaryEl = itemEl.createDiv({ cls: 'lan-sync-history-summary' });

				const typeIcon = record.type === 'send' ? t('history.send') : t('history.receive');
				summaryEl.createEl('span', {
					text: typeIcon,
					cls: record.type === 'send' ? 'lan-sync-type-send' : 'lan-sync-type-receive',
				});

				const bindingLabel = this.bindingLabels.get(record.targetBindingId) || record.targetBindingId.substring(0, 8);
				summaryEl.createEl('span', {
					text: `${record.sourceDeviceAlias} → ${bindingLabel}`,
					cls: 'lan-sync-history-info',
				});

				const timeStr = this.formatTime(record.timestamp);
				summaryEl.createEl('span', {
					text: timeStr,
					cls: 'lan-sync-muted',
				});

				const normalizedFiles = normalizeFiles(record.files);
				summaryEl.createEl('span', {
					text: t('history.fileCount', { count: normalizedFiles.length }),
					cls: 'lan-sync-muted',
				});

				// 点击展开文件列表
				summaryEl.style.cursor = 'pointer';
				summaryEl.addEventListener('click', () => {
					if (this.expandedIds.has(record.id)) {
						this.expandedIds.delete(record.id);
					} else {
						this.expandedIds.add(record.id);
					}
					this.render();
				});

				// 展开的文件列表
				if (this.expandedIds.has(record.id)) {
					const fileListEl = itemEl.createDiv({ cls: 'lan-sync-file-list' });
					for (const fileEntry of normalizedFiles) {
						const rowEl = fileListEl.createDiv({ cls: 'lan-sync-file-item' });
						if (record.type === 'receive') {
							const actionLetter = fileEntry.action === 'add' ? 'A' : fileEntry.action === 'del' ? 'D' : 'M';
							const actionCls = fileEntry.action === 'add' ? 'lan-sync-action-add' : fileEntry.action === 'del' ? 'lan-sync-action-del' : 'lan-sync-action-modify';
							rowEl.createEl('span', { text: actionLetter, cls: `lan-sync-file-action ${actionCls}` });
							rowEl.createEl('span', { text: fileEntry.path, cls: 'lan-sync-file-path' });
						} else {
							rowEl.setText(fileEntry.path);
						}
					}
				}
			}
		}

		new Setting(contentEl)
			.addButton((btn) => {
				btn.setButtonText(t('button.close'));
				btn.onClick(() => this.close());
			});
	}

	private formatTime(timestamp: number): string {
		const d = new Date(timestamp);
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
