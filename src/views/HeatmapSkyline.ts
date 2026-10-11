/**
 * 笔记统计「等距 3D 天际线」的 Canvas 绘制器。
 *
 * 每格画成一个立方体（顶面 + 左右两个加深的侧面），按深度由远及近绘制（画家算法）。
 * 配色直接读 CSS 变量 `--ad-hm-0` ~ `--ad-hm-4`，与 2D 平面热力图、底部图例保持同色。
 *
 * 性能：**不做持续动画帧**（首页已有噪点层在跑 rAF），只在「重绘 / 尺寸变化 / 悬停变化」时绘制。
 */

import { morphCamera, project, depthOf, barHeight, buildSkyline, weekMonths, easeInOutCubic, riseAt, fitWeeks, focusWindow, FOCUS_WEEKS, type DayCell } from '../data/heatmapModel';
import type { Cam } from '../data/heatmapModel';

export interface SkylineOptions {
	/** 日期 → 当天笔记数 */
	counts: Map<string, number>;
	/** 截止日期（含当天） */
	endDate: Date;
	/** 星期标签（周一 → 周日，与 2D 网格同一顺序） */
	weekdayLabels: string[];
	/** 月份名（1 月 → 12 月） */
	monthNames: string[];
	/** 单元格原生提示文案 */
	cellTitle: (key: string, count: number) => string;
	/** 最多画多少周（自适应上限，即全部可用历史） */
	maxWeeks: number;
	/** 目标视图：2d = 平面热力图（相机正俯视），3d = 等距天际线。两者是同一场景的两个相机状态。 */
	view: '2d' | '3d';
	/** 是否播形变动画（2D ⇄ 3D 切换时为 true） */
	animate?: boolean;
	/** 形变起点（0 平面 / 1 立体）。切换视图时卡片会被重建、本实例是全新的，
	 *  因此必须由调用方显式告知「从哪来」，否则 3D → 2D 会退化成 0 → 0 而没有动画。 */
	from?: number;
	/** 聚焦模式：进入 3D 时由「整年全景」连续放大到「最近 FOCUS_WEEKS 周」，尽量占满画面 */
	focus?: boolean;
	/** 取景口径：auto = 按卡片宽高比自适应（滚动近 12 个月）；full = 固定画满 maxWeeks（完整自然年） */
	weeksMode?: 'auto' | 'full';
}

/** 相机形变 + 柱体升降时长（ms） */
const MORPH_MS = 950;
/** 聚焦推镜的延迟：先「立起来」，再「推近」，观感更像一个连续镜头 */
const ZOOM_DELAY_MS = 420;
/** 聚焦推镜时长（ms）——比相机形变慢，避免「一闪就到位」 */
const ZOOM_MS = 1150;
/** 聚焦时窗口左侧的渐隐带宽度（周）：越早的周越先淡出 */
const FADE_BAND = 6;

/** 网格单元在屏幕上的三个面（各 4 个点），供命中测试复用 */
const QUAD_FLOATS = 24;
/** 每个面从中心外扩的像素数：让相邻盒体轻微交叠，消除抗锯齿留下的发丝细缝 */
const QUAD_EPS = 0.45;

export class HeatmapSkyline {
	private host: HTMLElement;
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null;
	private opts: SkylineOptions | null = null;

	/** 三面顶点缓存（每格 24 个 float：3 面 × 4 点 × 2 坐标） */
	private quads = new Float32Array(0);
	/** 该格需要绘制侧面（柱太矮/太窄时省略，省填充又避免噪点） */
	private faces = new Uint8Array(0);
	/** 上一次绘制的格子（命中后取提示文案用） */
	private cells: DayCell[] = [];
	/** 上一次绘制的画家算法顺序（远 → 近）；命中测试需逆序取最近者 */
	private order: number[] = [];
	private hovered = -1;
	/** 当前 3D 程度：0 = 正俯视（平面热力图），1 = 等距天际线。切换视图时在两者之间缓动。 */
	private animT = 0;
	private animFrom = 0;
	private animTo = 0;
	private animRaf = 0;
	private animStart = 0;
	/** 本次绘制的实际周数（自适应结果，供底部「近 N 周」文案使用） */
	private usedWeeks = 0;
	/** 聚焦缩放进度：0 = 整年全景，1 = 放大到最近 FOCUS_WEEKS 周 */
	private zoomK = 0;
	private zoomFrom = 0;
	private zoomTo = 0;
	private onMove = (e: PointerEvent): void => this.handleMove(e);
	private onLeave = (): void => this.setHover(-1);

	/** CSS 颜色 → RGB 的探针（可解析 hex / rgb / oklch / color-mix 等任意格式） */
	private probe: CanvasRenderingContext2D | null = null;

	constructor(host: HTMLElement) {
		this.host = host;
		this.canvas = host.createEl('canvas', { cls: 'ad-ns__canvas' });
		this.ctx = this.canvas.getContext('2d');
		this.canvas.addEventListener('pointermove', this.onMove);
		this.canvas.addEventListener('pointerleave', this.onLeave);
	}

	dispose(): void {
		this.stopAnim();
		this.canvas.removeEventListener('pointermove', this.onMove);
		this.canvas.removeEventListener('pointerleave', this.onLeave);
		this.canvas.remove();
		this.ctx = null;
		this.probe = null;
	}

	/**
	 * 重绘。view 指定目标状态（2d 平面 / 3d 天际线），animate=true 时在两个状态之间缓动，
	 * 因此 2D → 3D 与 3D → 2D 都是同一个场景的连续形变，而不是「换掉一整块画面」。
	 */
	render(opts: SkylineOptions): void {
		const target = opts.view === '3d' ? 1 : 0;
		const zoomTarget = opts.view === '3d' && opts.focus ? 1 : 0;
		this.opts = opts;
		if (opts.animate && !this.reducedMotion()) {
			this.stopAnim();
			this.animFrom = opts.from ?? this.animT;   // 从调用方声明的起点出发（双向都连贯）
			this.animTo = target;
			this.zoomFrom = this.zoomK;
			this.zoomTo = zoomTarget;
			this.animStart = performance.now();
			this.tickAnim();
			return;
		}
		// ⚠️ 动画进行中时，普通重绘（如 ResizeObserver 的首次回调）只能按当前进度重画，
		//    否则会把 animT 直接置为目标值，动画刚起步就被跳到终态（表现为「完全没有动画」）。
		if (this.animRaf) {
			this.draw();
			return;
		}
		this.animT = target;
		this.animFrom = target;
		this.animTo = target;
		this.zoomK = zoomTarget;
		this.zoomFrom = zoomTarget;
		this.zoomTo = zoomTarget;
		this.draw();
	}

	/** 本次绘制的实际周数（自适应，宽卡多、窄卡少） */
	get weeks(): number {
		return this.usedWeeks;
	}

	private reducedMotion(): boolean {
		try {
			return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		} catch {
			return false;
		}
	}

	private stopAnim(): void {
		if (this.animRaf) { window.cancelAnimationFrame(this.animRaf); this.animRaf = 0; }
	}

	/** 形变帧循环：相机与推镜各按自己的时长缓动，全部结束才停（不做常驻 rAF） */
	private tickAnim(): void {
		const el = performance.now() - this.animStart;
		const k = Math.min(1, el / MORPH_MS);
		this.animT = this.animFrom + (this.animTo - this.animFrom) * easeInOutCubic(k);
		const zk = Math.max(0, Math.min(1, (el - ZOOM_DELAY_MS) / ZOOM_MS));
		this.zoomK = this.zoomFrom + (this.zoomTo - this.zoomFrom) * easeInOutCubic(zk);
		this.draw();
		const total = Math.max(MORPH_MS, ZOOM_DELAY_MS + ZOOM_MS);
		if (el < total) this.animRaf = window.requestAnimationFrame(() => this.tickAnim());
		else {
			this.animRaf = 0;
			this.zoomK = this.zoomTo;   // 收尾对齐，避免缓动残差
			this.draw();
		}
	}

	/** 聚焦渐隐：窗口左右两侧的格子越远越先淡出（边界柔和过渡）。格子与月份标签必须共用同一函数，否则标签会残留 */
	private fadeAt(week: number, left: number, right: number, zk: number): number {
		if (zk <= 0) return 1;
		if (week < left) {
			const t = Math.min(1, Math.max(0, (left - week) / FADE_BAND));
			return 1 - zk * t;
		}
		if (week >= right) {
			const t = Math.min(1, (week - right + 1) / FADE_BAND);
			return 1 - zk * t;
		}
		return 1;
	}

	private setHover(i: number): void {
		if (i === this.hovered) return;
		this.hovered = i;
		const cell = i >= 0 ? this.cells[i] : undefined;
		this.canvas.title = cell && this.opts ? this.opts.cellTitle(cell.key, cell.count) : '';
		this.draw();
	}

	private handleMove(e: PointerEvent): void {
		const rect = this.canvas.getBoundingClientRect();
		this.setHover(this.hitTest(e.clientX - rect.left, e.clientY - rect.top));
	}

	/** 命中测试：按深度逆序（最近的先测），与绘制顺序相反 */
	private hitTest(x: number, y: number): number {
		for (let k = this.order.length; k-- > 0;) {
			const i = this.order[k]!;
			const o = i * QUAD_FLOATS;
			if (this.pointInQuad(o, x, y)) return i;
			if ((this.faces[i]! & 1) && this.pointInQuad(o + 8, x, y)) return i;
			if ((this.faces[i]! & 2) && this.pointInQuad(o + 16, x, y)) return i;
		}
		return -1;
	}

	private pointInQuad(o: number, x: number, y: number): boolean {
		const p = this.quads;
		let sign = 0;
		for (let k = 0; k < 4; k++) {
			const ax = p[o + k * 2]!;
			const ay = p[o + k * 2 + 1]!;
			const bx = p[o + ((k + 1) % 4) * 2]!;
			const by = p[o + ((k + 1) % 4) * 2 + 1]!;
			const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
			if (Math.abs(cross) < 1e-9) continue;
			const s = cross > 0 ? 1 : -1;
			if (sign === 0) sign = s;
			else if (s !== sign) return false;
		}
		return sign !== 0;
	}

	private draw(): void {
		const ctx = this.ctx;
		const opts = this.opts;
		if (!ctx || !opts) return;
		const W = this.host.clientWidth;
		const H = this.host.clientHeight;
		if (W < 8 || H < 8) return;

		const dpr = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(W * dpr);
		this.canvas.height = Math.round(H * dpr);
		this.canvas.setCssProps({ width: W + 'px', height: H + 'px' });
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, H);

		// 布局：左侧按需给星期标签留出装订线；窄卡（<420px）省略标签换取网格宽度
		const gutter = W < 420 ? 0 : 30;
		const pad = 6;
		const availW = Math.max(1, W - gutter - pad * 2);
		const availH = Math.max(1, H - pad * 2);
		const aspect = availW / availH;

		// 自适应周数：先按最大窗口取一次数据拿到柱子最高值，再按容器宽高比反推需要多少周才填得满
		const full = buildSkyline(opts.counts, opts.endDate, opts.maxWeeks);
		// 「完整自然年」不做自适应，固定画满；「滚动近 12 个月」按容器宽高比反推周数
		const weeks = opts.weeksMode === 'full'
			? opts.maxWeeks
			: fitWeeks(aspect, barHeight(full.max, full.max), 7, 10, opts.maxWeeks);
		const { cells, max } = weeks === opts.maxWeeks ? full : buildSkyline(opts.counts, opts.endDate, weeks);
		this.usedWeeks = weeks;
		this.cells = cells;
		if (this.quads.length !== cells.length * QUAD_FLOATS) {
			this.quads = new Float32Array(cells.length * QUAD_FLOATS);
			this.faces = new Uint8Array(cells.length);
			this.hovered = -1;
		}

		// 形变：animT 已是缓动后的 3D 程度（0 平面 → 1 等距）；柱高按波浪式升起/落下
		const e = this.animT;
		const cam = morphCamera(e);
		const heights = new Float32Array(cells.length);
		for (let i = 0; i < cells.length; i++) {
			const c = cells[i]!;
			heights[i] = riseAt(this.animT, c.week, weeks, c.day) * barHeight(c.count, max);
		}
		const colors = this.readColors();

		// 用当前相机 + 当前柱高求包围盒，并按聚焦进度在「整年全景」与「最近 FOCUS_WEEKS 周」之间插值取景
		const fit = (fromWeek: number, toWeek: number): { s: number; ox: number; oy: number } => {
			const b = this.extent(cam, cells, heights, fromWeek, toWeek);
			const bw = Math.max(1e-6, b.maxx - b.minx);
			const bh = Math.max(1e-6, b.maxy - b.miny);
			const sc = Math.min(availW / bw, availH / bh);
			return {
				s: sc,
				ox: gutter + pad + (availW - bw * sc) / 2 - b.minx * sc,
				oy: pad + (availH - bh * sc) / 2 - b.miny * sc,
			};
		};
		const fAll = fit(0, weeks);
		// 聚焦窗口右端对齐「今天」所在周（自然年模式下终点是 12/31，不能直接取末尾，否则会聚焦到年底）
		const win = focusWindow(cells, weeks, new Date(), FOCUS_WEEKS);
		const fFocus = this.zoomK > 0 ? fit(win.left, win.right) : fAll;
		const zk = this.zoomK;
		const s = fAll.s + (fFocus.s - fAll.s) * zk;
		const ox = fAll.ox + (fFocus.ox - fAll.ox) * zk;
		const oy = fAll.oy + (fFocus.oy - fAll.oy) * zk;
		/** 聚焦窗口 [focusLeft, focusRight)：窗口外的格子随推镜渐隐，而不是被硬裁掉 */
		const focusLeft = win.left;
		const focusRight = win.right;

		const px = (x: number, y: number): number => ox + project(cam, x, y, 0)[0] * s;
		const py = (x: number, y: number, z: number): number => oy + project(cam, x, y, z)[1] * s;

		const GAP = 0.10;               // 列（周）方向格间留缝（世界单位）
		const GAP_ROW = 0.18;           // 行（星期）方向留缝略大：行与行之间更透气
		const w = 1 - GAP;
		const h = 1 - GAP_ROW;
		const off = GAP / 2;
		const offY = GAP_ROW / 2;
		const radius = Math.max(0, Math.min(0.16 * s, 3));

		// 画家算法：按深度升序（远 → 近）
		const order = cells.map((_, i) => i).sort((a, b) => {
			const la = depthOf(cam, cells[a]!.week + 0.5, cells[a]!.day + 0.5);
			const lb = depthOf(cam, cells[b]!.week + 0.5, cells[b]!.day + 0.5);
			return la - lb;
		});
		this.order = order;

		for (const i of order) {
			const c = cells[i]!;
			// 聚焦：窗口外的周越远越先淡出（边界处柔和过渡），完全透明则跳过不画
			const fade = this.fadeAt(c.week, focusLeft, focusRight, zk);
			if (fade < 0.02) continue;
			ctx.globalAlpha = fade;
			const x0 = c.week + off;
			const y0 = c.day + offY;
			const x1 = x0 + w;
			const y1 = y0 + h;
			const z = heights[i]!;
			const o = i * QUAD_FLOATS;

			// 顶面
			this.setQuad(o, px(x0, y0), py(x0, y0, z), px(x1, y0), py(x1, y0, z), px(x1, y1), py(x1, y1, z), px(x0, y1), py(x0, y1, z));
			// +y 面（屏幕左侧）：底边 y1，从 z 落到 0
			this.setQuad(o + 8, px(x0, y1), py(x0, y1, 0), px(x1, y1), py(x1, y1, 0), px(x1, y1), py(x1, y1, z), px(x0, y1), py(x0, y1, z));
			// +x 面（屏幕右侧）：底边 x1
			this.setQuad(o + 16, px(x1, y0), py(x1, y0, 0), px(x1, y1), py(x1, y1, 0), px(x1, y1), py(x1, y1, z), px(x1, y0), py(x1, y0, z));

			// 柱太矮或格太窄时不画侧面（省填充，也避免细碎噪点）
			const tall = z * cam.ce * s;
			const sideY = w * s * cam.sn;   // +y 面沿 x 方向的宽度
			const sideX = h * s * cam.cs;   // +x 面沿 y 方向的宽度
			let f = 0;
			if (tall > 0.6 && sideY > 1.5) f |= 1;
			if (tall > 0.6 && sideX > 1.5) f |= 2;
			this.faces[i] = f;

			const [r, g, b] = colors[c.level] ?? colors[0]!;
			if (f & 1) {
				ctx.beginPath();
				this.quadPath(ctx, o + 8, 0);
				ctx.fillStyle = `rgb(${Math.round(r * 0.84)},${Math.round(g * 0.84)},${Math.round(b * 0.84)})`;
				ctx.fill();
			}
			if (f & 2) {
				ctx.beginPath();
				this.quadPath(ctx, o + 16, 0);
				ctx.fillStyle = `rgb(${Math.round(r * 0.68)},${Math.round(g * 0.68)},${Math.round(b * 0.68)})`;
				ctx.fill();
			}

			// 悬停：顶面提亮 + 描边，与其它格拉开层次
			const isHover = i === this.hovered;
			ctx.beginPath();
			this.quadPath(ctx, o, radius);
			if (isHover) {
				ctx.fillStyle = `rgb(${Math.min(255, Math.round(r + (255 - r) * 0.22))},${Math.min(255, Math.round(g + (255 - g) * 0.22))},${Math.min(255, Math.round(b + (255 - b) * 0.22))})`;
			} else {
				ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
			}
			ctx.fill();
			if (isHover) {
				ctx.strokeStyle = this.fg;
				ctx.lineWidth = 1.5;
				ctx.stroke();
			}
		}

		ctx.globalAlpha = 1;   // 渐隐可能停在中间值，标签必须按正常不透明度绘制
		this.drawLabels(ctx, opts, cells, weeks, e, focusLeft, focusRight, zk, px, py, gutter);
	}

	/** 把三面顶点写入缓存；同时从中心外扩 EPS，消除相邻盒体之间因抗锯齿产生的细缝 */
	private setQuad(o: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
		const p = this.quads;
		const cx = (x0 + x1 + x2 + x3) / 4;
		const cy = (y0 + y1 + y2 + y3) / 4;
		const push = (x: number, y: number, i: number): void => {
			const dx = x - cx;
			const dy = y - cy;
			const d = Math.hypot(dx, dy);
			if (d < 0.01) { p[o + i] = x; p[o + i + 1] = y; return; }
			p[o + i] = x + (dx / d) * QUAD_EPS;
			p[o + i + 1] = y + (dy / d) * QUAD_EPS;
		};
		push(x0, y0, 0); push(x1, y1, 2); push(x2, y2, 4); push(x3, y3, 6);
	}

	private quadPath(ctx: CanvasRenderingContext2D, o: number, r: number): void {
		const p = this.quads;
		if (r < 0.3) {
			ctx.moveTo(p[o]!, p[o + 1]!);
			ctx.lineTo(p[o + 2]!, p[o + 3]!);
			ctx.lineTo(p[o + 4]!, p[o + 5]!);
			ctx.lineTo(p[o + 6]!, p[o + 7]!);
			ctx.closePath();
			return;
		}
		ctx.moveTo((p[o + 6]! + p[o]!) / 2, (p[o + 7]! + p[o + 1]!) / 2);
		for (let k = 0; k < 4; k++) {
			const a = (k + 1) % 4;
			ctx.arcTo(p[o + k * 2]!, p[o + k * 2 + 1]!, p[o + a * 2]!, p[o + a * 2 + 1]!, r);
		}
		ctx.closePath();
	}

	/** 场景包围盒：按当前相机与各格实际柱高投影（每格取顶面四角 + 底面四角）。[fromWeek, toWeek) 用于聚焦取景。 */
	private extent(cam: Cam, cells: DayCell[], heights: Float32Array, fromWeek = 0, toWeek = Infinity): { minx: number; maxx: number; miny: number; maxy: number } {
		let minx = Infinity;
		let maxx = -Infinity;
		let miny = Infinity;
		let maxy = -Infinity;
		const add = (x: number, y: number, z: number): void => {
			const p = project(cam, x, y, z);
			if (p[0] < minx) minx = p[0];
			if (p[0] > maxx) maxx = p[0];
			if (p[1] < miny) miny = p[1];
			if (p[1] > maxy) maxy = p[1];
		};
		for (let i = 0; i < cells.length; i++) {
			const c = cells[i]!;
			if (c.week < fromWeek || c.week >= toWeek) continue;
			const x0 = c.week;
			const y0 = c.day;
			const x1 = x0 + 1;
			const y1 = y0 + 1;
			const z = heights[i]!;
			add(x0, y0, z); add(x1, y0, z); add(x0, y1, z); add(x1, y1, z);
			add(x0, y0, 0); add(x1, y0, 0); add(x0, y1, 0); add(x1, y1, 0);
		}
		return { minx, maxx, miny, maxy };
	}

	/**
	 * 标签随形变交叉淡入淡出（参考实现的做法，绝不「跳变」）：
	 * 平面态 → 月份在上方、星期在左侧；等距态 → 月份沿前缘（底边）、星期仍在左侧。
	 */
	private drawLabels(
		ctx: CanvasRenderingContext2D,
		opts: SkylineOptions,
		cells: DayCell[],
		weeks: number,
		e: number,
		focusLeft: number,
		focusRight: number,
		zk: number,
		px: (x: number, y: number) => number,
		py: (x: number, y: number, z: number) => number,
		gutter: number,
	): void {
		ctx.font = '10px ' + (getComputedStyle(this.host).fontFamily || 'sans-serif');
		const a2 = Math.max(0, 1 - e * 2.5);        // 平面态标签（快速淡出）
		const a3 = Math.max(0, (e - 0.6) / 0.4);    // 等距态标签（稍后淡入）
		const months = weekMonths(cells, weeks);
		const maxX = this.host.clientWidth - 2;

		// 月份：平面态在上方，等距态在前缘
		if (a2 > 0.01) {
			ctx.textAlign = 'left';
			ctx.textBaseline = 'bottom';
			let edge = -Infinity;
			for (let w = 0; w < months.length; w++) {
				const m = months[w]!;
				if (w > 0 && m === months[w - 1]) continue;
				const label = opts.monthNames[m] ?? '';
				if (!label) continue;
				// 与格子共用同一渐隐函数：月份必须跟着所属周一起淡出，否则会残留
				const fa = this.fadeAt(w, focusLeft, focusRight, zk);
				if (fa < 0.02) continue;
				const x = px(w + 0.5, -0.6);
				const tw = ctx.measureText(label).width;
				if (x < edge || x + tw > maxX) continue;
				ctx.fillStyle = this.alpha(this.muted, a2 * fa);
				ctx.fillText(label, x, py(w + 0.5, -0.6, 0));
				edge = x + tw + 8;
			}
		}
		if (a3 > 0.01) {
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			let edge = -Infinity;
			for (let w = 0; w < months.length; w++) {
				const m = months[w]!;
				if (w > 0 && m === months[w - 1]) continue;
				const label = opts.monthNames[m] ?? '';
				if (!label) continue;
				const fa = this.fadeAt(w, focusLeft, focusRight, zk);
				if (fa < 0.02) continue;
				const x = px(w + 0.5, 7.35);
				const tw = ctx.measureText(label).width;
				if (x < edge || x + tw > maxX) continue;
				ctx.fillStyle = this.alpha(this.muted, a3 * fa);
				ctx.fillText(label, x, py(w + 0.5, 7.35, 0) + 3);
				edge = x + tw + 8;
			}
		}

		// 星期标签：仅在有装订线时绘制（窄卡省略），两个状态下都在左侧
		if (gutter <= 0) return;
		ctx.fillStyle = this.muted;
		ctx.textAlign = 'right';
		ctx.textBaseline = 'middle';
		for (let d = 0; d < 7; d++) {
			const label = opts.weekdayLabels[d] ?? '';
			if (!label) continue;
			ctx.fillText(label, px(-0.35, d + 0.5) - 4, py(-0.35, d + 0.5, 0));
		}
	}

	/** 把 `rgba(r,g,b,a)` 形式的颜色按比例调透明度（muted 已是 rgba） */
	private alpha(rgba: string, k: number): string {
		const m = /rgba?\(([^)]+)\)/.exec(rgba);
		if (!m) return rgba;
		const parts = m[1]!.split(',').map((v) => Number(v.trim()));
		return `rgba(${parts[0]},${parts[1]},${parts[2]},${((parts[3] ?? 1) * k).toFixed(3)})`;
	}

	/* ---- 颜色：读 CSS 变量，保证与 2D 视图/图例同色 ---- */

	private fg = '#888';
	private muted = '#888';

	private readColors(): [number, number, number][] {
		const cs = getComputedStyle(this.host);
		this.fg = cs.color || '#888';
		const bg = cs.backgroundColor;
		const out: [number, number, number][] = [];
		for (let i = 0; i <= 4; i++) {
			const raw = cs.getPropertyValue(`--ad-hm-${i}`).trim();
			out.push(this.toRGB(raw) ?? this.toRGB(bg) ?? [128, 128, 128]);
		}
		// 轴标签用前景色与背景色的中间调，深浅主题都清晰
		const f = this.toRGB(this.fg) ?? [128, 128, 128];
		this.muted = `rgba(${f[0]},${f[1]},${f[2]},0.55)`;
		return out;
	}

	/** 任意 CSS 颜色 → RGB：借浏览器解析（hex / rgb / oklch / color-mix 皆可） */
	private toRGB(color: string): [number, number, number] | null {
		if (!color) return null;
		if (!this.probe) {
			// ⚠️ 不能用 document.createEl：Obsidian 的 createEl 会 append 到宿主节点，
			//    而往 document 上再 append 一个元素会抛 HierarchyRequestError，进而中断整屏渲染。
			//    这里挂到本卡的容器上取完 context 后立刻移出 DOM（脱离文档后 context 依然可用）。
			const c = this.host.createEl('canvas');
			c.width = c.height = 1;
			const ctx = c.getContext('2d', { willReadFrequently: true });
			c.remove();
			this.probe = ctx;
		}
		const p = this.probe;
		if (!p) return null;
		p.clearRect(0, 0, 1, 1);
		p.fillStyle = 'rgba(0,0,0,0)';
		p.fillStyle = color;
		p.fillRect(0, 0, 1, 1);
		const d = p.getImageData(0, 0, 1, 1).data;
		if (d[3]! < 8) return null;
		return [d[0]!, d[1]!, d[2]!];
	}
}