import { App, Modal } from 'obsidian';
import { UI_TEXT } from '../constants';
import type { CountdownSettings } from '../settings';

/**
 * CountdownModal — 编辑主页「倒计时」卡片的自定义事件：
 * 事件名称 + 目标日期。保存后回写 settings 并刷新卡片。
 */
export class CountdownModal extends Modal {
	private eventName: string;
	private targetDate: string;
	private onConfirm: (cfg: CountdownSettings) => void;

	constructor(app: App, current: CountdownSettings, onConfirm: (cfg: CountdownSettings) => void) {
		super(app);
		this.eventName = current.eventName;
		this.targetDate = current.targetDate;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-modal');

		contentEl.createEl('h3', { cls: 'ad-modal-title', text: '编辑倒计时事件' });

		// 事件名称
		const nameField = contentEl.createDiv({ cls: 'ad-modal-field' });
		nameField.createEl('label', { cls: 'ad-modal-label', text: '事件名称' });
		const nameInput = nameField.createEl('input', {
			cls: 'ad-modal-input',
			type: 'text',
			value: this.eventName,
		});
		nameInput.placeholder = '如：高考';

		// 目标日期
		const dateField = contentEl.createDiv({ cls: 'ad-modal-field' });
		dateField.createEl('label', { cls: 'ad-modal-label', text: '目标日期' });
		const dateInput = dateField.createEl('input', {
			cls: 'ad-modal-input',
			type: 'date',
			value: this.targetDate,
		});

		contentEl.createDiv({
			cls: 'ad-modal-hint',
			text: '卡片显示「距离 {名称} 还有」及剩余天数，进度条随目标日期动态变化。',
		});

		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		const cancelBtn = btns.createEl('button', { cls: 'ad-modal-btn', text: UI_TEXT.cancel });
		const confirmBtn = btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: '保存' });

		cancelBtn.addEventListener('click', () => this.close());
		confirmBtn.addEventListener('click', () => {
			const name = nameInput.value.trim() || '新年';
			const date = dateInput.value || '2027-01-01';
			this.onConfirm({ eventName: name, targetDate: date });
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
