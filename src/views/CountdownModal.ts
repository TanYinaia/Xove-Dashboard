import { App, Modal } from 'obsidian';
import { MODAL_TEXT, UI_TEXT } from '../constants';
import { getLang, t } from '../i18n';
import type { CountdownSettings } from '../settings';

const MAX_COUNTDOWNS = 5;

/** 新事件的默认名称（随语言，属数据默认值而非 UI 文案） */
export function defaultEventName(): string {
	return getLang() === 'en' ? 'New Year' : '新年';
}

/**
 * CountdownModal — 管理主页「倒计时」卡片的多个自定义事件（最多 5 个）。
 * 每个事件含事件名称 + 目标日期；可增 / 删 / 改，保存后回写 settings 并刷新卡片。
 * `opts.single=true` 时仅编辑传入的那一项（隐藏「添加」按钮、不可删/减），用于右键单卡编辑。
 */
export class CountdownModal extends Modal {
	private list: CountdownSettings[];
	private listEl!: HTMLElement;
	private onConfirm: (cfg: CountdownSettings[]) => void;
	private single: boolean;

	constructor(app: App, current: CountdownSettings[], onConfirm: (cfg: CountdownSettings[]) => void, opts?: { single?: boolean }) {
		super(app);
		this.single = !!opts?.single;
		const initial = this.single
			? (current.slice(0, 1).map((c) => ({ ...c })) || [{ eventName: defaultEventName(), targetDate: '2027-01-01' }])
			: (current && current.length ? current : [{ eventName: defaultEventName(), targetDate: '2027-01-01' }]).map((c) => ({ ...c }));
		this.list = initial;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ad-modal');
		this.containerEl.closest('.modal-container')?.addClass('dashboard-modal');

		contentEl.createEl('h3', { cls: 'ad-modal-title', text: this.single ? t('modal.cdTitleSingle') : t('modal.cdTitle') });

		this.listEl = contentEl.createDiv({ cls: 'ad-cd-list' });
		this.rebuild();

		const btns = contentEl.createDiv({ cls: 'ad-modal-btns' });
		btns.createEl('button', { cls: 'ad-modal-btn', text: UI_TEXT.cancel })
			.addEventListener('click', () => this.close());
		btns.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--primary', text: MODAL_TEXT.cdDone })
			.addEventListener('click', () => { this.onConfirm(this.list); this.close(); });
	}

	private rebuild(): void {
		const el = this.listEl;
		el.empty();

		if (!this.single && this.list.length === 0) {
			el.createDiv({ cls: 'ad-cd-empty', text: t('modal.cdEmpty') });
		}

		this.list.forEach((cfg, i) => {
			const row = el.createDiv({ cls: 'ad-cd-row' });

			const name = row.createEl('input', { cls: 'ad-modal-input', type: 'text' });
			name.value = cfg.eventName;
			name.placeholder = t('modal.cdEventPlaceholder');
			name.addEventListener('input', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, eventName: name.value.trim() || defaultEventName() };
			});

			const date = row.createEl('input', { cls: 'ad-modal-input ad-cd-date', type: 'date' });
			date.value = cfg.targetDate;
			date.addEventListener('input', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, targetDate: date.value || '2027-01-01' };
			});

			// 单卡编辑模式：禁止删除（右键「删除此卡片」入口已独立提供）
			if (!this.single) {
				const del = row.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--danger ad-cd-del' });
				del.textContent = '✕';
				del.title = MODAL_TEXT.cdDelete;
				del.addEventListener('click', () => { this.list.splice(i, 1); this.rebuild(); });
			}
		});

		// 单卡编辑模式：不允许再加更多卡；右键右键「删除此卡片」是删除入口
		if (this.single) return;

		const addBtn = el.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--ghost ad-cd-add', text: MODAL_TEXT.cdAdd });
		if (this.list.length >= MAX_COUNTDOWNS) {
			addBtn.disabled = true;
			addBtn.title = MODAL_TEXT.cdMax;
		} else {
			addBtn.addEventListener('click', () => {
				this.list.push({ eventName: defaultEventName(), targetDate: '2027-01-01' });
				this.rebuild();
			});
		}
	}

	onClose(): void {
		this.containerEl.closest('.modal-container')?.removeClass('dashboard-modal');
		this.contentEl.empty();
	}
}
