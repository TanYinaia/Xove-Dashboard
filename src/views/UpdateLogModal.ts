import { App, Modal, Setting } from 'obsidian';
import { t } from '../i18n';

/** 更新日志弹窗：插件更新后展示（lastSeenVersion, 当前版本] 之间的变更记录 */
export class UpdateLogModal extends Modal {
	/** 自上次运行的版本以来新增的变更条目（已按版本升序排列，跨版本按序展示） */
	private readonly entries: { version: string; text: string }[];
	private readonly currentVersion: string;

	constructor(app: App, entries: { version: string; text: string }[], currentVersion: string) {
		super(app);
		this.entries = entries;
		this.currentVersion = currentVersion;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-modal', 'ad-update-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: t('update.title').replace('{v}', this.currentVersion) });

		for (const entry of this.entries) {
			const block = contentEl.createDiv({ cls: 'ad-update-block' });
			block.createDiv({ cls: 'ad-update-version', text: `v${entry.version}` });
			const list = block.createEl('ul', { cls: 'ad-update-list' });
			for (const line of entry.text.split('\n')) {
				if (!line.trim()) continue;
				list.createEl('li', { text: line });
			}
		}

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('common.close')).setCta().onClick(() => this.close()),
			);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}