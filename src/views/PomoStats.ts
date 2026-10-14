import { t, tArr, isEnglish } from '../i18n';
import {
	POMO_SEGMENTS, POMO_KEEP_DAYS,
	pomoDayTotals, pomoHourTotals, pomoRecentRecords, pomoSegmentTotals,
	pomoTrendDays, pomoWeekdayBars, summarizePomo,
	type PomoBar, type PomoRecord,
} from '../data/pomoStats';
import { fmtDate } from '../data/taskLogic';
import { HeatmapSkyline } from './HeatmapSkyline';
import { ICON_heatGrid, ICON_heatCube, injectSvg } from '../icons';

/** 顶部页面标识（与 'home' / 'project' / 'opportunity' 并列） */
export type DashboardPage = 'home' | 'project' | 'opportunity' | 'pomodoro';

/** Host surface the PomoStats page needs from its owner view. */
export interface PomoStatsHost {
	plugin: { getPomoRecords(): Promise<PomoRecord[]> };
	boardEl: HTMLElement | null;
	currentPage: DashboardPage;
	exitEditMode(): void;
	showDashboard(): Promise<void> | void;
	showToast(message: string, kind?: 'success' | 'error'): void;
}

/** 统计页的 5 个视图 */
type StatsView = 'overview' | 'trend' | 'timeline' | 'hours' | 'year';

/** 年度 3D 柱阵最多画多少周（与首页笔记统计一致 = 一整年） */
const YEAR_MAX_WEEKS = 53;

/** SVG 命名空间元素创建（趋势图手绘用） */
function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
	return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/** 分钟 → 「X 小时 Y 分」/「Xh Ym」（时长展示统一入口） */
function fmtPomoDuration(ms: number): string {
	const min = Math.round(ms / 60000);
	if (isEnglish()) {
		if (min < 60) return `${min}m`;
		const h = Math.floor(min / 60);
		const m = min % 60;
		return m ? `${h}h ${m}m` : `${h}h`;
	}
	if (min < 60) return t('stats.unitMin', { n: min });
	const h = Math.floor(min / 60);
	const m = min % 60;
	return m ? t('stats.unitHour', { h, m }) : t('stats.unitHourExact', { h });
}

/** 本地化短日期：zh「10月1日」/ en「Oct 1」 */
function fmtDayLabel(d: Date): string {
	if (isEnglish()) return `${tArr('status.months')[d.getMonth()] ?? ''} ${d.getDate()}`;
	return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** HH:MM（真实时间戳） */
function fmtHm(ts: number): string {
	const d = new Date(ts);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** HH:MM（距 0 点的分钟数；直接按分钟格式化，避免 new Date(0) 受时区影响） */
function fmtMinutesOfDay(m: number): string {
	return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/** 番茄钟统计页（第五页）渲染器 —— 与 ProjectBoard / OpportunityBoard 同构：
 *  数据来自 plugin.getPomoRecords()（插件目录 pomodoro.json 的内存缓存）。 */
export class PomoStatsBoard {
	private host: PomoStatsHost;
	/** 当前视图（切页保留） */
	private view: StatsView = 'overview';
	/** 页面骨架引用（切 tab 只重渲染内容区） */
	private tabsEl: HTMLElement | null = null;
	private contentEl: HTMLElement | null = null;
	/** 年度热力图当前渲染的年份 */
	private year = new Date().getFullYear();
	/** 年度 3D 柱阵绘制器（与首页笔记统计同款；离开本视图/重渲染前须 dispose） */
	private skyline: HeatmapSkyline | null = null;
	/** 年度柱阵最近一次绘制参数（主题切换后用新色阶非动画重绘） */
	private skylineOpts: Parameters<HeatmapSkyline['render']>[0] | null = null;
	private skylineObs?: ResizeObserver;
	/** 年度柱阵当前视图：3d 立体柱阵（默认，与首页一致）/ 2d 平面热力 */
	private skylineView: '2d' | '3d' = '3d';

	constructor(host: PomoStatsHost) {
		this.host = host;
	}

	/** 离开统计页 / 组件销毁时释放 Canvas 与 ResizeObserver（避免泄漏） */
	dispose(): void {
		this.teardownSkyline();
	}

	private teardownSkyline(): void {
		this.skylineObs?.disconnect();
		this.skylineObs = undefined;
		this.skyline?.dispose();
		this.skyline = null;
		this.skylineOpts = null;
	}

	/** 主题切换后由宿主调用：统计页可见时按缓存参数用新色阶重绘年度柱阵（不播形变动画） */
	redrawSkylineIfVisible(): void {
		if (this.host.currentPage !== 'pomodoro' || !this.skyline || !this.skylineOpts) return;
		this.skyline.render(this.skylineOpts);
	}

	/** 番茄完成落盘后由视图调用：统计页正打开时整体重渲染 */
	refreshIfVisible(): void {
		if (this.host.currentPage === 'pomodoro') void this.refresh();
	}

	/** 重新载入记录并重渲染（保留当前 tab） */
	async refresh(): Promise<void> {
		if (!this.host.boardEl || this.host.currentPage !== 'pomodoro') return;
		await this.show();
	}

	async show(): Promise<void> {
		const board = this.host.boardEl;
		if (!board) return;
		this.host.exitEditMode();
		const entering = this.host.currentPage !== 'pomodoro';
		const records = await this.host.plugin.getPomoRecords();
		// 异步读取记录期间用户可能已切到其他页：放弃渲染，避免覆盖新页面
		if (!this.host.boardEl || this.host.currentPage === 'project' || this.host.currentPage === 'opportunity') return;

		if (entering) {
			board.empty();
			board.removeClass('ad-board');
			board.removeClass('po-board');
			board.removeClass('op-board');
			board.addClass('ps-board');
			this.host.currentPage = 'pomodoro';

			const page = board.createDiv({ cls: 'ps-page' });
			this.renderHeader(page);
			this.tabsEl = page.createDiv({ cls: 'ps-tabs' });
			this.contentEl = page.createDiv({ cls: 'ps-content' });
		}
		this.renderTabs();
		this.renderContent(records);
	}

	/* ============================================================
	   页面骨架：标题 + 返回 + tabs
	   ============================================================ */

	private renderHeader(page: HTMLElement): void {
		const head = page.createDiv({ cls: 'ps-head' });
		const left = head.createDiv({ cls: 'ps-head__left' });
		left.createEl('h2', { cls: 'ps-head__title', text: t('stats.title') });
		left.createDiv({ cls: 'ps-head__sub', text: t('stats.subtitle', { n: POMO_KEEP_DAYS }) });
		const back = head.createEl('button', { cls: 'ps-head__back', text: '‹ ' + t('home.nav.home') });
		back.addEventListener('click', () => {
			void this.host.showDashboard();
		});
	}

	private renderTabs(): void {
		if (!this.tabsEl) return;
		this.tabsEl.empty();
		const tabs: { id: StatsView; label: string }[] = [
			{ id: 'overview', label: t('stats.tabOverview') },
			{ id: 'trend', label: t('stats.tabTrend') },
			{ id: 'timeline', label: t('stats.tabTimeline') },
			{ id: 'hours', label: t('stats.tabHours') },
			{ id: 'year', label: t('stats.tabYear') },
		];
		for (const tb of tabs) {
			const btn = this.tabsEl.createEl('button', {
				cls: 'ps-tabs__btn' + (this.view === tb.id ? ' is-active' : ''),
				text: tb.label,
			});
			btn.addEventListener('click', () => {
				if (this.view === tb.id) return;
				this.view = tb.id;
				this.renderTabs();
				void this.host.plugin.getPomoRecords().then((r) => this.renderContent(r));
			});
		}
	}

	private renderContent(records: PomoRecord[]): void {
		if (!this.contentEl) return;
		// 每次重建内容区前先拆掉上一视图的 3D 柱阵（切 tab / 刷新都不能残留旧 Canvas）
		this.teardownSkyline();
		this.contentEl.empty();
		if (records.length === 0) {
			this.renderEmpty(this.contentEl);
			return;
		}
		switch (this.view) {
			case 'overview': this.renderOverview(this.contentEl, records); break;
			case 'trend': this.renderTrend(this.contentEl, records); break;
			case 'timeline': this.renderTimeline(this.contentEl, records); break;
			case 'hours': this.renderHours(this.contentEl, records); break;
			case 'year': this.renderYear(this.contentEl, records); break;
		}
	}

	/* ============================================================
	   概览：四格 KPI + 时段分布环形图 + 按日记录列表
	   ============================================================ */

	private renderOverview(root: HTMLElement, records: PomoRecord[]): void {
		const s = summarizePomo(records, new Date());

		// ── 四格统计卡 ──
		const kpis = root.createDiv({ cls: 'ps-kpis' });
		this.renderKpi(kpis, t('stats.kpiTodayPomos'), String(s.todayCount));
		this.renderKpi(kpis, t('stats.kpiTotalPomos'), String(s.totalCount));
		this.renderKpi(kpis, t('stats.kpiTodayFocus'), fmtPomoDuration(s.todayMs));
		this.renderKpi(kpis, t('stats.kpiTotalFocus'), fmtPomoDuration(s.totalMs));

		// ── 时段分布：conic-gradient 环形图 + 图例进度条 ──
		const segCard = root.createDiv({ cls: 'ps-card' });
		segCard.createDiv({ cls: 'ps-card__title', text: t('stats.segTitle') });
		const segWrap = segCard.createDiv({ cls: 'ps-seg' });
		const seg = pomoSegmentTotals(records);
		const segMs = POMO_SEGMENTS.map((k) => seg[k]);
		const total = segMs.reduce((a, b) => a + b, 0);

		// 环形图：四段按占比首尾相接的 conic-gradient，中心留洞显示总量
		const donut = segWrap.createDiv({ cls: 'ps-seg__donut' });
		const stops: string[] = [];
		let acc = 0;
		const segColors = ['var(--ad-ps-seg-1)', 'var(--ad-ps-seg-2)', 'var(--ad-ps-seg-3)', 'var(--ad-ps-seg-4)'];
		POMO_SEGMENTS.forEach((_, i) => {
			const from = (acc / (total || 1)) * 360;
			acc += segMs[i] ?? 0;
			const to = (acc / (total || 1)) * 360;
			stops.push(`${segColors[i]} ${from}deg ${to}deg`);
		});
		donut.setCssProps({ background: `conic-gradient(${stops.join(', ')})` });
		const hole = donut.createDiv({ cls: 'ps-seg__hole' });
		hole.createSpan({ cls: 'ps-seg__hole-v', text: fmtPomoDuration(total) });
		hole.createSpan({ cls: 'ps-seg__hole-l', text: t('stats.segTotal') });

		const legend = segWrap.createDiv({ cls: 'ps-seg__legend' });
		const segNames: Record<(typeof POMO_SEGMENTS)[number], string> = {
			dawn: t('stats.segDawn'), morning: t('stats.segMorning'),
			afternoon: t('stats.segAfternoon'), evening: t('stats.segEvening'),
		};
		POMO_SEGMENTS.forEach((k, i) => {
			const ms = segMs[i] ?? 0;
			const pct = total > 0 ? (ms / total) * 100 : 0;
			const row = legend.createDiv({ cls: 'ps-seg__row' });
			row.createDiv({ cls: `ps-seg__dot ps-seg__dot--${i + 1}` });
			row.createSpan({ cls: 'ps-seg__name', text: segNames[k] });
			// 顺序对应网格模板 10px auto 1fr auto auto：圆点 | 名称 | 进度条 | 时长 | 占比
			const bar = row.createDiv({ cls: 'ps-seg__bar' });
			bar.createDiv({ cls: `ps-seg__fill ps-seg__fill--${i + 1}` }).style.width = pct.toFixed(1) + '%';
			row.createSpan({ cls: 'ps-seg__ms', text: fmtPomoDuration(ms) });
			row.createSpan({ cls: 'ps-seg__pct', text: pct.toFixed(0) + '%' });
		});

		// ── 按日时间线的专注记录列表（最近 30 条） ──
		const listCard = root.createDiv({ cls: 'ps-card' });
		listCard.createDiv({ cls: 'ps-card__title', text: t('stats.recordsTitle') });
		const list = listCard.createDiv({ cls: 'ps-rec' });
		const recent = pomoRecentRecords(records, 30);
		const todayKey = fmtDate(new Date());
		let curKey = '';
		let group: HTMLElement | null = null;
		for (const r of recent) {
			const key = fmtDate(new Date(r.ts));
			if (key !== curKey) {
				curKey = key;
				const d = new Date(r.ts);
				const label = key === todayKey ? t('stats.today') : fmtDayLabel(d);
				group = list.createDiv({ cls: 'ps-rec__group' });
				group.createDiv({ cls: 'ps-rec__day', text: label });
			}
			const start = r.ts - r.ms;
			const row = (group as HTMLElement).createDiv({ cls: 'ps-rec__row' });
			row.createSpan({ cls: 'ps-rec__round', text: t('stats.roundN', { n: r.round }) });
			row.createSpan({ cls: 'ps-rec__time', text: `${fmtHm(start)} – ${fmtHm(r.ts)}` });
			row.createSpan({ cls: 'ps-rec__ms', text: fmtPomoDuration(r.ms) });
		}
	}

	private renderKpi(root: HTMLElement, label: string, value: string): void {
		const kpi = root.createDiv({ cls: 'ps-kpi' });
		kpi.createDiv({ cls: 'ps-kpi__v', text: value });
		kpi.createDiv({ cls: 'ps-kpi__l', text: label });
	}

	/* ============================================================
	   趋势：近 7 天面积折线图（每日平均时长，无数据日不画点）
	   ============================================================ */

	private renderTrend(root: HTMLElement, records: PomoRecord[]): void {
		const card = root.createDiv({ cls: 'ps-card' });
		card.createDiv({ cls: 'ps-card__title', text: t('stats.trendTitle') });
		const days = pomoTrendDays(records, new Date(), 7);
		const hasData = days
			.map((d, i) => ({ i, avg: d.avgMs / 60000 }))
			.filter((p) => p.avg > 0);
		if (hasData.length === 0) {
			card.createDiv({ cls: 'ps-chart-empty', text: t('stats.emptyTitle') });
			return;
		}

		const W = 560; const H = 190;
		const padL = 42; const padR = 14; const padT = 22; const padB = 28;
		const innerW = W - padL - padR; const innerH = H - padT - padB;
		// Y 轴上限：向上取整到 15 分钟的倍数（至少 30），保证刻度可读
		const rawMax = Math.max(...hasData.map((p) => p.avg));
		const maxY = Math.max(30, Math.ceil(rawMax / 15) * 15);
		const x = (i: number): number => padL + (innerW * i) / (days.length - 1);
		const y = (v: number): number => padT + innerH - (innerH * v) / maxY;

		const svg = svgEl('svg');
		svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
		svg.setAttribute('class', 'ps-trend');
		svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

		// 横向网格 + Y 轴刻度
		for (let g = 0; g <= 4; g++) {
			const v = (maxY / 4) * g;
			const line = svgEl('line');
			line.setAttribute('x1', String(padL)); line.setAttribute('x2', String(W - padR));
			line.setAttribute('y1', String(y(v))); line.setAttribute('y2', String(y(v)));
			line.setAttribute('class', g === 0 ? 'ps-trend__axis' : 'ps-trend__grid');
			svg.appendChild(line);
			const lbl = svgEl('text');
			lbl.setAttribute('x', String(padL - 8)); lbl.setAttribute('y', String(y(v) + 3));
			lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('class', 'ps-trend__tick');
			lbl.textContent = String(Math.round(v));
			svg.appendChild(lbl);
		}

		// 面积 + 折线：只连有数据的天（无数据日不画点，线跨越空档）
		const pts = hasData.map((p) => ({ ...p, cx: x(p.i), cy: y(p.avg) }));
		if (pts.length >= 2) {
			const base = y(0);
			const area = svgEl('polygon');
			area.setAttribute('points', [
				`${pts[0]!.cx},${base}`,
				...pts.map((p) => `${p.cx},${p.cy}`),
				`${pts[pts.length - 1]!.cx},${base}`,
			].join(' '));
			area.setAttribute('class', 'ps-trend__area');
			svg.appendChild(area);
			const poly = svgEl('polyline');
			poly.setAttribute('points', pts.map((p) => `${p.cx},${p.cy}`).join(' '));
			poly.setAttribute('class', 'ps-trend__line');
			svg.appendChild(poly);
		}
		for (const p of pts) {
			const dot = svgEl('circle');
			dot.setAttribute('cx', String(p.cx)); dot.setAttribute('cy', String(p.cy));
			dot.setAttribute('r', '3.2'); dot.setAttribute('class', 'ps-trend__dot');
			svg.appendChild(dot);
			const lbl = svgEl('text');
			lbl.setAttribute('x', String(p.cx)); lbl.setAttribute('y', String(p.cy - 8));
			lbl.setAttribute('text-anchor', 'middle'); lbl.setAttribute('class', 'ps-trend__val');
			lbl.textContent = String(Math.round(p.avg));
			svg.appendChild(lbl);
		}

		// X 轴日期
		const todayKey = fmtDate(new Date());
		days.forEach((d, i) => {
			const lbl = svgEl('text');
			lbl.setAttribute('x', String(x(i))); lbl.setAttribute('y', String(H - 8));
			lbl.setAttribute('text-anchor', 'middle');
			lbl.setAttribute('class', 'ps-trend__day' + (d.key === todayKey ? ' ps-trend__day--today' : ''));
			lbl.textContent = `${d.date.getMonth() + 1}/${d.date.getDate()}`;
			svg.appendChild(lbl);
		});
		card.createDiv({ cls: 'ps-chart' }).appendChild(svg);
		card.createDiv({ cls: 'ps-chart-foot', text: t('stats.trendUnit') });
	}

	/* ============================================================
	   时间线：24 小时 × 7 天网格，专注时段画横条
	   ============================================================ */

	private renderTimeline(root: HTMLElement, records: PomoRecord[]): void {
		const card = root.createDiv({ cls: 'ps-card' });
		card.createDiv({ cls: 'ps-card__title', text: t('stats.timelineTitle') });
		const rows = pomoWeekdayBars(records);
		const dows = tArr('ui.calWeekdays');

		// 小时刻度（0/3/…/24）
		const scale = card.createDiv({ cls: 'ps-tl__row ps-tl__row--scale' });
		scale.createSpan({ cls: 'ps-tl__dow' });
		const sTrack = scale.createDiv({ cls: 'ps-tl__track' });
		for (let h = 0; h <= 24; h += 3) {
			sTrack.createSpan({ cls: 'ps-tl__scale-l', text: String(h) });
		}

		const body = card.createDiv({ cls: 'ps-tl__body' });
		rows.forEach((bars, dow) => {
			const row = body.createDiv({ cls: 'ps-tl__row' });
			row.createSpan({ cls: 'ps-tl__dow', text: dows[dow] ?? '' });
			const track = row.createDiv({ cls: 'ps-tl__track' });
			if (bars.length === 0) {
				track.addClass('ps-tl__track--empty');
				return;
			}
			for (const b of bars as PomoBar[]) {
				const bar = track.createDiv({ cls: 'ps-tl__bar' });
				bar.style.left = ((b.m0 / 1440) * 100).toFixed(3) + '%';
				bar.style.width = Math.max(0.6, ((b.m1 - b.m0) / 1440) * 100).toFixed(3) + '%';
				bar.setAttribute('title', t('stats.barTip', {
					a: fmtMinutesOfDay(b.m0), b: fmtMinutesOfDay(b.m1), n: Math.round(b.ms / 60000),
				}));
			}
		});
	}

	/* ============================================================
	   最佳时段：24 小时柱状图（按小时聚合，无数据浅色占位）
	   ============================================================ */

	private renderHours(root: HTMLElement, records: PomoRecord[]): void {
		const card = root.createDiv({ cls: 'ps-card' });
		card.createDiv({ cls: 'ps-card__title', text: t('stats.hoursTitle') });
		const totals = pomoHourTotals(records);
		const max = Math.max(...totals, 1);
		const nowHour = new Date().getHours();

		const chart = card.createDiv({ cls: 'ps-hours' });
		for (let h = 0; h < 24; h++) {
			const col = chart.createDiv({ cls: 'ps-hours__col' });
			const area = col.createDiv({ cls: 'ps-hours__area' });
			const ms = totals[h] ?? 0;
			const bar = area.createDiv({ cls: 'ps-hours__bar' + (ms > 0 ? '' : ' ps-hours__bar--empty') });
			if (ms > 0) {
				bar.style.height = Math.max(4, (ms / max) * 100).toFixed(1) + '%';
				bar.setAttribute('title', t('stats.barTip', {
					a: `${pad2(h)}:00`, b: `${pad2(h)}:59`, n: Math.round(ms / 60000),
				}));
			}
			const lbl = col.createDiv({ cls: 'ps-hours__lbl', text: h % 3 === 0 ? String(h) : '' });
			if (h === nowHour) lbl.addClass('ps-hours__lbl--now');
		}
	}

	/* ============================================================
	   年度专注：复用首页「笔记统计」的 3D 柱阵（HeatmapSkyline）。
	   数据由每日专注毫秒折算成「番茄段数（25min/段）」喂给同一绘制器，
	   视觉/相机/聚焦/2D⇄3D 形变与首页完全一致。
	   ============================================================ */

	private renderYear(root: HTMLElement, records: PomoRecord[]): void {
		this.year = new Date().getFullYear();
		const totals = pomoDayTotals(records, this.year);

		// 每日专注毫秒 → 折算番茄段数（每 25 分钟一段，向上取整，至少 1）。
		// HeatmapSkyline 用 count 决定柱高与色阶，这里的「count」语义即当天专注了几段。
		const counts = new Map<string, number>();
		for (const [key, ms] of totals) {
			if (ms > 0) counts.set(key, Math.max(1, Math.round(ms / (25 * 60 * 1000))));
		}

		const card = root.createDiv({ cls: 'ps-card ps-card--year' });
		const titleRow = card.createDiv({ cls: 'ps-year__head' });
		titleRow.createDiv({ cls: 'ps-card__title', text: t('stats.yearTitle', { year: this.year }) });
		// 2D / 3D 切换（与首页笔记统计同款 SVG 图标按钮，同一套标题文案）
		const toggle = titleRow.createEl('button', { cls: 'ad-ns__view ps-year__view' });
		const syncToggle = (): void => {
			const is3d = this.skylineView === '3d';
			toggle.title = is3d ? t('home.heatmapTo2d') : t('home.heatmapTo3d');
			toggle.setAttribute('aria-label', toggle.title);
			toggle.empty();
			injectSvg(toggle, is3d ? ICON_heatGrid : ICON_heatCube);
		};
		syncToggle();

		const stage = card.createDiv({ cls: 'ad-ns__stage ps-year__stage' });
		this.skyline = new HeatmapSkyline(stage);
		const opts: Parameters<HeatmapSkyline['render']>[0] = {
			counts,
			// 完整自然年：锚定 12/31，画满 53 周（与首页「完整自然年」口径一致）
			endDate: new Date(this.year, 11, 31),
			maxWeeks: YEAR_MAX_WEEKS,
			weeksMode: 'full',
			weekdayLabels: tArr('home.heatDow'),
			monthNames: tArr('status.months'),
			cellTitle: (key: string, count: number) => {
				const d = new Date(key + 'T00:00:00');
				const ms = totals.get(key) ?? 0;
				return `${fmtDayLabel(d)} · ${ms > 0 ? fmtPomoDuration(ms) : t('stats.noFocus')}`;
			},
			view: this.skylineView,
			// 年度页不做「聚焦近 16 周」推镜：保持展示完整一年
			focus: false,
		};
		this.skylineOpts = opts;
		this.skyline.render(opts);
		toggle.addEventListener('click', (ev) => {
			ev.stopPropagation();
			this.skylineView = this.skylineView === '3d' ? '2d' : '3d';
			syncToggle();
			opts.view = this.skylineView;
			opts.animate = true;
			this.skyline?.render(opts);
			opts.animate = false;
		});

		// 容器尺寸变化时按同一参数重绘（侧栏折叠/窗格缩放后柱阵重新取景）
		this.skylineObs = new ResizeObserver(() => {
			this.skyline?.render(opts);
		});
		this.skylineObs.observe(stage);

		// 图例（与首页同一套色阶）
		const foot = card.createDiv({ cls: 'ps-year__foot' });
		foot.createDiv({ cls: 'ps-year__window', text: t('home.heatmapAllYear', { year: this.year }) });
		const legend = foot.createDiv({ cls: 'ps-year__legend' });
		legend.createSpan({ cls: 'ps-year__lbl', text: t('home.legendFew') });
		for (let li = 0; li <= 4; li++) {
			legend.createDiv({ cls: 'ps-year__sw' + (li > 0 ? ' l' + li : '') });
		}
		legend.createSpan({ cls: 'ps-year__lbl', text: t('home.legendMany') });
	}

	/* ============================================================
	   空状态
	   ============================================================ */

	private renderEmpty(root: HTMLElement): void {
		const e = root.createDiv({ cls: 'ps-empty' });
		e.createDiv({ cls: 'ps-empty__icon', text: '🍅' });
		e.createDiv({ cls: 'ps-empty__title', text: t('stats.emptyTitle') });
		e.createDiv({ cls: 'ps-empty__hint', text: t('stats.emptyHint', { n: POMO_KEEP_DAYS }) });
	}
}
