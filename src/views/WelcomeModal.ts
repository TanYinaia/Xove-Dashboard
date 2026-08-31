import { Modal, Setting } from 'obsidian';
import { t, tArr } from '../i18n';

/** 新用户欢迎弹窗：首次安装（无 lastSeenVersion）时展示功能亮点与快速上手，语言跟随当前设置 */
export class WelcomeModal extends Modal {
	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-modal', 'ad-welcome-modal');
		contentEl.createEl('h3', { cls: 'ad-modal-title', text: t('welcome.title') });
		contentEl.createDiv({ cls: 'ad-welcome-intro', text: t('welcome.intro') });

		contentEl.createDiv({ cls: 'ad-welcome-h', text: t('welcome.featuresTitle') });
		const feats = tArr('welcome.features');
		const featList = contentEl.createEl('ul', { cls: 'ad-update-list' });
		for (const f of feats) featList.createEl('li', { text: f });

		contentEl.createDiv({ cls: 'ad-welcome-h', text: t('welcome.usageTitle') });
		const steps = tArr('welcome.usage');
		const stepList = contentEl.createEl('ol', { cls: 'ad-update-list' });
		for (const s of steps) stepList.createEl('li', { text: s });

		new Setting(contentEl)
			.addButton((btn) =>
				btn.setButtonText(t('welcome.cta')).setCta().onClick(() => this.close()),
			);
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}