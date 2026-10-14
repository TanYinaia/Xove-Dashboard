import { App, Modal } from 'obsidian';
import { MODAL_TEXT, UI_TEXT } from '../constants';
import { getLang, t } from '../i18n';
import type { CountdownSettings } from '../settings';

const MAX_COUNTDOWNS = 5;

/** 新事件的默认名称（随语言，属数据默认值而非 UI 文案） */
export function defaultEventName(): string {
	return getLang() === 'en' ? 'New Year' : '新年';
}

/** 倒计时粒度选项（顺序即下拉顺序；label 在调用时随当前语言求值，卡片右上角下拉与编辑弹窗共用） */
export function countdownModes(): Array<{ v: NonNullable<CountdownSettings['mode']>; label: string }> {
	return [
		{ v: 'year', label: t('modal.cdModeYear') },
		{ v: 'month', label: t('modal.cdModeMonth') },
		{ v: 'day', label: t('modal.cdModeDay') },
	];
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
			const fields = row.createDiv({ cls: 'ad-cd-fields' });

			const name = fields.createEl('input', { cls: 'ad-modal-input', type: 'text' });
			name.value = cfg.eventName;
			name.placeholder = t('modal.cdEventPlaceholder');
			name.addEventListener('input', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, eventName: name.value.trim() || defaultEventName() };
			});

			// 倒计时粒度：按年（默认，保持旧数据行为）/ 按月 / 按日
			const mode = fields.createEl('select', { cls: 'ad-modal-input ad-cd-mode' }) as HTMLSelectElement;
			for (const m of countdownModes()) {
				const opt = mode.createEl('option', { text: m.label });
				opt.value = m.v;
			}
			mode.value = cfg.mode ?? 'year';

			// 目标值随粒度切换三种控件：按年=完整日期；按月=每月的日（1–31）；按日=时刻（HH:mm）
			const date = fields.createEl('input', { cls: 'ad-modal-input ad-cd-date', type: 'date' });
			date.value = cfg.targetDate;
			date.addEventListener('input', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, targetDate: date.value || '2027-01-01' };
			});

			// 按月：只选「日」。固定存成 2000-01-dd（1 月恒有 31 天，合法不溢出），渲染侧只取 getDate()
			const daySel = fields.createEl('select', { cls: 'ad-modal-input ad-cd-day' }) as HTMLSelectElement;
			for (let d = 1; d <= 31; d++) {
				daySel.createEl('option', { text: String(d) }).value = String(d);
			}
			const dayMatch = /-(\d{1,2})$/.exec((cfg.targetDate ?? '').trim());
			daySel.value = dayMatch ? String(parseInt(dayMatch[1]!, 10)) : '1';
			daySel.addEventListener('change', () => {
				const cur = this.list[i]!;
				const dd = daySel.value.padStart(2, '0');
				this.list[i] = { ...cur, targetDate: `2000-01-${dd}` };
			});

			// 按日：每日目标时刻；旧数据缺省 23:59（等价旧版「到今天结束」）
			const time = fields.createEl('input', { cls: 'ad-modal-input ad-cd-time', type: 'time' }) as HTMLInputElement;
			time.value = cfg.targetTime ?? '23:59';
			time.addEventListener('input', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, targetTime: time.value || '23:59' };
			});

			// 单卡编辑模式：禁止删除（右键「删除此卡片」入口已独立提供）
			if (!this.single) {
				const del = fields.createEl('button', { cls: 'ad-modal-btn ad-modal-btn--danger ad-cd-del' });
				del.textContent = '✕';
				del.title = MODAL_TEXT.cdDelete;
				del.addEventListener('click', () => { this.list.splice(i, 1); this.rebuild(); });
			}

			// 重复选项：按年时可勾选「每年同一天自动循环」；按月/按日本身即周期循环，锁定为开启
			const optRow = row.createDiv({ cls: 'ad-cd-repeat' });
			const label = optRow.createEl('label', { cls: 'ad-cd-repeat__label' });
			const checkbox = label.createEl('input', { type: 'checkbox' });
			label.createSpan({ text: t('modal.cdRepeat') });

			// 按粒度只显示对应的目标值控件，其余隐藏并禁用（不参与交互/提交）
			const syncTargetControl = () => {
				const isYear = mode.value === 'year';
				const isMonth = mode.value === 'month';
				const isDay = mode.value === 'day';
				date.style.display = isYear ? '' : 'none';
				daySel.style.display = isMonth ? '' : 'none';
				time.style.display = isDay ? '' : 'none';
				date.disabled = !isYear;
				daySel.disabled = !isMonth;
				time.disabled = !isDay;
				daySel.title = isMonth ? t('modal.cdMonthDayOnly') : '';
				time.title = isDay ? t('modal.cdDayTimeHint') : '';
			};
			// 重复勾选框状态随粒度联动
			const syncRepeat = () => {
				const cyclic = mode.value === 'month' || mode.value === 'day';
				if (cyclic) {
					// 周期模式天然重复：锁定勾选、置灰，并把数据置为 true（语义统一）
					checkbox.checked = true;
					checkbox.disabled = true;
					label.classList.add('is-locked');
					label.title = mode.value === 'month' ? t('modal.cdRepeatLockedMonth') : t('modal.cdRepeatLockedDay');
					const cur = this.list[i]!;
					if (!cur.repeat) this.list[i] = { ...cur, repeat: true };
				} else {
					checkbox.checked = !!this.list[i]!.repeat;
					checkbox.disabled = false;
					label.classList.remove('is-locked');
					label.title = t('modal.cdRepeatYearHint');
				}
			};
			checkbox.addEventListener('change', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, repeat: checkbox.checked };
			});
			syncTargetControl();
			syncRepeat();
			mode.addEventListener('change', () => {
				const cur = this.list[i]!;
				this.list[i] = { ...cur, mode: mode.value as CountdownSettings['mode'] };
				syncTargetControl();
				syncRepeat();
			});
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
