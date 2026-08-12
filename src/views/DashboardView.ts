import { ItemView, Menu, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { MOCK_DATA, DashboardData } from '../data/mockData';
import { BannerSettings, DEFAULT_SETTINGS } from '../settings';
import { BannerModal } from './BannerModal';
import { TaskEditModal } from './TaskEditModal';
import { TaskItem, ProjectInfo, TaskStatus, ProjectType, priorityWeight, NodeState, RepeatRule } from '../data/taskParser';
import { TaskStore } from '../data/taskStore';
import type { ParseIssue } from '../data/parserDiagnostics';
import { DashboardStore } from '../data/dashboardStore';
import { OpportunityBoard } from './OpportunityBoard';
import { ProjectBoard } from './ProjectBoard';
import { fmtDate, todayStr, nowFmt, calcNextRemindDate, getTodayUniverse, getTodayTasks, isDoneToday, isSkipToday, overdueDays, urgencyMeta } from '../data/taskLogic';

import type AgentDashboard from '../main';
import {
	ICON_home, ICON_newDiary, ICON_newTask, ICON_newProject,
	ICON_allProjects, ICON_opportunity, injectSvg,
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
	public plugin: AgentDashboard;
	private bannerState: BannerSettings;
	private bannerImg: HTMLImageElement | null = null;
	private bannerPh: HTMLElement | null = null;
	public boardEl: HTMLElement | null = null;
	private heatmapCard: HTMLElement | null = null;
	private heatmapTimer: number | null = null;
	private noiseId: number | null = null;
	private pulseEls: { total: HTMLElement; pending: HTMLElement; today: HTMLElement; streak: HTMLElement } | null = null;
	private dateEl: HTMLElement | null = null;
	// NOTE: deliberately NOT named `titleEl` — Obsidian's ItemView has its own
	// `titleEl` (view-header title). Declaring a field with that name would
	// overwrite the parent's after super() and break ItemView.load()
	// ("Cannot read properties of null (reading 'setText')" → blank view).
	private adTitleEl: HTMLElement | null = null;
	private weekdayEl: HTMLElement | null = null;
	private parseIssuesEl: HTMLElement | null = null;
	private lunarEl: HTMLElement | null = null;
	private dashboardEl: HTMLElement | null = null;
	/** Header theme-toggle button. Prefixed to avoid clashing with ItemView fields. */
	private adThemeBtn: HTMLElement | null = null;

	// Project overview state (renderer extracted into ProjectBoard)
	public selectedProject: string | null = null;

	// Which top-level page is currently shown (home / project overview / opportunity board)
	public currentPage: 'home' | 'project' | 'opportunity' = 'home';

	public taskStore: TaskStore;
	private dashboardStore: DashboardStore;
	private storeUnsub: (() => void) | null = null;
	private oppBoard: OpportunityBoard;
	private projectBoard: ProjectBoard;

	constructor(leaf: WorkspaceLeaf, plugin: AgentDashboard) {
		super(leaf);
		this.plugin = plugin;
		this.bannerState = { ...DEFAULT_SETTINGS.banner, ...plugin.settings.banner };
		this.taskStore = new TaskStore(this.app, () => this.plugin.settings, (msg) => this.showToast(msg));
		this.dashboardStore = new DashboardStore(this.taskStore);
		this.oppBoard = new OpportunityBoard(this);
		this.projectBoard = new ProjectBoard(this);
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
		btn.textContent = eff === 'dark' ? '\u2600' : '\uD83C\uDF19';
		btn.title = (eff === 'dark' ? '\u5207\u6362\u5230\u6D45\u8272' : '\u5207\u6362\u5230\u6DF1\u8272')
			+ '\uFF08\u540C\u65F6\u5207\u6362 Obsidian \u5916\u89C2\uFF09';
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
		this.renderParseIssues(this.dashboardEl);
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
				void this.projectBoard.refresh();
			} else if (this.currentPage === 'opportunity') {
				this.oppBoard.scheduleRefresh();
			} else {
				this.scheduleHeatmapRefresh();
				this.dashboardStore.requestRefresh();
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
				void this.projectBoard.refresh();
			} else if (this.currentPage === 'opportunity') {
				if (file instanceof TFile && file.path === this.plugin.settings.opportunityFile) {
					void this.updatePulse();
					this.oppBoard.scheduleRefresh();
				}
			} else {
				// Home: ignore edits to unrelated files. Only task files (markdown under
				// the projects folder) affect the home cards, so this saves a full rescan
				// on every unrelated note edit while still staying fresh for real changes.
				if (!(file instanceof TFile) || !this.taskStore.isTaskRelevantPath(file.path)) return;
				void this.updatePulse();
				this.dashboardStore.requestRefresh();
			}
		}));
		this.storeUnsub = this.dashboardStore.subscribe(() => {
			if (this.currentPage !== 'home' || !this.boardEl) return;
			void this.refreshHomeCards();
		});

		// Initial scan populates parse diagnostics asynchronously; refresh the
		// banner warning once the first scans have completed.
		window.setTimeout(() => this.refreshParseIssues(), 400);
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
		this.oppBoard.dispose();
		if (this.storeUnsub) { this.storeUnsub(); this.storeUnsub = null; }
		this.dashboardStore.dispose();
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
			// 手动切换主题时直接驱动 Obsidian 整体外观，仪表盘通过 'auto' 跟随。
			this.plugin.setObsidianTheme(next);
			this.plugin.settings.theme = 'auto';
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

		// 导航组：去哪看（主页 / 全部项目 / 机会点）
		const navItems: Array<{ glyph: string; label: string; action: string; svg?: string }> = [
			{ glyph: '\u2302', label: '\u4E3B\u9875', action: 'home', svg: ICON_home },
			{ glyph: '\u203A', label: '\u5168\u90E8\u9879\u76EE', action: 'all', svg: ICON_allProjects },
			{ glyph: '\u25C8', label: '\u673A\u4F1A\u70B9', action: 'opportunity', svg: ICON_opportunity },
		];
		// 动作组：建什么（新建日记 / 新建任务 / 新建项目）
		const actionItems: Array<{ glyph: string; label: string; action: string; svg?: string }> = [
			{ glyph: '+', label: '\u65B0\u5EFA\u65E5\u8BB0', action: 'diary', svg: ICON_newDiary },
			{ glyph: '\u25A1', label: '\u65B0\u5EFA\u4EFB\u52A1', action: 'task', svg: ICON_newTask },
			{ glyph: '\u25A3', label: '\u65B0\u5EFA\u9879\u76EE', action: 'project', svg: ICON_newProject },
		];

		const makeBtn = (it: { glyph: string; label: string; action: string; svg?: string }, extraCls = ''): HTMLElement => {
			const btn = nav.createEl('button', { cls: 'ad-toolbar__btn' + (extraCls ? ' ' + extraCls : '') });
			const glyphEl = btn.createSpan({ cls: 'ad-glyph' });
			if (it.svg) injectSvg(glyphEl, it.svg);
			else glyphEl.textContent = it.glyph;
			btn.createSpan({ text: it.label });
			btn.addEventListener('click', () => {
				btn.addClass('is-active');
				try {
					if (it.action === 'home') this.showDashboard();
					if (it.action === 'diary') void this.createDiary();
					if (it.action === 'task') void this.openTaskModal(this.selectedProject ?? undefined);
					if (it.action === 'project') void this.createProjectFile();
					if (it.action === 'all') void this.projectBoard.show();
					if (it.action === 'opportunity') void this.oppBoard.show();
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					this.showToast('打开失败：' + msg, 'error');
					console.error('[AgentDashboard] toolbar action "' + it.action + '" failed', e);
				}
				window.setTimeout(() => btn.removeClass('is-active'), 350);
			});
			return btn;
		};

		const navGroup = nav.createDiv({ cls: 'ad-toolbar__group' });
		navItems.forEach((it) => navGroup.appendChild(makeBtn(it)));
		nav.createDiv({ cls: 'ad-toolbar__sep' });
		const actGroup = nav.createDiv({ cls: 'ad-toolbar__group ad-toolbar__group--action' });
		actionItems.forEach((it) => actGroup.appendChild(makeBtn(it, 'ad-toolbar__btn--action')));
	}

	/* ============================================================
	   Parse-issue banner (shown directly under the banner image)
	   ============================================================ */
	private renderParseIssues(root: HTMLElement): void {
		const el = root.createDiv({ cls: 'ad-parse-issues ad-parse-issues--hidden' });
		this.parseIssuesEl = el;
		this.refreshParseIssues();
	}

	private refreshParseIssues(): void {
		const el = this.parseIssuesEl;
		if (!el) return;
		const issues = this.taskStore.getParseIssues();
		el.empty();
		if (issues.length === 0) {
			el.addClass('ad-parse-issues--hidden');
			return;
		}
		el.removeClass('ad-parse-issues--hidden');

		const bar = el.createDiv({ cls: 'ad-parse-issues__bar' });
		bar.createSpan({ cls: 'ad-parse-issues__icon', text: '⚠' });
		bar.createSpan({ cls: 'ad-parse-issues__text', text: `${issues.length} 个文件解析异常（数据可能不完整），点击查看` });
		const toggle = bar.createSpan({ cls: 'ad-parse-issues__toggle', text: '收起' });
		const list = el.createDiv({ cls: 'ad-parse-issues__list ad-parse-issues__list--hidden' });

		bar.addEventListener('click', () => {
			const hidden = list.classList.toggle('ad-parse-issues__list--hidden');
			toggle.textContent = hidden ? '展开' : '收起';
		});

		for (const it of issues) {
			const row = list.createDiv({ cls: 'ad-parse-issues__item' });
			row.createSpan({ cls: 'ad-parse-issues__path', text: it.path });
			row.createSpan({ cls: 'ad-parse-issues__msg', text: `[${it.kind}] ${it.message}` });
			const openBtn = row.createEl('button', { cls: 'ad-parse-issues__open', text: '在 Obsidian 打开' });
			openBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.openFileByPath(it.path);
			});
		}
	}

	private async openFileByPath(path: string): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (f instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(true);
			await leaf.openFile(f);
		} else {
			this.showToast('文件不存在：' + path, 'error');
		}
	}

	/* ============================================================
	   Empty-state helper + first-run guide (no sample-data auto-create)
	   ============================================================ */
	private renderEmpty(container: HTMLElement, opts: {
		icon?: string;
		title: string;
		hint?: string;
		actionLabel?: string;
		onAction?: () => void;
	}): void {
		const e = container.createDiv({ cls: 'ad-empty' });
		if (opts.icon) e.createDiv({ cls: 'ad-empty__icon', text: opts.icon });
		e.createDiv({ cls: 'ad-empty__title', text: opts.title });
		if (opts.hint) e.createDiv({ cls: 'ad-empty__hint', text: opts.hint });
		if (opts.actionLabel && opts.onAction) {
			const btn = e.createEl('button', { cls: 'ad-empty__btn', text: opts.actionLabel });
			btn.addEventListener('click', () => opts.onAction!());
		}
	}

	private async renderFirstRunIfEmpty(board: HTMLElement): Promise<void> {
		try {
			const projects = await this.taskStore.scanAllProjects();
			const tasks = await this.taskStore.scanAllTasks();
			if (projects.length > 0 || tasks.length > 0) return;
		} catch {
			return;
		}
		const card = board.createDiv({ cls: 'ad-card ad-card--guide' });
		this.cardHead(card, '\u{1F680}', '欢迎使用 Dashboard');
		card.createDiv({ cls: 'ad-guide__body', text: '检测到你的知识库还没有任何项目或任务。从下面任意一个开始，几秒即可上手：' });
		const actions = card.createDiv({ cls: 'ad-guide__actions' });
		const mk = (label: string, fn: () => void) => {
			const b = actions.createEl('button', { cls: 'ad-guide__btn', text: label });
			b.addEventListener('click', fn);
		};
		mk('＋ 新建项目', () => void this.createProjectFile());
		mk('＋ 新建任务', () => void this.openTaskModal(this.selectedProject ?? undefined));
		mk('＋ 新建日记', () => void this.createDiary());
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
		void this.renderFirstRunIfEmpty(board);
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
	public showToast(message: string, kind: 'success' | 'error' = 'success'): void {
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
			const tplPath = this.resolveTemplatePath(qc.templateFile);
			const tplFile = this.app.vault.getAbstractFileByPath(tplPath);
			if (tplFile instanceof TFile) {
				const tpl = await this.app.vault.read(tplFile);
				fileContent = this.applyTemplate(tpl, content, filename, now);
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
		if (dc.templateFile) {
			const tplPath = this.resolveTemplatePath(dc.templateFile);
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

	private resolveTemplatePath(file: string): string {
		const f = file.trim();
		if (!f) return '';
		return f.endsWith('.md') ? f : `${f}.md`;
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
	async toggleTask(task: TaskItem, row: HTMLElement): Promise<void> {
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
	async writeFrontmatter(file: TFile, updates: Record<string, string>): Promise<void> {
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

	/** Edit project via ProjectModal */
	async editProject(proj: ProjectInfo): Promise<void> {
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
		await this.projectBoard.refresh();
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

	/** Delete task file from vault */
	async deleteTask(task: TaskItem): Promise<void> {
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

	/** Open TaskEditModal for a given task */
	openTaskEditModal(task: TaskItem, presetTodayNode?: NodeState): void {
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
	async createProjectFile(): Promise<void> {
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
	async openTaskModalWithParent(parentName: string, projectName: string): Promise<void> {
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
		// A first-run guide (if shown at load) should yield as soon as the user
		// starts populating the vault, so drop any stale guide on refresh.
		this.boardEl.querySelector('.ad-card--guide')?.remove();
		const allTasks = this.dashboardStore.getTasks() ?? await this.taskStore.scanAllTasks();
		// scanAllTasks 是异步耗时操作；期间用户可能已切到其它页面。
		// 必须在渲染前重校验，否则会把主页卡片渲染进机会点/项目页面。
		if (this.currentPage !== 'home' || !this.boardEl) return;
		await this.renderTodo(this.boardEl, allTasks);
		await this.renderProgress(this.boardEl, allTasks);
		await this.renderWeekly(this.boardEl, allTasks);
		await this.renderProjects(this.boardEl);
		this.refreshParseIssues();
	}

	/** Refresh whichever board is active (home cards, project overview, or opportunity board) */
	private refreshRelevant(): void {
		this.taskStore.invalidate();
		// Auto-close recurring tasks that have passed their end-date bound before re-rendering.
		void this.closeRecurringIfExpired();
		if (this.currentPage === 'project') {
			void this.projectBoard.refresh();
		} else if (this.currentPage === 'opportunity') {
			this.oppBoard.scheduleRefresh();
		} else {
			void this.dashboardStore.refresh();
		}
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

		if (tasks.length === 0) {
			this.renderEmpty(card, {
				icon: '\u{1F3AF}',
				title: '还没有任何任务',
				hint: '在下方「快速捕捉」里随手记一条，或点工具栏「＋ 新建任务」开始。',
				actionLabel: '＋ 新建任务',
				onAction: () => void this.openTaskModal(this.selectedProject ?? undefined),
			});
			return;
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
				list.createDiv({ cls: 'ad-wo__empty', text: '\u{1F389} \u672C\u5468\u6682\u65E0\u5F85\u529E\u4EFB\u52A1' });
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
		const card = this.getOrCreateCard(board, 'ad-card ad-b-project');
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

		if (projects.length === 0) {
			this.renderEmpty(card, {
				icon: '\u{1F4D1}',
				title: '\u8FD8\u6CA1\u6709\u4EFB\u4F55\u9879\u76EE',
				hint: '\u70B9\u5DE5\u5177\u680F\u300C\uFF0B \u65B0\u5EFA\u9879\u76EE\u300D\u521B\u5EFA\u7B2C\u4E00\u4E2A\u9879\u76EE\uFF0C\u8FDB\u5EA6\u7BA1\u9053\u5C31\u4F1A\u663E\u793A\u5728\u8FD9\u91CC\u3002',
				actionLabel: '\uFF0B \u65B0\u5EFA\u9879\u76EE',
				onAction: () => void this.createProjectFile(),
			});
			return;
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
		await this.projectBoard.openProjectGantt(proj);
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

}
