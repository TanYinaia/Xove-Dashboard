/**
 * 工作日志页（第四页）渲染器 —— 从 DashboardView 抽出的子组件，仿 ProjectBoard。
 * 展示月视图日历：每个日期格内按开始时间列出带时刻的工作条目；
 * 点条目编辑、点空白格新增、点「+k」打开当日笔记。
 */

import { App, TFile } from 'obsidian';
import { DashboardSettings } from '../settings';
import { WorkLogEntry, WorkLogStore } from '../data/workLogParser';
import { WorkLogModal } from './WorkLogModal';

/** 宿主接口：WorkLogBoard 渲染器所需的宿主依赖。 */
export interface WorkLogHost {
	app: App;
	plugin: {
		settings: DashboardSettings;
		saveSettings(): Promise<void>;
	};
	boardEl: HTMLElement | null;
	currentPage: 'home' | 'project' | 'opportunity' | 'worklog';
	showToast(message: string, kind?: 'success' | 'error'): void;
	ensureFolder(path: string): Promise<void>;
	openFileByPath(path: string): Promise<void>;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

export class WorkLogBoard {
	private host: WorkLogHost;
	private store: WorkLogStore;
	private calYear: number;
	private calMonth: number; // 0 基

	constructor(host: WorkLogHost) {
		this.host = host;
		this.store = new WorkLogStore(host.app, () => host.plugin.settings);
		const now = new Date();
		this.calYear = now.getFullYear();
		this.calMonth = now.getMonth();
	}

	/** 进入工作日志页 */
	async show(): Promise<void> {
		const board = this.host.boardEl;
		if (!board) return;
		board.empty();
		await this.renderMonth();
	}

	/** 仓库事件/设置变更后刷新（仅当正停留该页） */
	async refresh(): Promise<void> {
		if (this.host.currentPage !== 'worklog') return;
		const board = this.host.boardEl;
		if (!board) return;
		board.empty();
		await this.renderMonth();
	}

	private async renderMonth(): Promise<void> {
		const board = this.host.boardEl;
		if (!board) return;
		const grid = board.createDiv({ cls: 'wl-cal' });

		const y = this.calYear;
		const m = this.calMonth;
		const dim = new Date(y, m + 1, 0).getDate();
		const fd = new Date(y, m, 1).getDay();
		const adj = fd === 0 ? 6 : fd - 1;

		const today = new Date();
		const realTodayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

		// ---- 头部导航 ----
		const header = grid.createDiv({ cls: 'wl-cal__header' });
		header.createSpan({ cls: 'wl-cal__title', text: `${y}年${m + 1}月` });
		const nav = header.createDiv({ cls: 'wl-cal__nav' });
		const prevBtn = nav.createEl('button', { cls: 'wl-cal__btn', text: '←' });
		const todayBtn = nav.createEl('button', { cls: 'wl-cal__btn', text: '今天' });
		const nextBtn = nav.createEl('button', { cls: 'wl-cal__btn', text: '→' });
		prevBtn.addEventListener('click', () => {
			this.calMonth--;
			if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; }
			void this.renderMonth();
		});
		nextBtn.addEventListener('click', () => {
			this.calMonth++;
			if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; }
			void this.renderMonth();
		});
		todayBtn.addEventListener('click', () => {
			const n = new Date();
			this.calYear = n.getFullYear();
			this.calMonth = n.getMonth();
			void this.renderMonth();
		});

		// ---- 星期行 ----
		const weekdays = grid.createDiv({ cls: 'wl-cal__weekdays' });
		['一', '二', '三', '四', '五', '六', '日'].forEach((d) => weekdays.createSpan({ text: d }));

		// ---- 读取当月数据 ----
		const map = await this.store.getMonthEntries(y, m);

		// ---- 日期网格 ----
		const days = grid.createDiv({ cls: 'wl-cal__days' });
		for (let i = 0; i < adj; i++) days.createDiv({ cls: 'wl-cal__day wl-cal__day--empty' });

		for (let d = 1; d <= dim; d++) {
			const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
			const isToday = ds === realTodayStr;
			const entries = map.get(ds) ?? [];
			const cls = 'wl-cal__day' + (isToday ? ' is-today' : '') + (entries.length ? ' has-entries' : '');
			const dayEl = days.createDiv({ cls, attr: { 'data-date': ds } });
			dayEl.createSpan({ cls: 'wl-cal__day-num', text: String(d) });

			const shown = entries.slice(0, 4);
			shown.forEach((e) => {
				const entryEl = dayEl.createDiv({ cls: 'wl-cal__entry' });
				entryEl.createSpan({
					cls: 'wl-cal__entry-time',
					text: e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime,
				});
				entryEl.createSpan({ cls: 'wl-cal__entry-title', text: e.title });
				entryEl.addEventListener('click', (ev) => {
					ev.stopPropagation();
					this.openEditModal(e);
				});
			});
			if (entries.length > 4) {
				const more = dayEl.createDiv({ cls: 'wl-cal__day-more', text: '+' + (entries.length - 4) });
				more.addEventListener('click', (ev) => {
					ev.stopPropagation();
					void this.openDayFile(ds);
				});
			}

			// 点击空白格 → 新增
			dayEl.addEventListener('click', () => this.openAddModal(ds));
		}

		// ---- 空状态提示 ----
		const total = Array.from(map.values()).reduce((s, arr) => s + arr.length, 0);
		if (total === 0) {
			grid.createDiv({
				cls: 'wl-cal__hint',
				text: '还没有工作日志，点击任意日期添加；或在「设置 → 工作日志」中确认存储路径与命名规则。',
			});
		}
	}

	private openAddModal(date: string): void {
		new WorkLogModal({
			app: this.host.app,
			date,
			store: this.store,
			onSaved: () => void this.refresh(),
			onToast: (msg, kind) => this.host.showToast(msg, kind),
		}).open();
	}

	private openEditModal(entry: WorkLogEntry): void {
		new WorkLogModal({
			app: this.host.app,
			date: entry.date,
			entry,
			store: this.store,
			onSaved: () => void this.refresh(),
			onToast: (msg, kind) => this.host.showToast(msg, kind),
		}).open();
	}

	private async openDayFile(date: string): Promise<void> {
		const path = this.store.notePath(date);
		const file = this.host.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.host.openFileByPath(path);
		} else {
			// 当日笔记不存在 → 改为打开新增弹窗
			this.openAddModal(date);
		}
	}
}
