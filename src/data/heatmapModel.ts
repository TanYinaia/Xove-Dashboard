/**
 * 笔记统计「等距 3D 天际线」的纯函数层。
 *
 * 只放无副作用的数学：相机 / 投影 / 深度排序 / 柱高 / 等级 / 网格生成。
 * 与 canvas 绘制解耦，便于单测覆盖（见 heatmapModel.test.ts）。
 *
 * 坐标约定：x = 周（向右增大）、y = 星期几（向下增大）、z = 柱高（向上升高）。
 */

// 运行时导入需带 .ts 扩展名：node 的 TS 类型剥离不做说明符重写（与 i18n/index.ts 的写法一致）
import { fmtDate } from './taskLogic.ts';

export interface DayCell {
	/** YYYY-MM-DD */
	key: string;
	count: number;
	/** 0（无）~ 4（最多），与 2D 热力图图例同一口径 */
	level: number;
	/** 第几周（0 起） */
	week: number;
	/** 星期几（0 = 周一 … 6 = 周日） */
	day: number;
}

export interface Cam {
	cs: number;
	sn: number;
	se: number;
	ce: number;
}

/** 3D 视角的角度：yaw 更窄（10°）—— yaw 越大，「周」轴越多地贡献到屏幕高度，
 *  等距形状就越接近正方形，在宽卡里两侧留白越多；10° 能显著填满横向。 */
export const YAW_3D = (10 * Math.PI) / 180;
export const ELEV_3D = (34 * Math.PI) / 180;
/** 聚焦模式放大的周数（最近 16 周） */
export const FOCUS_WEEKS = 16;

/** 3D 视角相机 */
export function skylineCamera(): Cam {
	return { cs: Math.cos(YAW_3D), sn: Math.sin(YAW_3D), se: Math.sin(ELEV_3D), ce: Math.cos(ELEV_3D) };
}

/**
 * 形变相机：e = 0 为正俯视（yaw 0 / elevation 90°，柱高不可见 → 就是平面热力图），
 * e = 1 为等距 3D 视角。
 *
 * 俯仰与偏航**刻意分两段完成**（俯仰先、偏航后）：若两者同步线性推进，画面看起来像
 * 一块刚体被硬拧过去，3D → 2D 尤其生硬；分段后观感是「先放平看清、再回正对齐卡片网格」。
 */
export function morphCamera(e: number): Cam {
	const t = clamp01(e);
	const te = Math.min(1, t / 0.72);
	const ty = Math.max(0, (t - 0.55) / 0.45);
	const yaw = YAW_3D * easeInOutCubic(ty);
	const elev = Math.PI / 2 + (ELEV_3D - Math.PI / 2) * easeInOutCubic(te);
	return { cs: Math.cos(yaw), sn: Math.sin(yaw), se: Math.sin(elev), ce: Math.cos(elev) };
}

function clamp01(v: number): number {
	return v > 0 ? (v < 1 ? v : 1) : 0;
}

/** 缓动：起步快、收尾缓（相机形变用） */
export function easeInOutCubic(x: number): number {
	const t = clamp01(x);
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(x: number): number {
	return 1 - Math.pow(1 - clamp01(x), 3);
}

/** 形变中每根柱子的升起进度：从最老的一周扫到最新的一周（波浪式） */
export function riseAt(t: number, week: number, weeks: number, day: number): number {
	const delay = (weeks > 1 ? week / (weeks - 1) : 0) * 0.36 + (day / 6) * 0.06;
	return easeOutCubic((clamp01(t) - delay) / (1 - 0.42));
}

/**
 * 按容器宽高比反推「需要多少周」才能填满画面：
 * 令投影包围盒的宽高比 ≈ 容器宽高比，解出周数 W（结果夹在 [minW, maxW]）。
 * 容器越宽 → 周数越多；窄卡自动减少，保证柱体始终有足够宽度。
 */
export function fitWeeks(aspect: number, maxZ: number, days = 7, minW = 10, maxW = 53): number {
	const { cs, sn, se, ce } = skylineCamera();
	const denom = cs - aspect * sn * se;
	if (denom <= 1e-6) return maxW;
	const w = (aspect * (cs * days * se + maxZ * ce) - sn * days) / denom;
	if (!Number.isFinite(w)) return maxW;
	return Math.max(minW, Math.min(maxW, Math.round(w)));
}

/**
 * 世界坐标 → 屏幕偏移（未含缩放/平移）：
 *   sx = x*cs - y*sn
 *   sy = (x*sn + y*cs)*se - z*ce    ← z 越大屏幕上越靠上
 */
export function project(c: Cam, x: number, y: number, z: number): [number, number] {
	return [x * c.cs - y * c.sn, (x * c.sn + y * c.cs) * c.se - z * c.ce];
}

/** 画家算法深度：越大越靠近观察者 → 绘制时按【升序】（由远及近） */
export function depthOf(c: Cam, x: number, y: number): number {
	return x * c.sn + y * c.cs;
}

/**
 * 柱高（单位 = 一个格子的边长）：
 * - 有记录：0.4 基础高度 + count/max 的开方压缩曲线，最忙的一天约 7.6 格
 * - 无记录：0.2 的薄片，保证空日在天际线里仍可见
 */
export function barHeight(count: number, max: number): number {
	if (count > 0 && max > 0) return 0.4 + Math.pow(count / max, 0.85) * 7.2;
	return 0.2;
}

/** 等级：与现有 2D 热力图的固定阈值保持一致（切换视图不换色） */
export function levelOf(count: number): number {
	if (count <= 0) return 0;
	if (count === 1) return 1;
	if (count <= 3) return 2;
	if (count <= 6) return 3;
	return 4;
}

/** 某一天所在周的周一（周一起始，与 2D 网格口径一致） */
export function mondayOf(d: Date): Date {
	const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	const dow = out.getDay(); // 0 = 周日
	out.setDate(out.getDate() - (dow === 0 ? 6 : dow - 1));
	return out;
}

/**
 * 生成「最近 weeks 周、周一起始、截止 endDate 当天」的格子序列（长度恒为 weeks*7）。
 * 不足一周的尾部用未来日期补齐，调用方可按 count=0 处理。
 */
export function buildSkyline(
	counts: Map<string, number>,
	endDate: Date,
	weeks: number,
): { cells: DayCell[]; max: number } {
	const start = mondayOf(endDate);
	start.setDate(start.getDate() - (weeks - 1) * 7);

	const cells: DayCell[] = [];
	let max = 0;
	for (let w = 0; w < weeks; w++) {
		for (let d = 0; d < 7; d++) {
			const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d);
			const key = fmtDate(dt);
			const count = counts.get(key) ?? 0;
			if (count > max) max = count;
			cells.push({ key, count, level: levelOf(count), week: w, day: d });
		}
	}
	return { cells, max };
}

/**
 * 聚焦窗口：返回「以 date 所在周为右端、向前数 count 周」的周区间 [left, right)（右端不含）。
 *
 * 关键：右端必须对齐 date（今天）所在周，而不是整段数据的末尾——
 * 「滚动近 12 个月」时 endDate = 今天，两者一致；「完整自然年」时 endDate = 12/31，
 * 若仍取末尾就会把镜头推到年底的未来空白周（表现为「没聚焦到当天位置」）。
 * 找不到 date 时退化为「整段末尾 count 周」。
 */
export function focusWindow(cells: DayCell[], weeks: number, date: Date, count: number): { left: number; right: number } {
	const maxLeft = Math.max(0, weeks - count);
	const key = fmtDate(date);
	let wk = -1;
	for (let i = 0; i < cells.length; i++) {
		if (cells[i]!.key === key) { wk = cells[i]!.week; break; }
	}
	if (wk < 0) return { left: maxLeft, right: weeks };
	const left = Math.max(0, Math.min(maxLeft, wk - count + 1));
	return { left, right: Math.min(weeks, left + count) };
}

/** 每周所属月份（取该周周四所在月，GitHub 同款口径），用于在天际线前缘标注月份 */
export function weekMonths(cells: DayCell[], weeks: number): number[] {
	const out: number[] = [];
	for (let w = 0; w < weeks; w++) {
		const thu = cells[w * 7 + 3];
		out.push(thu ? Number(thu.key.slice(5, 7)) - 1 : 0);
	}
	return out;
}