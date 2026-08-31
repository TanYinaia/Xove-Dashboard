import { ItemView, Menu, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { MOCK_DATA, DashboardData } from '../data/mockData';
import { BannerSettings, DEFAULT_SETTINGS, CountdownSettings } from '../settings';
import { BannerModal } from './BannerModal';
import { CountdownModal, defaultEventName } from './CountdownModal';
import { TaskEditModal } from './TaskEditModal';
import { TaskItem, ProjectInfo, TaskStatus, ProjectType, priorityWeight, NodeState, RepeatRule, serializeDailyNodesBlock, parseDailyNodesFromBody } from '../data/taskParser';
import { TaskStore } from '../data/taskStore';
import { writeFrontmatter as fmWriteFrontmatter, yamlScalar } from '../data/frontmatterWriter';
import type { ParseIssue } from '../data/parserDiagnostics';
import { DashboardStore } from '../data/dashboardStore';
import { OpportunityBoard } from './OpportunityBoard';
import { ProjectBoard } from './ProjectBoard';
import { fmtDate, todayStr, nowFmt, calcNextRemindDate, getTodayUniverse, getTodayTasks, isDoneToday, isSkipToday, overdueDays } from '../data/taskLogic';
import { t, tArr, isEnglish } from '../i18n';
import { UI_TEXT } from '../constants';

import type Dashboard from '../main';
import {
	ICON_home, ICON_newDiary, ICON_newTask, ICON_newProject,
	ICON_allProjects, ICON_opportunity, ICON_gear, ICON_moon, ICON_sun, injectSvg,
} from '../icons';

export const VIEW_TYPE = 'dashboard-view';

/** 首页模块描述符：id 对应 settings.homeModules，render 为对应渲染函数 */
interface HomeModule {
	id: string;
	title: string;
	cardCls: string;
	/** 是否参与数据刷新（refreshHomeCards）。false = 仅在初次渲染时绘制（如快速捕捉输入框、热力图、倒计时），避免刷新时清空输入或重复创建 */
	live?: boolean;
	render: (board: HTMLElement, allTasks?: TaskItem[]) => Promise<void> | void;
}

/** 卡片比例的最大格数（宽/高均为 1..4，4 = 页面最宽） */
const MAX_SPAN = 4;

/** 部分卡片的最低宽度（单位=格），限制缩放/比例菜单，避免关键卡片被压得过窄 */
const MIN_COLS: Record<string, number> = {
	'projects': 2, // 项目情况：最低宽度 2 格
	'heatmap': 2,  // 笔记统计：最低宽度 2 格（2×1 走窄版间距 + 自适应窗口）
};

/** 热力图格子尺寸（px，固定不变）与列间距的允许区间 —— 只调间距、不改格子尺寸 */
const HM_CELL = 15;
const HM_GAP_MIN = 3;
const HM_GAP_MAX = 14;
/** 星期列（22px）+ grid 列间距（4px），即 cells 相对 heat 容器的左侧偏移 */
const HM_DOW_W = 26;
/** 窄卡时至少保留的周数，避免退化成几根竖条 */
const HM_MIN_WEEKS = 10;

/** 部分卡片的最低宽高比（宽:高），限制缩放/比例菜单与响应式夹紧，避免关键卡片被压成过窄过高的竖条 */
const MIN_RATIO: Record<string, number> = {
	'projects': 2, // 项目情况：最低 2:1
	'heatmap': 3,  // 笔记统计：最低 3:1
};

/** 进度圆环动画参数（可按需微调）：时长 + 缓动曲线 */
const RING_ANIM = {
	/** 单次动画时长（毫秒） */
	duration: 900,
	/** 缓动曲线：easeOutCubic —— 起步快、收尾缓，符合进度填充的直觉 */
	easing: (t: number): number => 1 - Math.pow(1 - t, 3),
};

/** 把任意输入夹到合法的格数区间，非法值回退为 1 */
function clampSpan(v: unknown): number {
	const n = typeof v === 'number' ? Math.round(v) : parseInt(String(v ?? ''), 10);
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.min(MAX_SPAN, n);
}

/** 拖拽过程中的临时状态（编辑态下长按卡片后跟随指针移动） */
interface DragState {
	card: HTMLElement;
	placeholder: HTMLElement;
	offsetX: number;
	offsetY: number;
	lastX: number;
	lastY: number;
	overTrash: boolean;
	moved: boolean;
	/** rAF 节流句柄：拖拽期间每帧最多做一次重排计算 */
	raf: number | null;
}

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
	public plugin: Dashboard;
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

	// 首页编辑态（长按进入，仿手机桌面：拖拽排序 / 拖入垃圾桶删除 / 添加卡片）
	private adEditMode = false;
	private adEditBar: HTMLElement | null = null;
	private adDrag: DragState | null = null;
	private adResize: { card: HTMLElement; modId: string; startCols: number; startRows: number; x0: number; y0: number; moved: boolean } | null = null;
	private adLongPressTimer: number | null = null;
	private adBoardWired = false;
	/** 监听板面宽度，计算每行最大可容纳列数，并在 flex-wrap 布局下重夹紧卡片比例 */
	private adRowHObs?: ResizeObserver;
	private adLastColCount = 0; // 上次每行最大可容纳列数，用于变化时重夹紧卡片比例
	/** 监听笔记统计卡宽度，动态调整热力图列间距（格子尺寸固定），宽卡填满、窄卡收紧 */
	private adHmObs?: ResizeObserver;
	private adHmObsTarget?: HTMLElement;
	/** 上次热力图采用的布局指纹（周数|列间距|行间距），相同则跳过重排，避免 ResizeObserver 自激循环 */
	private adHmKey = '';
	/** 热力图每一周所属月份（长度=全年周数），窄卡只显示最近 N 周时据此重建月份标签 */
	private adHmWeekMonths: number[] = [];
	/** 热力图当前渲染的年份（用于底部窗口文案「YYYY 全年 / 近 N 周」） */
	private adHmYear = 0;
	/** 缩放触达限制时的红色抖动反馈计时器 */
	private adLimitTimer: number | null = null;
	/** 进度圆环：各环当前显示值与进行中的动画句柄（实例级持久化，
	 *  保证相邻刷新从「上次显示值」平滑过渡到新目标值，而非瞬间跳变） */
	private ringAnim: Record<string, { raf: number; value: number }> = {};
	/** 编辑态下拦截卡片自身的点击（避免误触下钻），仅拦截卡片内部；比例按钮例外放行 */
	private adClickGuard = (e: MouseEvent): void => {
		const t = e.target as HTMLElement;
		if (this.adEditMode && t.closest('.ad-card') && !t.closest('.ad-card__resize')) {
			e.preventDefault();
			e.stopPropagation();
		}
	};

	// 首页模块注册表：将 7 张卡的渲染从硬编码顺序统一为「注册表驱动 + settings.homeModules 排序/显隐」
	private homeModules: HomeModule[] = [
		{ id: 'quick-capture', title: t('home.modules.quickCapture'), cardCls: 'ad-card ad-b-capture', live: false, render: (b) => this.renderQuickCapture(b) },
		{ id: 'todo', title: 'TODO', cardCls: 'ad-card ad-b-todo', render: (b, t) => void this.renderTodo(b, t) },
		{ id: 'progress', title: t('home.modules.progress'), cardCls: 'ad-card ad-b-progress', render: (b, t) => void this.renderProgress(b, t) },
		{ id: 'weekly', title: t('home.modules.weekly'), cardCls: 'ad-card ad-b-weekly', render: (b, t) => void this.renderWeekly(b, t) },
		{ id: 'projects', title: t('home.modules.projects'), cardCls: 'ad-card ad-b-project', render: (b) => void this.renderProjects(b) },
		{ id: 'heatmap', title: t('home.modules.heatmap'), cardCls: 'ad-card ad-b-heatmap', live: false, render: (b) => this.renderHeatmap(b) },
		{ id: 'countdown', title: t('home.modules.countdown'), cardCls: 'ad-card ad-b-countdown', live: false, render: () => {} },
		{ id: 'pomodoro', title: t('home.modules.pomodoro'), cardCls: 'ad-card ad-b-pomodoro', live: false, render: (b) => this.renderPomodoro(b) },
	];

	// Project overview state (renderer extracted into ProjectBoard)
	public selectedProject: string | null = null;

	// Which top-level page is currently shown (home / project overview / opportunity board)
	public currentPage: 'home' | 'project' | 'opportunity' = 'home';

	public taskStore: TaskStore;
	private dashboardStore: DashboardStore;
	private storeUnsub: (() => void) | null = null;
	private oppBoard: OpportunityBoard;
	private projectBoard: ProjectBoard;

	/* ---- 番茄钟（状态提升到 plugin.pomoState，主页卡片与状态栏共用） ---- */
	private adPomoTimer: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: Dashboard) {
		super(leaf);
		this.plugin = plugin;
		// 首次使用时按当前设置初始化工作时长（开始过后保持实际剩余，不覆盖）
		if (!this.plugin.pomoState.started) this.plugin.pomoState.remaining = this.pomoWorkMs();
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
		const root = this.dashboardEl ?? (this.containerEl.querySelector('.dashboard-plugin'));
		if (root) root.setAttribute('data-theme', this.effectiveTheme());
		this.refreshThemeButton();
	}

	/** Keep the header toggle's icon/tooltip in sync with the effective theme. */
	refreshThemeButton(): void {
		const btn = this.adThemeBtn;
		if (!btn) return;
		const eff = this.effectiveTheme();
		btn.textContent = '';
		injectSvg(btn, eff === 'dark' ? ICON_sun : ICON_moon);
		btn.title = eff === 'dark' ? t('home.themeToLight') : t('home.themeToDark');
	}

	getViewType(): string { return VIEW_TYPE; }
	getDisplayText(): string { return 'Xove Dashboard'; }
	getIcon(): string { return 'layout-dashboard'; }

	async onOpen(): Promise<void> {
		// NOTE: earlier builds emptied this.containerEl then added .dashboard-plugin
		// directly; that was fine (the "setText on null" bug was the titleEl field
		// collision, NOT the empty()). Now we clear the container's leftovers
		// (Obsidian/theme placeholders) so our root div sits at the very top, then
		// create a child <div class="dashboard-plugin"> and render into it.
		this.containerEl.empty();
		this.dashboardEl = this.containerEl.createDiv({ cls: 'dashboard-plugin' });
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
				} else if (this.currentPage === 'opportunity' && this.plugin.settings.boardEnabled) {
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
				this.dashboardEl?.createEl('pre', { cls: 'ad-error', text: t('home.renderError') + '：\n' + (e.stack || e.message) });
			} catch { /* ignore */ }
			console.error('[Dashboard] render error', err);
		}
	}

	async onClose(): Promise<void> {
		if (this.noiseId) { window.cancelAnimationFrame(this.noiseId); this.noiseId = null; }
		if (this.adRowHObs) { this.adRowHObs.disconnect(); this.adRowHObs = undefined; }
		if (this.adHmObs) { this.adHmObs.disconnect(); this.adHmObs = undefined; this.adHmObsTarget = undefined; }
		if (this.adLimitTimer !== null) { window.clearTimeout(this.adLimitTimer); this.adLimitTimer = null; }
		if (this.adPomoTimer !== null) { window.clearInterval(this.adPomoTimer); this.adPomoTimer = null; }
		this.oppBoard.dispose();
		if (this.storeUnsub) { this.storeUnsub(); this.storeUnsub = null; }
		this.dashboardStore.dispose();
		this.dashboardEl?.empty();
	}

	/* ============================================================
	   BANNER — image insert via modal, vertical drag only
	   ============================================================ */
	private renderBanner(root: HTMLElement): void {
		if (!this.plugin.settings.banner.enabled) return;
		const banner = root.createDiv({ cls: 'ad-banner' });
		const ph = banner.createDiv({ cls: 'ad-banner__ph', text: t('home.bannerPlaceholder') });
		this.bannerPh = ph;

		const img = banner.createEl('img', { cls: 'ad-banner__img ad-banner__img--hidden' });
		img.alt = 'Banner';
		this.bannerImg = img;

		// toolbar
		const bar = banner.createDiv({ cls: 'ad-banner__bar' });
		const pickBtn = bar.createEl('button', { cls: 'ad-banner__btn', text: t('home.changeImage') });

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
		// 保留设置中当前的 enabled（横幅开关可能在视图打开后被设置页改过）
		const enabled = this.plugin.settings.banner?.enabled ?? true;
		this.plugin.settings.banner = { ...this.bannerState, enabled };
		await this.plugin.saveSettings();
	}

	/** 设置页开关横幅后，立即重建横幅显隐（无需重载视图） */
	refreshBanner(): void {
		const root = this.dashboardEl;
		if (!root) return;
		const old = root.querySelector('.ad-banner');
		const enabled = !!this.plugin.settings.banner.enabled;
		if (!enabled) {
			if (old) old.remove();
			this.bannerPh = null;
			this.bannerImg = null;
			return;
		}
		if (old) return; // 已显示，无需重建
		this.bannerPh = null;
		this.bannerImg = null;
		this.bannerState = { ...DEFAULT_SETTINGS.banner, ...this.plugin.settings.banner };
		this.renderBanner(root);
		const nb = root.querySelector('.ad-banner');
		if (nb) root.insertBefore(nb, root.firstChild);
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
		// 直接复用现有卡片（getOrCreateCard 会命中并清空旧卡子节点），不要先 remove 再重建——
		// 重建会丢掉卡片的 --cols/--rows（回退 1×1），且造成无谓的重排闪烁。
		if (!this.boardEl) return;
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
		left.createEl('p', { cls: 'ad-subtitle', text: 'Obsidian · Xove Dashboard · v' + (this.plugin.manifest?.version ?? d.header.subtitle.replace(/^.*v/, 'v')) });

		const right = h.createDiv({ cls: 'ad-header__right' });

		const now = new Date();
		const loc = isEnglish() ? 'en-US' : 'zh-CN';
		const dateStr = now.toLocaleDateString(loc, { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
		const timeStr = now.toLocaleTimeString(loc, { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
		this.dateEl = right.createDiv({ cls: 'ad-header__date', text: `${dateStr} ${timeStr}` });

		const meta = right.createDiv({ cls: 'ad-header__meta' });
		this.weekdayEl = meta.createSpan({ text: new Date().toLocaleDateString(loc, { timeZone: 'Asia/Shanghai', weekday: 'long' }) });
		meta.createSpan({ cls: 'ad-dot' });
		// Compute the real lunar date up front (mock data has a stale literal);
		// the 30s interval below keeps it fresh across day boundaries.
		// 决策2：英文模式下自动隐藏农历。
		const initialLunar = getLunarDate(new Date());
		if (initialLunar && !isEnglish()) {
			this.lunarEl = meta.createSpan({ text: t('home.lunarPrefix') + initialLunar });
		} else if (!isEnglish()) {
			this.lunarEl = meta.createSpan({ text: d.lunar });
		}

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

		const settings = btns.createEl('button', { cls: 'ad-header__settings', attr: { 'aria-label': t('home.settingsBtn') } });
		injectSvg(settings, ICON_gear);
		settings.addEventListener('click', () => {
			interface SettingApi { open(): void; openTabById(id: string): void }
			const app = this.app as unknown as { setting?: SettingApi };
			app.setting?.open();
			app.setting?.openTabById(this.plugin.manifest.id);
		});

		// Update time every 30 seconds
		this.registerInterval(window.setInterval(() => {
			const n = new Date();
			const l = isEnglish() ? 'en-US' : 'zh-CN';
			if (this.dateEl) {
				const ds = n.toLocaleDateString(l, { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
				const ts = n.toLocaleTimeString(l, { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
				this.dateEl.textContent = `${ds} ${ts}`;
			}
			if (this.weekdayEl) {
				this.weekdayEl.textContent = n.toLocaleDateString(l, { timeZone: 'Asia/Shanghai', weekday: 'long' });
			}
			// 英文模式下 lunarEl 不存在（决策2：隐藏农历），自然跳过
			if (this.lunarEl) {
				const lunar = getLunarDate(n);
				if (lunar) this.lunarEl.textContent = t('home.lunarPrefix') + lunar;
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
			{ glyph: '\u2302', label: t('home.nav.home'), action: 'home', svg: ICON_home },
			{ glyph: '\u203A', label: t('home.nav.allProjects'), action: 'all', svg: ICON_allProjects },
		];
		if (this.plugin.settings.boardEnabled) {
			navItems.push({ glyph: '\u25C8', label: this.plugin.settings.boardTitle || t('home.nav.board'), action: 'opportunity', svg: ICON_opportunity });
		}
		// 动作组：建什么（新建日记 / 新建任务 / 新建项目）
		const actionItems: Array<{ glyph: string; label: string; action: string; svg?: string }> = [
			{ glyph: '+', label: t('home.nav.newDiary'), action: 'diary', svg: ICON_newDiary },
			{ glyph: '\u25A1', label: t('home.nav.newTask'), action: 'task', svg: ICON_newTask },
			{ glyph: '\u25A3', label: t('home.nav.newProject'), action: 'project', svg: ICON_newProject },
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
					if (it.action === 'home') void this.showDashboard();
					if (it.action === 'diary') void this.createDiary();
					if (it.action === 'task') void this.openTaskModal(this.selectedProject ?? undefined);
					if (it.action === 'project') void this.createProjectFile();
					if (it.action === 'all') void this.projectBoard.show();
					if (it.action === 'opportunity') void this.oppBoard.show();
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					this.showToast(t('home.openFailed') + msg, 'error');
					console.error('[Dashboard] toolbar action "' + it.action + '" failed', e);
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
		bar.createSpan({ cls: 'ad-parse-issues__text', text: t('home.parseIssues', { n: issues.length }) });
		const toggle = bar.createSpan({ cls: 'ad-parse-issues__toggle', text: t('common.collapse') });
		const list = el.createDiv({ cls: 'ad-parse-issues__list ad-parse-issues__list--hidden' });

		bar.addEventListener('click', () => {
			const hidden = list.classList.toggle('ad-parse-issues__list--hidden');
			toggle.textContent = hidden ? t('common.expand') : t('common.collapse');
		});

		for (const it of issues) {
			const row = list.createDiv({ cls: 'ad-parse-issues__item' });
			row.createSpan({ cls: 'ad-parse-issues__path', text: it.path });
			row.createSpan({ cls: 'ad-parse-issues__msg', text: `[${it.kind}] ${it.message}` });
			const openBtn = row.createEl('button', { cls: 'ad-parse-issues__open', text: t('home.parseOpen') });
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
			this.showToast(t('home.fileNotFound') + path, 'error');
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
		this.cardHead(card, '\u{1F680}', t('home.guideTitle'));
		card.createDiv({ cls: 'ad-guide__body', text: t('home.guideBody') });
		const actions = card.createDiv({ cls: 'ad-guide__actions' });
		const mk = (label: string, fn: () => void) => {
			const b = actions.createEl('button', { cls: 'ad-guide__btn', text: label });
			b.addEventListener('click', fn);
		};
		mk(t('home.guideNewProject'), () => void this.createProjectFile());
		mk(t('home.guideNewTask'), () => void this.openTaskModal(this.selectedProject ?? undefined));
		mk(t('home.guideNewDiary'), () => void this.createDiary());
	}

	/* ============================================================
	   Board — single grid containing all cards
	   ============================================================ */
	private renderBoard(root: HTMLElement, d: DashboardData): void {
		const board = root.createDiv({ cls: 'ad-board' });
		this.boardEl = board;
		// 按注册表渲染全部启用模块
		void this.renderEnabledModules(board);
		this.attachBoardInteractions();
		void this.renderFirstRunIfEmpty(board);
	}

	/* ---- Quick Capture ---- */
	private renderQuickCapture(board: HTMLElement): void {
		// 复用已存在的卡壳（由 renderEnabledModules 按顺序建好），否则每次渲染都会追加一张新卡
		const card = this.getOrCreateCard(board, 'ad-card ad-b-capture');
		this.cardHead(card, '\u25C6', t('home.modules.quickCapture'));
		const qc = card.createDiv({ cls: 'ad-qc' });
		const area = qc.createEl('textarea', {
			cls: 'ad-qc__area',
			attr: { rows: '3', placeholder: t('home.quickCapturePlaceholder') },
		});
		const row = qc.createDiv({ cls: 'ad-qc__row' });
		const cta = row.createEl('button', { cls: 'ad-qc__cta', text: t('home.captureBtn') });

		const submit = async () => {
			const content = area.value.trim();
			if (!content) { area.focus(); return; }
			cta.addClass('flash');
			try {
				await this.createCaptureNote(content);
				area.value = '';
				this.showToast(t('home.capturedToast'));
			} catch (err) {
				console.error('[Dashboard] 快速捕捉失败', err);
				this.showToast(t('home.captureFailed'), 'error');
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
			this.showToast(t('home.fileExists', { name: filename }));
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
		this.showToast(t('home.diaryCreated', { name: filename }));

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
		const WK_SHORT = tArr('status.weekShort');
		const WK_FULL = tArr('status.weekLong');
		const meridiem = tArr('status.amPm')[d.getHours() < 12 ? 0 : 1]!;
		const h12 = d.getHours() % 12 || 12;
		// 支持的命名占位符（一次性正则替换，避免 DD 与 ddd/dddd 互相串扰）。
		// YYYY 年 / MM 月(2位) / MMM 月缩写(如 8月) / DD 日(2位)
		// ddd 星期短(周日) / dddd 星期全(星期日)
		// HH 24小时 / hh 12小时 / mm 分 / ss|SS 秒 / A 上午·下午
		const map: Record<string, string> = {
			YYYY: String(d.getFullYear()),
			MMM: tArr('status.months')[d.getMonth()]!,
			MM: pad(d.getMonth() + 1),
			dddd: WK_FULL[d.getDay()]!,
			ddd: WK_SHORT[d.getDay()]!,
			DD: pad(d.getDate()),
			HH: pad(d.getHours()),
			hh: pad(h12),
			mm: pad(d.getMinutes()),
			ss: pad(d.getSeconds()),
			SS: pad(d.getSeconds()),
			A: meridiem,
		};
		const name = pattern.replace(/(dddd|ddd|YYYY|MMM|MM|DD|HH|hh|mm|ss|SS|A)/g, (m) => map[m] ?? m);
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

		// Repeat task.
		if (task.type === '\u91CD\u590D') {
			// 今日已推进过（完成状态）：再点圆圈 = 取消今日完成 → 回退 remindDate 到今天并清除完成时间
			const advancedToday = !!task.completeTime && task.completeTime.startsWith(todayStr());
			if (advancedToday && task.status !== '\u5DF2\u5B8C\u6210') {
				await this.writeFrontmatter(file, { '\u63D0\u9192\u65E5\u671F': todayStr(), '\u5B8C\u6210\u65F6\u95F4': null });
				task.remindDate = todayStr();
				task.completeTime = null;
				row.toggleClass('is-done', false);
				this.showToast(t('home.nodeTodo', { date: todayStr() }));
				void this.refreshRelevant();
				return;
			}
			// 未完成（含今日尚未推进）：推进 remindDate 到下一次
			if (task.status !== '\u5DF2\u5B8C\u6210') {
				const nextDate = calcNextRemindDate(task);
				if (nextDate) {
					await this.writeTaskField(task, '\u63D0\u9192\u65E5\u671F', nextDate);
					task.remindDate = nextDate;
					const now = nowFmt();
					await this.writeTaskField(task, '\u5B8C\u6210\u65F6\u95F4', now);
					task.completeTime = now;
					this.showToast(t('home.repeatNext', { date: nextDate }));
					void this.refreshRelevant();
					return;
				}
			}
		}

		const newStatus: TaskStatus = task.status === '\u5DF2\u5B8C\u6210' ? '\u5F85\u529E' : '\u5DF2\u5B8C\u6210';
		const now = nowFmt();
		// 统一走 data 层写入器：一次调用完成 状态切换 + 完成时间 set/del
		// （CRLF-safe + 值转义；此前这里是手写行扫描，且不处理值含换行/冒号的情形）
		await fmWriteFrontmatter(this.app, file, {
			'\u72B6\u6001': newStatus,
			'\u5B8C\u6210\u65F6\u95F4': newStatus === '\u5DF2\u5B8C\u6210' ? now : null,
		});
		task.status = newStatus;
		task.completeTime = newStatus === '\u5DF2\u5B8C\u6210' ? now : null;
		row.toggleClass('is-done', newStatus === '\u5DF2\u5B8C\u6210');
	}

	/** Write frontmatter fields to a file via the shared data-layer writer (CRLF-safe + YAML value escaping). */
	async writeFrontmatter(file: TFile, updates: Record<string, string | null>): Promise<void> {
		await fmWriteFrontmatter(this.app, file, updates);
	}

	/**
	 * Set a single daily-node state for a task's date, rewriting the body
	 * "## 每日节点" block (state: done / todo / skip). Falls back to legacy
	 * frontmatter "每日节点" key when the body block is absent.
	 */
	async setDailyNode(task: TaskItem, date: string, state: 'done' | 'todo' | 'skip'): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		const raw = await this.app.vault.read(file);
		const lines = raw.split(/\r?\n/);
		// End of frontmatter
		let fmEnd = 0;
		if (lines[0]?.trim() === '---') {
			for (let i = 1; i < lines.length; i++) {
				if (lines[i]?.trim() === '---') { fmEnd = i; break; }
			}
		}
		// Parse existing nodes from the body block (canonical parser: marker words
		// like 未做/待办/完成 are not treated as notes — see parseDailyNodesFromBody)
		const nodes = parseDailyNodesFromBody(raw);
		// Apply the target state (todo = remove node entirely so it counts as "not done")
		if (state === 'todo') {
			delete nodes[date];
		} else {
			nodes[date] = { s: state, n: (nodes[date]?.n) || '' };
		}
		// Rebuild body without the old daily-node block, then append fresh block
		const block = serializeDailyNodesBlock(nodes);
		const fmPart = lines.slice(0, fmEnd + 1).join('\n');
		const bodyLines: string[] = [];
		let inDnBlock = false;
		for (let j = fmEnd + 1; j < lines.length; j++) {
			const l = lines[j] ?? '';
			if (/^#{1,6}\s+每日节点\s*$/.test(l.trim())) { inDnBlock = true; continue; }
			if (inDnBlock) {
				if (/^-\s*\d{4}-\d{2}-\d{2}/.test(l.trim())) continue;
				if (l.trim() === '') continue;
				inDnBlock = false;
			}
			bodyLines.push(l);
		}
		while (bodyLines.length && (bodyLines[bodyLines.length - 1] ?? '').trim() === '') bodyLines.pop();
		const tail = bodyLines.join('\n').trim();
		let out = fmPart;
		if (tail) out += '\n' + tail;
		if (block) out += '\n\n' + block + '\n';
		await this.app.vault.modify(file, out.trimEnd() + '\n');

		task.dailyNodes = nodes;
		this.showToast(state === 'done' ? t('home.nodeDone', { date }) : state === 'skip' ? t('home.nodeSkipped', { date }) : t('home.nodeTodo', { date }));
		void this.refreshRelevant();
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

		this.showToast(t('home.taskPostponed'));
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
			'\u989C\u8272': data.color,
			'\u9879\u76EE\u7C7B\u578B': typeLabel,
			'\u63CF\u8FF0': data.description,
			'\u5F00\u59CB\u65E5\u671F': data.startDate,
			'\u7ED3\u675F\u65E5\u671F': data.endDate,
			'\u9636\u6BB5': String(data.stage),
		});
		this.showToast(t('home.projectUpdated'));
		await this.projectBoard.refresh();
	}

	private async showDashboard(): Promise<void> {
		if (!this.boardEl) return;
		// 进入首页前确保退出可能的编辑态（修复「切页未退出编辑态」残留）
		this.exitEditMode();
		this.boardEl.empty();
		this.boardEl.removeClass('po-board');
		this.boardEl.removeClass('op-board');
		this.boardEl.addClass('ad-board');
		this.currentPage = 'home';
		// 按注册表渲染全部启用模块（顺序/显隐由 settings.homeModules 决定）
		await this.renderEnabledModules(this.boardEl);
	}

	/** Delete task file from vault */
	async deleteTask(task: TaskItem): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;
		const { ConfirmModal } = await import('./ConfirmModal');
		new ConfirmModal({
			app: this.app,
			title: t('common.delete'),
			message: t('home.deleteTaskConfirm', { name: task.content }),
			confirmLabel: t('common.delete'),
			cancelLabel: t('common.cancel'),
			onConfirm: () => {
				void (async () => {
					await this.app.fileManager.trashFile(file);
					this.showToast(t('home.taskDeleted', { name: task.content }));
					void this.refreshRelevant();
				})();
			},
		}).open();
	}

	/** Open TaskEditModal for a given task */
	openTaskEditModal(task: TaskItem, presetTodayNode?: NodeState): void {
		// 异步加载项目与任务列表，供任务详情弹窗内的「项目 / 父任务」下拉使用
		void (async () => {
			const [projects, allTasks] = await Promise.all([
				this.taskStore.scanAllProjects(),
				this.taskStore.scanAllTasks(),
			]);
			new TaskEditModal({
				app: this.app,
				task,
				presetTodayNode,
				projects,
				allTasks,
				projectsFolder: this.plugin.settings.projectsFolder,
				taskDetailMode: this.plugin.settings.taskDetailMode,
				onSave: () => {
					void this.refreshRelevant();
				},
			}).open();
		})();
	}

	/** Find the actual project folder by scanning vault */
	private async findProjectFolder(projectName: string): Promise<TFolder | null> {
		const rootPath = this.plugin.settings.projectsFolder;
		const root = this.app.vault.getAbstractFileByPath(rootPath);
		if (!(root instanceof TFolder)) return null;
		// 优先按「显示名 → path」映射匹配（TaskModal 传的是 ProjectInfo.name，可能是 frontmatter 项目名称而非文件夹名）
		const projects = await this.taskStore.scanAllProjects();
		const byName = projects.find((p) => p.name === projectName);
		if (byName) {
			const f = this.app.vault.getAbstractFileByPath(byName.path);
			if (f instanceof TFolder) return f;
		}
		// 兜底：按文件夹名递归匹配
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
			this.showToast(t('home.projectFolderMissing', { name: projectName }));
			return;
		}

		const safeTitle = title.replace(/[*"/<>:|?\\]/g, '-');
		const filename = `${safeTitle}.md`;
		const filePath = `${projectFolder.path}/${filename}`;

		// Check if already exists
		if (this.app.vault.getAbstractFileByPath(filePath)) {
			this.showToast(t('home.taskExistsInProject', { name: title }));
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
	lines.push(`\u72B6\u6001: ${yamlScalar(fmStatus)}`);
	lines.push(`\u4F18\u5148\u7EA7: ${yamlScalar(fmPriority)}`);
	lines.push(`\u5F00\u59CB\u65E5\u671F: ${yamlScalar(startDate)}`);
	// 截止日期 acts as the recurrence bound for recurring tasks (omitted when 无结束日期).
	if (endDate) lines.push(`\u622A\u6B62\u65E5\u671F: ${yamlScalar(endDate)}`);
	lines.push(`\u9879\u76EE: ${yamlScalar(projectName)}`);
	lines.push(`tags: ${JSON.stringify(tags)}`);
	lines.push(`\u7C7B\u578B: ${yamlScalar(fmType)}`);
	lines.push(`\u63D0\u9192: ${JSON.stringify(reminders)}`);
	lines.push(`\u5907\u6CE8: ${yamlScalar(notes)}`);
	if (parent) lines.push(`\u7236\u4EFB\u52A1: ${yamlScalar(parent)}`);

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

		try {
			await this.app.vault.create(filePath, lines.join('\n'));
			this.showToast(t('home.taskCreated'));
			void this.refreshRelevant();
		} catch (err) {
			console.error('createTaskFile failed', err);
			this.showToast(t('home.taskCreateFailed', { name: title, error: err instanceof Error ? err.message : String(err) }));
		}
	}

	/** Create a project folder + project.md with Chinese frontmatter */
	async createProjectFile(): Promise<void> {
		// Dynamically import to avoid circular deps
		const { ProjectModal } = await import('./ProjectModal');
		new ProjectModal({
			app: this.app,
			stages: this.plugin.settings.npdpStages,
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
		`\u9879\u76EE\u540D\u79F0: ${yamlScalar(name)}`,
		`\u989C\u8272: ${yamlScalar(color)}`,
		`\u9879\u76EE\u7C7B\u578B: ${yamlScalar(typeLabel)}`,
		`tags: [\u914D\u7F6E]`,
		`\u63CF\u8FF0: ${yamlScalar(description)}`,
		`\u5F00\u59CB\u65E5\u671F: ${yamlScalar(startDate)}`,
		`\u7ED3\u675F\u65E5\u671F: ${yamlScalar(endDate)}`,
		`\u521B\u5EFA\u65F6\u95F4: ${createDate}`,
		'---',
		'',
		`# ${name}`,
		'',
	];

		// Config file: project-{name}.md
		const projectFilePath = `${projectFolderPath}/project-${safeName}.md`;
		try {
			if (this.app.vault.getAbstractFileByPath(projectFilePath)) {
				this.showToast(t('home.fileExists', { name: 'project-' + safeName }));
				return;
			}
			await this.app.vault.create(projectFilePath, lines.join('\n'));
			this.showToast(t('home.projectCreated', { name }));
			void this.refreshRelevant();
		} catch (err) {
			console.error('createProjectFolder failed', err);
			this.showToast(t('home.projectCreateFailed', { name, error: err instanceof Error ? err.message : String(err) }));
		}
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

	/** 设置页切换「完成后不消失」等开关后，立即刷新 TODO 卡片（无需切页/重载） */
	public refreshTodo(): void {
		void this.refreshTodoList();
	}

	/** Refresh the weekly & overdue list card in-place */
	private async refreshWeeklyList(): Promise<void> {
		if (!this.boardEl) return;
		const allTasks = await this.taskStore.scanAllTasks();
		await this.renderWeekly(this.boardEl, allTasks);
	}

	/** 设置页切换「完成后不消失」等开关后，立即刷新本周待办卡片（无需切页/重载） */
	public refreshWeekly(): void {
		void this.refreshWeeklyList();
	}

	/**
	 * 由多类名字符串构造合法的类选择器：'ad-card ad-b-todo' → '.ad-card.ad-b-todo'
	 *
	 * ⚠️ 历史 bug（本轮修复的总根因）：此前各处直接写 `'.' + cardCls`，得到的是
	 * **后代选择器** `.ad-card ad-b-todo`（在 .ad-card 内找 <ad-b-todo> 标签），永远匹配不到。
	 * 由此连锁导致：卡片拿不到 data-mod（缩放手柄不注入、拖拽删除拿不到 id、顺序无法回写）、
	 * 拿不到 --cols/--rows（所有卡片回退 1:1），并且 getOrCreateCard 永远命中不到旧卡片而重复创建。
	 */
	private static cardSel(cls: string): string {
		return '.' + cls.trim().split(/\s+/).join('.');
	}

	/** Reuse an existing card element (keeps its grid placement → no disappearance flash)
	 *  by emptying its contents, or create it if missing. */
	private getOrCreateCard(board: HTMLElement, cls: string): HTMLElement {
		const existing = board.querySelector(DashboardView.cardSel(cls));
		if (existing) {
			existing.empty();
			return existing as HTMLElement;
		}
		return board.createDiv({ cls });
	}

	/**
	 * 按 settings.homeModules 的「启用 + 顺序」驱动首页渲染（注册表化核心）。
	 * - 渲染前先移除「已禁用 / 已不存在」模块的残留卡片，保证显隐即时生效、无重复。
	 * - onlyLive=true 时只重渲染 live 模块（数据刷新路径，保护快速捕捉输入框、热力图、倒计时不被重建）。
	 * - 一次 vault 扫描的 allTasks 在 todo/progress/weekly 间共享。
	 */
	private async renderEnabledModules(
		board: HTMLElement,
		opts?: { onlyLive?: boolean; allTasks?: TaskItem[] },
	): Promise<void> {
		const configs = this.plugin.settings.homeModules ?? [];
		const enabled = configs
			.filter((m) => m.enabled && this.homeModules.some((x) => x.id === m.id))
			.sort((a, b) => a.order - b.order);

		const enabledTokens = enabled
			.map((m) => {
				const mod = this.homeModules.find((x) => x.id === m.id);
				return mod ? mod.cardCls.split(' ')[1] : '';
			})
			.filter((t): t is string => t !== '');

		// 移除被禁用模块残留的卡片（显隐切换后旧卡需清掉，否则会留空白卡）
		board.querySelectorAll('.ad-card').forEach((el) => {
			const matched = enabledTokens.some((tok) => el.classList.contains(tok));
			if (!matched) el.remove();
		});

		// ── 第零步：把「启用模块」展开为渲染单元。
		//   倒计时是多实例模块：settings.countdown 每一项 = 一张独立卡片（cdIdx = 数组下标）；
		//   列表为空时退化出一张占位卡（cdIdx = -1），保证「右键添加」始终有入口。
		const units: { mod: HomeModule; cdIdx?: number }[] = [];
		for (const cfg of enabled) {
			const mod = this.homeModules.find((x) => x.id === cfg.id);
			if (!mod) continue;
			if (mod.id === 'countdown') {
				const cds = this.plugin.settings.countdown ?? [];
				const idxs = cds.length ? cds.map((_, i) => i) : [-1];
				for (const i of idxs) units.push({ mod, cdIdx: i });
			} else {
				units.push({ mod });
			}
		}

		// ── 第一步：**同步**建好全部卡壳并按 settings 顺序摆位 ──────────────────
		// 关键：部分模块的 render 是 async（todo/progress/weekly/projects 包在 `void` 里），
		// 若等它们各自 createDiv，DOM 顺序就变成「谁先 resolve 谁在前」→ 表现为
		// 「排好的布局一切页/一重启就乱」。先同步占好位置，异步内容只是往壳里填。
		const shells: HTMLElement[] = [];
		// 倒计时卡片数量减少后，残留旧实例（data-cd-idx 不再存在）需按精确下标移除
		const cdLiveIdx = new Set(units.filter((u) => u.cdIdx !== undefined).map((u) => String(u.cdIdx)));
		board.querySelectorAll('.ad-b-countdown').forEach((el) => {
			const idx = (el as HTMLElement).getAttribute('data-cd-idx');
			if (idx !== null && !cdLiveIdx.has(idx)) el.remove();
		});
		for (const u of units) {
			const sel = DashboardView.cardSel(u.mod.cardCls);
			let el = board.querySelector(sel) as HTMLElement | null;
			// 倒计时多实例：同一 class 有多张卡，必须按 data-cd-idx 精确命中，否则会全命中第一张
			if (u.cdIdx !== undefined && el) {
				const exact = board.querySelector(`${sel}[data-cd-idx="${u.cdIdx}"]`) as HTMLElement | null;
				if (exact) { el = exact; el.empty(); } else { el = null; }
			}
			if (!el) {
				el = board.createDiv({ cls: u.mod.cardCls });
				if (u.cdIdx !== undefined) el.setAttribute('data-cd-idx', String(u.cdIdx));
			}
			el.setAttribute('data-mod', u.mod.id);
			const cfg = this.plugin.settings.homeModules?.find((m) => m.id === u.mod.id);
			this.applyCardSpan(el, cfg?.cols, cfg?.rows);
			shells.push(el);
		}
		// 只在实际错位时才移动节点：避免无谓的重新插入导致快速捕捉输入框失焦
		let prev: HTMLElement | null = null;
		for (const el of shells) {
			// 显式标注类型：Obsidian 对 insertBefore 的类型增强会让此处的推断形成循环（TS7022）
			const expected: Element | null = prev ? prev.nextElementSibling : board.firstElementChild;
			if (expected !== el) board.insertBefore(el, expected);
			prev = el;
		}

		// ── 第二步：填充内容（各 render 内部用 getOrCreateCard 命中上面的壳） ──────
		const allTasks = opts?.allTasks ?? await this.taskStore.scanAllTasks();
		for (const u of units) {
			// 异步渲染期间用户可能已切页，必须重校验，否则会把主页卡渲染进其它页面
			if (this.currentPage !== 'home' || !this.boardEl) return;
			if (u.cdIdx !== undefined) {
				// 倒计时多实例：按 data-cd-idx 渲染对应独立卡片（live:false，不进 onlyLive 刷新）
				if (opts?.onlyLive) continue;
				this.renderCountdownCard(board, u.cdIdx);
				continue;
			}
			if (opts?.onlyLive && u.mod.live === false) continue;
			await u.mod.render(board, allTasks);
			// 内容渲染可能重建了卡片，比例/标识需要复位一次（幂等）
			const cardEl = board.querySelector(DashboardView.cardSel(u.mod.cardCls)) as HTMLElement | null;
			if (cardEl) {
				cardEl.setAttribute('data-mod', u.mod.id);
				const cfg = this.plugin.settings.homeModules?.find((m) => m.id === u.mod.id);
				this.applyCardSpan(cardEl, cfg?.cols, cfg?.rows);
			}
		}

		// 编辑态下确保每张卡都带「比例」按钮（重渲染（如数据刷新）会清空按钮，这里补回）
		if (this.adEditMode) this.injectCardResizeButtons();
		// 内容渲染（可能改变卡片数量/比例）后，确保行高仍与单列宽一致
		this.updateRowH();
	}

	/** 把「宽 cols 格 × 高 rows 格」写进卡片的 CSS 变量（grid-column span 由此驱动）。
	 *  统一经过 resolveSpan 夹紧：按当前实际列数裁剪宽度（避免撑出隐式列）、
	 *  按模块最低宽度（MIN_COLS）与最低宽高比（MIN_RATIO）夹紧，保证项目情况/笔记统计
	 *  等关键卡片既不被压得过窄、也不会被拉成「过窄过高的竖条」。 */
	private applyCardSpan(el: HTMLElement, cols?: number, rows?: number): void {
		const modId = el.getAttribute('data-mod') ?? '';
		const { cols: c, rows: r } = this.resolveSpan(modId, clampSpan(cols), clampSpan(rows));
		el.style.setProperty('--cols', String(c));
		el.style.setProperty('--rows', String(r));
	}

	/** 把一个（可能非法的）宽高格数解析成合法组合，渲染 / 拖拽 / 比例菜单 / 响应式夹紧共用，保证规则一致：
	 *  - 夹到 1..MAX_SPAN；
	 *  - 按当前实际列数裁剪宽度（2 列/1 列响应式下避免撑出隐式列）；
	 *  - 按模块最低宽度（MIN_COLS）夹紧；
	 *  - 按模块最低宽高比（MIN_RATIO）夹紧：宽/高 ≥ 最低比例 ⇒ 高 ≤ 宽/最低比例。 */
	private resolveSpan(modId: string, cols: number, rows: number): { cols: number; rows: number } {
		const colCount = this.currentColCount();
		let c = this.clampMinCols(modId, Math.min(colCount, clampSpan(cols)), colCount);
		let r = clampSpan(rows);
		const ratio = MIN_RATIO[modId];
		if (ratio) {
			const maxRows = Math.max(1, Math.floor(c / ratio));
			if (r > maxRows) r = maxRows;
		}
		return { cols: c, rows: r };
	}

	/** 把宽度按「模块最低宽度」与「当前实际列数」双重夹紧：响应式到更窄列数时只填充满，不强行跨列 */
	private clampMinCols(modId: string, cols: number, colCount: number): number {
		const min = MIN_COLS[modId] ?? 1;
		const c = colCount >= min ? Math.max(min, cols) : cols;
		// 硬上限 = 当前列数：span 一旦超过列数就会撑出隐式列，使所有轨道被 1fr 均分、
		// 每张卡整体变窄（= 用户看到的「挤压」）。这里是最后一道闸，任何调用路径都不得绕过。
		return Math.max(1, Math.min(colCount, c));
	}

	/** 设置页修改显隐/排序后，立即重建首页（清空并重渲染全部启用模块） */
	rebuildHome(): void {
		if (this.currentPage !== 'home' || !this.boardEl) return;
		this.boardEl.empty();
		void this.renderEnabledModules(this.boardEl);
	}

	/** 设置页修改看板开关/名称/阶段配置后，立即刷新导航与看板页（无需重启） */
	refreshNav(): void {
		if (!this.dashboardEl) return;
		// 1) 重渲染顶部导航：看板入口显隐 + 看板名称 label 实时生效。
		//    renderActions 会把 nav append 到末尾，故先在临时容器渲染，再插回 header 之后。
		//    ⚠️ 锚点必须用 .ad-header（始终存在），不能用 .ad-board：当视图停在项目/机会页时
		//    boardEl 已移除 .ad-board class，querySelector 找不到会 fallback 到 appendChild，
		//    把 toolbar 插到页面最底部（=「按钮栏漂移到卡片下方」的偶发 bug）。
		const oldToolbar = this.dashboardEl.querySelector('.ad-toolbar');
		if (oldToolbar) oldToolbar.remove();
		const tmp = this.dashboardEl.createDiv();
		this.renderActions(tmp);
		const nav = tmp.firstElementChild;
		tmp.remove();
		if (nav) {
			const header = this.dashboardEl.querySelector('.ad-header');
			if (header) {
				header.after(nav);
			} else {
				const boardEl = this.dashboardEl.querySelector('.ad-board');
				if (boardEl) this.dashboardEl.insertBefore(nav, boardEl);
				else this.dashboardEl.appendChild(nav);
			}
		}
		// 2) 看板被关闭且当前正停在看板页 → 切回主页
		if (!this.plugin.settings.boardEnabled && this.currentPage === 'opportunity') {
			void this.showDashboard();
			return;
		}
		// 3) 看板仍开启且当前正停在看板页 → 重刷看板（阶段名/颜色/输入框配置变化即时生效）
		if (this.currentPage === 'opportunity') {
			void this.oppBoard.show();
		}
	}

	/* ============================================================
	   首页编辑态：长按进入，仿手机桌面（拖拽排序 / 拖入垃圾桶删除 / 添加卡片）
	   ============================================================ */

	/** 绑定 board 的 pointerdown（长按进入编辑态 / 编辑态内直接拖拽），只绑一次 */
	private attachBoardInteractions(): void {
		if (this.adBoardWired || !this.boardEl) return;
		this.adBoardWired = true;
		this.boardEl.addEventListener('pointerdown', (e) => this.onBoardPointerDown(e));
		this.boardEl.addEventListener('contextmenu', (e) => this.onBoardContextMenu(e));
		// 板面宽度变化时重新计算每行最大可容纳列数，并据此夹紧卡片比例
		this.updateRowH();
		if (typeof ResizeObserver !== 'undefined') {
			this.adRowHObs = new ResizeObserver(() => this.updateRowH());
			this.adRowHObs.observe(this.boardEl);
		}
		// 首屏延一帧再夹紧一次：renderEnabledModules 同步写入 --cols 时可能读到尚未落定的列数
		// （例如先按 4 列算，使 projects/heatmap 这类 MIN_COLS=2 卡被钉成 2 列），
		// 等视图真正布局完成、auto-fill 算出最终（可能只有 1~2 列）后再 reapplySpans，
		// 让它们在该窄则窄、整卡满宽可读，避免被压成竖条。
		requestAnimationFrame(() => this.updateRowH());
	}

	/** 响应式布局中枢：按板面（= Obsidian 窗格）实际宽度算出列数并写入 --ad-cols，
	 *  同时把 Grid 行高 --ad-row-h 锁成「单列宽」（1×1 卡正方、多列卡与 1×1 同高、比例不变）。
	 *  列数走 4→3→2→1 梯度，保证每列宽度 ≥ MIN_CARD_W（可读下限），列宽仍是 1fr 随窗口等比缩放。
	 *  列数变化时重夹紧全部卡片（防 2 列卡在仅剩 1 列时撑出隐式列被挤压）。 */
	private updateRowH(): void {
		const board = this.boardEl;
		if (!board) return;
		const cs = getComputedStyle(board);
		const gap = parseFloat(cs.columnGap) || 12;
		const width = board.getBoundingClientRect().width;
		if (width <= 0) return; // 视图尚未布局（隐藏 tab / 首帧），等 ResizeObserver 再来
		const colCount = this.computeColCount(width, gap);
		board.style.setProperty('--ad-cols', String(colCount));
		// 行高 = 单列宽：与 CSS 的 minmax(0,1fr) 等宽轨道算法一致
		const unit = Math.max(40, (width - gap * (colCount - 1)) / colCount);
		board.style.setProperty('--ad-row-h', `${Math.round(unit)}px`);
		if (colCount !== this.adLastColCount) {
			this.adLastColCount = colCount;
			this.reapplySpans();
		}
	}

	/** 按板面实际宽度推算列数：宽→窄 4→3→2→1，每列宽度恒 ≥ MIN_CARD_W。
	 *  这是「卡片不被挤压」的唯一保证——绝不能交给 CSS auto-fill（它会在宽屏生成 5~7 列，
	 *  每列只有 MIN_CARD_W 那么宽，卡片内容被挤压竖排，且与 MAX_SPAN=4 的 span 模型冲突）。
	 *  @param width 板面内容宽度 @param gap 列间距 */
	private computeColCount(width: number, gap: number): number {
		const MIN_CARD_W = 260; // 单卡可读下限宽度（px）：低于此宽度 cqi 字号会塌到下限
		const fit = Math.floor((width + gap) / (MIN_CARD_W + gap));
		return Math.max(1, Math.min(MAX_SPAN, fit));
	}

	/** 按当前列数与各模块最低约束，用保存的 settings 比例重新夹紧所有卡片（响应式列数变化时调用） */
	private reapplySpans(): void {
		const board = this.boardEl;
		if (!board) return;
		const hm = this.plugin.settings.homeModules ?? [];
		board.querySelectorAll('.ad-card').forEach((card) => {
			const el = card as HTMLElement;
			const modId = el.getAttribute('data-mod') ?? '';
			const m = hm.find((x) => x.id === modId);
			if (!m) return;
			const { cols, rows } = this.resolveSpan(modId, clampSpan(m.cols), clampSpan(m.rows));
			el.style.setProperty('--cols', String(cols));
			el.style.setProperty('--rows', String(rows));
		});
	}

	private onBoardPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		// 编辑态（长按进入 / 加卡片）仅首页有效。项目总览与机会点页复用同一个 boardEl 渲染，
		// 但其中没有 .ad-card 元素，boardEmpty 恒为 true；若不拦截，长按空白处（含甘特轴/看板拖动）
		// 会误触发 enterEditMode 并弹出「添加卡片」编辑条。这两个页面本就没有卡片编辑模式，
		// 故非首页一律不响应板面长按。
		if (this.currentPage !== 'home') return;
		// 比例手柄的按下：交给缩放逻辑，绝不触发长按下进入编辑态/拖拽
		if ((e.target as HTMLElement).closest('.ad-card__resize')) return;
		const board = this.boardEl;
		if (!board) return;
		const target = (e.target as HTMLElement).closest('.ad-card') as HTMLElement | null;
		// 表单控件内的按下不进入编辑态（如快速捕捉文本框）
		if ((e.target as HTMLElement).closest('input, textarea, button, select, a')) {
			if (!this.adEditMode) return;
		}

		if (this.adEditMode) {
			if (target) this.beginCardDrag(target, e);
			return;
		}

		// 未进入编辑态：仅在「卡片边缘」长按时才进入，避免拖动滑轨/滑块/正文时误入。
		// 首页已无卡片时，长按空白板面仍可进入（以便直接添加）。
		const onEdge = target ? this.isOnCardEdge(target, e.clientX, e.clientY) : false;
		const boardEmpty = board.querySelectorAll('.ad-card').length === 0;
		if (!onEdge && !boardEmpty) return;

		// 长按 450ms 进入，期间移动超过 10px 视为滚动/意图滑动而取消
		const x0 = e.clientX;
		const y0 = e.clientY;
		const timer = window.setTimeout(() => {
			this.enterEditMode();
			if (target) this.beginCardDrag(target, e);
		}, 450);
		this.adLongPressTimer = timer;
		const move = (ev: PointerEvent) => {
			if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 10) {
				window.clearTimeout(timer);
				window.removeEventListener('pointermove', move);
			}
		};
		const up = () => {
			window.clearTimeout(timer);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	/** 指针是否落在某张卡片的边缘（边框）区域，用于「仅边缘长按进入编辑态」 */
	private isOnCardEdge(card: HTMLElement, x: number, y: number): boolean {
		const r = card.getBoundingClientRect();
		const EDGE = 18;
		if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;
		return (
			x - r.left <= EDGE ||
			r.right - x <= EDGE ||
			y - r.top <= EDGE ||
			r.bottom - y <= EDGE
		);
	}

	/** 首页倒计时卡片右键菜单：仅提供「编辑」（删除统一走编辑态「拖到此处删除」区，
	 *  避免入口重复、误删；新增卡片走「添加卡片」菜单）。非首页 / 非倒计时卡直接放行系统菜单。 */
	private onBoardContextMenu(e: MouseEvent): void {
		// 右键菜单仅作用于首页倒计时卡片；项目/机会点页无此卡片，直接放行系统右键菜单
		if (this.currentPage !== 'home') return;
		const card = (e.target as HTMLElement).closest('.ad-card') as HTMLElement | null;
		if (!card) return;
		if ((card.getAttribute('data-mod') ?? '') !== 'countdown') return;
		e.preventDefault();
		const idxAttr = card.getAttribute('data-cd-idx');
		const idx = idxAttr === null ? -1 : parseInt(idxAttr, 10);
		if (idx < 0) return; // 占位卡（无事件）不提供右键菜单
		// 右键仅提供「编辑」；删除统一走编辑态「拖到此处删除」区，避免入口重复、误删
		const menu = new Menu();
		menu.addItem((item) => item
			.setTitle(t('common.edit'))
			.setIcon('pencil')
			.onClick(() => this.openCountdownEdit(idx)));
		menu.showAtMouseEvent(e);
	}

	/** 打开倒计时事件编辑弹窗；idx >= 0 时仅编辑这一张卡（其他不受影响），idx < 0 时编辑整张占位卡。
	 *  保存后回写 settings 并刷新卡片。 */
	private openCountdownEdit(idx: number): void {
		if (!this.boardEl) return;
		const fullList = this.plugin.settings.countdown ?? [];
		if (idx >= 0) {
			// 单卡编辑：弹窗只显示当前这一张卡，确认后只回写这张卡（其他卡片不受影响）
			const current = fullList[idx];
			if (!current) return;
			const modal = new CountdownModal(
				this.app,
				[{ ...current }],
				(cfg) => {
					const next = fullList.slice();
					if (cfg.length) next[idx] = cfg[0]!;
					this.plugin.settings.countdown = next;
					void this.plugin.saveSettings();
					void this.renderEnabledModules(this.boardEl!);
				},
				{ single: true },
			);
			modal.open();
			return;
		}
		// 兜底：占位卡场景，整批编辑
		const modal = new CountdownModal(
			this.app,
			this.plugin.settings.countdown,
			(cfg) => {
				this.plugin.settings.countdown = cfg;
				void this.plugin.saveSettings();
				void this.renderEnabledModules(this.boardEl!);
			},
		);
		modal.open();
	}

	/** 开始拖拽某张卡片：用占位符保留其在网格中的位置，卡片本身提起跟随指针（手机图标式重排） */
	private beginCardDrag(card: HTMLElement, e: PointerEvent): void {
		if (this.adDrag) return;
		e.preventDefault();
		const rect = card.getBoundingClientRect();
		const cols = card.style.getPropertyValue('--cols') || '1';
		const rows = card.style.getPropertyValue('--rows') || '1';
		// 占位符：保留当前卡片在网格中的尺寸与槽位，其余卡片据此让位
		const ph = document.createElement('div');
		ph.className = 'ad-ph';
		ph.style.setProperty('--cols', cols);
		ph.style.setProperty('--rows', rows);
		ph.style.gridColumn = `span ${cols}`;
		ph.style.gridRow = `span ${rows}`;
		card.parentNode?.insertBefore(ph, card);

		// 提起当前卡片：脱离网格流，跟随指针
		card.classList.add('ad-card--dragging');
		card.style.width = rect.width + 'px';
		card.style.height = rect.height + 'px';
		card.style.left = rect.left + 'px';
		card.style.top = rect.top + 'px';
		card.style.position = 'fixed';
		card.style.zIndex = '9999';
		card.style.pointerEvents = 'none';

		this.adDrag = {
			card,
			placeholder: ph,
			offsetX: e.clientX - rect.left,
			offsetY: e.clientY - rect.top,
			lastX: e.clientX,
			lastY: e.clientY,
			overTrash: false,
			moved: false,
			raf: null,
		};

		const move = (ev: PointerEvent) => this.onDragMove(ev);
		const up = (ev: PointerEvent) => {
			this.onDragEnd(ev);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	}

	/**
	 * 指针是否落在「拖到此处删除」上。
	 * 用矩形命中测试而非 elementFromPoint：后者会被编辑条上方的任意浮层/伪元素挡掉，
	 * 是此前「拖到删除位置却删不掉」的直接原因。外扩 TRASH_PAD 让热区更好命中。
	 */
	private isOverTrash(x: number, y: number): boolean {
		const trash = this.adEditBar?.querySelector('.ad-editbar__trash') as HTMLElement | null;
		if (!trash) return false;
		const r = trash.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) return false;
		const PAD = 28;
		return x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD;
	}

	private onDragMove(ev: PointerEvent): void {
		const ds = this.adDrag;
		if (!ds) return;
		ds.moved = true;
		ds.lastX = ev.clientX;
		ds.lastY = ev.clientY;
		ds.card.style.left = (ev.clientX - ds.offsetX) + 'px';
		ds.card.style.top = (ev.clientY - ds.offsetY) + 'px';

		// 悬停垃圾桶：高亮并暂停重排，避免边删边抖
		const overTrash = this.isOverTrash(ev.clientX, ev.clientY);
		ds.overTrash = overTrash;
		this.adEditBar?.querySelector('.ad-editbar__trash')?.classList.toggle('is-over', overTrash);
		ds.card.classList.toggle('is-doomed', overTrash);
		if (overTrash) return;

		// 每帧最多重排一次（pointermove 触发频率远高于刷新率，不节流会白跑很多次布局计算）
		if (ds.raf !== null) return;
		ds.raf = window.requestAnimationFrame(() => {
			ds.raf = null;
			if (this.adDrag === ds) this.reflowDuringDrag(ds);
		});
	}

	/**
	 * 手机桌面图标式重排：把占位符插到「指针在阅读顺序上刚好领先」的那张卡之前，
	 * 其余卡片用 FLIP 动画平滑挤开让位。
	 *
	 * 判定规则（按阅读顺序 从左到右、从上到下）：
	 *  - 指针在某卡上边界之上 → 排在它之前；
	 *  - 指针在某卡下边界之下 → 排在它之后；
	 *  - 指针与该卡同一行     → 以该卡水平中线判定左右。
	 * 相比旧的「越过中心即换位」，只有真正跨过边界/中线才触发，不再来回抖动。
	 */
	private reflowDuringDrag(ds: DragState): void {
		const board = this.boardEl;
		if (!board) return;
		const x = ds.lastX;
		const y = ds.lastY;
		const cards = Array.from(
			board.querySelectorAll('.ad-card:not(.ad-card--dragging)'),
		) as HTMLElement[];

		let ref: HTMLElement | null = null;
		for (const c of cards) {
			const r = c.getBoundingClientRect();
			if (y < r.top) { ref = c; break; }                       // 指针在该卡上方
			if (y > r.bottom) continue;                               // 指针在该卡下方
			if (x < r.left + r.width / 2) { ref = c; break; }         // 同一行且在左半边
		}

		// 位置没变就不要动 DOM，否则每帧都会打断 FLIP 过渡
		if (ds.placeholder.nextElementSibling === ref) return;
		if (!ref && ds.placeholder === board.lastElementChild) return;

		const before = this.captureCardRects(board);
		board.insertBefore(ds.placeholder, ref);
		this.playFlip(before);
	}

	/** FLIP 第一步：记录移动前所有卡片的位置 */
	private captureCardRects(board: HTMLElement): Map<HTMLElement, DOMRect> {
		const map = new Map<HTMLElement, DOMRect>();
		board.querySelectorAll('.ad-card:not(.ad-card--dragging)').forEach((el) => {
			map.set(el as HTMLElement, el.getBoundingClientRect());
		});
		return map;
	}

	/**
	 * FLIP 第二步：把每张位移过的卡片先「拉回」旧位置，再动画归零 → 视觉上就是被挤开。
	 * 注意：编辑态抖动动画必须用独立的 `rotate` 属性实现，否则 CSS animation 的
	 * transform 优先级高于内联样式，会直接吃掉这里的 translate。
	 */
	private playFlip(before: Map<HTMLElement, DOMRect>): void {
		before.forEach((r0, el) => {
			if (!el.isConnected) return;
			const r1 = el.getBoundingClientRect();
			const dx = r0.left - r1.left;
			const dy = r0.top - r1.top;
			if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
			el.style.transition = 'none';
			el.style.transform = `translate(${dx}px, ${dy}px)`;
			// 强制回流，让上面的「倒带」立即生效，随后的过渡才有起点
			void el.offsetWidth;
			el.style.transition = 'transform 220ms cubic-bezier(0.2, 0, 0, 1)';
			el.style.transform = '';
			window.setTimeout(() => {
				el.style.removeProperty('transition');
				el.style.removeProperty('transform');
			}, 240);
		});
	}

	private onDragEnd(_ev: PointerEvent): void {
		const ds = this.adDrag;
		if (!ds) return;
		this.adDrag = null;
		if (ds.raf !== null) window.cancelAnimationFrame(ds.raf);
		const card = ds.card;
		const id = card.getAttribute('data-mod') || '';
		// 还原卡片样式，使其回到网格流
		card.classList.remove('ad-card--dragging');
		card.classList.remove('is-doomed');
		card.style.removeProperty('position');
		card.style.removeProperty('left');
		card.style.removeProperty('top');
		card.style.removeProperty('width');
		card.style.removeProperty('height');
		card.style.removeProperty('z-index');
		card.style.removeProperty('pointer-events');
		this.adEditBar?.querySelector('.ad-editbar__trash')?.classList.remove('is-over');

		// 落点复检垃圾桶（最后一次 move 可能未触发，漏判会导致「拖过去了却没删」）
		const overTrash = ds.overTrash || this.isOverTrash(ds.lastX, ds.lastY);

		if (overTrash && id) {
			ds.placeholder.remove();
			if (id === 'countdown') {
				// 倒计时是多实例：只删除被拖动的这一张（按 data-cd-idx 精确定位），
				// 不能走 removeModule（会把整个倒计时模块隐藏，误删其余卡片）
				const idxAttr = card.getAttribute('data-cd-idx');
				const idx = idxAttr === null ? -1 : parseInt(idxAttr, 10);
				this.deleteCountdownCard(idx);
			} else {
				this.removeModule(id);
			}
			return;
		}
		ds.placeholder.parentNode?.insertBefore(card, ds.placeholder);
		ds.placeholder.remove();
		this.syncOrderFromDom();
	}

	/** 把当前 DOM 中卡片的顺序写回 settings.homeModules 并持久化 */
	private syncOrderFromDom(): void {
		if (!this.boardEl) return;
		const order: string[] = [];
		this.boardEl.querySelectorAll('.ad-card').forEach((el) => {
			const id = el.getAttribute('data-mod');
			if (id) order.push(id);
		});
		const hm = this.plugin.settings.homeModules;
		if (!hm || order.length === 0) return; // 防御：读不到 data-mod 时绝不写入空顺序
		const map = new Map(hm.map((m) => [m.id, m]));
		order.forEach((id, i) => {
			const m = map.get(id);
			if (m) m.order = i;
		});
		// 被隐藏的模块统一排到可见卡片之后，保证 order 连续、重新添加时落在末尾
		let next = order.length;
		for (const m of hm) {
			if (!order.includes(m.id)) m.order = next++;
		}
		void this.plugin.saveSettings();
	}

	/** 移除模块（仅隐藏，不删数据），随后从 DOM 移除卡片 */
	private removeModule(id: string): void {
		const hm = this.plugin.settings.homeModules;
		const m = hm?.find((x) => x.id === id);
		if (m) m.enabled = false;
		void this.plugin.saveSettings();
		this.boardEl?.querySelector(`[data-mod="${id}"]`)?.remove();
		if (this.boardEl && this.boardEl.querySelectorAll('.ad-card').length === 0) {
			this.renderBoardEmptyHint();
		}
	}

	/** 恢复首页默认布局（显隐 / 顺序 / 比例），保留编辑态便于继续调整 */
	private async resetLayout(): Promise<void> {
		await this.plugin.resetHomeLayout();
		if (this.boardEl) this.boardEl.empty();
		await this.showDashboardKeepEditMode();
		this.showToast(t('home.restoreLayout'));
	}

	/** 重建首页但不退出编辑态（供「重置布局 / 添加卡片」在编辑态内复用） */
	private async showDashboardKeepEditMode(): Promise<void> {
		if (!this.boardEl) return;
		this.currentPage = 'home';
		await this.renderEnabledModules(this.boardEl);
		if (this.adEditMode) this.injectCardResizeButtons();
	}

	/** 重新启用被隐藏的模块并追加到末尾 */
	private async addModule(id: string): Promise<void> {
		const hm = this.plugin.settings.homeModules;
		const m = hm?.find((x) => x.id === id);
		if (!m) return;
		m.enabled = true;
		const maxOrder = hm && hm.length ? Math.max(...hm.map((x) => x.order)) : -1;
		m.order = maxOrder + 1;
		await this.plugin.saveSettings();
		// 保持编辑态：加回卡片后用户通常还要继续排序/调比例
		this.boardEl?.querySelector('.ad-empty')?.remove();
		await this.showDashboardKeepEditMode();
	}

	private enterEditMode(): void {
		if (this.adEditMode) return;
		this.adEditMode = true;
		this.dashboardEl?.classList.add('ad-edit');
		this.showEditBar();
		this.injectCardResizeButtons();
		this.boardEl?.addEventListener('click', this.adClickGuard, true);
		// 若首页已无卡片，直接进入添加流程
		if (this.boardEl && this.boardEl.querySelectorAll('.ad-card').length === 0) {
			this.openAddMenu();
		}
	}

	/** 退出编辑态；同时清理可能残留的比例/添加弹层与编辑条（切页或点「完成」时调用） */
	public exitEditMode(): void {
		if (!this.adEditMode) return;
		this.adEditMode = false;
		this.dashboardEl?.classList.remove('ad-edit');
		this.boardEl?.querySelectorAll('.ad-card__resize, .ad-card__ratio, .ad-ph').forEach((b) => b.remove());
		// 清掉拖拽/缩放过程中可能残留的瞬时类，避免退出后卡片still抖动或带高亮描边
		this.boardEl?.querySelectorAll('.ad-card').forEach((c) => {
			c.classList.remove('ad-card--dragging', 'ad-card--resizing', 'is-doomed');
			(c as HTMLElement).style.removeProperty('transform');
			(c as HTMLElement).style.removeProperty('transition');
		});
		// 清理残留弹层：添加卡片列表 / 比例选择器（修复「点完成后小卡片未消失」）
		this.dashboardEl?.querySelectorAll('.ad-addmenu-backdrop, .ad-propmenu-backdrop').forEach((b) => b.remove());
		this.hideEditBar();
		this.boardEl?.removeEventListener('click', this.adClickGuard, true);
	}

	private showEditBar(): void {
		if (this.adEditBar || !this.dashboardEl) return;
		const bar = this.dashboardEl.createDiv({ cls: 'ad-editbar' });
		bar.createEl('button', { cls: 'ad-editbar__trash', text: t('home.editbar.trash') });
		bar.createDiv({ cls: 'ad-editbar__spacer' });
		const add = bar.createEl('button', { cls: 'ad-editbar__add', text: t('home.editbar.add') });
		add.addEventListener('click', () => this.openAddMenu());
		const reset = bar.createEl('button', { cls: 'ad-editbar__reset', text: t('home.editbar.reset') });
		reset.addEventListener('click', () => void this.resetLayout());
		const done = bar.createEl('button', { cls: 'ad-editbar__done', text: t('home.editbar.done') });
		done.addEventListener('click', () => this.exitEditMode());
		this.adEditBar = bar;
	}

	private hideEditBar(): void {
		this.adEditBar?.remove();
		this.adEditBar = null;
	}

	/** 编辑态：给每张卡片追加「⤢ 比例」手柄（重复调用安全：先清后加，重渲染后补回）。
	 *  手柄在卡片右下角，悬停可见；按下并拖动即可按方向缩放比例，轻点则打开精确比例菜单。 */
	private injectCardResizeButtons(): void {
		if (!this.boardEl) return;
		this.boardEl.querySelectorAll('.ad-card__resize').forEach((b) => b.remove());
		this.boardEl.querySelectorAll('.ad-card').forEach((card) => {
			const c = card as HTMLElement;
			// data-mod 优先；兜底用卡片类名反查模块 id，避免任何一处遗漏就整卡失去缩放能力
			const modId = c.getAttribute('data-mod')
				?? this.homeModules.find((m) => c.classList.contains(m.cardCls.split(' ')[1] ?? ''))?.id;
			if (!modId) return;
			if (!c.getAttribute('data-mod')) c.setAttribute('data-mod', modId);
			const btn = c.createDiv({ cls: 'ad-card__resize', text: '⤢' });
			btn.setAttribute('aria-label', t('home.ratioAria'));
			btn.addEventListener('pointerdown', (ev) => {
				ev.stopPropagation();
				ev.preventDefault();
				this.beginResizeDrag(c, modId, ev);
			});
		});
	}

	/** 当前网格列数（1~4，由 updateRowH 按板面宽度写入 --ad-cols）。
	 *  用于 resolveSpan / gridUnit：卡片 span 必须 ≤ 此值，否则会撑出隐式列被挤压。 */
	private currentColCount(): number {
		const board = this.boardEl;
		if (!board) return MAX_SPAN;
		const v = parseInt(board.style.getPropertyValue('--ad-cols'), 10);
		if (v > 0) return Math.max(1, Math.min(MAX_SPAN, v));
		// --ad-cols 尚未写入（首屏同步渲染阶段）：按当前宽度即时推算，
		// 避免误按 4 列把 MIN_COLS=2 的 projects/heatmap 钉成 2 列而在窄窗格撑出隐式列
		const gap = parseFloat(getComputedStyle(board).columnGap) || 12;
		const width = board.getBoundingClientRect().width;
		return width > 0 ? this.computeColCount(width, gap) : MAX_SPAN;
	}

	/** 单个基础尺寸单元（单列宽）与列间距（用于把指针位置换算成「几格」） */
	private gridUnit(): { unit: number; gap: number; colCount: number } {
		const board = this.boardEl;
		const colCount = this.currentColCount();
		if (!board) return { unit: 200, gap: 12, colCount };
		const cs = getComputedStyle(board);
		const gap = parseFloat(cs.columnGap) || 12;
		const width = board.getBoundingClientRect().width;
		const unit = Math.max(40, (width - gap * (colCount - 1)) / colCount);
		return { unit, gap, colCount };
	}

	/**
	 * 从右下角手柄开始拖拽缩放。
	 * 与旧实现（固定 45px 一档的相对位移）不同，这里按**指针的绝对位置**换算格数：
	 * 指针拖到哪，卡片右下角就吸附到哪一格，所见即所得。
	 */
	private beginResizeDrag(card: HTMLElement, modId: string, e: PointerEvent): void {
		e.preventDefault();
		e.stopPropagation();
		const m = this.plugin.settings.homeModules?.find((x) => x.id === modId);
		const startCols = clampSpan(m?.cols);
		const startRows = clampSpan(m?.rows);
		this.adResize = { card, modId, startCols, startRows, x0: e.clientX, y0: e.clientY, moved: false };
		card.classList.add('ad-card--resizing');
		const move = (ev: PointerEvent) => this.onResizeMove(ev);
		const up = (ev: PointerEvent) => {
			this.onResizeEnd(ev);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			window.removeEventListener('pointercancel', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
		window.addEventListener('pointercancel', up);
	}

	private onResizeMove(ev: PointerEvent): void {
		const st = this.adResize;
		if (!st) return;
		// 4px 死区：手抖不该被当成缩放，否则轻点打不开精确菜单
		if (!st.moved && Math.hypot(ev.clientX - st.x0, ev.clientY - st.y0) < 4) return;
		st.moved = true;

		const { unit, gap, colCount } = this.gridUnit();
		const r = st.card.getBoundingClientRect();
		// 卡片左上角是锚点：指针到锚点的距离 ÷ 单元格尺寸 = 目标格数
		const wantCols = Math.round((ev.clientX - r.left + gap) / (unit + gap));
		const wantRows = Math.round((ev.clientY - r.top + gap) / (unit + gap));
		const rawCols = Math.max(1, Math.min(colCount, wantCols));
		const rawRows = Math.max(1, Math.min(MAX_SPAN, wantRows));
		// 经过 resolveSpan 夹紧（最低宽度 + 最低宽高比），拖到下半屏也不会变成过窄竖条
		const { cols, rows } = this.resolveSpan(st.modId, rawCols, rawRows);
		st.card.style.setProperty('--cols', String(cols));
		st.card.style.setProperty('--rows', String(rows));
		this.showResizeBadge(st.card, cols, rows);
		// 指针想要的格数被夹紧 → 已触达上/下限，边框转红并抖动（只在状态翻转时加类，动画才会重新播放）
		this.setResizeLimit(st.card, wantCols !== cols || wantRows !== rows);
	}

	/** 缩放触达限制的视觉反馈：边框变红 + 抖动脉冲（状态翻转时才切类，避免动画每帧重启） */
	private setResizeLimit(card: HTMLElement, limited: boolean): void {
		const on = card.classList.contains('is-limit');
		if (limited === on) return;
		card.classList.toggle('is-limit', limited);
	}

	private onResizeEnd(_ev: PointerEvent): void {
		const st = this.adResize;
		if (!st) return;
		this.adResize = null;
		st.card.classList.remove('ad-card--resizing');
		st.card.classList.remove('is-limit');
		st.card.querySelector('.ad-card__ratio')?.remove();
		// 几乎没拖动（视为点击）→ 打开精确比例菜单
		if (!st.moved) {
			this.openProportionMenu(st.card, st.modId);
			return;
		}
		const cols = clampSpan(st.card.style.getPropertyValue('--cols'));
		const rows = clampSpan(st.card.style.getPropertyValue('--rows'));
		const m = this.plugin.settings.homeModules?.find((x) => x.id === st.modId);
		if (m) {
			m.cols = cols;
			m.rows = rows;
			void this.plugin.saveSettings();
		}
	}

	/** 缩放过程中在卡片中央显示当前比例，如「2×1」 */
	private showResizeBadge(card: HTMLElement, cols: number, rows: number): void {
		let badge = card.querySelector('.ad-card__ratio') as HTMLElement | null;
		if (!badge) badge = card.createDiv({ cls: 'ad-card__ratio' });
		badge.setText(`${cols} × ${rows}`);
	}

	/**
	 * 创建统一的弹层容器。
	 * 挂到 document.body 而非 dashboardEl：面板所在的滚动容器会成为 fixed 的包含块，
	 * 导致「居中」被算到整个滚动内容的中点（表现为弹窗跑到最底部、要滚动才点得到）。
	 * 同时把 data-theme 复制过来，令牌（--ad-*）在 body 层依然按当前主题解析。
	 */
	private createPopover(cls: string, opts?: { anchored?: boolean }): { backdrop: HTMLElement; close: () => void } {
		const backdrop = document.body.createDiv({ cls: `ad-popover ${cls}` + (opts?.anchored ? ' is-anchored' : '') });
		const theme = this.dashboardEl?.getAttribute('data-theme');
		if (theme) backdrop.setAttribute('data-theme', theme);
		const close = (): void => {
			window.removeEventListener('keydown', onKey, true);
			backdrop.remove();
		};
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === 'Escape') { e.preventDefault(); close(); }
		};
		window.addEventListener('keydown', onKey, true);
		backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
		return { backdrop, close };
	}

	/** 把弹层就近定位到锚点旁（优先锚点左上方，越界自动翻转/收边，始终留 12px 视口边距） */
	private placeNearAnchor(menu: HTMLElement, anchor: HTMLElement | null): void {
		const pad = 12;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const mr = menu.getBoundingClientRect();
		const ar = anchor?.getBoundingClientRect();
		let left: number;
		let top: number;
		if (ar) {
			// 手柄在卡片右下角：默认把菜单摆在手柄左上方，视觉上「从手柄长出来」
			left = ar.right - mr.width;
			top = ar.top - mr.height - 8;
			if (top < pad) top = Math.min(vh - mr.height - pad, ar.bottom + 8); // 上方不够 → 翻到下方
		} else {
			left = (vw - mr.width) / 2;
			top = (vh - mr.height) / 2;
		}
		menu.style.left = Math.round(Math.max(pad, Math.min(vw - mr.width - pad, left))) + 'px';
		menu.style.top = Math.round(Math.max(pad, Math.min(vh - mr.height - pad, top))) + 'px';
	}

	/** 编辑态：弹出 4×4 比例选择器；宽度/高度各 1-4 格（宽度 4 = 页面最宽），高度可大于宽度（如 1:2 竖卡） */
	private openProportionMenu(cardEl: HTMLElement, modId: string): void {
		const hm = this.plugin.settings.homeModules;
		const m = hm?.find((x) => x.id === modId);
		if (!m) return;
		const curCols = m.cols ?? 1;
		const curRows = m.rows ?? 1;
		const { backdrop, close } = this.createPopover('ad-propmenu-backdrop', { anchored: true });
		const menu = backdrop.createDiv({ cls: 'ad-propmenu' });
		const ratioHint = MIN_RATIO[modId] ? t('home.ratioHint', { ratio: MIN_RATIO[modId] }) : '';
		menu.createDiv({ cls: 'ad-propmenu__title', text: t('home.ratioMenuTitle', { hint: ratioHint }) });
		const grid = menu.createDiv({ cls: 'ad-propmenu__grid' });
		for (let r = 1; r <= 4; r++) {
			for (let c = 1; c <= 4; c++) {
				const cell = grid.createDiv({ cls: 'ad-propmenu__cell', text: `${c}×${r}` });
				if (c === curCols && r === curRows) cell.addClass('is-current');
				// 经 resolveSpan 校验：会被最低宽度/最低宽高比改写的组合直接置灰，避免选到非法比例
				const res = this.resolveSpan(modId, c, r);
				if (res.cols !== c || res.rows !== r) {
					cell.addClass('is-dim');
					// 点击非法比例：红色抖动，明确告知「这里是限制」
					cell.addEventListener('click', () => this.rejectCell(cell));
				} else cell.addEventListener('click', () => {
					m.cols = c;
					m.rows = r;
					void this.plugin.saveSettings();
					cardEl.style.setProperty('--cols', String(c));
					cardEl.style.setProperty('--rows', String(r));
					close();
				});
			}
		}
		// 就近定位到该卡片的「⤢」手柄旁（需先入 DOM 才能量到菜单尺寸）
		this.placeNearAnchor(menu, cardEl.querySelector('.ad-card__resize') as HTMLElement | null);
	}

	/** 非法比例格的拒绝反馈：红色抖动一次 */
	private rejectCell(cell: HTMLElement): void {
		cell.removeClass('is-reject');
		// 强制重排以重启动画（连点同一格也能再抖一次）
		void cell.offsetWidth;
		cell.addClass('is-reject');
		if (this.adLimitTimer !== null) window.clearTimeout(this.adLimitTimer);
		this.adLimitTimer = window.setTimeout(() => {
			cell.removeClass('is-reject');
			this.adLimitTimer = null;
		}, 460);
	}

	/** 弹出可添加的卡片列表；点击即加入首页。
	 *  - 倒计时：自由追加独立卡片（≤5 张），与「隐藏模块」显隐逻辑解耦；
	 *  - 其余模块：列出被隐藏（enabled=false）的模块，点击恢复显示。 */
	private openAddMenu(): void {
		const hm = this.plugin.settings.homeModules ?? [];
		const hidden = hm.filter((m) => !m.enabled);
		const titleMap = new Map(this.homeModules.map((m) => [m.id, m.title]));
		const cds = this.plugin.settings.countdown ?? [];
		const { backdrop, close } = this.createPopover('ad-addmenu-backdrop');
		const menu = backdrop.createDiv({ cls: 'ad-addmenu' });
		menu.createDiv({ cls: 'ad-addmenu__title', text: t('home.addMenuTitle') });

		// 倒计时：存在倒计时卡片 ≤5 时，始终提供「添加倒计时卡片」入口
		if (cds.length < 5) {
			const item = menu.createDiv({ cls: 'ad-addmenu__item' });
			item.createSpan({ text: t('home.cdAddCard') });
			item.createSpan({ text: '＋' });
			item.addEventListener('click', () => {
				close();
				this.addCountdownCard();
			});
		}

		for (const m of hidden) {
			const item = menu.createDiv({ cls: 'ad-addmenu__item' });
			item.createSpan({ text: titleMap.get(m.id) ?? m.id });
			item.createSpan({ text: '＋' });
			item.addEventListener('click', () => {
				close();
				void this.addModule(m.id);
			});
		}

		// 既无隐藏模块、倒计时也已满 5 张：给个空提示
		if (hidden.length === 0 && cds.length >= 5) {
			menu.createDiv({ cls: 'ad-addmenu__empty', text: t('home.addMenuEmpty') });
		}
	}

	/** 全部卡片被移除后的空状态提示 */
	private renderBoardEmptyHint(): void {
		if (!this.boardEl) return;
		this.boardEl.empty();
		const hint = this.boardEl.createDiv({ cls: 'ad-empty' });
		hint.createDiv({ cls: 'ad-empty__icon', text: '\uD83D\uDD12' });
		hint.createDiv({ cls: 'ad-empty__title', text: t('home.emptyTitle') });
		hint.createDiv({ cls: 'ad-empty__hint', text: t('home.emptyHint') });
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
		// 仅重渲染 live 模块（保护快速捕捉输入框、热力图、倒计时不被重建）
		await this.renderEnabledModules(this.boardEl, { onlyLive: true, allTasks });
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
			// 「完成后不消失」开关：开启时已完成任务保留在列表中，以变灰 + 删除线展示
			const keepDone = !!this.plugin.settings.todoShowCompleted;
			const today = todayStr();
			const todayTasks = getTodayTasks(tasks, today, keepDone);

			// 视为「已完成」的行：状态已完成，或重复任务在今日完成推进（默认推进后仍保留待办状态，
			// 但画布上用变灰呈现），或多日任务今日节点已打卡。用于排序沉底与 is-done 样式。
			const isDoneRow = (t: TaskItem): boolean => {
				if (t.status === '\u5DF2\u5B8C\u6210') return true;
				if (t.type === '\u91CD\u590D' && !!t.completeTime && t.completeTime.startsWith(today)) return true;
				const node = t.dailyNodes && t.dailyNodes[today];
				return !!node && node.s === 'done';
			};

			// Sort: 已完成沉底（仅开启保留时才有已完成行）、逾期优先、再按优先级
			const sorted = todayTasks.sort((a, b) => {
				const aDone = isDoneRow(a);
				const bDone = isDoneRow(b);
				if (aDone !== bDone) return aDone ? 1 : -1;
				if (a.isOverdue && !b.isOverdue) return -1;
				if (!a.isOverdue && b.isOverdue) return 1;
				return priorityWeight(a.priority) - priorityWeight(b.priority);
			});

			sorted.forEach((task) => {
				const isDone = isDoneRow(task);
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
			// 优先级标签：纯文本无 emoji（不显示 🔴🟡🔵⚪ 圆点），胶囊样式参考本周待办的紧急标签（ad-wo__urg）
			const prioLabel = task.priority ? UI_TEXT.prioText(task.priority) : t('common.notSet');
			row.createSpan({ cls: 'ad-todo__tag', text: prioLabel, attr: { 'data-prio': task.priority || '' } });

				// Right-click context menu
				row.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle(t('home.editTask')).setIcon('pencil').onClick(() => this.openTaskEditModal(task));
				});
				menu.addItem((item) => {
					item.setTitle(t('home.postponeDay')).setIcon('calendar').onClick(() => void this.postponeTask(task));
				});
				menu.addSeparator();
			menu.addItem((item) => {
				item.setTitle(t('common.delete')).setIcon('trash').onClick(() => void this.deleteTask(task));
			});
			// Multi-day tasks: daily node check-in via edit modal
			if (task.startDate && task.dueDate && task.startDate !== task.dueDate) {
				menu.addSeparator();
				menu.addItem((item) => {
					item.setTitle(t('home.todayDone')).setIcon('check').onClick(() => this.openTaskEditModal(task, 'done'));
				});
				menu.addItem((item) => {
					item.setTitle(t('home.todaySkip')).setIcon('x').onClick(() => this.openTaskEditModal(task, 'skip'));
				});
			}
				menu.showAtMouseEvent(e);
				});
			});

			const universe = getTodayUniverse(tasks);
			const doneCount = universe.filter((t) => isDoneToday(t)).length;
			const skipCount = universe.filter((t) => isSkipToday(t)).length;
			const totalForSummary = universe.length - skipCount;
			summary.textContent = t('home.todoSummary', { done: doneCount, total: totalForSummary });
		} catch {
			summary.textContent = '0 / 0 done';
			list.createDiv({ cls: 'ad-todo__empty', text: t('home.noTodayTasks') });
		}
	}

	/* ---- Progress (dual ring, real task data) ---- */
	private async renderProgress(board: HTMLElement, allTasks?: TaskItem[]): Promise<void> {
		const tasks = allTasks ?? await this.taskStore.scanAllTasks();
		const card = this.getOrCreateCard(board, 'ad-card ad-b-progress');
		this.cardHead(card, '\u25D0', t('home.modules.progress'), 'today \u00B7 ring');
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
				title: t('home.todoEmptyTitle'),
				hint: t('home.todoEmptyHint'),
				actionLabel: t('home.todoEmptyAction'),
				onAction: () => void this.openTaskModal(this.selectedProject ?? undefined),
			});
			return;
		}

		// Top ring — today's tasks
		const todayPct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;
		this.buildRing(dp, todayPct, 'ad-dp__pct-daily', 'daily');
		dp.createDiv({ cls: 'ad-dp__stat' }).createEl('strong', { text: t('home.todayStat', { done: todayDone, total: todayTotal }) });

		// Bottom ring — all tasks
		const allPct = allTotal ? Math.round((allDone / allTotal) * 100) : 0;
		this.buildRing(dp, allPct, 'ad-dp__pct-proj', 'proj');
		dp.createDiv({ cls: 'ad-dp__stat' }).createEl('strong', { text: t('home.allStat', { done: allDone, total: allTotal }) });
	}

	private buildRing(parent: HTMLElement, pct: number, pctCls: string, ringKey: string): void {
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

		// 起点 = 上次显示值（首帧即落位，避免整圈闪烁）；终点 = 当前目标进度
		const from = this.ringAnim[ringKey]?.value ?? 0;
		const to = Math.max(0, Math.min(100, pct));
		fill.setAttribute('stroke-dashoffset', (C * (1 - from / 100)).toFixed(2));

		const center = wrap.createDiv({ cls: 'ad-dp__center' });
		const pctEl = center.createDiv({ cls: `ad-dp__pct ${pctCls}` });
		pctEl.textContent = Math.round(from) + '%';

		// 记录目标值，供下次刷新衔接；动画过程中该值会被实时更新为当前显示值
		this.ringAnim[ringKey] = { raf: 0, value: to };
		this.animateRing(fill, pctEl, C, from, to, ringKey);
	}

	/**
	 * 用 requestAnimationFrame 驱动进度圆环的填充动画，使圆弧与中心数值同步更新。
	 * - 从 `from` 平滑过渡到 `to`，时长与缓动曲线由 RING_ANIM 控制；
	 * - 每帧同时更新 stroke-dashoffset（圆弧）与中心文本（数值），二者始终一致；
	 * - 若系统开启「减少动态效果」或起止值相同，则直接落位、不做动画。
	 */
	private animateRing(
		fill: SVGElement,
		pctEl: HTMLElement,
		C: number,
		from: number,
		to: number,
		ringKey: string,
	): void {
		const reduceMotion =
			typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		if (reduceMotion || from === to) {
			fill.setAttribute('stroke-dashoffset', (C * (1 - to / 100)).toFixed(2));
			pctEl.textContent = Math.round(to) + '%';
			if (this.ringAnim[ringKey]) this.ringAnim[ringKey].value = to;
			return;
		}

		const { duration, easing } = RING_ANIM;
		const state = this.ringAnim[ringKey];
		if (state?.raf) cancelAnimationFrame(state.raf);

		const start = performance.now();
		const step = (now: number): void => {
			const t = Math.min(1, (now - start) / duration);
			const val = from + (to - from) * easing(t);
			fill.setAttribute('stroke-dashoffset', (C * (1 - val / 100)).toFixed(2));
			pctEl.textContent = Math.round(val) + '%';
			const s = this.ringAnim[ringKey];
			if (!s) return;
			s.value = val;
			if (t < 1) {
				s.raf = requestAnimationFrame(step);
			} else {
				s.value = to;
				s.raf = 0;
			}
		};
		if (state) state.raf = requestAnimationFrame(step);
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
		h3.appendText(t('home.modules.weekly'));

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

			// 「完成后不消失」开关：开启时本周待办同样保留已完成（变灰+删除线）
			const keepDone = !!this.plugin.settings.todoShowCompleted;

			// ALL overdue tasks (even outside this week), sorted earliest-overdue first
			const overdue = tasks.filter((t) => t.isOverdue);
			overdue.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : a.dueDate! > b.dueDate! ? 1 : 0));

	// This-week, non-overdue, not done — incl. multi-day tasks that span the week
	const thisWeek = tasks.filter((t) => {
		if (isDone(t)) {
			// 完成后不消失：仅保留「本周内完成」的已完成任务（变灰展示），逾期完成也一并保留
			if (!keepDone) return false;
			if (t.completeTime) {
				const ct = t.completeTime.slice(0, 10);
				return ct >= weekStartStr && ct < weekEndStr;
			}
			return false;
		}
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
				badge.title = t('home.overdueTooltip', { n: overdue.length });
			}

			// Section: overdue (pinned top, red)
			if (overdue.length > 0) {
				const og = list.createDiv({ cls: 'ad-wo__group ad-wo--overdue' });
				const oh4 = og.createEl('h4');
			oh4.createSpan({ cls: 'ad-wo-mark', text: '▲' });
			oh4.appendText(t('home.overdue'));
				const ul = og.createEl('ul', { cls: 'ad-wo__list' });
				overdue.forEach((t) => this.renderWeeklyRow(ul, t, true));
			}

			list.createDiv({ cls: 'ad-wo__sep' });

			// Section: this week
			const wg = list.createDiv({ cls: 'ad-wo__group' });
			const wh4 = wg.createEl('h4');
			wh4.createSpan({ cls: 'ad-wo-mark', text: '◆' });
			wh4.appendText(t('home.thisWeek'));
			const ul = wg.createEl('ul', { cls: 'ad-wo__list' });
			if (thisWeek.length === 0 && overdue.length === 0) {
				list.createDiv({ cls: 'ad-wo__empty', text: t('home.weekEmpty') });
			} else {
				thisWeek.forEach((t) => this.renderWeeklyRow(ul, t, false));
			}

			// Footer stats
			const foot = card.createDiv({ cls: 'ad-wo__foot' });
			foot.textContent = t('home.weeklyFoot', { n: thisWeek.length, m: overdue.length });
		} catch {
			list.createDiv({ cls: 'ad-wo__empty', text: t('home.loadFailed') });
		}
	}

	/** Build a single weekly/overdue task row (li) with click + context menu */
	private renderWeeklyRow(ul: HTMLElement, task: TaskItem, isOverdue: boolean): void {
		const li = ul.createEl('li');
		if (task.status === '\u5DF2\u5B8C\u6210') li.classList.add('is-done');
		const due = task.dueDate || task.remindDate || '';
		li.createSpan({ cls: 'ad-wo__date', text: due ? due.slice(5) : '\u2014' });
		li.createSpan({ cls: 'ad-wo__text', text: task.content });
		if (isOverdue) {
			const days = overdueDays(task.dueDate);
			li.createSpan({ cls: 'ad-wo__over', text: t('home.overdueDays', { n: days }) });
			li.classList.add('is-overdue-row');
		} else {
			// This-week rows: 优先级胶囊与 TODO 卡片统一（纯文本 + data-prio 同款配色）
			if (task.priority) {
				li.createSpan({ cls: 'ad-todo__tag', text: UI_TEXT.prioText(task.priority), attr: { 'data-prio': task.priority } });
			}
		}

		li.addEventListener('click', () => this.openTaskEditModal(task));
		li.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(t('home.editTask')).setIcon('pencil').onClick(() => this.openTaskEditModal(task));
			});
			menu.addItem((item) => {
				item.setTitle(t('home.deleteTask')).setIcon('trash').onClick(() => void this.deleteTask(task));
			});
			menu.addItem((item) => {
				item.setTitle(t('common.openSource')).setIcon('file').onClick(() => {
					if (task.sourceFile) void this.app.workspace.openLinkText(task.sourceFile, '', true);
				});
			});
			menu.addItem((item) => {
				item.setTitle(t('home.postponeDay')).setIcon('calendar').onClick(() => void this.postponeTask(task));
			});
			menu.addItem((item) => {
				item.setTitle(t('home.markDone')).setIcon('check').onClick(() => void this.markTaskComplete(task));
			});
			if (isOverdue) {
				menu.addItem((item) => {
					item.setTitle(t('home.postponeToday')).setIcon('calendar-clock').onClick(() => void this.postponeTaskToToday(task));
				});
			}
			menu.showAtMouseEvent(e);
		});
	}

		/** Mark a task as completed (状态: 已完成) */
	private async markTaskComplete(task: TaskItem): Promise<void> {
		if (task.status === '\u5DF2\u5B8C\u6210') {
			this.showToast(t('home.taskDone'));
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
				this.showToast(t('home.repeatNext', { date: nextDate }));
				void this.refreshRelevant();
				return;
			}
		}
		await this.writeTaskField(task, '\u72B6\u6001', '\u5DF2\u5B8C\u6210');
		task.status = '\u5DF2\u5B8C\u6210';
		this.showToast(t('home.taskDone'));
		void this.refreshRelevant();
	}

	/** Move an overdue task's due date to today */
	private async postponeTaskToToday(task: TaskItem): Promise<void> {
		if (!task.dueDate) return;
		const today = todayStr();
		await this.writeTaskField(task, '\u622A\u6B62\u65E5\u671F', today);
		task.dueDate = today;
		this.showToast(t('home.postponedToday'));
		void this.refreshRelevant();
	}

	/* ---- Projects (real data) ---- */
	private async renderProjects(board: HTMLElement): Promise<void> {
		const card = this.getOrCreateCard(board, 'ad-card ad-b-project');
		const head = card.createDiv({ cls: 'ad-card__head ad-card__head--proj' });
		const h3 = head.createEl('h3', { cls: 'ad-card__title' });
		h3.createSpan({ cls: 'ad-marker', text: '\u25A6' });
		h3.appendText(t('home.modules.projects'));
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

		hint.textContent = t('home.projectsCount', { n: filtered.length, m: stageProjects.length });
		if (maxStageFilter < stages.length) {
			hint.textContent += ` (\u2264${stages[maxStageFilter - 1]})`;
		}

		if (projects.length === 0) {
			this.renderEmpty(card, {
				icon: '\u{1F4D1}',
				title: t('home.projectsEmptyTitle'),
				hint: t('home.projectsEmptyHint'),
				actionLabel: t('home.projectsEmptyAction'),
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
			name.createSpan({ cls: 'ad-meta', text: t('home.projectMeta', { tasks: p.taskCount, active: p.activeCount, pct }) });

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
					item.setTitle(t('home.editProject')).setIcon('pencil').onClick(() => void this.editProject(p));
				});
				menu.addItem((item) => {
					item.setTitle(t('home.viewGantt')).setIcon('gantt-chart').onClick(() => void this.navigateToProjectGantt(p));
				});
				menu.showAtMouseEvent(e);
			});

			// Click → navigate to Gantt
			row.addEventListener('click', () => void this.navigateToProjectGantt(p));
		});

		// Footer summary
		const sum = proj.createDiv({ cls: 'ad-proj__sum' });
		const filterLabel = maxStageFilter < stages.length ? `\u2264 ${stages[maxStageFilter - 1]}` : t('ui.opAll');
		const sumRow = sum.createSpan({ cls: 'ad-row' });
		sumRow.createSpan({ cls: 'ad-key', text: '\u2299' });
		sumRow.appendText(` ${t('home.activeCount', { n: activeCount, filter: filterLabel })}`);
	}

	/** Navigate to project overview and select a specific project's Gantt view */
	private async navigateToProjectGantt(proj: ProjectInfo): Promise<void> {
		await this.projectBoard.openProjectGantt(proj);
	}

	/* ---- Heatmap (year-based: Jan 1 -> Dec 31) ---- */
		private renderHeatmap(board: HTMLElement): void {
		const card = this.getOrCreateCard(board, 'ad-card ad-b-heatmap');
		this.heatmapCard = card;
		// 渲染可能重建卡片元素（如 refreshHeatmap 先 remove 再渲染），需重新套用标识与比例，
		// 否则新元素无 --cols/--rows，会回退成 1×1（新建笔记刷新热力图后比例丢失即此因）。
		card.setAttribute('data-mod', 'heatmap');
		const hm = this.plugin.settings.homeModules?.find((x) => x.id === 'heatmap');
		this.applyCardSpan(card, hm?.cols, hm?.rows);

		const noteCounts = this.getVaultNoteCounts();
		const today = new Date();
		const todayTime = today.getTime();
		const todayKey = fmtDate(today); // 今天日期（YYYY-MM-DD），用于标记当天格子
		const year = today.getFullYear();
		const stats = calcHeatmapStats(noteCounts, year, today);
		
		// Title header (dashboard header style)
		const head = card.createDiv({ cls: 'ad-card__head' });
		const h3 = head.createEl('h3', { cls: 'ad-card__title' });
		h3.createSpan({ cls: 'ad-marker', text: '\u25A5' });
		h3.appendText(t('home.modules.heatmap'));
		
		// 统计数字 + 活跃度指标（顶部右上角，与标题同行右对齐）
		const nsHead = head.createDiv({ cls: 'ad-ns__head' });
		nsHead.createDiv({ cls: 'ad-ns__big', text: String(stats.total) });
		const small = nsHead.createDiv({ cls: 'ad-ns__small' });
		small.createDiv({ cls: 'ad-ns__active', text: t('home.daysActive', { n: stats.active }) });
		const streak = small.createDiv({ cls: 'ad-ns__streak' });
		streak.appendText(t('home.streakPrefix'));
		streak.createEl('strong', { text: String(stats.streak) });
		streak.appendText(t('home.daysSuffix'));
		
		// --- Year boundaries (Jan 1 -> Dec 31) ---
		const yearStart = new Date(year, 0, 1);
		const yearEnd   = new Date(year, 11, 31);
		const yearStartTime = yearStart.getTime();
		const yearEndTime   = yearEnd.getTime();
		
		const startDow = yearStart.getDay();
		const startMonday = new Date(year, 0, 1 - ((startDow + 6) % 7));
		const endDow = yearEnd.getDay();
		const endSunday = new Date(year, 11, 31 + ((7 - endDow) % 7 || 7));
		
		const totalDays = Math.round((endSunday.getTime() - startMonday.getTime()) / 86400000) + 1;
		const totalWeeks = Math.ceil(totalDays / 7);
		
		// --- Heat area (flex column + horizontal scroll; fixed 13px cells) ---
		const heat = card.createDiv({ cls: 'ad-ns__heat' });
		
		// 月份标签行：内容由 layoutHeatmap 按「可见周窗口 + 实际列间距」动态重建（此处只建容器）
		heat.createDiv({ cls: 'ad-ns__months' });
		const startMs = startMonday.getTime();
		// 缓存每周所属月份（取该周周四所在月，GitHub 同款口径），供 layoutHeatmap 重建月份标签
		const weekMonths: number[] = [];
		for (let w = 0; w < totalWeeks; w++) {
			const thu = new Date(startMs + (w * 7 + 3) * 86400000);
			weekMonths.push(thu.getMonth());
		}
		this.adHmWeekMonths = weekMonths;
		this.adHmYear = year;
		this.adHmKey = ''; // DOM 已重建，强制重新布局
		
		// Grid: day-of-week column + cells (column flow, fixed 13px cells)
		const grid = heat.createDiv({ cls: 'ad-ns__grid' });
		const dow = grid.createDiv({ cls: 'ad-ns__dow' });
		tArr('home.heatDow').forEach((lab) => dow.createSpan({ text: lab }));
		
		const cells = grid.createDiv({ cls: 'ad-ns__cells' });
		for (let w = 0; w < totalWeeks; w++) {
			for (let r = 0; r < 7; r++) {
				const cellDate = new Date(startMs + (w * 7 + r) * 86400000);
				const cellTime = cellDate.getTime();
				const cell = cells.createDiv({ cls: 'ad-ns__cell' });
				
				if (cellTime < yearStartTime || cellTime > yearEndTime) {
					cell.addClass('ad-ns__cell--empty');
					continue;
				}
				
				const dateStr = fmtDate(cellDate);
				const count   = noteCounts.get(dateStr) ?? 0;
				const isFuture = cellTime > todayTime;
				
				if (!isFuture && count > 0) {
					if (count === 1)  cell.addClass('l1');
					else if (count <= 3) cell.addClass('l2');
					else if (count <= 6) cell.addClass('l3');
					else                 cell.addClass('l4');
				}
				if (isFuture) cell.addClass('is-future');
			if (dateStr === todayKey) cell.addClass('is-today'); // 当天格子：边缘光晕
				
				const mm = String(cellDate.getMonth() + 1).padStart(2, '0');
				const dd = String(cellDate.getDate()).padStart(2, '0');
				cell.title = isFuture ? t('home.cellFuture', { m: mm, d: dd }) : t('home.cellNotes', { m: mm, d: dd, n: count });
			}
		}
		
		// Footer legend (less ... more)
		const foot = card.createDiv({ cls: 'ad-ns__foot' });
		foot.createSpan({ cls: 'ad-ns__window', text: t('home.heatmapAllYear', { year }) });
		const legend = foot.createSpan({ cls: 'ad-ns__legend' });
		legend.createSpan({ cls: 'ad-ns__lbl', text: t('home.legendFew') });
		['', 'l1', 'l2', 'l3', 'l4'].forEach((lv) => {
			legend.createSpan({ cls: 'ad-ns__sw' + (lv ? ' ' + lv : '') });
		});
		legend.createSpan({ cls: 'ad-ns__lbl', text: t('home.legendMany') });

		// 按卡片实际宽高摊开格子间距（格子尺寸恒为 HM_CELL，绝不缩放），并监听尺寸变化实时重排
		this.layoutHeatmap(card);
		if (this.adHmObsTarget !== heat) {
			this.adHmObs?.disconnect();
			this.adHmObs = new ResizeObserver(() => {
				if (this.heatmapCard) this.layoutHeatmap(this.heatmapCard);
			});
			this.adHmObs.observe(heat);
			this.adHmObsTarget = heat;
		}
	}

	/**
	 * 热力图自适应布局：**格子尺寸固定为 HM_CELL，只调间距**。
	 * 1) 先按最小间距算出当前宽度最多能放几周；放不下全年就只显示最近 N 周（窄卡 2×1 用）；
	 * 2) 再把剩余空白摊进列间距，把整行填满（宽卡 4×1 右侧不再留大片空白），间距上限 HM_GAP_MAX；
	 * 3) 行间距同理按可用高度摊开，让热力区纵向也饱满；
	 * 4) 月份标签按可见周窗口 + 实际间距重建，保证与格子列严格对齐。
	 */
	private layoutHeatmap(card: HTMLElement): void {
		const heat = card.querySelector('.ad-ns__heat') as HTMLElement | null;
		const cells = card.querySelector('.ad-ns__cells') as HTMLElement | null;
		const dow = card.querySelector('.ad-ns__dow') as HTMLElement | null;
		const monthsRow = card.querySelector('.ad-ns__months') as HTMLElement | null;
		if (!heat || !cells || !dow || !monthsRow) return;
		const total = this.adHmWeekMonths.length;
		if (total === 0) return;

		const availW = Math.max(HM_CELL * HM_MIN_WEEKS, heat.clientWidth - HM_DOW_W);
		// 能完整放下几周（含最小间距）
		let weeks = Math.floor((availW + HM_GAP_MIN) / (HM_CELL + HM_GAP_MIN));
		weeks = Math.max(HM_MIN_WEEKS, Math.min(total, weeks));
		// 把剩余宽度摊进列间距
		let cgap = weeks > 1 ? (availW - weeks * HM_CELL) / (weeks - 1) : HM_GAP_MIN;
		cgap = Math.max(HM_GAP_MIN, Math.min(HM_GAP_MAX, Math.round(cgap * 10) / 10));

		// 行间距：可用高度 = 热力区高度 − 月份标签 − 内部 flex 间距/内边距
		const availH = heat.clientHeight - monthsRow.offsetHeight - 10;
		let rgap = (availH - 7 * HM_CELL) / 6;
		rgap = Math.max(HM_GAP_MIN, Math.min(HM_GAP_MAX, Math.round(rgap * 10) / 10));

		const key = `${weeks}|${cgap}|${rgap}`;
		if (key === this.adHmKey) return; // 与上次一致：跳过，避免 ResizeObserver 自激循环
		this.adHmKey = key;

		cells.style.setProperty('--hm-cgap', cgap + 'px');
		cells.style.setProperty('--hm-rgap', rgap + 'px');
		dow.style.setProperty('--hm-rgap', rgap + 'px');

		// 月份标签行必须与格子列左对齐：整体左移「星期列实际宽 + 网格列间距」。
		// 读取真实渲染尺寸（不写死），保证任意缩放/主题/屏幕尺寸下都精确对齐。
		const gridEl = cells.parentElement as HTMLElement | null;
		const gridGap = gridEl ? (parseFloat(getComputedStyle(gridEl).columnGap) || 4) : 4;
		monthsRow.style.paddingLeft = (dow.offsetWidth + gridGap) + 'px';

		// 只显示最近 weeks 周：隐藏最早的整列（每列 7 格，auto-flow column 会自动回填）
		const hiddenCells = (total - weeks) * 7;
		const kids = cells.children;
		for (let i = 0; i < kids.length; i++) {
			(kids[i] as HTMLElement).style.display = i < hiddenCells ? 'none' : '';
		}

		// 月份标签：按可见周窗口重建，宽度 = 该月周数 × (格子 + 间距) − 间距
		const monthNames = tArr('status.months');
		const visible = this.adHmWeekMonths.slice(total - weeks);
		monthsRow.empty();
		const unit = HM_CELL + cgap;
		let curM = visible[0] ?? 0;
		let curS = 1;
		const flush = (m: number, span: number): void => {
			const label = monthsRow.createSpan({ text: monthNames[m] ?? '' });
			label.style.minWidth = (span * unit) + 'px';
		};
		for (let w = 1; w < visible.length; w++) {
			const m = visible[w] ?? curM;
			if (m === curM) { curS++; continue; }
			flush(curM, curS);
			curM = m; curS = 1;
		}
		flush(curM, curS);

		// 底部窗口文案随可见范围变化
		const win = card.querySelector('.ad-ns__window') as HTMLElement | null;
		if (win) win.setText(weeks >= total ? t('home.heatmapAllYear', { year: this.adHmYear }) : t('home.heatmapRecent', { n: weeks }));
	}


	/* ---- Pomodoro（番茄钟：单实例卡片） ---- */
	private renderPomodoro(board: HTMLElement): void {
		const card = this.getOrCreateCard(board, 'ad-card ad-b-pomodoro');
		const w = (this.plugin.settings.pomodoro?.workMin ?? 25);
		const b = (this.plugin.settings.pomodoro?.breakMin ?? 5);
		this.cardHead(card, '\u25F7', t('home.modules.pomodoro'), `${w} / ${b}`);
		const p = card.createDiv({ cls: 'ad-pomo' });
		const modeEl = p.createDiv({ cls: 'ad-pomo__mode', text: this.plugin.pomoState.mode === 'work' ? t('home.pomoWork') : t('home.pomoBreak') });
		p.createDiv({ cls: 'ad-pomo__time', text: this.pomoTimeText() });
		const btns = p.createDiv({ cls: 'ad-pomo__btns' });
		const startBtn = btns.createEl('button', { cls: 'ad-pomo__btn ad-pomo__start', text: this.plugin.pomoState.running ? t('home.pomoPause') : t('home.pomoStart') });
		const resetBtn = btns.createEl('button', { cls: 'ad-pomo__btn', text: t('home.pomoReset') });

		startBtn.addEventListener('click', () => {
			if (this.plugin.pomoState.running) {
				this.plugin.pomoState.remaining = Math.max(0, this.plugin.pomoState.endTime - Date.now());
				this.plugin.pomoState.running = false;
				this.plugin.pomoState.endTime = 0;
			} else {
				this.plugin.pomoState.started = true;
				this.plugin.pomoState.endTime = Date.now() + this.plugin.pomoState.remaining;
				this.plugin.pomoState.running = true;
				this.plugin.warmPomoAudio(); // 用户手势内预热音频，确保到点提示音可播放
			}
			this.ensurePomoTimer();
			this.syncPomoDom();
		});
		resetBtn.addEventListener('click', () => {
			this.plugin.pomoState.started = false;
			this.plugin.pomoState.running = false;
			this.plugin.pomoState.endTime = 0;
			this.plugin.pomoState.mode = 'work';
			this.plugin.pomoState.remaining = this.pomoDuration();
			this.ensurePomoTimer();
			this.syncPomoDom();
		});
		// 点击模式名：工作 ⇄ 休息
		modeEl.addEventListener('click', () => {
			this.plugin.pomoState.started = false;
			this.plugin.pomoState.mode = this.plugin.pomoState.mode === 'work' ? 'break' : 'work';
			this.plugin.pomoState.running = false;
			this.plugin.pomoState.endTime = 0;
			this.plugin.pomoState.remaining = this.pomoDuration();
			this.ensurePomoTimer();
			this.syncPomoDom();
		});

		this.ensurePomoTimer();
	}

	private pomoWorkMs(): number {
		return Math.max(1, (this.plugin.settings.pomodoro?.workMin ?? 25)) * 60 * 1000;
	}

	private pomoBreakMs(): number {
		return Math.max(1, (this.plugin.settings.pomodoro?.breakMin ?? 5)) * 60 * 1000;
	}

	private pomoDuration(): number {
		return this.plugin.pomoState.mode === 'work' ? this.pomoWorkMs() : this.pomoBreakMs();
	}

	private pomoTimeText(): string {
		const totalSec = Math.max(0, Math.ceil(
			(this.plugin.pomoState.running ? this.plugin.pomoState.endTime - Date.now() : this.plugin.pomoState.remaining) / 1000,
		));
		const m = Math.floor(totalSec / 60);
		const s = totalSec % 60;
		return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	}

	/** 运行中则确保 interval 在跑，停止则清理，避免多视图/重建泄漏计时器 */
	private ensurePomoTimer(): void {
		if (this.plugin.pomoState.running && this.adPomoTimer === null) {
			this.adPomoTimer = window.setInterval(() => this.tickPomodoro(), 1000);
		} else if (!this.plugin.pomoState.running && this.adPomoTimer !== null) {
			window.clearInterval(this.adPomoTimer);
			this.adPomoTimer = null;
		}
	}

	private tickPomodoro(): void {
		if (!this.plugin.pomoState.running) return;
		const left = this.plugin.pomoState.endTime - Date.now();
		if (left <= 0) {
			// 完成一段 → 声音提醒 + 自动切到下一段并停止，等待用户手动开始
			const wasWork = this.plugin.pomoState.mode === 'work';
			this.plugin.pomoState.mode = wasWork ? 'break' : 'work';
			this.plugin.pomoState.running = false;
			this.plugin.pomoState.endTime = 0;
			this.plugin.pomoState.remaining = this.pomoDuration();
			this.ensurePomoTimer();
			this.plugin.playPomoSound();
			this.showToast(wasWork ? t('home.pomoDoneWork') : t('home.pomoDoneBreak'));
		} else {
			this.plugin.pomoState.remaining = left;
		}
		this.syncPomoDom();
	}

	private syncPomoDom(): void {
		if (!this.boardEl) return;
		const timeEl = this.boardEl.querySelector('.ad-b-pomodoro .ad-pomo__time');
		if (timeEl) timeEl.textContent = this.pomoTimeText();
		const modeEl = this.boardEl.querySelector('.ad-b-pomodoro .ad-pomo__mode');
		if (modeEl) modeEl.textContent = this.plugin.pomoState.mode === 'work' ? t('home.pomoWork') : t('home.pomoBreak');
		const startBtn = this.boardEl.querySelector('.ad-b-pomodoro .ad-pomo__start');
		if (startBtn) startBtn.textContent = this.plugin.pomoState.running ? t('home.pomoPause') : t('home.pomoStart');
	}

	/* ---- Countdown（多实例：每张独立卡片） ---- */
	/** 渲染「倒计时」多实例中的某一张独立卡片；idx 为 settings.countdown 下标，-1 表示占位卡 */
	private renderCountdownCard(board: HTMLElement, idx: number): void {
		const card = board.querySelector(`.ad-card.ad-b-countdown[data-cd-idx="${idx}"]`) as HTMLElement | null;
		if (!card) return;
		card.empty();
		card.setAttribute('data-mod', 'countdown');
		const list = this.plugin.settings.countdown ?? [];
		if (idx < 0 || idx >= list.length) {
			this.cardHead(card, '\u25C7', t('home.modules.countdown'), 'Days Left');
			const cd = card.createDiv({ cls: 'ad-cd' });
			cd.createDiv({ cls: 'ad-cd__empty', text: t('modal.cdEmpty') });
			return;
		}
		const cfg = list[idx]!;
		// 卡片标题固定为模块名「倒计时」（与注册表 homeModules 一致），事件名只出现在副标题「距离 {事件}」
		this.cardHead(card, '\u25C7', t('home.modules.countdown'), 'Days Left');
		const cd = card.createDiv({ cls: 'ad-cd' });
		this.renderOneCountdown(cd, cfg);
	}

	/** 新增一张倒计时卡片（追加一个独立事件，最多 5 张） */
	private addCountdownCard(): void {
		const list = this.plugin.settings.countdown ?? [];
		if (list.length >= 5) { this.showToast(t('modal.cdMax')); return; }
		list.push({ eventName: defaultEventName(), targetDate: '2027-01-01' });
		this.plugin.settings.countdown = list;
		// 确保倒计时模块本身已启用：被隐藏时也能通过「添加卡片」恢复显示
		const hm = this.plugin.settings.homeModules;
		const m = hm?.find((x) => x.id === 'countdown');
		if (m && !m.enabled) {
			m.enabled = true;
			const maxOrder = hm && hm.length ? Math.max(...hm.map((x) => x.order)) : -1;
			m.order = maxOrder + 1;
		}
		void this.plugin.saveSettings();
		if (this.boardEl) void this.renderEnabledModules(this.boardEl);
	}

	/** 删除指定下标的倒计时卡片（不影响其它卡片） */
	private deleteCountdownCard(idx: number): void {
		const list = this.plugin.settings.countdown ?? [];
		if (idx < 0 || idx >= list.length) return;
		list.splice(idx, 1);
		this.plugin.settings.countdown = list;
		void this.plugin.saveSettings();
		if (this.boardEl) void this.renderEnabledModules(this.boardEl);
	}

	private renderOneCountdown(cd: HTMLElement, cfg: CountdownSettings): void {
		const target = this.parseCountdownDate(cfg.targetDate);
		const now = new Date();
		const today = this.startOfDay(now);
		const targetDay = this.startOfDay(target);
		// 以「天」为单位的差值：>0 表示未来、0 表示当天到达、<0 表示已过期
		const diffDays = Math.round((targetDay.getTime() - today.getTime()) / 86400000);

		const item = cd.createDiv({ cls: 'ad-cd__item' });
		// 副标题：距离 {事件名}
		item.createDiv({ cls: 'ad-cd__sub', text: t('home.countdownSubtitle', { event: cfg.eventName }) });

		if (diffDays > 0) {
			// 进度：以「事件日期前一年」为起点、事件日期为终点（默认即日历年度进度），随事件日期动态变化
			const periodStart = new Date(target.getFullYear() - 1, target.getMonth(), target.getDate());
			const total = Math.max(1, target.getTime() - periodStart.getTime());
			const elapsed = now.getTime() - periodStart.getTime();
			const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));

			const big = item.createDiv({ cls: 'ad-cd__big' });
			big.createSpan({ text: String(diffDays) });
			big.createSpan({ cls: 'ad-unit', text: 'DAYS' });

			// 底部组：小字行紧贴进度条（保留少量间距），整体下移到底部
			const bottom = item.createDiv({ cls: 'ad-cd__bottom' });
			const row = bottom.createDiv({ cls: 'ad-cd__row' });
			row.createSpan({ text: t('home.weeksLeft') }).createEl('strong', { text: String(Math.ceil(diffDays / 7)) });
			row.createSpan({ cls: 'ad-dot', attr: { style: 'display:inline-block;width:3px;height:3px;background:var(--ad-text-dim);border-radius:50%;' } });
			row.createSpan({ text: t('home.donePct') }).createEl('strong', { text: pct.toFixed(1) + '%' });

			const barWrap = bottom.createDiv({ cls: 'ad-cd__bar' });
			const fill = barWrap.createDiv({ cls: 'ad-fill' });
			fill.style.width = pct + '%';
		} else if (diffDays === 0) {
			// 当天到达目标日期：隐藏数字与 DAYS，居中显示「此时此刻」
			item.createDiv({ cls: 'ad-cd__arrived', text: t('home.countdownArrived') });
			const bottom = item.createDiv({ cls: 'ad-cd__bottom' });
			const barWrap = bottom.createDiv({ cls: 'ad-cd__bar' });
			const fill = barWrap.createDiv({ cls: 'ad-fill' });
			fill.style.width = '100%';
		} else {
			// 已过期：居中显示「旅程已然到达」
			item.createDiv({ cls: 'ad-cd__arrived', text: t('home.countdownReached') });
			const bottom = item.createDiv({ cls: 'ad-cd__bottom' });
			const barWrap = bottom.createDiv({ cls: 'ad-cd__bar' });
			const fill = barWrap.createDiv({ cls: 'ad-fill' });
			fill.style.width = '100%';
		}
	}

	/** 解析 ISO yyyy-mm-dd 为目标 Date（当地 0 点）；非法或留空回退到「下一年 1 月 1 日」 */
	private parseCountdownDate(s: string): Date {
		const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? '').trim());
		if (m) {
			const y = parseInt(m[1]!, 10);
			const mo = parseInt(m[2]!, 10) - 1;
			const d = parseInt(m[3]!, 10);
			const dt = new Date(y, mo, d);
			if (!Number.isNaN(dt.getTime()) && dt.getFullYear() === y && dt.getDate() === d) return dt;
		}
		return new Date(new Date().getFullYear() + 1, 0, 1);
	}

	/** 取某日当地 0 点，用于按「天」比较 */
	private startOfDay(d: Date): Date {
		return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
