import { App, Modal } from 'obsidian';
import { UI_TEXT } from '../constants';
import { t } from '../i18n';
import type { PomodoroSettings } from '../settings';

/**
 * PomoSettingsModal — 主页「番茄钟」卡片内直接调整工作 / 休息时长。
 * 与设置页的番茄钟时长项共用同一份 settings.pomodoro，保存后即时生效。
 */
export class PomoSettingsModal extends Modal {
	private current: PomodoroSettings;
	private onConfirm: (cfg: PomodoroSettings) => void;

	constructor(app: App, current: PomodoroSettings, onConfirm: (cfg: PomodoroSettings) => void) {
		super(app);
		this.current = { ...current };
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-modal');
		this.containerEl.closest('.modal-container')?.addClass('dashboard-modal');

		contentEl.createEl('h3', { cls: 'ad-modal-title', text: t('modal.pomoTitle') });
		contentEl.createDiv({ cls: 'ad-modal-desc', text: t('modal.pomoDesc') });

		const list = contentEl.createDiv({ cls: 'ad-cd-list' });
		this.buildRow(list, 'work', t('modal.pomoWork'), this.current.workMin, 180);
		this.buildRow(list, 'break', t('modal.pomoBreak'), this.current.breakMin, 60);

		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: UI_TEXT.save })
			.addEventListener('click', () => {
				this.onConfirm(this.current);
				this.close();
			});
	}

	/** 单行：标签 + 数字输入（分钟） */
	private buildRow(container: HTMLElement, key: 'work' | 'break', label: string, value: number, max: number): void {
		const row = container.createDiv({ cls: 'ad-pomo-row' });
		row.createSpan({ cls: 'ad-pomo-row__label', text: label });
		const input = row.createEl('input', {
			cls: 'ad-modal-input ad-pomo-row__input',
			type: 'number',
			attr: { min: '1', max: String(max), step: '1' },
		});
		input.value = String(value);
		input.addEventListener('change', () => {
			const n = parseInt(input.value, 10);
			const safe = Number.isFinite(n) && n > 0 ? Math.min(max, n) : 1;
			input.value = String(safe);
			if (key === 'work') this.current.workMin = safe;
			else this.current.breakMin = safe;
		});
	}

	onClose(): void {
		this.containerEl.closest('.modal-container')?.removeClass('dashboard-modal');
		this.contentEl.empty();
	}
}