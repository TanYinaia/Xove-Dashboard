import { ItemView, Menu, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { MOCK_DATA, DashboardData } from '../data/mockData';
import { BannerSettings, DEFAULT_SETTINGS } from '../settings';
import { BannerModal } from './BannerModal';
import { TaskEditModal } from './TaskEditModal';
import { parseFrontmatter, TaskItem, ProjectInfo, TaskStatus, STATUS_LIST, ProjectType, priorityWeight, NodeState, RepeatRule } from '../data/taskParser';
import { TaskStore } from '../data/taskStore';
import { fmtDate, todayStr, nowFmt, calcNextRemindDate, getTodayUniverse, getTodayTasks, isDoneToday, isSkipToday, overdueDays, urgencyMeta } from '../data/taskLogic';
import { OpportunityModal } from './OpportunityModal';
import {
	OpportunityItem, OpportunityFormData, OpportunityStatus,
	OPPORTUNITY_STATUS_LIST, OPPORTUNITY_STATUS_CLASS, OPPORTUNITY_STATUS_DOT,
	sortOpportunities,
	ensureOpportunityFile, parseOpportunitiesFile, writeOpportunitiesFile,
	createOpportunity, updateOpportunity, updateOpportunityStatus, toggleOpportunityRoadmap, deleteOpportunity,
	DEFAULT_OPPORTUNITY_FILE,
} from '../data/opportunityParser';
import type AgentDashboard from '../main';
import {
	ICON_home, ICON_newDiary, ICON_newTask, ICON_newProject,
	ICON_allProjects, ICON_opportunity, ICON_gantt, ICON_list,
	ICON_calendar, ICON_kanban, injectSvg,
} from '../icons';

export const VIEW_TYPE = 'agent-dashboard-view';



/* ---- Repeat rule helpers (modal English freq → Chinese frontmatter) ---- */

/**
 * Build a RepeatRule object from the modal's structured repeat settings.
 *  - daily:   workdaysOnly → 频率: 工作日；否则 频率: 每天 + 间隔天数
 *  - weekly:  频率: 每周 + 每周几[] (1=Mon .. 7=Sun)
 *  - monthly: 频率: 每月 + 每月几号
 * "每年" was removed per product decision.
 */
function buildRepeatRule(data: {
	freq: string;
	interval: number;
	workdaysOnly: boolean;
	weekdays: number[];
	monthDay: number;
	startDate: string | null;
}): RepeatRule | null {
	if (!data.freq) return null;
	const rule: RepeatRule = {};
	const d = data.startDate ? new Date(data.startDate + 'T00:00:00') : new Date();

	if (data.freq === 'daily') {
		if (data.workdaysOnly) {
			rule['频率'] = '工作日';
		} else {
			rule['频率'] = '每天';
			rule['间隔天数'] = data.interval && data.interval >= 1 ? data.interval : 1;
		}
	} else if (data.freq === 'weekly') {
		rule['频率'] = '每周';
		const days = (data.weekdays && data.weekdays.length)
			? [...data.weekdays].sort((a, b) => a - b)
			: [((d.getDay() + 6) % 7) + 1];
		rule['每周几'] = days;
	} else if (data.freq === 'monthly') {
		rule['频率'] = '每月';
		const md = data.monthDay && data.monthDay >= 1 && data.monthDay <= 31
			? data.monthDay
			: (isNaN(d.getTime()) ? 1 : d.getDate());
		rule['每月几号'] = md;
	} else {
		return null;
	}
	return rule;
}

function calcHeatmapStats(data: Map<string, number>, year: number, today: Date): { total: number; active: number; streak: number } {
	let total = 0;
	let active = 0;
	const prefix = `${year}-`;
	const todayStr = fmtDate(today);

	for (const [date, count] of data) {
		if (!date.startsWith(prefix) || date > todayStr) continue;
		total += count;
		if (count > 0) active++;
	}

	// current streak counted backwards from today
	let streak = 0;
	const d = new Date(today);
	while (d.getFullYear() === year) {
		const key = fmtDate(d);
		if ((data.get(key) ?? 0) > 0) streak++;
		else break;
		d.setDate(d.getDate() - 1);
	}

	return { total, active, streak };
}

/** Format lunar date as "五月廿二" style */
function getLunarDate(d: Date): string {
	try {
		const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
			timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric',
		}).formatToParts(d);
		const monthStr = parts.find((p) => p.type === 'month')?.value ?? '';
		const dayStr = parts.find((p) => p.type === 'day')?.value ?? '';
		if (/[\u4e00-\u9fff]/.test(monthStr)) {
			// Convert numeric day to Chinese ordinal (e.g. "1" → "初一", "15" → "十五")
			const dayNum = parseInt(dayStr);
			if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 30) {
				const LUNAR_DAYS = ['\u521D\u4E00','\u521D\u4E8C','\u521D\u4E09','\u521D\u56DB','\u521D\u4E94','\u521D\u516D','\u521D\u4E03','\u521D\u516B','\u521D\u4E5D','\u521D\u5341',
					'\u5341\u4E00','\u5341\u4E8C','\u5341\u4E09','\u5341\u56DB','\u5341\u4E94','\u5341\u516D','\u5341\u4E03','\u5341\u516B','\u5341\u4E5D','\u4E8C\u5341',
					'\u5EFF\u4E00','\u5EFF\u4E8C','\u5EFF\u4E09','\u5EFF\u56DB','\u5EFF\u4E94','\u5EFF\u516D','\u5EFF\u4E03','\u5EFF\u516B','\u5EFF\u4E5D','\u4E09\u5341'];
				return monthStr + (LUNAR_DAYS[dayNum - 1] ?? dayStr);
			}
			return monthStr + dayStr.replace('\u65E5', '');
		}
		const m = parseInt(monthStr) || 1;
		const day = parseInt(dayStr) || 1;
		const MONTHS = ['\u6B63\u6708','\u4E8C\u6708','\u4E09\u6708','\u56DB\u6708','\u4E94\u6708','\u516D\u6708','\u4E03\u6708','\u516B\u6708','\u4E5D\u6708','\u5341\u6708','\u51AC\u6708','\u814A\u6708'];
		const DAYS = ['\u521D\u4E00','\u521D\u4E8C','\u521D\u4E09','\u521D\u56DB','\u521D\u4E94','\u521D\u516D','\u521D\u4E03','\u521D\u516B','\u521D\u4E5D','\u521D\u5341','\u5341\u4E00','\u5341\u4E8C','\u5341\u4E09','\u5341\u56DB','\u5341\u4E94','\u5341\u516D','\u5341\u4E03','\u5341\u516B','\u5341\u4E5D','\u4E8C\u5341','\u5EFF\u4E00','\u5EFF\u4E8C','\u5EFF\u4E09','\u5EFF\u56DB','\u5EFF\u4E94','\u5EFF\u516D','\u5EFF\u4E03','\u5EFF\u516B','\u5EFF\u4E5D','\u4E09\u5341'];
		return MONTHS[m - 1] + (DAYS[day - 1] ?? '');
	} catch {
		return '';
	}
}

export class DashboardView extends ItemView {
	private plugin: AgentDashboard;
	private bannerState: BannerSettings;
	private bannerImg: HTMLImageElement | null = null;
	private bannerPh: HTMLElement | null = null;
	private boardEl: HTMLElement | null = null;
	private heatmapCard: HTMLElement | null = null;
	private heatmapTimer: number | null = null;
	private homeRefreshTimer: number | null = null;
	private noiseId: number | null = null;
	private pulseEls: { total: HTMLElement; pending: HTMLElement; today: HTMLElement; streak: HTMLElement } | null = null;
	private dateEl: HTMLElement | null = null;
	// NOTE: deliberately NOT named `titleEl` — Obsidian's ItemView has its own
	// `titleEl` (view-header title). Declaring a field with that name would
	// overwrite the parent's after super() and break ItemView.load()
	// ("Cannot read properties of null (reading 'setText')" → blank view).
	private adTitleEl: HTMLElement | null = null;
	private weekdayEl: HTMLElement | null = null;
	private lunarEl: HTMLElement | null = null;
	private dashboardEl: HTMLElement | null = null;
	/** Header theme-toggle button. Prefixed to avoid clashing with ItemView fields. */
	private adThemeBtn: HTMLElement | null = null;

	// Project overview state
	private currentProjects: ProjectInfo[] = [];
	private currentTasks: TaskItem[] = [];
	private selectedProject: string | null = null;
	private currentView: string = 'gantt';
	private poMainEl: HTMLElement | null = null;
	private calYear: number = new Date().getFullYear();
	private calMonth: number = new Date().getMonth();
	private sortCol: string = '';
	private sortDir: 'asc' | 'desc' = 'asc';
	private taskListFilter: string = 'all';
	private collapsedParents: Set<string> = new Set();
	private highlightedBar: Element | null = null;
	private highlightedRow: HTMLElement | null = null;
	private ganttZoom: 'day' | 'week' | 'month' | 'quarter' = 'week';
	private ganttStatusFilter: TaskStatus[] = [];

	// Which top-level page is currently shown (home / project overview / opportunity board)
	private currentPage: 'home' | 'project' | 'opportunity' = 'home';

	// Opportunity board state
	private currentOpportunities: OpportunityItem[] = [];
	private selectedOppStatus: string = 'all';
	private oppShowRoadmapOnly: boolean = false;
	private selectedOppDetailId: string | null = null; // 单状态模式下右侧详情面板选中的机会点
	private draggedOppId: string | null = null; // 看板拖拽中正在拖动的机会点 id
	private opMainEl: HTMLElement | null = null;
	private oppSortCol: string = '';
	private oppSortDir: 'asc' | 'desc' = 'asc';
	private oppRefreshTimer: number | null = null;
	private oppCache: { at: number; items: OpportunityItem[] } | null = null;

	private taskStore: TaskStore;

	constructor(leaf: WorkspaceLeaf, plugin: AgentDashboard) {
		super(leaf);
		this.plugin = plugin;
		this.bannerState = { ...DEFAULT_SETTINGS.banner, ...plugin.settings.banner };
		this.taskStore = new TaskStore(this.app, () => this.plugin.settings, (msg) => this.showToast(msg));
	}

	/** Theme actually in effect for the dashboard right now. */
	private effectiveTheme(): 'light' | 'dark' {
		const t = this.plugin.settings.theme;
		if (t === 'auto') return document.body.classList.contains('theme-light') ? 'light' : 'dark';
		return t;
	}

	private applyTheme(): void {
		const root = this.dashboardEl ?? (this.containerEl.querySelector('.agent-dashboard'));
		if (root) root.setAttribute('data-theme', this.effectiveTheme());
		this.refreshThemeButton();
	}

	/** Keep the header toggle's icon/tooltip in sync with the effective theme. */
	refreshThemeButton(): void {
		const btn = this.adThemeBtn;
		if (!btn) return;
		const eff = this.effectiveTheme();
		const syncing = this.plugin.settings.themeSyncObsidian;
		btn.textContent = eff === 'dark' ? '\u2600' : '\uD83C\uDF19';
		btn.title = (eff === 'dark' ? '\u5207\u6362\u5230\u6D45\u8272' : '\u5207\u6362\u5230\u6DF1\u8272')
			+ (syncing ? '\uFF08\u540C\u65F6\u5207\u6362 Obsidian \u5916\u89C2\uFF09' : '\uFF08\u4EC5\u4EEA\u8868\u76D8\uFF09');
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Agent dashboard'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		// NOTE: earlier builds emptied this.containerEl then added .agent-dashboard
		// directly; that was fine (the "setText on null" bug was the titleEl field
		// collision, NOT the empty()). Now we clear the container's leftovers
		// (Obsidian/theme placeholders) so our root div sits at the very top, then
		// create a child <div class="agent-dashboard"> and render into it.
		this.containerEl.empty();
		this.dashboardEl = this.containerEl.createDiv({ cls: 'agent-dashboard' });
		this.applyTheme();
		this.registerEvent(this.app.workspace.on('css-change', () => this.applyTheme()));

		try {
		const d = MOCK_DATA;
		this.renderBanner(this.dashboardEl);
		this.renderNoise(this.dashboardEl);
		void this.renderPulse(this.dashboardEl, d);
		this.renderHeader(this.dashboardEl, d);
		this.renderActions(this.dashboardEl);
		this.renderBoard(this.dashboardEl, d);

		// Auto-refresh on vault changes (home cards incl. progress + weekly, or project overview)
		const refreshAll = () => {
			this.taskStore.invalidate();
			void this.updatePulse();
			if (this.currentPage === 'project') {
				void this.refreshProjectOverview();
			} else if (this.currentPage === 'opportunity') {
				this.scheduleOpportunityRefresh();
			} else {
				this.scheduleHeatmapRefresh();
				this.scheduleHomeRefresh();
			}
		};
		this.registerEvent(this.app.vault.on('create', refreshAll));
		this.registerEvent(this.app.vault.on('delete', refreshAll));
		this.registerEvent(this.app.vault.on('rename', refreshAll));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			this.taskStore.invalidate();
			if (this.currentPage === 'project') {
				// Project config files are re-rendered by setProjectStage / updateProjectFile themselves.
				// Skipping here avoids a stale re-scan clobbering the just-set stage (flash → reset to first stage).
				if (file instanceof TFile && file.name.startsWith('project-')) return;
				void this.updatePulse();
				void this.refreshProjectOverview();
			} else if (this.currentPage === 'opportunity') {
				if (file instanceof TFile && file.path === this.plugin.settings.opportunityFile) {
					void this.updatePulse();
					this.scheduleOpportunityRefresh();
				}
			} else {
				// Home: ignore edits to unrelated files. Only task files (markdown under
				// the projects folder) affect the home cards, so this saves a full rescan
				// on every unrelated note edit while still staying fresh for real changes.
				if (!(file instanceof TFile) || !this.taskStore.isTaskRelevantPath(file.path)) return;
				void this.updatePulse();
				this.scheduleHomeRefresh();
			}
		}));
		} catch (err) {
			try {
				const e = err instanceof Error ? err : new Error(String(err));
				this.dashboardEl?.empty();
				this.dashboardEl?.createEl('pre', { cls: 'ad-error', text: 'Dashboard 渲染出错：\n' + (e.stack || e.message) });
			} catch { /* ignore */ }
			console.error('[AgentDashboard] render error', err);
		}
	}

	async onClose(): Promise<void> {
		if (this.noiseId) { window.cancelAnimationFrame(this.noiseId); this.noiseId = null; }
		if (this.oppRefreshTimer) { window.clearTimeout(this.oppRefreshTimer); this.oppRefreshTimer = null; }
		this.dashboardEl?.empty();
	}

	/* ============================================================
	   BANNER — image insert via modal, vertical drag only
	   ============================================================ */
	private renderBanner(root: HTMLElement): void {
		const banner = root.createDiv({ cls: 'ad-banner' });
		const ph = banner.createDiv({ cls: 'ad-banner__ph', text: '[ banner ]  ·  点击右上角按钮插入封面图片' });
		this.bannerPh = ph;

		const img = banner.createEl('img', { cls: 'ad-banner__img ad-banner__img--hidden' });
		img.alt = 'Banner';
		this.bannerImg = img;

		// toolbar
		const bar = banner.createDiv({ cls: 'ad-banner__bar' });
		const pickBtn = bar.createEl('button', { cls: 'ad-banner__btn', text: '更换图片' });

		// hidden file input
		const fileInput = root.createEl('input', { cls: 'ad-banner__fileinput', attr: { type: 'file', accept: 'image/*' } });

		// restore saved image
		if (this.bannerState.imageDataUrl && this.bannerImg && this.bannerPh) {
			this.displayBannerImage(this.bannerState.imageDataUrl, this.bannerState.offsetY);
		}

		// pick → read → open modal
		pickBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			fileInput.click();
		});

		fileInput.addEventListener('change', () => {
			const file = fileInput.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (ev) => {
				const dataUrl = ev.target?.result as string;
				this.openBannerModal(dataUrl, 0);
			};
			reader.readAsDataURL(file);
			fileInput.value = '';
		});

		// click image to re-adjust position
		img.addEventListener('click', (e) => {
			e.stopPropagation();
			if (this.bannerState.imageDataUrl) {
				this.openBannerModal(this.bannerState.imageDataUrl, this.bannerState.offsetY);
			}
		});
	}

	private openBannerModal(dataUrl: string, currentOffsetY: number): void {
		new BannerModal(
			this.app,
			dataUrl,
			currentOffsetY,
			(offsetY: number) => {
				this.bannerState.imageDataUrl = dataUrl;
				this.bannerState.offsetY = offsetY;
				void this.saveBanner().then(() => {
					this.displayBannerImage(dataUrl, offsetY);
				});
			},
		).open();
	}

	private displayBannerImage(dataUrl: string, offsetY: number): void {
		const img = this.bannerImg;
		const ph = this.bannerPh;
		if (!img || !ph) return;
		img.onload = () => {
			img.style.transform = `translateY(${offsetY}px)`;
		};
		img.src = dataUrl;
		img.removeClass('ad-banner__img--hidden');
		ph.addClass('ad-banner__ph--hidden');
	}

	private async saveBanner(): Promise<void> {
		this.plugin.settings.banner = { ...this.bannerState };
		await this.plugin.saveSettings();
	}

	/* ---- Vault note counts by creation date ---- */
	private getVaultNoteCounts(): Map<string, number> {
		const counts = new Map<string, number>();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const d = new Date(file.stat.ctime);
			const key = fmtDate(d);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return counts;
	}

	private scheduleHeatmapRefresh(): void {
		if (this.heatmapTimer) window.clearTimeout(this.heatmapTimer);
		this.heatmapTimer = window.setTimeout(() => this.refreshHeatmap(), 300);
	}

	private refreshHeatmap(): void {
		if (!this.heatmapCard || !this.boardEl) return;
		this.heatmapCard.remove();
		this.renderHeatmap(this.boardEl);
	}

	/* ============================================================
	   Noise background (canvas grain overlay)
	   ============================================================ */
	private renderNoise(root: HTMLElement): void {
		const canvas = root.createEl('canvas', { cls: 'ad-noise' });
		// Inline fallback so the grain overlay never occupies normal-flow space
		// (covers flex %-height quirks + CSS load-order issues).
		canvas.setCssProps({
			position: 'absolute',
			inset: '0',
			width: '100%',
			height: '100%',
			zIndex: '0',
			pointerEvents: 'none',
			imageRendering: 'pixelated',
			display: 'block',
		});
		const ctx = canvas.getContext('2d', { alpha: true });
		if (!ctx) return;
		const size = 1024;
		canvas.width = size;
		canvas.height = size;
		// disable antialiasing for crisp pixel edges
		ctx.imageSmoothingEnabled = false;
		let frame = 0;
		const draw = () => {
			if (frame % 2 === 0) {
				const img = ctx.createImageData(size, size);
				const d = img.data;
				for (let i = 0; i < d.length; i += 4) {
					const v = Math.random() * 255;
					d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 18;
				}
				ctx.putImageData(img, 0, 0);
			}
			frame++;
			this.noiseId = window.requestAnimationFrame(draw);
		};
		this.noiseId = window.requestAnimationFrame(draw);
	}

	/* ============================================================
	   Pulse
	   ============================================================ */
	private async renderPulse(root: HTMLElement, d: DashboardData): Promise<void> {
		const bar = root.createDiv({ cls: 'ad-pulse' });
		bar.createSpan({ cls: 'ad-pulse__tag', text: '[ VAULT PULSE ]' });

		const today = new Date();
		const todayKey = todayStr();
		const noteCounts = this.getVaultNoteCounts();
		const hs = calcHeatmapStats(noteCounts, today.getFullYear(), today);
		const todayCount = noteCounts.get(todayKey) ?? 0;

		// Compute real pending task count (not done / not cancelled)
		let pendingCount = 0;
		try {
			const all = await this.taskStore.scanAllTasks();
			pendingCount = all.filter((t) => t.status !== '\u5DF2\u5B8C\u6210' && t.status !== '\u5DF2\u53D6\u6D88').length;
		} catch { /* keep 0 */ }

		const totalEl = bar.createSpan({ text: `${hs.total} NOTES` });
		bar.createSpan({ cls: 'ad-pulse__sep', text: '\u00B7' });
		const pendingEl = bar.createSpan({ text: `${pendingCount} PENDING` });
		bar.createSpan({ cls: 'ad-pulse__sep', text: '\u00B7' });
		const todayEl = bar.createSpan();
		todayEl.textContent = `\u0394 TODAY +${todayCount}`;
		bar.createSpan({ cls: 'ad-pulse__sep', text: '\u00B7' });
		const streakEl = bar.createSpan({ text: `${hs.streak}D STREAK` });

		// Fix 4: JS-based caret blink
		const caret = bar.createSpan({ cls: 'ad-pulse__caret' });
		let caretOn = true;
		this.registerInterval(window.setInterval(() => {
			caretOn = !caretOn;
			caret.style.opacity = caretOn ? '1' : '0';
		}, 525));

		this.pulseEls = { total: totalEl, pending: pendingEl, today: todayEl, streak: streakEl };
	}

	private async updatePulse(): Promise<void> {
		if (!this.pulseEls) return;
		const today = new Date();
		const todayKey = todayStr();
		const noteCounts = this.getVaultNoteCounts();
		const hs = calcHeatmapStats(noteCounts, today.getFullYear(), today);
		const todayCount = noteCounts.get(todayKey) ?? 0;
		this.pulseEls.total.textContent = `${hs.total} NOTES`;
		this.pulseEls.today.textContent = `\u0394 TODAY +${todayCount}`;
		this.pulseEls.streak.textContent = `${hs.streak}D STREAK`;
		// Update pending with real task count
		try {
			const all = await this.taskStore.scanAllTasks();
			const pending = all.filter((t) => t.status !== '\u5DF2\u5B8C\u6210' && t.status !== '\u5DF2\u53D6\u6D88').length;
			this.pulseEls.pending.textContent = `${pending} PENDING`;
		} catch { /* keep current */ }
	}

	/** Live-update only the dashboard title text (cheap; no full re-render). */
	refreshTitle(): void {
		if (!this.adTitleEl) return;
		this.adTitleEl.textContent = this.plugin.settings.dashboardTitle || MOCK_DATA.header.title;
	}

	/* ============================================================
	   Header
	   ============================================================ */
	private renderHeader(root: HTMLElement, d: DashboardData): void {
		const h = root.createEl('header', { cls: 'ad-header' });
		const left = h.createDiv({ cls: 'ad-header__left' });
		left.createEl('p', { cls: 'ad-eyebrow', text: d.header.eyebrow });
		this.adTitleEl = left.createEl('h1', { cls: 'ad-title', text: this.plugin.settings.dashboardTitle || d.header.title });
		left.createEl('p', { cls: 'ad-subtitle', text: 'Obsidian · Personal Dashboard · v' + (this.plugin.manifest?.version ?? d.header.subtitle.replace(/^.*v/, 'v')) });

		const right = h.createDiv({ cls: 'ad-header__right' });

		const now = new Date();
		const dateStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
		const timeStr = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
		this.dateEl = right.createDiv({ cls: 'ad-header__date', text: `${dateStr} ${timeStr}` });

		const meta = right.createDiv({ cls: 'ad-header__meta' });
		this.weekdayEl = meta.createSpan({ text: new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' }) });
		meta.createSpan({ cls: 'ad-dot' });
		// Compute the real lunar date up front (mock data has a stale literal);
		// the 30s interval below keeps it fresh across day boundaries.
		const initialLunar = getLunarDate(new Date());
		this.lunarEl = meta.createSpan({ text: initialLunar ? '农历 ' + initialLunar : d.lunar });

		// Buttons row: theme toggle (left) + settings (right), same line
		const btns = right.createDiv({ cls: 'ad-header__btns' });

		const themeBtn = btns.createEl('button', { cls: 'ad-header__theme' });
		this.adThemeBtn = themeBtn;
		this.refreshThemeButton();
		themeBtn.addEventListener('click', () => { void (async () => {
			const next: 'light' | 'dark' = this.effectiveTheme() === 'light' ? 'dark' : 'light';
			if (this.plugin.settings.themeSyncObsidian) {
				// Switch Obsidian's global appearance and let the dashboard follow it.
				this.plugin.setObsidianTheme(next);
				this.plugin.settings.theme = 'auto';
			} else {
				this.plugin.settings.theme = next;
			}
			await this.plugin.saveSettings();
			this.plugin.refreshThemeButtons();
			this.applyTheme();
		})(); });

		const settings = btns.createEl('button', { cls: 'ad-header__settings' });
		settings.textContent = '\u2699 \u8BBE\u7F6E';
		settings.addEventListener('click', () => {
			interface SettingApi { open(): void; openTabById(id: string): void }
			const app = this.app as unknown as { setting?: SettingApi };
			app.setting?.open();
			app.setting?.openTabById(this.plugin.manifest.id);
		});

		// Update time every 30 seconds
		this.registerInterval(window.setInterval(() => {
			const n = new Date();
			if (this.dateEl) {
				const ds = n.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
				const ts = n.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
				this.dateEl.textContent = `${ds} ${ts}`;
			}
			if (this.weekdayEl) {
				this.weekdayEl.textContent = n.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' });
			}
			if (this.lunarEl) {
				const lunar = getLunarDate(n);
				if (lunar) this.lunarEl.textContent = '\u519C\u5386 ' + lunar;
			}
		}, 30000));
	}

	/* ============================================================
	   Actions toolbar
	   ============================================================ */
	private renderActions(root: HTMLElement): void {
		const nav = root.createEl('nav', { cls: 'ad-toolbar' });
		const items: Array<{ glyph: string; label: string; action: string; svg?: string }> = [
			{ glyph: '\u2302', label: '\u4E3B\u9875', action: 'home', svg: ICON_home },
			{ glyph: '+', label: '\u65B0\u5EFA\u65E5\u8BB0', action: 'diary', svg: ICON_newDiary },
			{ glyph: '\u25A1', label: '\u65B0\u5EFA\u4EFB\u52A1', action: 'task', svg: ICON_newTask },
			{ glyph: '\u25A3', label: '\u65B0\u5EFA\u9879\u76EE', action: 'project', svg: ICON_newProject },
			{ glyph: '\u203A', label: '\u5168\u90E8\u9879\u76EE', action: 'all', svg: ICON_allProjects },
			{ glyph: '\u25C8', label: '\u673A\u4F1A\u70B9', action: 'opportunity', svg: ICON_opportunity },
		];
		items.forEach((it) => {
			const btn = nav.createEl('button', { cls: 'ad-toolbar__btn' });
			const glyphEl = btn.createSpan({ cls: 'ad-glyph' });
			if (it.svg) injectSvg(glyphEl, it.svg);
			else glyphEl.textContent = it.glyph;
			btn.createSpan({ text: it.label });
			btn.addEventListener('click', () => {
				btn.addClass('is-active');
				if (it.action === 'home') this.showDashboard();
				if (it.action === 'diary') void this.createDiary();
				if (it.action === 'task') void this.openTaskModal(this.selectedProject ?? undefined);
				if (it.action === 'project') void this.createProjectFile();
			if (it.action === 'all') void this.showProjectOverview();
			if (it.action === 'opportunity') void this.showOpportunityBoard();
			window.setTimeout(() => btn.removeClass('is-active'), 350);
			});
		});
	}

	/* ============================================================
	   Board — single grid containing all cards
	   ============================================================ */
	private renderBoard(root: HTMLElement, d: DashboardData): void {
		const board = root.createDiv({ cls: 'ad-board' });
		this.boardEl = board;
		this.renderQuickCapture(board);
		void this.renderTodo(board);
		void this.renderProgress(board);
		void this.renderWeekly(board);
		void this.renderProjects(board);
		this.renderHeatmap(board);
		this.renderCountdown(board);
	}

	/* ---- Quick Capture ---- */
	private renderQuickCapture(board: HTMLElement): void {
		const card = board.createDiv({ cls: 'ad-card ad-b-capture' });
		this.cardHead(card, '\u25C6', '\u5FEB\u901F\u6355\u6349');
		const qc = card.createDiv({ cls: 'ad-qc' });
		const area = qc.createEl('textarea', {
			cls: 'ad-qc__area',
			attr: { rows: '3', placeholder: '\u8BB0\u5F55\u4E00\u95EA\u800C\u8FC7\u7684\u60F3\u6CD5\u2026' },
		});
		const row = qc.createDiv({ cls: 'ad-qc__row' });
		const cta = row.createEl('button', { cls: 'ad-qc__cta', text: '\u6355\u6349' });

		const submit = async () => {
			const content = area.value.trim();
			if (!content) { area.focus(); return; }
			cta.addClass('flash');
			try {
				await this.createCaptureNote(content);
				area.value = '';
				this.showToast('\u2728 \u60F3\u6CD5\u5DF2\u6355\u6349\uFF01');
			} catch (err) {
				console.error('[Agent Dashboard] 快速捕捉失败', err);
				this.showToast('\u26A0\uFE0F 捕捉失败，请检查「存储路径」设置', 'error');
			} finally {
				window.setTimeout(() => cta.removeClass('flash'), 400);
			}
		};

		cta.addEventListener('click', () => void submit());
	}

	/* ---- Toast ---- */
	private showToast(message: string, kind: 'success' | 'error' = 'success'): void {
		// Append to <body> so the toast is fixed to the viewport TOP regardless of any
		// transformed ancestor inside the Obsidian workspace (which would otherwise
		// break position:fixed and push the toast to the bottom).
		const toast = document.body.createDiv({ cls: 'ad-toast' + (kind === 'error' ? ' ad-toast--error' : '') });
		toast.createSpan({ text: message });
		window.setTimeout(() => {
			toast.addClass('ad-toast--out');
			window.setTimeout(() => toast.remove(), 300);
		}, 2500);
	}

	/* ---- Create note in vault ---- */
	/** Ensure a folder exists, creating parent folders recursively if needed. */
	private async ensureFolder(path: string): Promise<void> {
		if (!path || path === '/') return;
		if (this.app.vault.getAbstractFileByPath(path)) return;
		// createFolder only creates a single level, so build parents first.
		const parts = path.split('/').filter(Boolean);
		let cur = '';
		for (const part of parts) {
			cur = cur ? `${cur}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				await this.app.vault.createFolder(cur);
			}
		}
	}

	private async createCaptureNote(content: string): Promise<void> {
		const qc = this.plugin.settings.quickCapture;
		const now = new Date();

		// Ensure folder exists
		const folderPath = qc.storagePath;
		await this.ensureFolder(folderPath);

		// Generate filename
		const filename = this.applyNamingPattern(qc.namingPattern, now);
		const filepath = `${folderPath}/${filename}.md`;

		// Build content: template or plain
		let fileContent = content;
		if (qc.templateFile) {
			const tplFolder = this.getTemplateFolder();
			if (tplFolder) {
				const tplPath = `${tplFolder}/${qc.templateFile}.md`;
				const tplFile = this.app.vault.getAbstractFileByPath(tplPath);
				if (tplFile instanceof TFile) {
					const tpl = await this.app.vault.read(tplFile);
					fileContent = this.applyTemplate(tpl, content, filename, now);
				}
			}
		}

		await this.app.vault.create(filepath, fileContent);
	}

	/* ---- Create diary note ---- */
	private async createDiary(): Promise<void> {
		const dc = this.plugin.settings.diary;
		const now = new Date();

		// Ensure folder
		await this.ensureFolder(dc.storagePath);

		const filename = this.applyNamingPattern(dc.namingPattern, now);
		const filepath = `${dc.storagePath}/${filename}.md`;

		// Check if already exists
		if (this.app.vault.getAbstractFileByPath(filepath)) {
			this.showToast(`\u274C ${filename} \u5DF2\u5B58\u5728`);
			return;
		}

		// Build content from template
		let content = `# ${filename}\n`;
		if (dc.templateFile && dc.templateFolder) {
			const tplPath = `${dc.templateFolder}/${dc.templateFile}.md`;
			const tplFile = this.app.vault.getAbstractFileByPath(tplPath);
			if (tplFile instanceof TFile) {
				const tpl = await this.app.vault.read(tplFile);
				content = this.applyTemplate(tpl, '', filename, now);
			}
		}

		await this.app.vault.create(filepath, content);
		this.showToast(`\u2728 \u65E5\u8BB0\u5DF2\u521B\u5EFA\uFF1A${filename}`);

		// Open the new note
		const file = this.app.vault.getAbstractFileByPath(filepath);
		if (file instanceof TFile) {
			await this.app.workspace.openLinkText(file.path, '', true);
		}
	}

	private applyTemplate(template: string, content: string, title: string, d: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
		const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

		let result = template
			.replace(/\{\{date\}\}/g, date)
			.replace(/\{\{time\}\}/g, time)
			.replace(/\{\{title\}\}/g, title);

		// If {{content}} marker exists, insert there; otherwise append
		if (result.includes('{{content}}')) {
			result = result.replace(/\{\{content\}\}/g, content);
		} else {
			result += '\n\n' + content;
		}
		return result;
	}

	private getTemplateFolder(): string {
		return this.plugin.settings.quickCapture.templateFolder || '';
	}

	private applyNamingPattern(pattern: string, d: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		const name = pattern
			.replace('YYYY', String(d.getFullYear()))
			.replace('MM', pad(d.getMonth() + 1))
			.replace('DD', pad(d.getDate()))
			.replace('HH', pad(d.getHours()))
			.replace('mm', pad(d.getMinutes()))
			.replace('SS', pad(d.getSeconds()));
		// Remove characters not allowed in filenames (Windows/Mac/Linux)
		return name.replace(/[*"/<>:|?\\]/g, '-');
	}

	/* ============================================================
	   Task actions
	   ============================================================ */

	/** Toggle task status in source file's Chinese frontmatter */
	private async toggleTask(task: TaskItem, row: HTMLElement): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		// Repeat task: instead of toggling status, advance remindDate
		if (task.type === '\u91CD\u590D' && task.status !== '\u5DF2\u5B8C\u6210') {
			const nextDate = calcNextRemindDate(task);
			if (nextDate) {
				await this.writeTaskField(task, '\u63D0\u9192\u65E5\u671F', nextDate);
				task.remindDate = nextDate;
				const now = nowFmt();
				await this.writeTaskField(task, '\u5B8C\u6210\u65F6\u95F4', now);
				task.completeTime = now;
				this.showToast('\u2728 \u91CD\u590D\u4EFB\u52A1\uFF0C\u4E0B\u6B21\u63D0\u9192: ' + nextDate);
				void this.refreshRelevant();
				return;
			}
		}

		const content = await this.app.vault.read(file);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		let inFM = false;

		const newStatus: TaskStatus = task.status === '\u5DF2\u5B8C\u6210' ? '\u5F85\u529E' : '\u5DF2\u5B8C\u6210';

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') { inFM = !inFM; continue; }
			if (!inFM) continue;
			if (line.startsWith('\u72B6\u6001:')) {
				lines[i] = `\u72B6\u6001: ${newStatus}`;
				break;
			}
		}

		// Record / clear 完成时间 (precise to minute) when whole task toggled
		const now = nowFmt();
		if (newStatus === '\u5DF2\u5B8C\u6210') {
			let found = false;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.startsWith('\u5B8C\u6210\u65F6\u95F4:')) { lines[i] = `\u5B8C\u6210\u65F6\u95F4: ${now}`; found = true; break; }
		}
			if (!found) {
				const si = lines.findIndex((l) => l?.startsWith('\u72B6\u6001:'));
				if (si >= 0) lines.splice(si + 1, 0, `\u5B8C\u6210\u65F6\u95F4: ${now}`);
			}
		} else {
			const ci = lines.findIndex((l) => l?.startsWith('\u5B8C\u6210\u65F6\u95F4:'));
			if (ci >= 0) lines.splice(ci, 1);
		}

		await this.app.vault.modify(file, lines.join(eol));
		task.status = newStatus;
		task.completeTime = newStatus === '\u5DF2\u5B8C\u6210' ? now : null;
		row.toggleClass('is-done', newStatus === '\u5DF2\u5B8C\u6210');
	}

	/** Write a single frontmatter field to task file */
	/** Read a file and apply frontmatter field updates (create if missing). CRLF-safe. */
	private async writeFrontmatter(file: TFile, updates: Record<string, string>): Promise<void> {
		const content = await this.app.vault.read(file);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		this.applyFrontmatterUpdates(lines, updates);
		await this.app.vault.modify(file, lines.join(eol));
	}

	/** Mutate a lines array: update existing frontmatter fields, insert missing ones before closing ---. CRLF-safe. */
	private applyFrontmatterUpdates(lines: string[], updates: Record<string, string>): void {
		let inFM = false;
		let fmEnd = -1;
		const done = new Set<string>();
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') {
				if (!inFM) { inFM = true; continue; }
				fmEnd = i;
				inFM = false;
				continue;
			}
			if (!inFM) continue;
			for (const key of Object.keys(updates)) {
				if (line.startsWith(key + ':')) {
					lines[i] = `${key}: ${updates[key]}`;
					done.add(key);
				}
			}
		}
		const missing = Object.keys(updates).filter((k) => !done.has(k));
		if (missing.length === 0) return;
		if (fmEnd > 0) {
			lines.splice(fmEnd, 0, ...missing.map((k) => `${k}: ${updates[k]}`));
		} else {
			// No frontmatter at all — prepend a block
			lines.unshift(...['---', ...missing.map((k) => `${k}: ${updates[k]}`), '---', '']);
		}
	}

	private async writeTaskField(task: TaskItem, fieldKey: string, value: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;
		await this.writeFrontmatter(file, { [fieldKey]: value });
	}

	/** Postpone task by one day (spec section VIII.3) */
	private async postponeTask(task: TaskItem): Promise<void> {
		const shift = (iso: string): string => {
			const d = new Date(iso + 'T00:00:00');
			d.setDate(d.getDate() + 1);
			return fmtDate(d);
		};
		const isRecurring = task.type === '\u91CD\u590D';

		if (isRecurring) {
			// Recurring: advance the next 提醒日期 only (截止日期 is the recurrence bound,
			// shifting it would change when the whole recurring series ends).
			const newDate = task.remindDate ? shift(task.remindDate) : shift(todayStr());
			await this.writeTaskField(task, '\u63D0\u9192\u65E5\u671F', newDate);
			task.remindDate = newDate;
		} else if (task.dueDate) {
			// Single / multi-day: shift the date window so it no longer anchors to today.
			const newDue = shift(task.dueDate);
			await this.writeTaskField(task, '\u622A\u6B62\u65E5\u671F', newDue);
			task.dueDate = newDue;
			if (task.startDate) {
				const newStart = shift(task.startDate);
				await this.writeTaskField(task, '\u5F00\u59CB\u65E5\u671F', newStart);
				task.startDate = newStart;
			}
		} else if (task.startDate) {
			const newStart = shift(task.startDate);
			await this.writeTaskField(task, '\u5F00\u59CB\u65E5\u671F', newStart);
			task.startDate = newStart;
		} else if (task.remindDate) {
			const newRemind = shift(task.remindDate);
			await this.writeTaskField(task, '\u63D0\u9192\u65E5\u671F', newRemind);
			task.remindDate = newRemind;
		}

		this.showToast('\u2728 \u4EFB\u52A1\u5DF2\u5EF6\u540E\u4E00\u5929');
		void this.refreshRelevant();
	}
	private async showProjectOverview(): Promise<void> {
		if (!this.boardEl) return;

		// Scan FIRST (async) so the board is never left half-built if a vault event
		// fires mid-render. We only mutate the DOM after data is ready, which keeps
		// the project-overview build atomic and avoids stale/doubled home cards.
		const projects = await this.taskStore.scanAllProjects();
		const allTasks = await this.taskStore.scanAllTasks();

		this.boardEl.empty();
		this.boardEl.addClass('po-board');
		this.boardEl.removeClass('ad-board');
		this.boardEl.removeClass('op-board');
		this.currentPage = 'project';

		this.currentProjects = projects;
		this.currentTasks = allTasks;
		this.applyProjectOrder();
		this.selectedProject = null;
		this.currentView = this.plugin.settings.currentPoView || 'gantt';
		this.ganttStatusFilter = (this.plugin.settings.poGanttStatusFilter || []) as TaskStatus[];

		// Container with sidebar + main
		const container = this.boardEl.createDiv({ cls: 'po-container' });

		// Sidebar
		const sidebar = container.createDiv({ cls: 'po-sidebar' });
		this.renderProjectSidebar(sidebar);

		// Main content area
		this.poMainEl = container.createDiv({ cls: 'po-main' });
		this.renderProjectOverviewPanels();
	}

	/** Re-render only the main content panels (tabs + panels) */
	private renderProjectOverviewPanels(): void {
		if (!this.poMainEl) return;
		this.poMainEl.empty();

		const filteredTasks = this.selectedProject
			? this.currentTasks.filter((t) => t.projectId === this.selectedProject)
			: this.currentTasks;

		// Tabs
		const tabs = this.poMainEl.createDiv({ cls: 'po-tabs' });
		const tabDefs = [
			{ key: 'gantt', label: '\u7518\u7279\u56FE', icon: ICON_gantt },
			{ key: 'list', label: '\u5217\u8868', icon: ICON_list },
			{ key: 'calendar', label: '\u65E5\u5386', icon: ICON_calendar },
			{ key: 'kanban', label: '\u770B\u677F', icon: ICON_kanban },
		];
		const content = this.poMainEl.createDiv({ cls: 'po-content' });
		const panels: Record<string, HTMLElement> = {};
		for (const td of tabDefs) {
			const btn = tabs.createEl('button', { cls: 'po-tab' + (td.key === this.currentView ? ' is-active' : '') });
			const tabGlyph = btn.createSpan({ cls: 'ad-glyph' });
			injectSvg(tabGlyph, td.icon);
			btn.createSpan({ text: td.label });
			btn.dataset.view = td.key;
			panels[td.key] = content.createDiv({ cls: 'po-panel' + (td.key === this.currentView ? ' is-active' : ''), attr: { 'data-view': td.key } });
		}

		// Stage pipeline (compact dots) at the tab row's right side — only for 阶段项目
		if (this.selectedProject) {
			const selProj = this.currentProjects.find((p) => p.name === this.selectedProject);
			if (selProj && (selProj.type ?? 'stage') === 'stage') {
				this.renderStagePipeline(tabs);
			}
		}

		// Render only the ACTIVE panel up front. The other three are built lazily when
		// their tab is first opened — avoids building Gantt SVG + calendar + kanban all
		// at once on every open (perf).
		this.renderPoPanel(this.currentView, panels[this.currentView]!, filteredTasks);

		// Tab switch (lazy-render target panel)
		tabs.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.po-tab') as HTMLElement;
			if (!btn) return;
			const view = btn.dataset.view;
			if (!view) return;
			tabs.querySelectorAll('.po-tab').forEach((t) => t.removeClass('is-active'));
			btn.addClass('is-active');
			Object.values(panels).forEach((p) => p.classList.remove('is-active'));
			if (panels[view]) panels[view].addClass('is-active');
			this.currentView = view;
			this.plugin.settings.currentPoView = view;
			void this.plugin.saveSettings();
			if (panels[view]) this.renderPoPanel(view, panels[view], filteredTasks);
		});
	}

	/** Render a single PO panel by key (used for both initial render and lazy tab switch) */
	private renderPoPanel(key: string, panel: HTMLElement, tasks: TaskItem[]): void {
		panel.empty();
		if (key === 'gantt') this.renderGanttPanel(panel, tasks, this.currentProjects);
		else if (key === 'list') this.renderTaskTable(panel, 'po-tb2', tasks, this.currentProjects);
		else if (key === 'calendar') this.renderCalendarPanel(panel, tasks, this.currentProjects);
		else if (key === 'kanban') this.renderKanbanPanel(panel, tasks, this.currentProjects);
	}

	/** Render NPDP stage pipeline for selected project — compact card-style dots (like home page project card) */
	private renderStagePipeline(container: HTMLElement): void {
		const proj = this.currentProjects.find((p) => p.name === this.selectedProject);
		if (!proj || (proj.type ?? 'stage') !== 'stage') return;
		const stages = this.plugin.settings.npdpStages;
		const currentStage = proj.stage ?? 0;

		const bar = container.createDiv({ cls: 'ad-proj__stages po-stage-compact' });
		// Auto-size by stage count
		const stageMinW = Math.max(20, Math.min(36, Math.floor(160 / stages.length)));
		bar.style.gap = `${Math.max(1, Math.floor(4 / (stages.length / 4)))}px`;

		stages.forEach((label, i) => {
			const isDone = i < currentStage;
			const isCurrent = i === currentStage;
			const s = bar.createDiv({ cls: 'ad-proj__stage' + (isDone ? ' is-done' : '') + (isCurrent ? ' is-current' : '') });
			s.style.minWidth = stageMinW + 'px';
			s.createSpan({ cls: 'ad-pip' });
			s.appendText(label);

			s.addEventListener('click', () => void this.setProjectStage(proj, i));
		});
	}

	/** Set project stage and persist to project-{name}.md frontmatter */
	private async setProjectStage(proj: ProjectInfo, stage: number): Promise<void> {
		proj.stage = stage;
		// Persist stage to the project's config file (CRLF-safe)
		const folderName = proj.path.split('/').pop() || proj.name;
		const projectFilePath = `${proj.path}/project-${folderName}.md`;
		const file = this.app.vault.getAbstractFileByPath(projectFilePath);
		if (file instanceof TFile) {
			await this.writeFrontmatter(file, { '\u9636\u6BB5': String(stage) });
		}
		this.renderProjectOverviewPanels();
		const sidebar = this.boardEl?.querySelector('.po-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderProjectSidebar(sidebar);
		this.showToast(`\u2728 ${proj.name} \u9636\u6BB5\u5DF2\u66F4\u65B0\u4E3A "${this.plugin.settings.npdpStages[stage]}"`);
	}

	/** Render the project sidebar with filtering */
	private renderProjectSidebar(sidebar: HTMLElement): void {
		sidebar.empty();
		const list = sidebar.createDiv({ cls: 'po-sidebar__list' });

		// "全部项目" item
		const totalTasks = this.currentProjects.reduce((s, p) => s + p.taskCount, 0);
		const totalActive = this.currentProjects.reduce((s, p) => s + p.activeCount, 0);

		const allItem = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedProject === null ? ' is-active' : '') });
		allItem.createSpan({ cls: 'po-dot', attr: { style: 'background:#7BA7FF;color:#7BA7FF' } });
		allItem.createSpan({ text: '\u5168\u90E8\u9879\u76EE' });
		allItem.createSpan({ cls: 'po-count', text: totalActive + '/' + totalTasks });
		allItem.addEventListener('click', () => {
			this.selectedProject = null;
			this.renderProjectSidebar(sidebar);
			this.renderProjectOverviewPanels();
		});

		// Individual projects with right-click menu
		this.currentProjects.forEach((p) => {
			const item = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedProject === p.name ? ' is-active' : '') });
			item.createSpan({ cls: 'po-dot', attr: { style: 'background:' + p.color + ';color:' + p.color } });
			item.createSpan({ text: p.name });
			item.createSpan({ cls: 'po-count', text: p.activeCount + '/' + p.taskCount });
			item.addEventListener('click', () => {
				this.selectedProject = p.name;
				this.renderProjectSidebar(sidebar);
				this.renderProjectOverviewPanels();
			});
			// Right-click context menu
			item.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((menuItem) => {
					menuItem.setTitle('\u7F16\u8F91\u9879\u76EE').setIcon('pencil').onClick(() => {
						void this.editProject(p);
					});
				});
				menu.addItem((menuItem) => {
					menuItem.setTitle('\u5220\u9664\u9879\u76EE').setIcon('trash').onClick(() => {
						void this.deleteProject(p, sidebar);
					});
				});
				menu.showAtMouseEvent(e);
			});
			// Drag & drop reorder
			item.draggable = true;
			item.dataset.projIdx = String(this.currentProjects.indexOf(p));
			item.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/proj-idx', String(this.currentProjects.indexOf(p)));
				item.addClass('po-sidebar__item--dragging');
			});
			item.addEventListener('dragend', () => item.removeClass('po-sidebar__item--dragging'));
			item.addEventListener('dragover', (e) => { e.preventDefault(); item.addClass('po-sidebar__item--drag-over'); });
			item.addEventListener('dragleave', () => item.removeClass('po-sidebar__item--drag-over'));
		item.addEventListener('drop', (e) => {
			e.preventDefault();
			item.removeClass('po-sidebar__item--drag-over');
			// 跨项目移动：从甘特图「任务名称」行拖来的任务
			const taskId = e.dataTransfer?.getData('text/task-id');
			if (taskId) {
				void this.moveTaskToProject(taskId, p.name, sidebar);
				return;
			}
			const fromIdx = parseInt(e.dataTransfer?.getData('text/proj-idx') || '-1');
			const toIdx = this.currentProjects.indexOf(p);
			if (fromIdx < 0 || fromIdx === toIdx) return;
		const moved = this.currentProjects.splice(fromIdx, 1)[0];
		if (moved) {
			// Account for the shift after removal: when dragging down
			// (fromIdx < toIdx) the target's index moved one left, so we
			// insert at toIdx - 1 to land in the intended slot.
			const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
			this.currentProjects.splice(insertAt, 0, moved);
		}
			this.renderProjectSidebar(sidebar);
			this.renderProjectOverviewPanels();
			// Persist the new project order so it survives switching views
			this.plugin.settings.poProjectOrder = this.currentProjects.map((p) => p.name);
			void this.plugin.saveSettings();
		});
		});

		// New project button
		const addBtn = sidebar.createEl('button', { cls: 'po-add-btn', text: '+ \u65B0\u5EFA\u9879\u76EE' });
		addBtn.addEventListener('click', () => {
			void this.createProjectFile();
		});

	}

	/**
	 * 把某个任务（由甘特图「任务名称」行拖来）移动到目标项目文件夹。
	 * 项目归属由文件夹决定，故用 fileManager.renameFile 搬运 .md 文件；
	 * 同步遗留的 项目: frontmatter 字段，并在同名冲突时中止。
	 */
	private async moveTaskToProject(taskId: string, targetProject: string, sidebar: HTMLElement): Promise<void> {
		const rootPath = this.plugin.settings.projectsFolder || 'Projects';
		const parts = taskId.split('/');
		const curProj = parts.length > 1 ? parts[1] : '';
		if (curProj === targetProject) { this.showToast('任务已在该项目'); return; }
		const file = this.app.vault.getAbstractFileByPath(taskId);
		if (!(file instanceof TFile)) { this.showToast('找不到任务文件'); return; }
		const fileName = parts[parts.length - 1] || '';
		const newPath = `${rootPath}/${targetProject}/${fileName}`;
		if (this.app.vault.getAbstractFileByPath(newPath)) {
			this.showToast(`目标项目已存在同名任务「${fileName}」，未移动`);
			return;
		}
		await this.app.fileManager.renameFile(file, newPath);
		// 同步遗留的 项目: 字段（若存在）
		const moved = this.app.vault.getAbstractFileByPath(newPath);
		if (moved instanceof TFile) {
			const content = await this.app.vault.read(moved);
			const fm = parseFrontmatter(content);
			if (typeof fm['项目'] === 'string' && fm['项目'] !== targetProject) {
				await this.writeFrontmatter(moved, { '项目': targetProject });
			}
		}
		this.showToast(`已移动到「${targetProject}」`);
		// 重新扫描项目与任务，刷新计数与视图
		this.currentProjects = await this.taskStore.scanAllProjects();
		this.currentTasks = await this.taskStore.scanAllTasks();
		this.applyProjectOrder();
		this.renderProjectSidebar(sidebar);
		this.renderProjectOverviewPanels();
	}

	/** Edit project via ProjectModal */
	private async editProject(proj: ProjectInfo): Promise<void> {
		const { ProjectModal } = await import('./ProjectModal');
		const stages = this.plugin.settings.npdpStages;
		new ProjectModal({
			app: this.app,
			stages,
			editData: {
				name: proj.name,
				color: proj.color,
				startDate: proj.startDate || '',
				endDate: proj.endDate || '',
				description: proj.description,
				stage: proj.stage ?? 0,
				type: proj.type ?? 'stage',
			},
			onSave: (data) => {
				void this.updateProjectFile(proj, data);
			},
		}).open();
	}

	/** Update existing project-{name}.md frontmatter */
	private async updateProjectFile(proj: ProjectInfo, data: { name: string; color: string; startDate: string; endDate: string; description: string; stage: number; type: ProjectType }): Promise<void> {
		// Config file name derived from folder name
		const folderName = proj.path.split('/').pop() || proj.name;
		const projectFilePath = `${proj.path}/project-${folderName}.md`;
		const file = this.app.vault.getAbstractFileByPath(projectFilePath);
		if (!(file instanceof TFile)) return;

		const typeLabel = data.type === 'nostage' ? '\u975E\u9636\u6BB5\u9879\u76EE' : '\u9636\u6BB5\u9879\u76EE';
		await this.writeFrontmatter(file, {
			'\u9879\u76EE\u540D\u79F0': data.name,
			'\u989C\u8272': `"${data.color}"`,
			'\u9879\u76EE\u7C7B\u578B': typeLabel,
			'\u63CF\u8FF0': data.description,
			'\u5F00\u59CB\u65E5\u671F': data.startDate,
			'\u7ED3\u675F\u65E5\u671F': data.endDate,
			'\u9636\u6BB5': String(data.stage),
		});
		this.showToast('\u2728 \u9879\u76EE\u5DF2\u66F4\u65B0');
		await this.refreshProjectOverview();
	}

	/** Delete project with confirmation */
	private async deleteProject(proj: ProjectInfo, sidebar: HTMLElement): Promise<void> {
		const confirmed = confirm(`\u786E\u5B9A\u5220\u9664\u9879\u76EE "${proj.name}" \u53CA\u5176\u6240\u6709\u4EFB\u52A1\u6587\u4EF6\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`);
		if (!confirmed) return;

		const folder = this.app.vault.getAbstractFileByPath(proj.path);
		if (folder instanceof TFolder) {
			await this.app.fileManager.trashFile(folder);
			this.showToast('\u274C \u9879\u76EE\u5DF2\u5220\u9664: ' + proj.name);
			await this.refreshProjectOverview();
		}
	}

	/** Sort currentProjects by the persisted sidebar order (new projects go last) */
	private applyProjectOrder(): void {
		const order = this.plugin.settings.poProjectOrder;
		if (!order || order.length === 0) return;
		this.currentProjects.sort((a, b) => {
			const ia = order.indexOf(a.name);
			const ib = order.indexOf(b.name);
			const wa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
			const wb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
			return wa - wb;
		});
	}

	/** Refresh project overview data and re-render */
	private async refreshProjectOverview(): Promise<void> {
		// Only meaningful while the project overview is the active board.
		if (this.currentPage !== 'project') return;
		const projects = await this.taskStore.scanAllProjects();
		const allTasks = await this.taskStore.scanAllTasks();
		// 异步扫描期间用户可能已切页；渲染前重校验，避免把项目页内容渲染进其它页面。
		if (this.currentPage !== 'project' || !this.boardEl) return;
		this.currentProjects = projects;
		this.currentTasks = allTasks;
		this.applyProjectOrder();

		// Re-render sidebar and panels
		const sidebar = this.boardEl?.querySelector('.po-sidebar') as HTMLElement;
		if (sidebar) this.renderProjectSidebar(sidebar);
		this.renderProjectOverviewPanels();
	}

	private showDashboard(): void {
		if (!this.boardEl) return;
		this.boardEl.empty();
		this.boardEl.removeClass('po-board');
		this.boardEl.removeClass('op-board');
		this.boardEl.addClass('ad-board');
		this.currentPage = 'home';
		// Re-render all dashboard cards
		this.renderQuickCapture(this.boardEl);
		void this.renderTodo(this.boardEl);
		void this.renderProgress(this.boardEl);
		void this.renderWeekly(this.boardEl);
		void this.renderProjects(this.boardEl);
		this.renderHeatmap(this.boardEl);
		this.renderCountdown(this.boardEl);
	}

	/* ---- Gantt Panel (ported architecture: SVG axis + left labels / right scroll) ---- */
	private renderGanttPanel(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		// Apply Gantt status filter (multi-select) — like reference obsidian-pm FilterDropdown
		if (this.ganttStatusFilter.length > 0) {
			tasks = tasks.filter((t) => this.ganttStatusFilter.includes(t.status));
		}

		// Filter tasks that have at least one date (used only for the timeline range)
		const tasksWithDates = tasks.filter((t) => t.startDate || t.dueDate);

		if (tasks.length === 0) {
			panel.createDiv({ cls: 'po-empty', text: '暂无任务数据' });
			return;
		}

		// ---------- Build parent/child hierarchy from the FULL task list ----------
		// Reference obsidian-pm builds the tree from ALL tasks, then renders. A parent
		// task without dates must still be in the tree so its children get the correct
		// indentation level — otherwise every task falls back to level 0 and nothing indents.
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		const taskByName = new Map<string, TaskItem>();
		const taskById = new Map<string, TaskItem>();
		tasks.forEach((t) => {
			taskByName.set(t.content, t);
			taskById.set(t.id, t);
		});

		const childrenOf = new Map<string, TaskItem[]>();
		const rootTasks: TaskItem[] = [];
		tasks.forEach((t) => {
			if (t.parent && (taskByName.has(t.parent) || taskById.has(t.parent))) {
				const parentTask = taskByName.get(t.parent) || taskById.get(t.parent);
				const parentKey = parentTask ? parentTask.content : t.parent;
				const children = childrenOf.get(parentKey) || [];
				children.push(t);
				childrenOf.set(parentKey, children);
			} else {
				rootTasks.push(t);
			}
		});

		// Group root tasks by left sidebar project order; time-sub-sort within each project
		const projOrder = projects.map((p) => p.name);
		const byProject: Record<string, TaskItem[]> = {};
		const ungrouped: TaskItem[] = [];
		for (const t of rootTasks) {
			const pi = projOrder.indexOf(t.projectId);
			if (pi >= 0) {
				if (!byProject[t.projectId]) byProject[t.projectId] = [];
				byProject[t.projectId]!.push(t);
			} else {
				ungrouped.push(t);
			}
		}
		const timeSort = (a: TaskItem, b: TaskItem): number => {
			const sa = a.startDate || '9999-12-31';
			const sb = b.startDate || '9999-12-31';
			if (sa !== sb) return sa.localeCompare(sb);
			const da = a.dueDate || '';
			const db = b.dueDate || '';
			if (da !== db) return da.localeCompare(db);
			return a.content.localeCompare(b.content);
		};
		// Apply manual drag order WITHIN each project group (so it never overrides the
		// required project-level grouping). Falls back to time sort when no manual order.
		const manualOrder = this.plugin.settings.poTaskOrder || [];
		const manualIdx = new Map<string, number>();
		manualOrder.forEach((id, i) => manualIdx.set(id, i));
		const groupSort = (a: TaskItem, b: TaskItem): number => {
			const ia = manualIdx.has(a.id) ? (manualIdx.get(a.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
			const ib = manualIdx.has(b.id) ? (manualIdx.get(b.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
			if (ia !== ib) return ia - ib;
			return timeSort(a, b);
		};
		const groupedRoots: TaskItem[] = [];
		for (const p of projOrder) {
			if (byProject[p]) groupedRoots.push(...byProject[p].slice().sort(groupSort));
		}
		groupedRoots.push(...ungrouped.slice().sort(groupSort));
		rootTasks.length = 0;
		rootTasks.push(...groupedRoots);

		// Flatten in tree order — every task gets a row; level drives label indentation.
		// Root tasks keep the project-group order built above; children are time-sorted
		// within their parent. This makes the Gantt follow the left sidebar project order
		// (and re-order when the project order changes).
		const orderedTasks: TaskItem[] = [];
		const taskLevels = new Map<string, number>();
		const flattenWithLevel = (taskList: TaskItem[], level: number): void => {
			const list = level === 0 ? taskList : [...taskList].sort(timeSort);
			for (const t of list) {
				orderedTasks.push(t);
				taskLevels.set(t.id, Math.min(level, 3));
				const kids = childrenOf.get(t.content) || [];
				// Skip children of collapsed parents (collapse/expand via arrow)
				if (kids.length && !this.collapsedParents.has(t.content)) flattenWithLevel(kids, level + 1);
			}
		};
		flattenWithLevel(rootTasks, 0);

		// Manual task order is already applied per-project-group above (groupSort), so it
		// never overrides the project-level grouping required by the sorting spec.

		// ---------- Timeline config: linear per-day width, like obsidian-pm ----------
		const granularity: 'day' | 'week' | 'month' | 'quarter' = this.ganttZoom || 'week';
		const DAY_WIDTH: Record<string, number> = { day: 36, week: 16, month: 7, quarter: 4 };
		const MIN_DAYS: Record<string, number> = { day: 30, week: 90, month: 365, quarter: 365 };
		const dayWidth = DAY_WIDTH[granularity] ?? 16;
		const HEADER_HEIGHT = 56;
		const ROW_HEIGHT = 34;

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// Raw date range from data + today + padding
	let minD = new Date('2099-12-31T00:00:00');
	let maxD = new Date('2000-01-01T00:00:00');
		tasksWithDates.forEach((t) => {
			if (t.startDate) {
				const s = new Date(t.startDate + 'T00:00:00');
				if (!isNaN(s.getTime()) && s < minD) minD = new Date(s);
			}
			if (t.dueDate) {
				const e = new Date(t.dueDate + 'T00:00:00');
				if (!isNaN(e.getTime()) && e > maxD) maxD = new Date(e);
			}
		});
		if (today < minD) minD = new Date(today);
		if (today > maxD) maxD = new Date(today);
		minD.setDate(minD.getDate() - 7);
		maxD.setDate(maxD.getDate() + 14);

		// Enforce a minimum visible span per granularity so the axis is always wide enough
		const minDaysForZoom = MIN_DAYS[granularity] ?? 30;
		let spanDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000);
		if (spanDays < minDaysForZoom) {
			const extra = Math.ceil((minDaysForZoom - spanDays) / 2);
			minD.setDate(minD.getDate() - extra);
			maxD.setDate(maxD.getDate() + extra);
		}

		// Snap the start to the 1st of the month for non-day granularities (cleaner headers)
		if (granularity !== 'day') {
			minD = new Date(minD.getFullYear(), minD.getMonth(), 1);
		}

		const totalDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000);
		const totalWidth = totalDays * dayWidth;

		// date -> x (px)
		const dateToX = (d: Date): number => {
			const dd = new Date(d);
			dd.setHours(0, 0, 0, 0);
			return Math.round((dd.getTime() - minD.getTime()) / 86400000) * dayWidth;
		};
		// x (px) -> date
		const xToDate = (x: number): Date => {
			const d = new Date(minD);
			d.setDate(d.getDate() + Math.round(x / dayWidth));
			return d;
		};

		// ISO 8601 week number (1-53)
		const isoWeek = (d: Date): number => {
			const t = new Date(d);
			t.setHours(0, 0, 0, 0);
			t.setDate(t.getDate() + 4 - (t.getDay() || 7));
			const yearStart = new Date(t.getFullYear(), 0, 1);
			return Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
		};

		// ---------- SVG helper ----------
		const SVGNS = 'http://www.w3.org/2000/svg';
		const svgEl = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
			const el = document.createElementNS(SVGNS, tag);
			for (const k in attrs) el.setAttribute(k, String(attrs[k]));
			return el;
		};
		const svgText = (x: number, y: number, text: string, cls: string): SVGTextElement => {
			const t = svgEl('text', { x, y, class: cls }) as SVGTextElement;
			t.textContent = text;
			return t;
		};

		// ---------- DOM scaffold ----------
		const zoomBar = panel.createDiv({ cls: 'po-gantt__zoom' });
		const zoomLevels: Array<{ key: string; label: string }> = [
			{ key: 'day', label: '日' },
			{ key: 'week', label: '周' },
			{ key: 'month', label: '月' },
			{ key: 'quarter', label: '季度' },
		];
		zoomLevels.forEach((z) => {
			const btn = zoomBar.createEl('button', { cls: 'po-gantt__zoom-btn' + (z.key === granularity ? ' is-active' : ''), text: z.label });
			btn.addEventListener('click', () => {
				this.ganttZoom = z.key as typeof this.ganttZoom;
				panel.empty();
				this.renderGanttPanel(panel, tasks, projects);
			});
		});

		// Status filter (multi-select) — modeled on reference obsidian-pm FilterDropdown
		zoomBar.createSpan({ cls: 'po-gantt__sep' });
		const filterBtn = zoomBar.createEl('button', { cls: 'po-gantt__zoom-btn' + (this.ganttStatusFilter.length ? ' is-active' : '') });
		const updateFilterLabel = (): void => {
			filterBtn.textContent = this.ganttStatusFilter.length ? `状态: ${this.ganttStatusFilter.length}` : '状态筛选';
			filterBtn.toggleClass('is-active', this.ganttStatusFilter.length > 0);
		};
		updateFilterLabel();
		filterBtn.addEventListener('click', (e) => {
			const menu = new Menu();
			for (const st of STATUS_LIST) {
				menu.addItem((item) => item
					.setTitle(st)
					.setChecked(this.ganttStatusFilter.includes(st))
					.onClick(() => {
					const idx = this.ganttStatusFilter.indexOf(st);
					if (idx >= 0) this.ganttStatusFilter.splice(idx, 1);
					else this.ganttStatusFilter.push(st);
					updateFilterLabel();
					this.plugin.settings.poGanttStatusFilter = [...this.ganttStatusFilter];
					void this.plugin.saveSettings();
					this.renderProjectOverviewPanels();
				}));
			}
			if (this.ganttStatusFilter.length) {
				menu.addSeparator();
				menu.addItem((item) => item.setTitle('清除筛选').onClick(() => {
				this.ganttStatusFilter.length = 0;
				updateFilterLabel();
				this.plugin.settings.poGanttStatusFilter = [];
				void this.plugin.saveSettings();
				this.renderProjectOverviewPanels();
				}));
			}
			menu.showAtMouseEvent(e);
		});

		const gantt = panel.createDiv({ cls: 'po-gantt' });
		const wrapper = gantt.createDiv({ cls: 'po-gantt__wrap' });

		// Left panel: task labels
		const left = wrapper.createDiv({ cls: 'po-gantt__left' });
		const leftHeader = left.createDiv({ cls: 'po-gantt__left-hd' });
		leftHeader.style.height = HEADER_HEIGHT + 'px';
		leftHeader.createSpan({ text: '任务名称', cls: 'po-gantt__left-hd-label' });
		const leftBody = left.createDiv({ cls: 'po-gantt__left-body' });

		// Right panel: scrollable SVG timeline
		const right = wrapper.createDiv({ cls: 'po-gantt__right' });

		// Sticky header (SVG) — pinned to top on vertical scroll, scrolls horizontally with body
		const headerSticky = right.createDiv({ cls: 'po-gantt__hdr-sticky' });
		headerSticky.style.width = totalWidth + 'px';
		headerSticky.style.height = HEADER_HEIGHT + 'px';
		const headerSvg = svgEl('svg', { width: totalWidth, height: HEADER_HEIGHT, class: 'po-gantt__hdr-svg' }) as SVGSVGElement;
		headerSticky.appendChild(headerSvg);

		// Timeline SVG — tucked under the sticky header via negative margin-top
		const svgWrap = right.createDiv({ cls: 'po-gantt__svgwrap' });
		svgWrap.style.width = totalWidth + 'px';
		svgWrap.style.marginTop = `-${HEADER_HEIGHT}px`;
		const totalRows = orderedTasks.length;
		const svgHeight = HEADER_HEIGHT + (totalRows + 1) * ROW_HEIGHT;
		const svg = svgEl('svg', { width: totalWidth, height: svgHeight, class: 'po-gantt__svg' }) as SVGSVGElement;
		svgWrap.appendChild(svg);

		// ---------- Header rendering ----------
		headerSvg.appendChild(svgEl('rect', { x: 0, y: 0, width: totalWidth, height: HEADER_HEIGHT, class: 'po-gantt__hdr-bg' }));

		const renderMonthBands = (y: number, h: number): void => {
			let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
			while (m < maxD) {
				const nm = new Date(m.getFullYear(), m.getMonth() + 1, 1);
				const x1 = Math.max(0, dateToX(m));
				const x2 = Math.min(totalWidth, dateToX(nm));
				headerSvg.appendChild(svgEl('rect', {
					x: x1, y, width: Math.max(0, x2 - x1), height: h,
					class: (m.getMonth() % 2 === 0) ? 'po-gantt__band-even' : 'po-gantt__band-odd',
				}));
				headerSvg.appendChild(svgText(x1 + 6, y + h - 7, (m.getMonth() + 1) + '月', 'po-gantt__hdr-month-top'));
				m = nm;
			}
		};
		const renderYearBands = (y: number, h: number): void => {
			let yd = new Date(minD.getFullYear(), 0, 1);
			while (yd < maxD) {
				const ny = new Date(yd.getFullYear() + 1, 0, 1);
				const x1 = Math.max(0, dateToX(yd));
				const x2 = Math.min(totalWidth, dateToX(ny));
				headerSvg.appendChild(svgEl('rect', {
					x: x1, y, width: Math.max(0, x2 - x1), height: h,
					class: (yd.getFullYear() % 2 === 0) ? 'po-gantt__band-even' : 'po-gantt__band-odd',
				}));
				headerSvg.appendChild(svgText(x1 + 6, y + h - 7, String(yd.getFullYear()), 'po-gantt__hdr-year'));
				yd = ny;
			}
		};

		if (granularity === 'day') {
			renderMonthBands(0, 24);
			for (let i = 0; i < totalDays; i++) {
				const d = new Date(minD); d.setDate(d.getDate() + i);
				const x = i * dayWidth;
				const isWeekend = d.getDay() === 0 || d.getDay() === 6;
				if (isWeekend) {
					headerSvg.appendChild(svgEl('rect', { x, y: 24, width: dayWidth, height: HEADER_HEIGHT - 24, class: 'po-gantt__hdr-weekend' }));
				}
				if (dayWidth >= 20) {
					headerSvg.appendChild(svgText(x + dayWidth / 2, 42, String(d.getDate()), 'po-gantt__hdr-day'));
				}
			}
		} else if (granularity === 'week') {
			renderMonthBands(0, 24);
			const nativeDow = minD.getDay();
			const isoDow = nativeDow === 0 ? 7 : nativeDow;
			const offsetToMonday = isoDow === 1 ? 0 : 8 - isoDow;
			if (offsetToMonday > 0) {
				headerSvg.appendChild(svgText((offsetToMonday * dayWidth) / 2, 44, 'W' + isoWeek(minD), 'po-gantt__hdr-week'));
			}
			let i = offsetToMonday;
			while (i < totalDays) {
				const d = new Date(minD); d.setDate(d.getDate() + i);
				const x = i * dayWidth;
				const daysInWeek = Math.min(7, totalDays - i);
				const w = daysInWeek * dayWidth;
				headerSvg.appendChild(svgText(x + w / 2, 44, 'W' + isoWeek(d), 'po-gantt__hdr-week'));
				headerSvg.appendChild(svgEl('line', { x1: x, y1: 24, x2: x, y2: HEADER_HEIGHT, class: 'po-gantt__hdr-tick' }));
				i += 7;
			}
		} else if (granularity === 'month') {
			renderYearBands(0, 24);
			let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
			while (m < maxD) {
				const nm = new Date(m.getFullYear(), m.getMonth() + 1, 1);
				const x1 = Math.max(0, dateToX(m));
				const x2 = Math.min(totalWidth, dateToX(nm));
				headerSvg.appendChild(svgText(x1 + (x2 - x1) / 2, 44, (m.getMonth() + 1) + '月', 'po-gantt__hdr-month'));
				headerSvg.appendChild(svgEl('line', { x1, y1: 24, x2: x1, y2: HEADER_HEIGHT, class: 'po-gantt__hdr-tick' }));
				m = nm;
			}
		} else {
			renderYearBands(0, 24);
			let q = new Date(minD.getFullYear(), Math.floor(minD.getMonth() / 3) * 3, 1);
			while (q < maxD) {
				const nq = new Date(q.getFullYear(), q.getMonth() + 3, 1);
				const x1 = Math.max(0, dateToX(q));
				const x2 = Math.min(totalWidth, dateToX(nq));
				const qq = Math.floor(q.getMonth() / 3) + 1;
				headerSvg.appendChild(svgText(x1 + (x2 - x1) / 2, 44, 'Q' + qq + ' ' + q.getFullYear(), 'po-gantt__hdr-quarter'));
				headerSvg.appendChild(svgEl('line', { x1, y1: 24, x2: x1, y2: HEADER_HEIGHT, class: 'po-gantt__hdr-tick' }));
				q = nq;
			}
		}

		// ---------- Grid lines + weekend shading ----------
		for (let i = 0; i < totalDays; i++) {
			const d = new Date(minD); d.setDate(d.getDate() + i);
			const x = i * dayWidth;
			const isWeekend = d.getDay() === 0 || d.getDay() === 6;
			const isFirst = d.getDate() === 1;
			const isQuarterStart = isFirst && d.getMonth() % 3 === 0;

			if (isWeekend && granularity === 'day') {
				svg.appendChild(svgEl('rect', { x, y: HEADER_HEIGHT, width: dayWidth, height: svgHeight - HEADER_HEIGHT, class: 'po-gantt__weekend' }));
			}
			const drawV = (granularity === 'day' && (d.getDay() === 1)) ||
				(granularity === 'week' && (d.getDay() === 1)) ||
				(granularity === 'month' && isFirst) ||
				(granularity === 'quarter' && isQuarterStart);
			if (drawV) {
				svg.appendChild(svgEl('line', { x1: x, y1: HEADER_HEIGHT, x2: x, y2: svgHeight, class: 'po-gantt__gridline-v' }));
			}
		}
		for (let r = 0; r <= totalRows; r++) {
			const y = HEADER_HEIGHT + r * ROW_HEIGHT;
			svg.appendChild(svgEl('line', { x1: 0, y1: y, x2: totalWidth, y2: y, class: 'po-gantt__gridline-h' }));
		}

		// ---------- Today line ----------
		const todayX = dateToX(today);
		if (todayX >= 0 && todayX <= totalWidth) {
			svg.appendChild(svgEl('line', { x1: todayX, y1: HEADER_HEIGHT - 8, x2: todayX, y2: svgHeight, class: 'po-gantt__today' }));
			headerSvg.appendChild(svgEl('polygon', {
				points: `${todayX},${HEADER_HEIGHT - 16} ${todayX + 6},${HEADER_HEIGHT - 8} ${todayX},${HEADER_HEIGHT} ${todayX - 6},${HEADER_HEIGHT - 8}`,
				class: 'po-gantt__today-diamond',
			}));
		}

		// ---------- Tooltip ----------
		const tooltip = panel.createDiv({ cls: 'po-gantt__tooltip' });

		// ---------- Task bars (SVG rects) + left labels ----------
		const bars: SVGElement[] = [];
		const labelRows: HTMLElement[] = [];
		orderedTasks.forEach((t, idx) => {
			const level = taskLevels.get(t.id) || 0;
			const isParent = childrenOf.has(t.content);
			const color = colorMap[t.projectId] || '#3b82f6';

			// Left label row (indentation by depth)
			const lr = leftBody.createDiv({ cls: 'po-gantt__label-row' + (level > 0 ? ' po-gantt__label-row--child' : '') });
			lr.style.height = ROW_HEIGHT + 'px';
			lr.style.paddingLeft = (level * 18 + 8) + 'px';
			lr.dataset.taskId = t.id;
			if (isParent) {
				const collapsed = this.collapsedParents.has(t.content);
				const dot = lr.createSpan({ cls: 'po-gantt__label-dot', text: collapsed ? '▸' : '▾' });
				dot.addEventListener('click', (e) => {
					e.stopPropagation();
					if (collapsed) this.collapsedParents.delete(t.content);
					else this.collapsedParents.add(t.content);
					panel.empty();
					this.renderGanttPanel(panel, tasks, projects);
				});
			}
			lr.createSpan({ cls: 'po-gantt__label-title', text: t.content });
			const addBtn = lr.createSpan({ cls: 'po-gantt__label-add', text: '+' });
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.openTaskModalWithParent(t.content, t.projectId);
			});
			lr.addEventListener('click', () => this.openTaskEditModal(t));
			// Right-click context menu: edit / delete
			lr.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle('任务详情').setIcon('pencil').onClick(() => this.openTaskEditModal(t));
				});
				menu.addItem((item) => {
					item.setTitle('删除任务').setIcon('trash').onClick(() => void this.deleteTask(t));
				});
				menu.showAtMouseEvent(e);
			});

			// Drag to reorder task rows (persisted)
			lr.draggable = true;
			lr.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/task-id', t.id);
				lr.addClass('po-row--dragging');
			});
			lr.addEventListener('dragend', () => lr.removeClass('po-row--dragging'));
			lr.addEventListener('dragover', (e) => { e.preventDefault(); lr.addClass('po-row--drag-over'); });
			lr.addEventListener('dragleave', () => lr.removeClass('po-row--drag-over'));
			lr.addEventListener('drop', (e) => {
				e.preventDefault();
				lr.removeClass('po-row--drag-over');
				const draggedId = e.dataTransfer?.getData('text/task-id');
				if (!draggedId || draggedId === t.id) return;
				const rows = Array.from(leftBody.querySelectorAll<HTMLElement>('.po-gantt__label-row'));
				const ids = rows.map((r) => r.dataset.taskId).filter((id): id is string => !!id);
				const from = ids.indexOf(draggedId);
				const to = ids.indexOf(t.id);
				if (from < 0 || to < 0) return;
			ids.splice(from, 1);
			ids.splice(from < to ? to - 1 : to, 0, draggedId);
				this.plugin.settings.poTaskOrder = ids;
				void this.plugin.saveSettings();
				this.renderProjectOverviewPanels();
			});

			labelRows.push(lr);

			// Bar
			if (!t.startDate && !t.dueDate) return;
		const startDate = t.startDate ? new Date(t.startDate + 'T00:00:00') : new Date(t.dueDate! + 'T00:00:00');
		const endDate = t.dueDate ? new Date(t.dueDate + 'T00:00:00') : new Date(startDate);
			if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return;
			const x = dateToX(startDate);
			const xEnd = dateToX(new Date(endDate.getTime() + 86400000));
			const width = Math.max(2, xEnd - x);
			const barCls = 'po-gantt__bar' + (t.status === '已完成' ? ' is-completed' : '') +
				(isParent ? ' po-gantt__bar--parent' : '') + (level > 0 ? ' po-gantt__bar--child' : '');
			const bar = svgEl('rect', {
				x, y: HEADER_HEIGHT + idx * ROW_HEIGHT + 8, width, height: ROW_HEIGHT - 16, rx: 4, class: barCls,
			}) as SVGRectElement;
			bar.setAttribute('fill', color);
			bar.dataset.taskId = t.id;
			(bar as SVGElement & { _dragged?: boolean })._dragged = false;
			bars.push(bar);

			// Tooltip on hover
			bar.addEventListener('mouseenter', (e: MouseEvent) => {
				const prioLabel = t.priority || '未设置';
				tooltip.empty();
				tooltip.createEl('strong', { text: t.content });
				tooltip.createEl('br');
				tooltip.appendText((t.startDate || '?') + ' → ' + (t.dueDate || '?'));
				tooltip.createEl('br');
				tooltip.appendText(prioLabel + ' · ' + t.status);
				tooltip.addClass('is-visible');
				this.positionTooltip(tooltip, e);
			});
			bar.addEventListener('mousemove', (e: MouseEvent) => this.positionTooltip(tooltip, e));
			bar.addEventListener('mouseleave', () => tooltip.removeClass('is-visible'));

			// Click: edit + link highlight
			bar.addEventListener('click', () => {
				if ((bar as SVGElement & { _dragged?: boolean })._dragged) {
					(bar as SVGElement & { _dragged?: boolean })._dragged = false;
					return;
				}
				this.openTaskEditModal(t);
				this.clearHighlights(bars, tableRows);
				if (tableRows[idx]) {
					tableRows[idx].addClass('po-row--highlight');
					tableRows[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
					this.highlightedRow = tableRows[idx];
				}
				bar.classList.add('po-bar--highlight');
				this.highlightedBar = bar;
			});

			// Drag to move / resize
			bar.addEventListener('mousedown', (e: MouseEvent) => {
				e.preventDefault();
				const rect = bar.getBoundingClientRect();
				const edge = 8;
				const isLeft = (e.clientX - rect.left) < edge;
				const isRight = (rect.right - e.clientX) < edge;
				const startX = e.clientX;
				const origX = parseFloat(bar.getAttribute('x') || '0');
				const origW = parseFloat(bar.getAttribute('width') || '0');
				let moved = false;

				const onMove = (ev: MouseEvent) => {
					const dx = ev.clientX - startX;
					if (Math.abs(dx) < 3) return;
					moved = true;
					if (isLeft) {
						const nx = Math.max(0, origX + dx);
						const nw = origW - (nx - origX);
						if (nw >= dayWidth) { bar.setAttribute('x', String(nx)); bar.setAttribute('width', String(nw)); }
					} else if (isRight) {
						bar.setAttribute('width', String(Math.max(dayWidth, origW + dx)));
					} else {
						bar.setAttribute('x', String(origX + dx));
					}
				};
				const onUp = () => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
					if (!moved) return;
					(bar as SVGElement & { _dragged?: boolean })._dragged = true;
					tooltip.removeClass('is-visible');
					const nx = parseFloat(bar.getAttribute('x') || '0');
					const nw = parseFloat(bar.getAttribute('width') || '0');
					const startD = xToDate(nx);
					const endD = xToDate(nx + nw);
					endD.setDate(endD.getDate() - 1); // inclusive end day
					void this.updateTaskDates(t, fmtDate(startD), fmtDate(endD));
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
			});

			svg.appendChild(bar);
		});

		// ---------- Scroll sync (right <-> left) ----------
		const syncSpacer = (): void => {
			const hBar = right.offsetHeight - right.clientHeight;
			leftBody.style.paddingBottom = hBar + 'px';
		};
		right.addEventListener('scroll', () => {
			syncSpacer();
			leftBody.scrollTop = right.scrollTop;
		});
		left.addEventListener('wheel', (e: WheelEvent) => {
			right.scrollTop += e.deltaY;
			right.scrollLeft += e.deltaX;
			e.preventDefault();
		}, { passive: false });

		// ---------- Center today line on load ----------
		const scrollToToday = (): void => {
			if (!right.clientWidth) return;
			right.scrollLeft = Math.max(0, todayX - right.clientWidth / 2);
		};
		window.requestAnimationFrame(() => {
			syncSpacer();
			scrollToToday();
		});

		// ---------- Resize handle + task table (kept from original) ----------
		const resizeHandle = panel.createDiv({ cls: 'po-resize' });
		this.setupResizeHandle(resizeHandle, gantt);

		const tableRows = this.renderTaskTable(panel, 'po-tb1', tasks, projects);

		tableRows.forEach((row, idx) => {
			row.addEventListener('click', () => {
				this.clearHighlights(bars, tableRows);
				if (bars[idx]) {
					bars[idx].classList.add('po-bar--highlight');
					this.highlightedBar = bars[idx];
				}
				row.addClass('po-row--highlight');
				this.highlightedRow = row;
			});
		});
	}

	private positionTooltip(tooltip: HTMLElement, e: MouseEvent): void {
		const parent = tooltip.parentElement;
		if (!parent) return;
		const rect = parent.getBoundingClientRect();
		tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
		tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
	}

	private clearHighlights(bars: Element[], rows: HTMLElement[]): void {
		if (this.highlightedBar) { this.highlightedBar.classList.remove('po-bar--highlight'); this.highlightedBar = null; }
		if (this.highlightedRow) { this.highlightedRow.removeClass('po-row--highlight'); this.highlightedRow = null; }
		bars.forEach((b) => b.classList.remove('po-bar--highlight'));
		rows.forEach((r) => r.removeClass('po-row--highlight'));
	}

	private setupResizeHandle(handle: HTMLElement, gantt: HTMLElement): void {
		let startY = 0;
		let startH = 0;
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			startY = e.clientY;
			startH = gantt.offsetHeight;
			const onMove = (ev: MouseEvent) => {
				const dh = ev.clientY - startY;
				gantt.addClass('po-gantt--resized');
				gantt.style.height = Math.max(100, startH + dh) + 'px';
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	/** Update task start/due dates in source file */
	private async updateTaskDates(task: TaskItem, newStart: string, newEnd: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		let inFM = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') { inFM = !inFM; continue; }
			if (!inFM) continue;
			if (line.startsWith('\u5F00\u59CB\u65E5\u671F:')) lines[i] = `\u5F00\u59CB\u65E5\u671F: ${newStart}`;
			else if (line.startsWith('\u622A\u6B62\u65E5\u671F:')) lines[i] = `\u622A\u6B62\u65E5\u671F: ${newEnd}`;
		}

		await this.app.vault.modify(file, lines.join('\n'));
		task.startDate = newStart;
		task.dueDate = newEnd;
	}

	/* ---- Task Table ---- */
	private renderTaskTable(panel: HTMLElement, tbodyId: string, tasks: TaskItem[], projects: ProjectInfo[]): HTMLElement[] {
		const section = panel.createDiv({ cls: 'po-tasklist' });
		const toolbar = section.createDiv({ cls: 'po-toolbar' });
		toolbar.createSpan({ cls: 'po-toolbar__label', text: '\u7B5B\u9009' });
		['\u5168\u90E8', '\u5F85\u529E', '\u8FDB\u884C\u4E2D', '\u5DF2\u963B\u585E', '\u5DF2\u5B8C\u6210'].forEach((f, i) => {
			const key = i === 0 ? 'all' : f;
			const chip = toolbar.createEl('button', { cls: 'po-chip' + (key === this.taskListFilter ? ' is-active' : ''), text: f });
			chip.dataset.filter = key;
		});

		const wrap = section.createDiv({ cls: 'po-table-wrap' });
		const table = wrap.createEl('table', { cls: 'po-table' });
		const thead = table.createEl('thead');
		const hr = thead.createEl('tr');
		const colDefs = [
			{ key: '', label: '' },
			{ key: 'name', label: '\u4EFB\u52A1\u540D\u79F0' },
			{ key: 'priority', label: '\u4F18\u5148\u7EA7' },
			{ key: 'startDate', label: '\u5F00\u59CB' },
			{ key: 'dueDate', label: '\u622A\u6B62' },
			{ key: 'status', label: '\u72B6\u6001' },
			{ key: 'project', label: '\u9879\u76EE' },
		];

		const thEls: HTMLElement[] = [];
		colDefs.forEach((col) => {
			const th = hr.createEl('th', { text: col.label });
			th.dataset.sortKey = col.key;
			thEls.push(th);
			if (col.key) {
				th.addClass('po-th--sortable');
				th.createSpan({ cls: 'po-sort-arrow' });
			}
		});

		const tbody = table.createEl('tbody');
		tbody.id = tbodyId;

		// Sort tasks
		let sortedTasks = [...tasks];
		const applySort = () => {
			if (!this.sortCol) { sortedTasks = [...tasks]; return; }
			sortedTasks = [...tasks].sort((a, b) => {
				let va = '', vb = '';
				switch (this.sortCol) {
					case 'name': va = a.content; vb = b.content; break;
					case 'priority': va = String(priorityWeight(a.priority)); vb = String(priorityWeight(b.priority)); break;
					case 'startDate': va = a.startDate || 'zzz'; vb = b.startDate || 'zzz'; break;
					case 'dueDate': va = a.dueDate || 'zzz'; vb = b.dueDate || 'zzz'; break;
					case 'status': va = a.status; vb = b.status; break;
					case 'project': va = a.projectId; vb = b.projectId; break;
				}
				const cmp = va.localeCompare(vb, 'zh-CN');
				return this.sortDir === 'asc' ? cmp : -cmp;
			});
		};
		applySort();

		const tableRows = this.fillPoTable(tbody, sortedTasks, projects);

		// Sort click
		thead.addEventListener('click', (e) => {
			const th = (e.target as HTMLElement).closest('th') as HTMLElement;
			if (!th?.dataset.sortKey) return;
			const key = th.dataset.sortKey;
			if (this.sortCol === key) {
				this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
			} else {
				this.sortCol = key;
				this.sortDir = 'asc';
			}
			// Update arrows
			thEls.forEach((h) => {
				const arrow = h.querySelector('.po-sort-arrow');
				if (arrow) arrow.textContent = '';
			});
			const arrow = th.querySelector('.po-sort-arrow');
			if (arrow) arrow.textContent = this.sortDir === 'asc' ? ' \u2191' : ' \u2193';

			applySort();
			tbody.empty();
			this.fillPoTable(tbody, sortedTasks, projects);
			this.applyTaskFilter(tbody);
		});

		// Filter click
		toolbar.addEventListener('click', (e) => {
			const chip = (e.target as HTMLElement).closest('.po-chip') as HTMLElement;
			if (!chip) return;
			toolbar.querySelectorAll('.po-chip').forEach((c) => c.removeClass('is-active'));
			chip.addClass('is-active');
			this.taskListFilter = chip.dataset.filter ?? 'all';
			this.applyTaskFilter(tbody);
		});

		// Restore persisted filter after (re)render
		this.applyTaskFilter(tbody);

		return tableRows;
	}

	private applyTaskFilter(tbody: HTMLElement): void {
		const filter = this.taskListFilter;
		tbody.querySelectorAll('tr').forEach((row) => {
			const st = (row as HTMLElement).dataset.status ?? '';
			(row as HTMLElement).style.display = (filter === 'all' || st === filter) ? '' : 'none';
		});
	}

	private fillPoTable(tbody: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): HTMLElement[] {
		const statusMap: Record<string, string> = { '\u5F85\u529E':'po-todo', '\u8FDB\u884C\u4E2D':'po-progress', '\u5DF2\u963B\u585E':'po-blocked', '\u5DF2\u5B8C\u6210':'po-done', '\u5DF2\u53D6\u6D88':'po-cancelled' };
		const prioMap: Record<string, string> = { '\u91CD\u8981\u4E14\u7D27\u6025':'po-p-high', '\u91CD\u8981\u4E0D\u7D27\u6025':'po-p-med', '\u7D27\u6025\u4E0D\u91CD\u8981':'po-p-med', '\u4E0D\u91CD\u8981\u4E0D\u7D27\u6025':'po-p-low' };
		const prioShort: Record<string, string> = { '\u91CD\u8981\u4E14\u7D27\u6025':'\u9AD8', '\u91CD\u8981\u4E0D\u7D27\u6025':'\u4E2D', '\u7D27\u6025\u4E0D\u91CD\u8981':'\u4E2D', '\u4E0D\u91CD\u8981\u4E0D\u7D27\u6025':'\u4F4E' };

		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		const rows: HTMLElement[] = [];
		tasks.forEach((t) => {
		const tr = tbody.createEl('tr');
		tr.dataset.taskId = t.id;
		tr.dataset.status = t.status;
		rows.push(tr);

			// Checkbox
			const tdCb = tr.createEl('td');
			const cb = tdCb.createSpan({ cls: 'po-check' + (t.status === '\u5DF2\u5B8C\u6210' ? ' is-done' : '') });
			cb.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.toggleTask(t, tr);
			});

			// Task name (clickable to edit)
			const nameEl = tr.createEl('td', { text: t.content, cls: 'po-name-cell' });
			nameEl.addEventListener('click', () => {
				this.openTaskEditModal(t);
			});

			// Priority
			const tdPrio = tr.createEl('td');
			if (t.priority) tdPrio.createSpan({ cls: 'po-prio ' + (prioMap[t.priority] || ''), text: prioShort[t.priority] || t.priority });

			// Start date
			tr.createEl('td', { cls: 'po-mono', text: t.startDate || '-' });

			// Due date
			tr.createEl('td', { cls: 'po-mono', text: t.dueDate || '-' });

			// Status
			const tdSt = tr.createEl('td');
			tdSt.createSpan({ cls: 'po-status ' + (statusMap[t.status] || ''), text: t.status });

			// Project
			const tdProj = tr.createEl('td');
			const projColor = colorMap[t.projectId] || '#3b82f6';
			tdProj.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + projColor } });
			tdProj.appendText(t.projectId);

			// Right-click context menu
			tr.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle('\u7F16\u8F91').setIcon('pencil').onClick(() => this.openTaskEditModal(t));
				});
				menu.addItem((item) => {
					item.setTitle('\u5220\u9664').setIcon('trash').onClick(() => void this.deleteTask(t));
				});
				menu.addItem((item) => {
					item.setTitle('\u6253\u5F00\u6E90\u6587\u4EF6').setIcon('file-text').onClick(() => {
						if (t.sourceFile) void this.app.workspace.openLinkText(t.sourceFile, '', true);
					});
				});
				menu.showAtMouseEvent(e);
			});
		});
		return rows;
	}

	/** Delete task file from vault */
	private async deleteTask(task: TaskItem): Promise<void> {
		if (!task.sourceFile) return;
		const confirmed = confirm(`\u786E\u5B9A\u5220\u9664\u4EFB\u52A1 "${task.content}"\uFF1F`);
		if (!confirmed) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (file instanceof TFile) {
			await this.app.fileManager.trashFile(file);
			this.showToast('\u274C \u4EFB\u52A1\u5DF2\u5220\u9664: ' + task.content);
			void this.refreshRelevant();
		}
	}

	/* ---- Calendar Panel ---- */
	private renderCalendarPanel(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		const grid = panel.createDiv({ cls: 'po-cal' });

		// Build project color lookup
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		const today = new Date();
		const todayStr = fmtDate(today);

		// Use calYear/calMonth state
		const renderMonth = () => {
			grid.empty();
			const y = this.calYear, m = this.calMonth;
			const dim = new Date(y, m + 1, 0).getDate();
			const fd = new Date(y, m, 1).getDay();
			const adj = fd === 0 ? 6 : fd - 1;

			// Header with navigation
			const header = grid.createDiv({ cls: 'po-cal__header' });
			header.createSpan({ cls: 'po-cal__title', text: y + '\u5E74' + (m + 1) + '\u6708' });
			const nav = header.createDiv({ cls: 'po-cal__nav' });
			const prevBtn = nav.createEl('button', { cls: 'po-cal__btn', text: '\u2190' });
			const todayBtn = nav.createEl('button', { cls: 'po-cal__btn', text: '\u4ECA\u5929' });
			const nextBtn = nav.createEl('button', { cls: 'po-cal__btn', text: '\u2192' });

			prevBtn.addEventListener('click', () => {
				this.calMonth--;
				if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; }
				renderMonth();
			});
			nextBtn.addEventListener('click', () => {
				this.calMonth++;
				if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; }
				renderMonth();
			});
			todayBtn.addEventListener('click', () => {
				this.calYear = today.getFullYear();
				this.calMonth = today.getMonth();
				renderMonth();
			});

			// Weekdays
			const weekdays = grid.createDiv({ cls: 'po-cal__weekdays' });
			['\u4E00', '\u4E8C', '\u4E09', '\u56DB', '\u4E94', '\u516D', '\u65E5'].forEach((d) => weekdays.createSpan({ text: d }));

			// Days
			const days = grid.createDiv({ cls: 'po-cal__days' });
			for (let i = 0; i < adj; i++) days.createDiv({ cls: 'po-cal__day' });
			for (let d = 1; d <= dim; d++) {
				const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
				const isToday = ds === todayStr;
				const dayTasks = tasks.filter((t) => {
					const effectiveDate = t.remindDate || t.dueDate;
					return effectiveDate === ds || t.startDate === ds;
				});
				const hasOverdue = dayTasks.some((t) => t.status !== '\u5DF2\u5B8C\u6210' && t.status !== '\u5DF2\u53D6\u6D88' && t.dueDate && new Date(t.dueDate) < today);
				const cls = 'po-cal__day' + (isToday ? ' is-today' : '') +
					(dayTasks.length ? (hasOverdue ? ' has-overdue has-tasks' : ' has-tasks') : '');
				const dayEl = days.createDiv({ cls, attr: { 'data-date': ds } });
				dayEl.createSpan({ cls: 'po-cal__day-num', text: String(d) });
				// Show up to 3 task names inside the cell
				const shown = dayTasks.slice(0, 3);
				shown.forEach((t) => {
					const taskEl = dayEl.createDiv({ cls: 'po-cal__day-task', text: t.content });
					taskEl.style.color = t.status === '\u5DF2\u5B8C\u6210' ? 'var(--ad-text-dim)' : '';
				});
				if (dayTasks.length > 3) {
					dayEl.createDiv({ cls: 'po-cal__day-more', text: '+' + (dayTasks.length - 3) });
				}
			}

			// Preview area
			const preview = grid.createDiv({ cls: 'po-cal__preview', text: '\u70B9\u51FB\u65E5\u671F\u67E5\u770B\u5F53\u5929\u4EFB\u52A1' });

			// Click date to show tasks
			grid.addEventListener('click', (e) => {
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (!dayEl || !dayEl.dataset.date) return;
				const dt = dayEl.dataset.date;
				const dayTasks = tasks.filter((t) => {
					const effectiveDate = t.remindDate || t.dueDate;
					return effectiveDate === dt || t.startDate === dt;
				});
				preview.empty();
				if (dayTasks.length) {
					dayTasks.forEach((t) => {
						const row = preview.createDiv({ cls: 'po-cal__task' });
						row.draggable = true;
						row.dataset.taskId = t.id;
						const projColor = colorMap[t.projectId] || '#3b82f6';
						row.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + projColor } });
						const nameSpan = row.createSpan({ cls: 'po-cal__task-name po-clickable', text: t.content });
						nameSpan.addEventListener('click', (ev) => {
							ev.stopPropagation();
							this.openTaskEditModal(t);
						});
						row.createSpan({ cls: 'po-status ' + (t.status === '\u5DF2\u5B8C\u6210' ? 'po-done' : 'po-todo'), text: t.status });

						// Drag to move task to another date
						row.addEventListener('dragstart', (ev) => {
							ev.dataTransfer?.setData('text/plain', t.id);
						});
					});
				} else {
					preview.createSpan({ text: '\u8BE5\u65E5\u671F\u6682\u65E0\u4EFB\u52A1' });
				}
			});

			// Drop on calendar days to move task
			grid.addEventListener('dragover', (e) => {
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (dayEl?.dataset.date) { e.preventDefault(); dayEl.addClass('po-cal__day--drag-over'); }
			});
			grid.addEventListener('dragleave', (e) => {
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (dayEl) dayEl.removeClass('po-cal__day--drag-over');
			});
			grid.addEventListener('drop', (e) => {
				e.preventDefault();
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (!dayEl?.dataset.date) return;
				dayEl.removeClass('po-cal__day--drag-over');
				const taskId = e.dataTransfer?.getData('text/plain');
				if (!taskId) return;
				const task = tasks.find((t) => t.id === taskId);
				if (!task) return;
				const newDate = dayEl.dataset.date;
				void this.updateTaskDate(task, newDate);
			});
		};

		renderMonth();
	}

	/** Update task dueDate (and remindDate if exists) in source file */
	private async updateTaskDate(task: TaskItem, newDate: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		let inFM = false;
		const oldDate = task.dueDate;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') { inFM = !inFM; continue; }
			if (!inFM) continue;
			if (line.startsWith('\u622A\u6B62\u65E5\u671F:') && oldDate) {
				lines[i] = `\u622A\u6B62\u65E5\u671F: ${newDate}`;
			}
			if (line.startsWith('\u63D0\u9192\u65E5\u671F:') && task.remindDate) {
				lines[i] = `\u63D0\u9192\u65E5\u671F: ${newDate}`;
			}
		}

		await this.app.vault.modify(file, lines.join('\n'));
		task.dueDate = newDate;
		if (task.remindDate) task.remindDate = newDate;
		this.showToast('\u2728 \u4EFB\u52A1\u65E5\u671F\u5DF2\u66F4\u65B0');
		await this.refreshProjectOverview();
	}

	/* ---- Kanban Panel ---- */
	private renderKanbanPanel(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		const board = panel.createDiv({ cls: 'po-kanban' });
		const cols = [
			{ key: '\u5F85\u529E', label: '\u5F85\u529E' },
			{ key: '\u8FDB\u884C\u4E2D', label: '\u8FDB\u884C\u4E2D' },
			{ key: '\u5DF2\u963B\u585E', label: '\u5DF2\u963B\u585E' },
			{ key: '\u5DF2\u5B8C\u6210', label: '\u5DF2\u5B8C\u6210' },
			{ key: '\u5DF2\u53D6\u6D88', label: '\u5DF2\u53D6\u6D88' },
		];

		// Build project color lookup
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		cols.forEach((col) => {
			const colEl = board.createDiv({ cls: 'po-kanban__col' });
			colEl.dataset.status = col.key;
			const hd = colEl.createDiv({ cls: 'po-kanban__hd' });
			hd.createSpan({ text: col.label });
			const ct = tasks.filter((t) => t.status === col.key);
			hd.createSpan({ cls: 'po-kanban__count', text: String(ct.length) });

			ct.forEach((t) => {
				const card = colEl.createDiv({ cls: 'po-kanban__card' });
				card.draggable = true;
				card.dataset.taskId = t.id;
				card.createDiv({ text: t.content });
				const meta = card.createDiv({ cls: 'po-kanban__meta' });
				const dateRange = [t.startDate, t.dueDate].filter(Boolean).join(' \u2192 ');
				if (dateRange) meta.createSpan({ text: dateRange });
				const proj = meta.createSpan();
				const projColor = colorMap[t.projectId] || '#3b82f6';
				proj.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + projColor } });
				proj.appendText(t.projectId);

				// Click to edit
				card.addEventListener('click', () => {
					this.openTaskEditModal(t);
				});

				// Right-click context menu
				card.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((item) => {
						item.setTitle('\u7F16\u8F91').setIcon('pencil').onClick(() => this.openTaskEditModal(t));
					});
					menu.addItem((item) => {
						item.setTitle('\u5220\u9664').setIcon('trash').onClick(() => void this.deleteTask(t));
					});
					menu.addItem((item) => {
						item.setTitle('\u6253\u5F00\u6E90\u6587\u4EF6').setIcon('file-text').onClick(() => {
							if (t.sourceFile) void this.app.workspace.openLinkText(t.sourceFile, '', true);
						});
					});
					// Priority submenu
					menu.addSeparator();
					const priorities = ['\u91CD\u8981\u4E14\u7D27\u6025', '\u91CD\u8981\u4E0D\u7D27\u6025', '\u7D27\u6025\u4E0D\u91CD\u8981', '\u4E0D\u91CD\u8981\u4E0D\u7D27\u6025'];
					priorities.forEach((prio) => {
						menu.addItem((item) => {
							item.setTitle('\u4F18\u5148\u7EA7: ' + prio).onClick(() => void this.updateTaskPriority(t, prio));
						});
					});
					menu.showAtMouseEvent(e);
				});

				// Drag start
				card.addEventListener('dragstart', (e) => {
					e.dataTransfer?.setData('text/plain', t.id);
					card.addClass('po-kanban__card--dragging');
				});
				card.addEventListener('dragend', () => {
					card.removeClass('po-kanban__card--dragging');
				});
			});

			// Drop zone
			colEl.addEventListener('dragover', (e) => {
				e.preventDefault();
				colEl.addClass('po-kanban__col--drag-over');
			});
			colEl.addEventListener('dragleave', () => {
				colEl.removeClass('po-kanban__col--drag-over');
			});
			colEl.addEventListener('drop', (e) => {
				e.preventDefault();
				colEl.removeClass('po-kanban__col--drag-over');
				const taskId = e.dataTransfer?.getData('text/plain');
				if (!taskId) return;
				const task = tasks.find((t) => t.id === taskId);
				if (!task || task.status === col.key) return;
				void this.updateTaskStatus(task, col.key as TaskStatus);
			});
		});
	}

	/** Update task status in source file */
	private async updateTaskStatus(task: TaskItem, newStatus: TaskStatus): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		let inFM = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') { inFM = !inFM; continue; }
			if (!inFM) continue;
			if (line.startsWith('\u72B6\u6001:')) {
				lines[i] = `\u72B6\u6001: ${newStatus}`;
				break;
			}
		}

		await this.app.vault.modify(file, lines.join('\n'));
		task.status = newStatus;
		this.showToast('\u2728 \u4EFB\u52A1\u72B6\u6001\u5DF2\u66F4\u65B0: ' + newStatus);
		await this.refreshProjectOverview();
	}

	/** Update task priority in source file */
	private async updateTaskPriority(task: TaskItem, newPriority: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		let inFM = false;
		let found = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			if (line.trim() === '---') { inFM = !inFM; continue; }
			if (!inFM) continue;
			if (line.startsWith('\u4F18\u5148\u7EA7:')) {
				lines[i] = `\u4F18\u5148\u7EA7: ${newPriority}`;
				found = true;
				break;
			}
		}

		if (!found) {
			// Insert after 状态 line
			const statusIdx = lines.findIndex((l) => l?.startsWith('\u72B6\u6001:'));
			if (statusIdx >= 0) lines.splice(statusIdx + 1, 0, `\u4F18\u5148\u7EA7: ${newPriority}`);
		}

		await this.app.vault.modify(file, lines.join('\n'));
		task.priority = newPriority as TaskItem['priority'];
		this.showToast('\u2728 \u4F18\u5148\u7EA7\u5DF2\u66F4\u65B0: ' + newPriority);
		await this.refreshProjectOverview();
	}

	/** Open TaskEditModal for a given task */
	private openTaskEditModal(task: TaskItem, presetTodayNode?: NodeState): void {
		new TaskEditModal({
			app: this.app,
			task,
			presetTodayNode,
			onSave: () => {
				void this.refreshRelevant();
			},
		}).open();
	}

	/** Find the actual project folder by scanning vault */
	private async findProjectFolder(projectName: string): Promise<TFolder | null> {
		const rootPath = this.plugin.settings.projectsFolder;
		const root = this.app.vault.getAbstractFileByPath(rootPath);
		if (!(root instanceof TFolder)) return null;
		return this.findProjectFolderRecursive(root, projectName);
	}

	private findProjectFolderRecursive(folder: TFolder, projectName: string): TFolder | null {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				if (child.name === projectName) return child;
				const found = this.findProjectFolderRecursive(child, projectName);
				if (found) return found;
			}
		}
		return null;
	}

	/** Create a new task file with Chinese frontmatter */
	private async createTaskFile(
		title: string,
		projectName: string,
		startDate: string,
		endDate: string,
		priority: string,
		status: string,
		type: string,
		tags: string[],
		reminders: string[],
		notes: string,
		parent: string,
		repeatFreq: string,
		repeatInterval: number,
		repeatWorkdaysOnly: boolean,
		repeatWeekdays: number[],
		repeatMonthDay: number,
		noEndDate: boolean,
	): Promise<void> {
		const projectFolder = await this.findProjectFolder(projectName);
		if (!projectFolder) {
			this.showToast(`\u274C \u627E\u4E0D\u5230\u9879\u76EE\u6587\u4EF6\u5939: ${projectName}`);
			return;
		}

		const safeTitle = title.replace(/[*"/<>:|?\\]/g, '-');
		const filename = `${safeTitle}.md`;
		const filePath = `${projectFolder.path}/${filename}`;

		// Check if already exists
		if (this.app.vault.getAbstractFileByPath(filePath)) {
			this.showToast(`\u274C ${title} \u5DF2\u5B58\u5728\u4E8E\u8BE5\u9879\u76EE\u4E2D`);
			return;
		}

		// Map status values
		const statusMap: Record<string, string> = {
			'todo': '\u5F85\u529E',
			'in-progress': '\u8FDB\u884C\u4E2D',
			'blocked': '\u5DF2\u963B\u585E',
			'done': '\u5DF2\u5B8C\u6210',
			'cancelled': '\u5DF2\u53D6\u6D88',
		};

		// Map type values
		const typeMap: Record<string, string> = {
			'task': '\u666E\u901A',
			'recurring': '\u91CD\u590D',
		};

		const fmPriority = priority || '';
		const fmType = typeMap[type] || '\u666E\u901A';
		const isRecurring = fmType === '\u91CD\u590D';
		// Recurring tasks are always 进行中 while active (the user does not pick a
		// status for them); they get closed to 已完成 on natural expiry or manual edit.
		const fmStatus = isRecurring ? '\u8FDB\u884C\u4E2D' : (statusMap[status] || '\u5F85\u529E');

		// Build the nested 重复规则 block for recurring tasks from structured settings.
		const repeatRule = isRecurring ? buildRepeatRule({
			freq: repeatFreq,
			interval: repeatInterval,
			workdaysOnly: repeatWorkdaysOnly,
			weekdays: repeatWeekdays,
			monthDay: repeatMonthDay,
			startDate,
		}) : null;

		const lines: string[] = ['---'];
		lines.push(`\u72B6\u6001: ${fmStatus}`);
		lines.push(`\u4F18\u5148\u7EA7: ${fmPriority}`);
		lines.push(`\u5F00\u59CB\u65E5\u671F: ${startDate}`);
		// 截止日期 acts as the recurrence bound for recurring tasks (omitted when 无结束日期).
		if (endDate) lines.push(`\u622A\u6B62\u65E5\u671F: ${endDate}`);
		lines.push(`\u9879\u76EE: ${projectName}`);
		lines.push(`tags: ${JSON.stringify(tags)}`);
		lines.push(`\u7C7B\u578B: ${fmType}`);
		lines.push(`\u63D0\u9192: ${JSON.stringify(reminders)}`);
		lines.push(`\u5907\u6CE8: ${notes}`);
		if (parent) lines.push(`\u7236\u4EFB\u52A1: ${parent}`);

		if (isRecurring && repeatRule) {
			lines.push('\u91CD\u590D\u89C4\u5219:');
			lines.push(`  \u9891\u7387: ${repeatRule['\u9891\u7387']}`);
			if (repeatRule['\u95F4\u9694\u5929\u6570'] != null) lines.push(`  \u95F4\u9694\u5929\u6570: ${repeatRule['\u95F4\u9694\u5929\u6570']}`);
			if (repeatRule['\u6BCF\u5468\u51E0'] && repeatRule['\u6BCF\u5468\u51E0'].length) lines.push(`  \u6BCF\u5468\u51E0: [${repeatRule['\u6BCF\u5468\u51E0'].join(', ')}]`);
			if (repeatRule['\u6BCF\u6708\u51E0\u53F7'] != null) lines.push(`  \u6BCF\u6708\u51E0\u53F7: ${repeatRule['\u6BCF\u6708\u51E0\u53F7']}`);
			// Initialize 提醒日期 to the start date so the first occurrence is due today/on start.
			lines.push(`\u63D0\u9192\u65E5\u671F: ${startDate || todayStr()}`);
		}

		lines.push('---');
		lines.push('');
		lines.push(`# ${title}`);
		lines.push('');

		await this.app.vault.create(filePath, lines.join('\n'));
		this.showToast(`\u2728 \u4EFB\u52A1\u5DF2\u521B\u5EFA`);
	}

	/** Create a project folder + project.md with Chinese frontmatter */
	private async createProjectFile(): Promise<void> {
		// Dynamically import to avoid circular deps
		const { ProjectModal } = await import('./ProjectModal');
		new ProjectModal({
			app: this.app,
			onSave: (data) => {
				void this.createProjectFolder(data.name, data.color, data.startDate, data.endDate, data.description, data.type);
			},
		}).open();
	}

	private async createProjectFolder(name: string, color: string, startDate: string, endDate: string, description: string, type: ProjectType = 'stage'): Promise<void> {
		const rootPath = this.plugin.settings.projectsFolder;

		// Ensure root folder exists
		await this.ensureFolder(rootPath);

		const safeName = name.replace(/[*"/<>:|?\\]/g, '-');
		// Folder name = project name (no prefix)
		const projectFolderPath = `${rootPath}/${safeName}`;
		await this.ensureFolder(projectFolderPath);

		const now = new Date();
		const createDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

		const typeLabel = type === 'nostage' ? '\u975E\u9636\u6BB5\u9879\u76EE' : '\u9636\u6BB5\u9879\u76EE';
		const lines: string[] = [
			'---',
			`\u9879\u76EE\u540D\u79F0: ${name}`,
			`\u989C\u8272: "${color}"`,
			`\u9879\u76EE\u7C7B\u578B: ${typeLabel}`,
			`tags: [\u914D\u7F6E]`,
			`\u63CF\u8FF0: ${description}`,
			`\u5F00\u59CB\u65E5\u671F: ${startDate}`,
			`\u7ED3\u675F\u65E5\u671F: ${endDate}`,
			`\u521B\u5EFA\u65F6\u95F4: ${createDate}`,
			'---',
			'',
			`# ${name}`,
			'',
		];

		// Config file: project-{name}.md
		const projectFilePath = `${projectFolderPath}/project-${safeName}.md`;
		await this.app.vault.create(projectFilePath, lines.join('\n'));
		this.showToast(`\u2728 \u9879\u76EE\u5DF2\u521B\u5EFA\uFF1A${name}`);
	}

	/** Get list of all projects (async version using scanAllProjects) */
	private async getProjectsList(): Promise<ProjectInfo[]> {
		return await this.taskStore.scanAllProjects();
	}

	/** Open TaskModal for creating a new task */
	private async openTaskModal(defaultProject?: string): Promise<void> {
		const { TaskModal } = await import('./TaskModal');
		const projects = await this.taskStore.scanAllProjects();
		const allTasks = await this.taskStore.scanAllTasks();

		new TaskModal({
			app: this.app,
			projects: projects.map((p) => ({ name: p.name, path: p.path })),
			allTasks: allTasks.map((t) => ({ id: t.id, title: t.content, projectId: t.projectId })),
			defaultProject,
			onSave: (data) => {
				void this.createTaskFile(
					data.title,
					data.project,
					data.startDate,
					data.endDate,
					data.priority,
					data.status,
					data.type,
					data.tags,
					data.reminders,
					data.notes,
					data.parent,
					data.repeatFreq,
					data.repeatInterval,
					data.repeatWorkdaysOnly,
					data.repeatWeekdays,
					data.repeatMonthDay,
					data.noEndDate,
				);
			},
		}).open();
	}

/** Open TaskModal with a pre-filled parent task */
	private async openTaskModalWithParent(parentName: string, projectName: string): Promise<void> {
		const { TaskModal } = await import('./TaskModal');
		const projects = await this.taskStore.scanAllProjects();
		const allTasks = await this.taskStore.scanAllTasks();

		new TaskModal({
			app: this.app,
			projects: projects.map((p) => ({ name: p.name, path: p.path })),
			allTasks: allTasks.map((t) => ({ id: t.id, title: t.content, projectId: t.projectId })),
			defaultProject: projectName,
			defaultParent: parentName,
			onSave: (data) => {
				void this.createTaskFile(
					data.title,
					data.project,
					data.startDate,
					data.endDate,
					data.priority,
					data.status,
					data.type,
					data.tags,
					data.reminders,
					data.notes,
					data.parent || parentName,
					data.repeatFreq,
					data.repeatInterval,
					data.repeatWorkdaysOnly,
					data.repeatWeekdays,
					data.repeatMonthDay,
					data.noEndDate,
				);
			},
		}).open();
	}

	/** Refresh the todo list card in-place */
	private async refreshTodoList(): Promise<void> {
		if (!this.boardEl) return;
		const allTasks = await this.taskStore.scanAllTasks();
		await this.renderTodo(this.boardEl, allTasks);
	}

	/** Debounced refresh of the home cards. Vault events (especially file autosave)
	 *  can fire in bursts; coalescing them into one update ~200ms after the last
	 *  event avoids the cards stuttering/flashing on every keystroke-save. */
	private scheduleHomeRefresh(): void {
		if (this.homeRefreshTimer !== null) window.clearTimeout(this.homeRefreshTimer);
		this.homeRefreshTimer = window.setTimeout(() => {
			this.homeRefreshTimer = null;
			void this.refreshHomeCards();
		}, 200);
	}

	/** Reuse an existing card element (keeps its grid placement → no disappearance flash)
	 *  by emptying its contents, or create it if missing. */
	private getOrCreateCard(board: HTMLElement, cls: string): HTMLElement {
		const existing = board.querySelector('.' + cls);
		if (existing) {
			existing.empty();
			return existing as HTMLElement;
		}
		return board.createDiv({ cls });
	}

	/** Refresh all home dashboard cards (todo + progress + weekly) in-place.
	 *  A single vault scan feeds all three cards; each card reuses its own shell
	 *  (no remove/re-create), so the layout never flashes. */
	private async refreshHomeCards(): Promise<void> {
		if (this.currentPage !== 'home' || !this.boardEl) return;
		const allTasks = await this.taskStore.scanAllTasks();
		// scanAllTasks 是异步耗时操作；期间用户可能已切到其它页面。
		// 必须在渲染前重校验，否则会把主页卡片渲染进机会点/项目页面。
		if (this.currentPage !== 'home' || !this.boardEl) return;
		await this.renderTodo(this.boardEl, allTasks);
		await this.renderProgress(this.boardEl, allTasks);
		await this.renderWeekly(this.boardEl, allTasks);
	}

	/** Refresh whichever board is active (home cards, project overview, or opportunity board) */
	private refreshRelevant(): void {
		this.taskStore.invalidate();
		// Auto-close recurring tasks that have passed their end-date bound before re-rendering.
		void this.closeRecurringIfExpired();
		if (this.currentPage === 'project') {
			void this.refreshProjectOverview();
		} else if (this.currentPage === 'opportunity') {
			this.scheduleOpportunityRefresh();
		} else {
			void this.refreshHomeCards();
		}
	}

	/** Debounced refresh of the opportunity board (250ms) to coalesce rapid vault events. */
	private scheduleOpportunityRefresh(): void {
		if (this.oppRefreshTimer) window.clearTimeout(this.oppRefreshTimer);
		this.oppRefreshTimer = window.setTimeout(() => {
			this.oppRefreshTimer = null;
			void this.refreshOpportunityBoard();
		}, 250);
	}

	/**
	 * Auto-close a recurring task whose end date (截止日期) has passed: once the next
	 * occurrence would fall after the bound, the recurrence is over and the task is
	 * set to 已完成. No end date (无限重复) never auto-closes. Manual edit to 已完成
	 * still works independently.
	 */
	private async closeRecurringIfExpired(): Promise<void> {
		const tasks = await this.taskStore.scanAllTasks();
		const today = todayStr();
		for (const t of tasks) {
			if (t.type !== '\u91CD\u590D' || t.status === '\u5DF2\u5B8C\u6210') continue;
			if (!t.dueDate) continue; // 无结束日期 → never auto-close
			// Close when either: the bound has passed, or the next occurrence already
			// falls after the bound (i.e. the last one was completed).
			const pastBound = t.dueDate < today;
			const nextPastBound = !!t.remindDate && t.remindDate > t.dueDate;
			if (pastBound || nextPastBound) {
				await this.writeTaskField(t, '\u72B6\u6001', '\u5DF2\u5B8C\u6210');
				t.status = '\u5DF2\u5B8C\u6210';
			}
		}
	}

	/* ============================================================
	   TODO — async, reads real tasks from vault
	   ============================================================ */
	private async renderTodo(board: HTMLElement, allTasks?: TaskItem[]): Promise<void> {
		const tasks = allTasks ?? await this.taskStore.scanAllTasks();
		const card = this.getOrCreateCard(board, 'ad-card ad-b-todo');
		const summary = card.createSpan({ cls: 'ad-card__hint' });
		this.cardHead(card, '\u25CE', 'TODO', undefined, summary);
		const list = card.createDiv({ cls: 'ad-todo' });

		try {
			const todayTasks = getTodayTasks(tasks);

			// Sort: overdue first, then by priority
			const sorted = todayTasks.sort((a, b) => {
				if (a.isOverdue && !b.isOverdue) return -1;
				if (!a.isOverdue && b.isOverdue) return 1;
				return priorityWeight(a.priority) - priorityWeight(b.priority);
			});

			sorted.forEach((task) => {
				const isDone = task.status === '\u5DF2\u5B8C\u6210';
				const row = list.createDiv({ cls: 'ad-todo__item' + (isDone ? ' is-done' : '') + (task.isOverdue ? ' is-overdue' : '') });

				// Circle click → toggle task (handles repeat tasks)
				const check = row.createSpan({ cls: 'ad-todo__check' });
				check.addEventListener('click', (e) => {
					e.stopPropagation();
					void this.toggleTask(task, row);
				});

		// Text click → open edit modal
		const text = row.createSpan({ cls: 'ad-todo__text', text: task.content });
		text.addEventListener('click', () => {
			this.openTaskEditModal(task);
		});

			// Tag with priority
				const prioLabel = task.priority || '\u672A\u8BBE\u7F6E';
				row.createSpan({ cls: 'ad-todo__tag', text: prioLabel, attr: { 'data-prio': task.priority || '' } });

				// Right-click context menu
				row.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((item) => {
						item.setTitle('\u7F16\u8F91\u4EFB\u52A1').setIcon('pencil').onClick(() => this.openTaskEditModal(task));
					});
					menu.addItem((item) => {
						item.setTitle('\u5EF6\u540E\u4E00\u5929').setIcon('calendar').onClick(() => void this.postponeTask(task));
					});
					menu.addSeparator();
				menu.addItem((item) => {
					item.setTitle('\u5220\u9664\u4EFB\u52A1').setIcon('trash').onClick(() => void this.deleteTask(task));
				});
				// Multi-day tasks: daily node check-in via edit modal
				if (task.startDate && task.dueDate && task.startDate !== task.dueDate) {
					menu.addSeparator();
					menu.addItem((item) => {
						item.setTitle('今日完成').setIcon('check').onClick(() => this.openTaskEditModal(task, 'done'));
					});
					menu.addItem((item) => {
						item.setTitle('今日不做').setIcon('x').onClick(() => this.openTaskEditModal(task, 'skip'));
					});
				}
				menu.showAtMouseEvent(e);
				});
			});

			const universe = getTodayUniverse(tasks);
			const doneCount = universe.filter((t) => isDoneToday(t)).length;
			const skipCount = universe.filter((t) => isSkipToday(t)).length;
			const totalForSummary = universe.length - skipCount;
			summary.textContent = `${doneCount} / ${totalForSummary} done \u00B7 \u6309\u4F18\u5148\u7EA7`;
		} catch {
			summary.textContent = '0 / 0 done';
			list.createDiv({ cls: 'ad-todo__empty', text: '\u6682\u65E0\u4ECA\u65E5\u4EFB\u52A1' });
		}
	}

	/* ---- Progress (dual ring, real task data) ---- */
	private async renderProgress(board: HTMLElement, allTasks?: TaskItem[]): Promise<void> {
		const tasks = allTasks ?? await this.taskStore.scanAllTasks();
		const card = this.getOrCreateCard(board, 'ad-card ad-b-progress');
		this.cardHead(card, '\u25D0', '\u5DE5\u4F5C\u8FDB\u5EA6', 'today \u00B7 ring');
		const dp = card.createDiv({ cls: 'ad-dp' });

		let todayDone = 0, todayTotal = 0, allDone = 0, allTotal = 0;
		try {
			// Today's universe (incl. tasks finished earlier today) as the stable
			// denominator; "done" = status 已完成 OR today's node done OR recurring
			// advanced today; "今日不做" (node skip) is excluded from the denominator.
			const todayTasks = getTodayUniverse(tasks);
			const skipCount = todayTasks.filter((t) => isSkipToday(t)).length;
			todayTotal = todayTasks.length - skipCount;
			todayDone = todayTasks.filter((t) => isDoneToday(t)).length;
			const nonCancelled = tasks.filter((t) => t.status !== '\u5DF2\u53D6\u6D88');
			allTotal = nonCancelled.length;
			allDone = nonCancelled.filter((t) => t.status === '\u5DF2\u5B8C\u6210').length;
		} catch {
			/* keep zeros */
		}

		// Top ring — today's tasks
		const todayPct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;
		this.buildRing(dp, todayPct, 'ad-dp__pct-daily');
		dp.createDiv({ cls: 'ad-dp__stat' }).createEl('strong', { text: `\u4ECA\u65E5\u5DF2\u5B8C\u6210 ${todayDone} / \u4ECA\u65E5\u603B\u4EFB\u52A1 ${todayTotal}` });

		// Bottom ring — all tasks
		const allPct = allTotal ? Math.round((allDone / allTotal) * 100) : 0;
		this.buildRing(dp, allPct, 'ad-dp__pct-proj');
		dp.createDiv({ cls: 'ad-dp__stat' }).createEl('strong', { text: `\u5DF2\u5B8C\u6210 ${allDone} / \u603B\u4EFB\u52A1 ${allTotal}` });
	}

	private buildRing(parent: HTMLElement, pct: number, pctCls: string): void {
		const C = 263.9;
		const wrap = parent.createDiv({ cls: 'ad-dp__ring' });
		const svg = wrap.createSvg('svg');
		svg.setAttribute('viewBox', '0 0 100 100');
		const track = svg.createSvg('circle');
		track.setAttribute('cx', '50');
		track.setAttribute('cy', '50');
		track.setAttribute('r', '42');
		track.classList.add('ad-track');
		const fill = svg.createSvg('circle');
		fill.setAttribute('cx', '50');
		fill.setAttribute('cy', '50');
		fill.setAttribute('r', '42');
		fill.classList.add('ad-fill');
		fill.setAttribute('stroke-dasharray', C.toFixed(2));
		fill.setAttribute('stroke-dashoffset', (C * (1 - pct / 100)).toFixed(2));
		const center = wrap.createDiv({ cls: 'ad-dp__center' });
		center.createDiv({ cls: `ad-dp__pct ${pctCls}`, text: pct + '%' });
	}

	/* ---- Weekly & Overdue ---- */
	/* ---- Weekly & Overdue (real task data) ---- */
	private async renderWeekly(board: HTMLElement, allTasks?: TaskItem[]): Promise<void> {
		const tasks = allTasks ?? await this.taskStore.scanAllTasks();
		const card = this.getOrCreateCard(board, 'ad-card ad-b-weekly');

		// Header: calendar icon + title + overdue badge (right)
		const head = card.createDiv({ cls: 'ad-card__head' });
		const h3 = head.createEl('h3', { cls: 'ad-card__title' });
		h3.createSpan({ cls: 'ad-marker', text: '\u{1F4C5}' });
		h3.appendText('\u672C\u5468\u5F85\u529E & \u903E\u671F\u63D0\u9192');

		const list = card.createDiv({ cls: 'ad-wo' });

		try {
			const today = todayStr();

			// Week range: Monday 00:00 .. next Monday (exclusive)
			const now = new Date(); now.setHours(0, 0, 0, 0);
			const dow = (now.getDay() + 6) % 7; // 0 = Monday
			const weekStart = new Date(now); weekStart.setDate(now.getDate() - dow);
			const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7);
			const weekStartStr = fmtDate(weekStart);
			const weekEndStr = fmtDate(weekEnd);

			const isDone = (t: TaskItem): boolean =>
				t.status === '\u5DF2\u5B8C\u6210' || t.status === '\u5DF2\u53D6\u6D88';

			// ALL overdue tasks (even outside this week), sorted earliest-overdue first
			const overdue = tasks.filter((t) => t.isOverdue);
			overdue.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));

	// This-week, non-overdue, not done — incl. multi-day tasks that span the week
	const thisWeek = tasks.filter((t) => {
		if (isDone(t)) return false;
		// Recurring tasks: show when their next 提醒日期 falls within this week
		if (t.type === '\u91CD\u590D' && t.remindDate) {
			return t.remindDate < weekEndStr && t.remindDate >= weekStartStr;
		}
		if (!t.dueDate) return false;
		if (t.dueDate < today) return false; // overdue shown separately above
		const start = t.startDate || t.dueDate;
		// Overlaps this week: starts strictly before week end (next Monday, exclusive)
		// AND due on/after week start. Using '<' (not '<=') keeps tasks whose start
		// falls on next Monday or later out of "this week".
		return start < weekEndStr && t.dueDate >= weekStartStr;
	});
			thisWeek.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));

			// Overdue badge (hidden when 0)
			if (overdue.length > 0) {
				const badge = head.createSpan({ cls: 'ad-badge ad-badge--danger', text: String(overdue.length) });
				badge.title = `${overdue.length} \u4E2A\u903E\u671F\u4EFB\u52A1`;
			}

			// Section: overdue (pinned top, red)
			if (overdue.length > 0) {
				const og = list.createDiv({ cls: 'ad-wo__group ad-wo--overdue' });
				const oh4 = og.createEl('h4');
			oh4.createSpan({ cls: 'ad-wo-mark', text: '▲' });
			oh4.appendText('逾期提醒');
				const ul = og.createEl('ul', { cls: 'ad-wo__list' });
				overdue.forEach((t) => this.renderWeeklyRow(ul, t, true));
			}

			list.createDiv({ cls: 'ad-wo__sep' });

			// Section: this week
			const wg = list.createDiv({ cls: 'ad-wo__group' });
			const wh4 = wg.createEl('h4');
			wh4.createSpan({ cls: 'ad-wo-mark', text: '◆' });
			wh4.appendText('本周待办');
			const ul = wg.createEl('ul', { cls: 'ad-wo__list' });
			if (thisWeek.length === 0 && overdue.length === 0) {
				list.createDiv({ cls: 'ad-wo__empty', text: '\u{1F389} \u672C\u5468\u6682\u65E0\u4FEE\u529E\u4EFB\u52A1' });
			} else {
				thisWeek.forEach((t) => this.renderWeeklyRow(ul, t, false));
			}

			// Footer stats
			const foot = card.createDiv({ cls: 'ad-wo__foot' });
			foot.textContent = `\u672C\u5468\u5171 ${thisWeek.length} \u4E2A\u4EFB\u52A1\uFF0C\u903E\u671F ${overdue.length} \u4E2A`;
		} catch {
			list.createDiv({ cls: 'ad-wo__empty', text: '\u52A0\u8F7D\u5931\u8D25' });
		}
	}

	/** Build a single weekly/overdue task row (li) with click + context menu */
	private renderWeeklyRow(ul: HTMLElement, task: TaskItem, isOverdue: boolean): void {
		const li = ul.createEl('li');
		const due = task.dueDate || task.remindDate || '';
		li.createSpan({ cls: 'ad-wo__date', text: due ? due.slice(5) : '\u2014' });
		li.createSpan({ cls: 'ad-wo__text', text: task.content });
		if (isOverdue) {
			const days = overdueDays(task.dueDate);
			li.createSpan({ cls: 'ad-wo__over', text: `\u903E\u671F ${days}\u5929` });
			li.classList.add('is-overdue-row');
		} else {
			// This-week rows: show urgency tag (color-coded by priority)
			const urg = urgencyMeta(task.priority);
			if (urg) {
				li.createSpan({ cls: 'ad-wo__urg', text: urg.label, attr: { 'data-urg': urg.key } });
			}
		}

		li.addEventListener('click', () => this.openTaskEditModal(task));
		li.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle('\u7F16\u8F91\u4EFB\u52A1').setIcon('pencil').onClick(() => this.openTaskEditModal(task));
			});
			menu.addItem((item) => {
				item.setTitle('\u5220\u9664\u4EFB\u52A1').setIcon('trash').onClick(() => void this.deleteTask(task));
			});
			menu.addItem((item) => {
				item.setTitle('\u6253\u5F00\u6E90\u6587\u4EF6').setIcon('file').onClick(() => {
					if (task.sourceFile) void this.app.workspace.openLinkText(task.sourceFile, '', true);
				});
			});
			menu.addItem((item) => {
				item.setTitle('\u5EF6\u540E\u4E00\u5929').setIcon('calendar').onClick(() => void this.postponeTask(task));
			});
			menu.addItem((item) => {
				item.setTitle('\u6807\u8BB0\u5B8C\u6210').setIcon('check').onClick(() => void this.markTaskComplete(task));
			});
			if (isOverdue) {
				menu.addItem((item) => {
					item.setTitle('\u5EF6\u540E\u5230\u4ECA\u5929').setIcon('calendar-clock').onClick(() => void this.postponeTaskToToday(task));
				});
			}
			menu.showAtMouseEvent(e);
		});
	}

		/** Mark a task as completed (状态: 已完成) */
	private async markTaskComplete(task: TaskItem): Promise<void> {
		if (task.status === '\u5DF2\u5B8C\u6210') {
			this.showToast('\u2705 \u4EFB\u52A1\u5DF2\u5B8C\u6210');
			return;
		}
		// Repeat task: instead of completing, advance 提醒日期 so it keeps recurring.
		if (task.type === '\u91CD\u590D') {
			const nextDate = calcNextRemindDate(task);
			if (nextDate) {
				await this.writeTaskField(task, '\u63D0\u9192\u65E5\u671F', nextDate);
				task.remindDate = nextDate;
				const now = nowFmt();
				await this.writeTaskField(task, '\u5B8C\u6210\u65F6\u95F4', now);
				task.completeTime = now;
				this.showToast('\u2728 \u91CD\u590D\u4EFB\u52A1\uFF0C\u4E0B\u6B21\u63D0\u9192: ' + nextDate);
				void this.refreshRelevant();
				return;
			}
		}
		await this.writeTaskField(task, '\u72B6\u6001', '\u5DF2\u5B8C\u6210');
		task.status = '\u5DF2\u5B8C\u6210';
		this.showToast('\u2705 \u4EFB\u52A1\u5DF2\u5B8C\u6210');
		void this.refreshRelevant();
	}

	/** Move an overdue task's due date to today */
	private async postponeTaskToToday(task: TaskItem): Promise<void> {
		if (!task.dueDate) return;
		const today = todayStr();
		await this.writeTaskField(task, '\u622A\u6B62\u65E5\u671F', today);
		task.dueDate = today;
		this.showToast('\u2728 \u5DF2\u5EF6\u540E\u5230\u4ECA\u5929');
		void this.refreshRelevant();
	}

	/* ---- Projects (real data) ---- */
	private async renderProjects(board: HTMLElement): Promise<void> {
		const card = board.createDiv({ cls: 'ad-card ad-b-project' });
		const head = card.createDiv({ cls: 'ad-card__head ad-card__head--proj' });
		const h3 = head.createEl('h3', { cls: 'ad-card__title' });
		h3.createSpan({ cls: 'ad-marker', text: '\u25A6' });
		h3.appendText('\u9879\u76EE\u60C5\u51B5');
		const hint = head.createSpan({ cls: 'ad-card__hint ad-card__hint--inline' });

		const stages = this.plugin.settings.npdpStages;
		const maxStageFilter = this.plugin.settings.npdpProgressFilter ?? stages.length;

		let projects: ProjectInfo[] = [];
		try {
			projects = await this.taskStore.scanAllProjects();
		} catch { /* keep empty */ }

		// Only 阶段项目 participate in the stage-progress card (非阶段项目 excluded from display & count)
		const stageProjects = projects.filter((p) => (p.type ?? 'stage') === 'stage');

		// Filter: only show projects at stage <= maxStageFilter
		const filtered = maxStageFilter < stages.length
			? stageProjects.filter((p) => (p.stage ?? 0) <= maxStageFilter)
			: stageProjects;

		hint.textContent = `${filtered.length} / ${stageProjects.length} \u4E2A\u9879\u76EE`;
		if (maxStageFilter < stages.length) {
			hint.textContent += ` (\u2264${stages[maxStageFilter - 1]})`;
		}

		const proj = card.createDiv({ cls: 'ad-proj' });
		const list = proj.createDiv({ cls: 'ad-proj__list' });

		let activeCount = 0;
		filtered.forEach((p) => {
			const projStage = p.stage ?? 0;
			if (projStage > 0 && projStage < (p.stages?.length ?? stages.length)) activeCount++;
			const pct = p.taskCount > 0 ? Math.round((p.activeCount / p.taskCount) * 100) : 0;

			const row = list.createDiv({ cls: 'ad-proj__row' });
			row.createSpan({ cls: 'ad-proj__dot', attr: { style: `background:${p.color}` } });
			const name = row.createDiv({ cls: 'ad-proj__name' });
			name.appendText(p.name);
			name.createSpan({ cls: 'ad-meta', text: `${p.taskCount} \u4EFB\u52A1 \u00B7 ${p.activeCount}\u6D3B\u8DC3 \u00B7 ${pct}%` });

			// Stage pipeline mini (connector line segments colored by progress, ends at last dot)
			const track = row.createDiv({ cls: 'ad-proj__track' });
			const stageNodes = track.createDiv({ cls: 'ad-proj__stages' });
			const projStages = p.stages || stages;
			// Auto-size stage dots by count: more stages → smaller, fixed width for connector math
			const stageMinW = Math.max(20, Math.min(36, Math.floor(160 / projStages.length)));
			const stageGap = Math.max(1, Math.floor(4 / (projStages.length / 4)));
			stageNodes.style.setProperty('--pip-w', stageMinW + 'px');
			stageNodes.style.setProperty('--pip-gap', stageGap + 'px');
			stageNodes.style.gap = stageGap + 'px';
			projStages.forEach((label, i) => {
				const isDone = i < projStage;
				const isCurrent = i === projStage;
				const s = stageNodes.createDiv({ cls: 'ad-proj__stage' + (isDone ? ' is-done' : '') + (isCurrent ? ' is-current' : '') });
				s.style.width = stageMinW + 'px';
				s.createSpan({ cls: 'ad-pip' });
				s.appendText(label);
			});

			row.createDiv({ cls: 'ad-proj__chev', text: '\u203A' });

			// Right-click context menu
			row.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle('\u7F16\u8F91\u9879\u76EE').setIcon('pencil').onClick(() => void this.editProject(p));
				});
				menu.addItem((item) => {
					item.setTitle('\u67E5\u770B\u7518\u7279\u56FE').setIcon('gantt-chart').onClick(() => void this.navigateToProjectGantt(p));
				});
				menu.showAtMouseEvent(e);
			});

			// Click → navigate to Gantt
			row.addEventListener('click', () => void this.navigateToProjectGantt(p));
		});

		// Footer summary
		const sum = proj.createDiv({ cls: 'ad-proj__sum' });
		const filterLabel = maxStageFilter < stages.length ? `\u2264 ${stages[maxStageFilter - 1]}` : '\u5168\u90E8';
		const sumRow = sum.createSpan({ cls: 'ad-row' });
		sumRow.createSpan({ cls: 'ad-key', text: '\u2299' });
		sumRow.appendText(` ${activeCount} \u8FDB\u884C\u4E2D \u00B7 ${filterLabel}`);
	}

	/** Navigate to project overview and select a specific project's Gantt view */
	private async navigateToProjectGantt(proj: ProjectInfo): Promise<void> {
		this.selectedProject = proj.name;
		this.currentView = 'gantt';
		await this.showProjectOverview();
	}

	/* ---- Heatmap (year-based: Jan 1 -> Dec 31) ---- */
	private renderHeatmap(board: HTMLElement): void {
		const card = board.createDiv({ cls: 'ad-card ad-b-heatmap' });
		this.heatmapCard = card;

		const noteCounts = this.getVaultNoteCounts();
		const today = new Date();
		const todayTime = today.getTime();
		const year = today.getFullYear();
		const stats = calcHeatmapStats(noteCounts, year, today);

		// Header row: title (left) + stats (right)
		const head = card.createDiv({ cls: 'ad-card__head' });
		const h3 = head.createEl('h3', { cls: 'ad-card__title' });
		h3.createSpan({ cls: 'ad-marker', text: '\u25A5' });
		h3.appendText('\u7B14\u8BB0\u7EDF\u8BA1');
		const statsEl = head.createDiv({ cls: 'ad-card__stats' });
		statsEl.createSpan({ cls: 'ad-big', text: String(stats.total) });
		statsEl.createSpan({ cls: 'ad-dot' });
		statsEl.createSpan({ text: `${stats.active} \u5929\u6D3B\u8DC3` });
		statsEl.createSpan({ cls: 'ad-dot' });
		statsEl.createSpan({ text: `\u5F53\u524D\u8FDE\u7EED ${stats.streak} \u5929` });

		// --- Year boundaries ---
		const yearStart = new Date(year, 0, 1);        // Jan 1
		const yearEnd   = new Date(year, 11, 31);       // Dec 31
		const yearStartTime = yearStart.getTime();
		const yearEndTime   = yearEnd.getTime();

		// Monday of the week containing Jan 1
		const startDow = yearStart.getDay(); // 0=Sun
		const startMonday = new Date(year, 0, 1 - ((startDow + 6) % 7));

		// Sunday of the week containing Dec 31
		const endDow = yearEnd.getDay();
		const endSunday = new Date(year, 11, 31 + ((7 - endDow) % 7 || 7));

		// Total columns (weeks)
		const totalDays = Math.round((endSunday.getTime() - startMonday.getTime()) / 86400000) + 1;
		const totalWeeks = Math.ceil(totalDays / 7);

		// --- Heatmap grid ---
		const heat = card.createDiv({ cls: 'ad-ns__heat' });
		heat.style.setProperty('--ad-w', String(totalWeeks));

		const startMs = startMonday.getTime();

		// Month labels: assign each week column to the month containing its Thursday
		const monthsRow = heat.createDiv({ cls: 'ad-ns__months' });
		const monthNames = ['1\u6708','2\u6708','3\u6708','4\u6708','5\u6708','6\u6708','7\u6708','8\u6708','9\u6708','10\u6708','11\u6708','12\u6708'];
		const weekMonths: number[] = [];
		for (let w = 0; w < totalWeeks; w++) {
			const thu = new Date(startMs + (w * 7 + 3) * 86400000);
			weekMonths.push(thu.getMonth());
		}
		// Group consecutive weeks by month
		const monthSpans: { month: number; span: number }[] = [];
		let curM = weekMonths[0] ?? 0;
		let curS = 1;
		for (let w = 1; w < totalWeeks; w++) {
			const m = weekMonths[w] ?? curM;
			if (m === curM) { curS++; }
			else { monthSpans.push({ month: curM, span: curS }); curM = m; curS = 1; }
		}
		monthSpans.push({ month: curM, span: curS });
		for (const ms of monthSpans) {
			const label = monthsRow.createSpan({ text: monthNames[ms.month] });
			label.style.gridColumn = `span ${ms.span}`;
		}

		// Day-of-week labels
		const dow = heat.createDiv({ cls: 'ad-ns__dow' });
		['\u4E00', '\u4E8C', '\u4E09', '\u56DB', '\u4E94', '\u516D', '\u65E5'].forEach((t) => dow.createSpan({ text: t }));

		// Cells
		const cells = heat.createDiv({ cls: 'ad-ns__cells' });

		for (let w = 0; w < totalWeeks; w++) {
			for (let r = 0; r < 7; r++) {
				const cellDate = new Date(startMs + (w * 7 + r) * 86400000);
				const cellTime = cellDate.getTime();
				const cell = cells.createDiv({ cls: 'ad-ns__cell' });

				// Outside the year → empty
				if (cellTime < yearStartTime || cellTime > yearEndTime) {
					cell.addClass('ad-ns__cell--empty');
					continue;
				}

				const dateStr = fmtDate(cellDate);
				const count   = noteCounts.get(dateStr) ?? 0;
				const isFuture = cellTime > todayTime;

				// Colour: only past/present dates with notes
				if (!isFuture && count > 0) {
					if (count === 1)  cell.addClass('l1');
					else if (count <= 3) cell.addClass('l2');
					else                 cell.addClass('l3');
				}

				if (isFuture) cell.addClass('is-future');

				// Tooltip
				const mm = String(cellDate.getMonth() + 1).padStart(2, '0');
				const dd = String(cellDate.getDate()).padStart(2, '0');
				cell.title = isFuture ? `${mm}-${dd} \u00B7 \u672A\u6765` : `${mm}-${dd} \u00B7 ${count} \u7BC7\u7B14\u8BB0`;
			}
		}

		// Footer with numeric legend
		const foot = card.createDiv({ cls: 'ad-ns__foot' });
		foot.createSpan({ text: `${year} \u5168\u5E74` });
		const legend = foot.createSpan({ cls: 'ad-ns__legend' });
		[
			{ cls: '',  label: '0' },
			{ cls: 'l1', label: '1' },
			{ cls: 'l2', label: '2-3' },
			{ cls: 'l3', label: '4+' },
		].forEach((lv) => {
			const item = legend.createSpan({ cls: 'ad-ns__legend-item' });
			item.createSpan({ cls: 'ad-ns__sw' + (lv.cls ? ' ' + lv.cls : '') });
			item.createSpan({ cls: 'ad-ns__legend-text', text: lv.label });
		});
	}

	/* ---- Countdown ---- */
	private renderCountdown(board: HTMLElement): void {
		// Real date computation — replaces static MOCK_DATA countdown values
		const now = new Date();
		const year = now.getFullYear();
		const yearEnd = new Date(year, 11, 31, 23, 59, 59);
		const yearStart = new Date(year, 0, 1);
		const msPerDay = 86400000;
		const daysLeft = Math.max(0, Math.ceil((yearEnd.getTime() - now.getTime()) / msPerDay));
		const dayOfYear = Math.floor((now.getTime() - yearStart.getTime()) / msPerDay) + 1;
		const isLeap = ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0);
		const totalDays = isLeap ? 366 : 365;
		const weeksLeft = Math.ceil(daysLeft / 7);
		const percentDone = Math.min(100, Math.round((dayOfYear / totalDays) * 1000) / 10);
		const quarter = Math.floor(now.getMonth() / 3) + 1;
		const milestone = `Q${quarter} 进度`;
		const card = board.createDiv({ cls: 'ad-card ad-b-countdown' });
		this.cardHead(card, '\u25C8', `\u5012\u8BA1\u65F6 \u00B7 ${year}`, 'days left');
		const cd = card.createDiv({ cls: 'ad-cd' });

		const big = cd.createDiv({ cls: 'ad-cd__big' });
		big.createSpan({ text: String(daysLeft) });
		big.createSpan({ cls: 'ad-unit', text: 'DAYS' });

		const row = cd.createDiv({ cls: 'ad-cd__row' });
		row.createSpan({ text: '\u5269\u4F59\u5468\u6570 ' }).createEl('strong', { text: String(weeksLeft) });
		row.createSpan({ cls: 'ad-dot', attr: { style: 'display:inline-block;width:3px;height:3px;background:var(--ad-text-dim);border-radius:50%;' } });
		row.createSpan({ text: '\u5DF2\u5B8C\u6210 ' }).createEl('strong', { text: percentDone.toFixed(1) + '%' });

		const barWrap = cd.createDiv({ cls: 'ad-cd__bar' });
		const fill = barWrap.createDiv({ cls: 'ad-fill' });
		fill.style.width = percentDone + '%';

		const foot = cd.createDiv({ cls: 'ad-cd__foot' });
		foot.appendText('\u4E0B\u4E00\u4E2A\u91CC\u7A0B\u7891 \u00B7 ');
		foot.createSpan({ cls: 'ad-accent', text: milestone });
	}

	/* ---- Shared card header ---- */
	private cardHead(card: HTMLElement, icon: string, title: string, hint?: string, hintEl?: HTMLElement): void {
		const head = card.createDiv({ cls: 'ad-card__head' });
		const h3 = head.createEl('h3', { cls: 'ad-card__title' });
		h3.createSpan({ cls: 'ad-marker', text: icon });
		h3.appendText(title);
		if (hintEl) head.appendChild(hintEl);
		else if (hint) head.createSpan({ cls: 'ad-card__hint', text: hint });
	}

	/* ============================================================
	   机会点管理（第三页）
	   ============================================================ */

	private opportunityPath(): string {
		return this.plugin.settings.opportunityFile || DEFAULT_OPPORTUNITY_FILE;
	}

	private async loadOpportunities(): Promise<OpportunityItem[]> {
		const now = Date.now();
		if (this.oppCache && now - this.oppCache.at < 300) return this.oppCache.items;
		const path = this.opportunityPath();
		await ensureOpportunityFile(this.app, path);
		const items = await parseOpportunitiesFile(this.app, path);
		const sorted = sortOpportunities(items);
		this.oppCache = { at: now, items: sorted };
		return sorted;
	}

	private async saveOpportunities(items: OpportunityItem[]): Promise<void> {
		const path = this.opportunityPath();
		await writeOpportunitiesFile(this.app, path, items);
		this.oppCache = { at: Date.now(), items: sortOpportunities(items) };
	}

	private async showOpportunityBoard(): Promise<void> {
		if (!this.boardEl) return;
		const items = await this.loadOpportunities();
		this.boardEl.empty();
		this.boardEl.removeClass('ad-board');
		this.boardEl.removeClass('po-board');
		this.boardEl.addClass('op-board');
		this.currentPage = 'opportunity';

		this.currentOpportunities = items;
		this.selectedOppStatus = 'all';
		this.oppShowRoadmapOnly = false;
		this.selectedOppDetailId = null;

		const container = this.boardEl.createDiv({ cls: 'po-container op-container' });
		const sidebar = container.createDiv({ cls: 'po-sidebar op-sidebar' });
		this.renderOpportunitySidebar(sidebar);
		this.opMainEl = container.createDiv({ cls: 'po-main op-main' });
		this.renderOpportunityPanels();
	}

	private renderOpportunitySidebar(sidebar: HTMLElement): void {
		sidebar.empty();
		const list = sidebar.createDiv({ cls: 'po-sidebar__list' });
		const items = this.currentOpportunities;
		const total = items.length;

		const allItem = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedOppStatus === 'all' && !this.oppShowRoadmapOnly ? ' is-active' : '') });
		allItem.createSpan({ cls: 'po-dot', attr: { style: 'background:var(--ad-accent);color:var(--ad-accent)' } });
		allItem.createSpan({ text: '全部机会点' });
		allItem.createSpan({ cls: 'po-count', text: String(total) });
		allItem.addEventListener('click', () => {
			this.selectedOppStatus = 'all';
			this.oppShowRoadmapOnly = false;
			this.selectedOppDetailId = null;
			this.renderOpportunitySidebar(sidebar);
			this.renderOpportunityPanels();
		});

		for (const st of OPPORTUNITY_STATUS_LIST) {
			const count = items.filter((i) => i.status === st).length;
			const item = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedOppStatus === st ? ' is-active' : '') });
			item.createSpan({ cls: 'po-dot', attr: { style: 'background:' + OPPORTUNITY_STATUS_DOT[st] + ';color:' + OPPORTUNITY_STATUS_DOT[st] } });
			item.createSpan({ text: st });
			item.createSpan({ cls: 'po-count', text: String(count) });
			item.addEventListener('click', () => {
				this.selectedOppStatus = st;
				this.oppShowRoadmapOnly = false;
				this.selectedOppDetailId = null;
				this.renderOpportunitySidebar(sidebar);
				this.renderOpportunityPanels();
			});
		}

		const rmItem = list.createDiv({ cls: 'po-sidebar__item' + (this.oppShowRoadmapOnly ? ' is-active' : '') });
		rmItem.createSpan({ cls: 'po-dot', attr: { style: 'background:#eab308;color:#eab308' } });
		rmItem.createSpan({ text: '★ 转路标' });
		rmItem.createSpan({ cls: 'po-count', text: String(items.filter((i) => i.toRoadmap).length) });
		rmItem.addEventListener('click', () => {
			this.oppShowRoadmapOnly = !this.oppShowRoadmapOnly;
			this.selectedOppStatus = 'all';
			this.selectedOppDetailId = null;
			this.renderOpportunitySidebar(sidebar);
			this.renderOpportunityPanels();
		});
	}

	private renderOpportunityPanels(): void {
		if (!this.opMainEl) return;
		this.opMainEl.empty();
		const items = this.filteredOpportunities();
		const tabs = this.opMainEl.createDiv({ cls: 'po-tabs' });
		const tabDefs = [
			{ key: 'kanban', label: '▦ 看板' },
			{ key: 'list', label: '☰ 列表' },
		];
		const content = this.opMainEl.createDiv({ cls: 'po-content' });
		const panels: Record<string, HTMLElement> = {};
		const cur = this.plugin.settings.currentOppView || 'kanban';
		for (const td of tabDefs) {
			const btn = tabs.createEl('button', { cls: 'po-tab' + (td.key === cur ? ' is-active' : ''), text: td.label });
			btn.dataset.view = td.key;
			panels[td.key] = content.createDiv({ cls: 'po-panel' + (td.key === cur ? ' is-active' : ''), attr: { 'data-view': td.key } });
		}
		const newBtn = tabs.createEl('button', { cls: 'po-add-btn op-new-btn', text: '+ 新建机会点' });
		newBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.createOpportunityFile(); });
		this.renderOppPanel(cur, panels[cur]!, items);
		tabs.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.po-tab') as HTMLElement;
			if (!btn) return;
			const view = btn.dataset.view;
			if (!view) return;
			tabs.querySelectorAll('.po-tab').forEach((t) => t.removeClass('is-active'));
			btn.addClass('is-active');
			Object.values(panels).forEach((p) => p.classList.remove('is-active'));
			if (panels[view]) panels[view].addClass('is-active');
			this.plugin.settings.currentOppView = view;
			void this.plugin.saveSettings();
			if (panels[view]) this.renderOppPanel(view, panels[view], this.filteredOpportunities());
		});
	}

	private filteredOpportunities(): OpportunityItem[] {
		let items = this.currentOpportunities;
		if (this.oppShowRoadmapOnly) items = items.filter((i) => i.toRoadmap);
		else if (this.selectedOppStatus !== 'all') items = items.filter((i) => i.status === this.selectedOppStatus);
		return items;
	}

	private renderOppPanel(key: string, panel: HTMLElement, items: OpportunityItem[]): void {
		panel.empty();
		if (key === 'kanban') this.renderOpportunityKanban(panel, items);
		else if (key === 'list') this.renderOpportunityList(panel, items);
	}

	private renderOpportunityKanban(panel: HTMLElement, items: OpportunityItem[]): void {
		const singleMode = this.selectedOppStatus !== 'all' && !this.oppShowRoadmapOnly;
		const statuses = singleMode ? [this.selectedOppStatus as OpportunityStatus] : OPPORTUNITY_STATUS_LIST;
		const board = panel.createDiv({ cls: 'po-kanban op-kanban' + (singleMode ? ' op-kanban--single' : '') });

		// 单状态模式：默认选中排序第一个；若当前选中项已不在本状态则回退
		if (singleMode) {
			const ordered = sortOpportunities(items);
			if (!this.selectedOppDetailId || !items.some((i) => i.id === this.selectedOppDetailId)) {
				this.selectedOppDetailId = ordered.length ? (ordered[0]?.id ?? null) : null;
			}
		}

		for (const st of statuses) {
			const colEl = board.createDiv({ cls: 'po-kanban__col op-kanban__col' });
			colEl.dataset.status = st;
			const hd = colEl.createDiv({ cls: 'po-kanban__hd' });
			hd.createSpan({ text: st });
			const ct = items.filter((i) => i.status === st).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
			hd.createSpan({ cls: 'po-kanban__count', text: String(ct.length) });
			if (ct.length === 0) colEl.createDiv({ cls: 'op-empty-col' });

			ct.forEach((it) => {
				const card = colEl.createDiv({ cls: 'po-kanban__card op-card' + (singleMode && it.id === this.selectedOppDetailId ? ' is-selected' : '') });
				card.draggable = true;
				card.dataset.oppId = it.id;
				const chip = card.createDiv({ cls: 'op-st ' + OPPORTUNITY_STATUS_CLASS[st] });
				chip.textContent = st;
				const title = card.createDiv({ cls: 'op-card__title' });
				title.textContent = it.title;
				const desc = card.createDiv({ cls: 'op-card__desc' });
				desc.textContent = it.background || it.commConclusion || '';
				if (it.toRoadmap) card.createDiv({ cls: 'op-badge--roadmap', text: '★ 转路标' });
				card.addEventListener('click', () => {
					if (singleMode) {
						this.selectedOppDetailId = it.id;
						board.querySelectorAll('.op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.op-detail');
						if (detail instanceof HTMLElement) this.renderOppDetail(detail, it);
					} else {
						this.openOpportunityModal(it);
					}
				});
				card.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((m) => m.setTitle('编辑').setIcon('pencil').onClick(() => this.openOpportunityModal(it)));
					if (singleMode) menu.addItem((m) => m.setTitle('在右侧查看').setIcon('eye').onClick(() => {
						this.selectedOppDetailId = it.id;
						board.querySelectorAll('.op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.op-detail');
						if (detail instanceof HTMLElement) this.renderOppDetail(detail, it);
					}));
					menu.addItem((m) => m.setTitle('打开详情双链').setIcon('file-text').onClick(() => void this.openOpportunityDetail(it)));
					menu.addSeparator();
					for (const s of OPPORTUNITY_STATUS_LIST) {
						menu.addItem((m) => m.setTitle('状态: ' + s).onClick(() => void this.setOpportunityStatus(it, s)));
					}
					menu.addSeparator();
					menu.addItem((m) => m.setTitle(it.toRoadmap ? '取消转路标' : '标记为转路标').setIcon('flag').onClick(() => void this.setOpportunityRoadmap(it, !it.toRoadmap)));
					menu.addItem((m) => m.setTitle('删除').setIcon('trash').onClick(() => void this.deleteOpportunityItem(it)));
					menu.showAtMouseEvent(e);
				});
			card.addEventListener('dragstart', (e) => {
				this.draggedOppId = it.id;
				e.dataTransfer?.setData('text/opp-id', it.id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
				card.addClass('po-kanban__card--dragging');
			});
			card.addEventListener('dragend', () => { this.draggedOppId = null; card.removeClass('po-kanban__card--dragging'); });
			// 拖到某张卡片之前插入（用于列内/跨列排序）
			card.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; card.addClass('op-card--drag-over'); });
			card.addEventListener('dragleave', () => card.removeClass('op-card--drag-over'));
			card.addEventListener('drop', (e) => {
				e.preventDefault();
				e.stopPropagation();
				card.removeClass('op-card--drag-over');
				const id = this.draggedOppId ?? e.dataTransfer?.getData('text/opp-id');
				this.draggedOppId = null;
				if (!id) return;
				void this.reorderOpportunity(id, st, it.id);
			});
			});

			colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.addClass('po-kanban__col--drag-over'); });
			colEl.addEventListener('dragleave', () => colEl.removeClass('po-kanban__col--drag-over'));
			// 拖到列空白区域：追加到该列末尾（跨列即改状态）
		colEl.addEventListener('drop', (e) => {
			e.preventDefault();
			colEl.removeClass('po-kanban__col--drag-over');
			const id = this.draggedOppId ?? e.dataTransfer?.getData('text/opp-id');
			this.draggedOppId = null;
			if (!id) return;
			void this.reorderOpportunity(id, st);
		});
		}

		// 单状态模式：右侧详情面板（内联编辑器）
		if (singleMode) {
			const detail = board.createDiv({ cls: 'op-detail' });
			const sel = items.find((i) => i.id === this.selectedOppDetailId) || sortOpportunities(items)[0];
			if (sel) this.renderOppDetail(detail, sel);
			else detail.createSpan({ text: '（该状态暂无机会点）' });
		}
	}

	/** 手动排序：把 draggedId 放到 targetStatus 列中 beforeId 之前（省略 beforeId 则追加到末尾）。 */
	private async reorderOpportunity(draggedId: string, targetStatus: OpportunityStatus, beforeId?: string): Promise<void> {
		if (beforeId && beforeId === draggedId) return;
		const items = this.currentOpportunities;
		const dragged = items.find((i) => i.id === draggedId);
		if (!dragged) return;
		const colItems = items
			.filter((i) => i.status === targetStatus && i.id !== draggedId)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		let insertIdx = colItems.length;
		if (beforeId) {
			const bi = colItems.findIndex((i) => i.id === beforeId);
			insertIdx = bi < 0 ? colItems.length : bi;
		}
		const reordered: OpportunityItem[] = [];
		let n = 0;
		for (let k = 0; k < colItems.length + 1; k++) {
			if (k === insertIdx) { reordered.push({ ...dragged, status: targetStatus, order: n }); n++; }
			if (k < colItems.length) { reordered.push({ ...colItems[k], order: n } as OpportunityItem); n++; }
		}
		const map = new Map(reordered.map((i) => [i.id, i]));
		const next = items.map((i) => map.get(i.id) ?? i);
		this.currentOpportunities = sortOpportunities(next);
		await this.saveOpportunities(this.currentOpportunities);
		void this.refreshOpportunityBoard();
	}

	/** 单状态模式下，右侧内联详情编辑器 */
	private renderOppDetail(container: HTMLElement, item: OpportunityItem): void {
		container.empty();
		const wrap = container.createDiv({ cls: 'op-detail__inner' });
		wrap.createDiv({ cls: 'op-detail__hd', text: '机会点详情' });

		const titleInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		titleInput.value = item.title; titleInput.placeholder = '机会点名称';

		const statusSel = wrap.createEl('select', { cls: 'ad-modal-input' });
		for (const s of OPPORTUNITY_STATUS_LIST) {
			const o = statusSel.createEl('option', { value: s, text: s });
			if (s === item.status) o.selected = true;
		}

		const tagInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		tagInput.value = (item.tags || []).join('、'); tagInput.placeholder = '标签，顿号/逗号分隔';

		const bg = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '3' } });
		bg.value = item.background || ''; bg.placeholder = '背景 / 描述';

		const comm = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2' } });
		comm.value = item.commConclusion || ''; comm.placeholder = '沟通结论';

		const res = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2' } });
		res.value = item.researchConclusion || ''; res.placeholder = '调研结论';

		const meet = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2' } });
		meet.value = item.meetingConclusion || ''; meet.placeholder = '上会结论';

		const rmRow = wrap.createDiv({ cls: 'op-detail__row' });
		const rmChk = rmRow.createEl('input', { attr: { type: 'checkbox' } });
		rmChk.checked = item.toRoadmap;
		rmChk.disabled = item.status !== '已完成';
		rmRow.createSpan({ text: ' 转路标（仅「已完成」可勾）' });

		const detailInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		detailInput.value = item.detail || ''; detailInput.placeholder = '详情双链，如 [[机会点-xxx-详情]]';
		const openBtn = wrap.createEl('button', { cls: 'op-detail__btn op-detail__btn--ghost', text: '打开详情双链' });
		openBtn.addEventListener('click', () => void this.openOpportunityDetail({ ...item, detail: detailInput.value }));

		const btnRow = wrap.createDiv({ cls: 'op-detail__actions' });
		const saveBtn = btnRow.createEl('button', { cls: 'op-detail__btn op-detail__btn--primary', text: '保存' });
		const delBtn = btnRow.createEl('button', { cls: 'op-detail__btn op-detail__btn--danger', text: '删除' });

		saveBtn.addEventListener('click', () => {
			void this.saveOpportunityDetail(item, {
				title: titleInput.value.trim(),
				status: statusSel.value as OpportunityStatus,
				tags: tagInput.value.split(/[，,、]/).map((t) => t.trim()).filter(Boolean),
				background: bg.value.trim(),
				commConclusion: comm.value.trim(),
				researchConclusion: res.value.trim(),
				meetingConclusion: meet.value.trim(),
				toRoadmap: rmChk.checked,
				detail: detailInput.value.trim(),
			});
		});
		delBtn.addEventListener('click', () => void this.deleteOpportunityItem(item));
	}

	private async saveOpportunityDetail(item: OpportunityItem, f: {
		title: string; status: OpportunityStatus; tags: string[]; background: string;
		commConclusion: string; researchConclusion: string; meetingConclusion: string; toRoadmap: boolean; detail: string;
	}): Promise<void> {
		const path = this.opportunityPath();
		await updateOpportunity(this.app, path, item.id, {
			title: f.title, status: f.status, tags: f.tags, background: f.background,
			commConclusion: f.commConclusion, researchConclusion: f.researchConclusion,
			meetingConclusion: f.meetingConclusion, toRoadmap: f.toRoadmap, detail: f.detail,
		});
		const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) this.currentOpportunities[idx] = { ...cur, ...f };
		}
		this.currentOpportunities = sortOpportunities(this.currentOpportunities);
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.showToast('已保存');
		void this.refreshOpportunityBoard();
	}

	private renderOpportunityList(panel: HTMLElement, items: OpportunityItem[]): void {
		const chips = panel.createDiv({ cls: 'op-chips' });
		const mkChip = (label: string, active: boolean, onClick: () => void) => {
			const c = chips.createEl('button', { cls: 'op-chip' + (active ? ' is-active' : ''), text: label });
			c.addEventListener('click', onClick);
		};
		mkChip('全部', this.selectedOppStatus === 'all' && !this.oppShowRoadmapOnly, () => {
			this.selectedOppStatus = 'all'; this.oppShowRoadmapOnly = false; this.rerenderOppSidebarAndPanels();
		});
		for (const st of OPPORTUNITY_STATUS_LIST) {
			mkChip(st, this.selectedOppStatus === st, () => {
				this.selectedOppStatus = st; this.oppShowRoadmapOnly = false; this.rerenderOppSidebarAndPanels();
			});
		}

		const table = panel.createEl('table', { cls: 'po-tb2 op-tb' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		const cols: { key: string; label: string }[] = [
			{ key: 'title', label: '名称' },
			{ key: 'status', label: '状态' },
			{ key: 'createDate', label: '创建时间' },
			{ key: 'toRoadmap', label: '转路标' },
		];
		for (const c of cols) {
			const th = headRow.createEl('th', { text: c.label });
			th.addEventListener('click', () => this.sortOppList(c.key));
		}
		const tbody = table.createEl('tbody');
		for (const it of this.sortedOppList(items)) {
			const tr = tbody.createEl('tr');
			tr.createEl('td', { text: it.title });
			const stTd = tr.createEl('td');
			stTd.createSpan({ cls: 'op-st ' + OPPORTUNITY_STATUS_CLASS[it.status], text: it.status });
			tr.createEl('td', { text: it.createDate || '-' });
			tr.createEl('td', { text: it.toRoadmap ? '★' : '-' });
			tr.addEventListener('click', () => this.openOpportunityModal(it));
		}
	}

	private rerenderOppSidebarAndPanels(): void {
		const sidebar = this.boardEl?.querySelector('.op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderOpportunitySidebar(sidebar);
		this.renderOpportunityPanels();
	}

	private sortOppList(key: string): void {
		if (this.oppSortCol === key) this.oppSortDir = this.oppSortDir === 'asc' ? 'desc' : 'asc';
		else { this.oppSortCol = key; this.oppSortDir = 'asc'; }
		const panel = this.opMainEl?.querySelector('.po-panel[data-view="list"]') as HTMLElement | undefined;
		if (panel) this.renderOppPanel('list', panel, this.filteredOpportunities());
	}

	private sortedOppList(items: OpportunityItem[]): OpportunityItem[] {
		const col = this.oppSortCol;
		const dir = this.oppSortDir === 'asc' ? 1 : -1;
		const cellStr = (v: unknown): string => {
			if (typeof v === 'string') return v;
			if (typeof v === 'number' || typeof v === 'boolean') return String(v);
			return '';
		};
		return [...items].sort((a, b) => {
			let av: string; let bv: string;
			if (col === 'toRoadmap') { av = a.toRoadmap ? '1' : '0'; bv = b.toRoadmap ? '1' : '0'; }
			else { av = cellStr((a as unknown as Record<string, unknown>)[col] ?? ''); bv = cellStr((b as unknown as Record<string, unknown>)[col] ?? ''); }
			return av.localeCompare(bv, 'zh-CN') * dir;
		});
	}

	private openOpportunityModal(item?: OpportunityItem): void {
		const modal = new OpportunityModal({
			app: this.app,
			editData: item,
			onSave: (data: OpportunityFormData) => { void this.onOpportunitySave(data, item); },
		});
		modal.open();
	}

	private async openOpportunityDetail(it: OpportunityItem): Promise<void> {
		const link = (it.detail || '').trim();
		if (!link) { this.showToast('该机会点暂无详情双链'); return; }
		await this.app.workspace.openLinkText(link.replace(/^\[\[/, '').replace(/\]\]$/, ''), '', true);
	}

	private async onOpportunitySave(data: OpportunityFormData, item?: OpportunityItem): Promise<void> {
		const path = this.opportunityPath();
		if (item) {
			const patch: Partial<OpportunityItem> = {
				title: data.title, status: data.status, tags: data.tags, background: data.background,
				commConclusion: data.commConclusion, researchConclusion: data.researchConclusion,
				meetingConclusion: data.meetingConclusion,
				toRoadmap: data.toRoadmap, detail: data.detail,
			};
			await updateOpportunity(this.app, path, item.id, patch);
			const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
			if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) this.currentOpportunities[idx] = { ...cur, ...patch };
		}
		} else {
			const created = await createOpportunity(this.app, path, data);
			this.currentOpportunities.push(created);
		}
		this.currentOpportunities = sortOpportunities(this.currentOpportunities);
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.showToast(item ? '机会点已更新' : '机会点已创建');
		void this.refreshOpportunityBoard();
	}

	private async createOpportunityFile(): Promise<void> {
		this.openOpportunityModal(undefined);
	}

	private async setOpportunityStatus(item: OpportunityItem, status: OpportunityStatus): Promise<void> {
		const path = this.opportunityPath();
		await updateOpportunityStatus(this.app, path, item.id, status);
		const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) {
				this.currentOpportunities[idx] = {
					...cur,
					status,
					toRoadmap: status === '已完成' ? cur.toRoadmap : false,
				};
			}
		}
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.showToast('状态已更新为「' + status + '」');
		void this.refreshOpportunityBoard();
	}

	private async setOpportunityRoadmap(item: OpportunityItem, val: boolean): Promise<void> {
		const path = this.opportunityPath();
		await toggleOpportunityRoadmap(this.app, path, item.id, val);
		const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) this.currentOpportunities[idx] = { ...cur, toRoadmap: val };
		}
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		void this.refreshOpportunityBoard();
	}

	private async deleteOpportunityItem(item: OpportunityItem): Promise<void> {
		const path = this.opportunityPath();
		await deleteOpportunity(this.app, path, item.id);
		this.currentOpportunities = this.currentOpportunities.filter((i) => i.id !== item.id);
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.showToast('机会点已删除');
		void this.refreshOpportunityBoard();
	}

	private async refreshOpportunityBoard(): Promise<void> {
		if (this.currentPage !== 'opportunity') return;
		const items = await this.loadOpportunities();
		// 异步加载期间用户可能已切到其它页面；渲染前重校验，避免把机会点内容渲染进其它页面。
		if (this.currentPage !== 'opportunity' || !this.boardEl) return;
		this.currentOpportunities = items;
		const sidebar = this.boardEl?.querySelector('.op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderOpportunitySidebar(sidebar);
		this.renderOpportunityPanels();
	}

}
