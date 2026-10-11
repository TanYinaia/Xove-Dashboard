/* ============================================================
   番茄钟专注记录：持久化 + 纯函数聚合。
   无 Obsidian 导入 —— 保持 node:test 可测（与 taskLogic 同约定）。
   ============================================================ */

import { fmtDate } from './taskLogic.ts';

/** 一条专注记录：完成时刻（ms 时间戳）/ 本次时长（ms）/ 当日第几轮（1 起） */
export interface PomoRecord {
	ts: number;
	ms: number;
	round: number;
}

/** 记录文件名（存放在插件目录，与 data.json 并列） */
export const POMO_FILE = 'pomodoro.json';
/** 记录保留天数：每次写入自动裁剪，老文件无需迁移 */
export const POMO_KEEP_DAYS = 365;
/** 单文件记录数硬上限（防止异常膨胀） */
const POMO_MAX_RECORDS = 20000;

/** 持久化所需的最小文件系统能力（Obsidian 的 DataAdapter 结构性满足） */
export interface PomoFileAdapter {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	mkdir(path: string): Promise<void>;
}

/* ============================================================
   序列化 / 解析（宽容读取：坏行丢弃，不抛错）
   ============================================================ */

/** 序列化为 pomodoro.json 内容（带版本号，便于未来演进） */
export function serializePomoRecords(records: PomoRecord[]): string {
	return JSON.stringify({ version: 1, records }, null, 2);
}

/** 解析 pomodoro.json 内容：接受 {version,records} 或裸数组，坏条目静默丢弃 */
export function parsePomoFile(raw: string | null | undefined): PomoRecord[] {
	let arr: unknown;
	try {
		const data = JSON.parse(raw ?? '') as unknown;
		if (Array.isArray(data)) arr = data;
		else if (data && typeof data === 'object' && Array.isArray((data as { records?: unknown }).records)) {
			arr = (data as { records: unknown }).records;
		} else return [];
	} catch {
		return [];
	}
	const out: PomoRecord[] = [];
	for (const it of arr as unknown[]) {
		if (!it || typeof it !== 'object') continue;
		const r = it as { ts?: unknown; ms?: unknown; round?: unknown };
		const ts = typeof r.ts === 'number' && Number.isFinite(r.ts) ? r.ts : NaN;
		const ms = typeof r.ms === 'number' && Number.isFinite(r.ms) ? r.ms : NaN;
		if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(ms) || ms <= 0) continue;
		const round = typeof r.round === 'number' && Number.isFinite(r.round) && r.round >= 1 ? Math.floor(r.round) : 1;
		out.push({ ts, ms, round });
	}
	out.sort((a, b) => a.ts - b.ts);
	if (out.length > POMO_MAX_RECORDS) out.splice(0, out.length - POMO_MAX_RECORDS);
	return out;
}

/** 裁剪到最近 365 天（含今天）：返回原地未变的新数组 */
export function trimPomoRecords(records: PomoRecord[], now: Date): PomoRecord[] {
	const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	cutoff.setDate(cutoff.getDate() - (POMO_KEEP_DAYS - 1));
	return records.filter((r) => r.ts >= cutoff.getTime());
}

/** 追加一条记录并裁剪（纯函数：返回新数组，不修改入参） */
export function appendPomoRecord(records: PomoRecord[], record: PomoRecord, now: Date): PomoRecord[] {
	return trimPomoRecords([...records, record], now);
}

/** 某时刻所在「当天」已完成的轮次（供写入时计算下一轮的 round 值） */
export function nextRoundFor(records: PomoRecord[], ts: number): number {
	const key = pomoDayKey(ts);
	let n = 0;
	for (const r of records) if (pomoDayKey(r.ts) === key) n++;
	return n + 1;
}

/* ============================================================
   文件读写（adapter 注入，便于测试与解耦）
   ============================================================ */

export function pomoFilePath(dir: string): string {
	return dir.replace(/\/+$/, '') + '/' + POMO_FILE;
}

/** 读取记录（文件不存在 / 损坏 → 空数组，零迁移负担） */
export async function readPomoRecords(adapter: PomoFileAdapter, dir: string): Promise<PomoRecord[]> {
	try {
		const path = pomoFilePath(dir);
		if (!(await adapter.exists(path))) return [];
		return parsePomoFile(await adapter.read(path));
	} catch {
		return [];
	}
}

/** 写入记录（先确保插件目录存在；调用方负责 best-effort 容错） */
export async function writePomoRecords(adapter: PomoFileAdapter, dir: string, records: PomoRecord[]): Promise<void> {
	const path = pomoFilePath(dir);
	try {
		await adapter.mkdir(dir);
	} catch { /* 目录已存在时部分适配器会抛错，忽略 */ }
	await adapter.write(path, serializePomoRecords(records));
}

/* ============================================================
   聚合纯函数（统计页 5 个视图的数据源）
   ============================================================ */

/** 某时间戳的本地日期键 YYYY-MM-DD */
export function pomoDayKey(ts: number): string {
	return fmtDate(new Date(ts));
}

export interface PomoSummary {
	/** 今日番茄数 / 总番茄数 */
	todayCount: number;
	totalCount: number;
	/** 今日专注时长 / 总专注时长（ms） */
	todayMs: number;
	totalMs: number;
}

/** 四格概览统计 */
export function summarizePomo(records: PomoRecord[], now: Date): PomoSummary {
	const todayKey = pomoDayKey(now.getTime());
	let todayCount = 0;
	let todayMs = 0;
	let totalCount = 0;
	let totalMs = 0;
	for (const r of records) {
		totalCount++;
		totalMs += r.ms;
		if (pomoDayKey(r.ts) === todayKey) {
			todayCount++;
			todayMs += r.ms;
		}
	}
	return { todayCount, totalCount, todayMs, totalMs };
}

export interface PomoTrendDay {
	/** 该日 0 点（本地） */
	date: Date;
	key: string;
	/** 当日番茄数 */
	count: number;
	/** 当日总专注时长（ms） */
	totalMs: number;
	/** 当日单次平均时长（ms，无番茄时为 0） */
	avgMs: number;
}

/** 近 n 天（含今天，旧→新）趋势序列 */
export function pomoTrendDays(records: PomoRecord[], now: Date, days: number): PomoTrendDay[] {
	const byDay = new Map<string, { count: number; ms: number }>();
	for (const r of records) {
		const key = pomoDayKey(r.ts);
		const cur = byDay.get(key) ?? { count: 0, ms: 0 };
		cur.count++;
		cur.ms += r.ms;
		byDay.set(key, cur);
	}
	const out: PomoTrendDay[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
		const key = fmtDate(d);
		const hit = byDay.get(key);
		const count = hit?.count ?? 0;
		const totalMs = hit?.ms ?? 0;
		out.push({ date: d, key, count, totalMs, avgMs: count > 0 ? totalMs / count : 0 });
	}
	return out;
}

/** 全部记录按「开始小时」聚合的专注总时长（下标 0-23，单位 ms） */
export function pomoHourTotals(records: PomoRecord[]): number[] {
	const hours = new Array<number>(24).fill(0);
	for (const r of records) {
		const h = new Date(r.ts - r.ms).getHours();
		hours[h]! += r.ms;
	}
	return hours;
}

/** 一条记录在作息网格里的横条：起始/结束分钟（同一天内，跨零点截断） */
export interface PomoBar {
	/** 距 0 点的起始分钟 */
	m0: number;
	/** 距 0 点的结束分钟（≤1440） */
	m1: number;
	/** 时长（ms，截断后） */
	ms: number;
}

/** 按星期（一=0 … 日=6）分组的专注横条（时间线视图数据源） */
export function pomoWeekdayBars(records: PomoRecord[]): PomoBar[][] {
	const rows: PomoBar[][] = [[], [], [], [], [], [], []];
	for (const r of records) {
		const start = r.ts - r.ms;
		const d = new Date(start);
		// 周一=0 … 周日=6（与首页热力图 / 日历的周起始一致）
		const dow = (d.getDay() + 6) % 7;
		const m0 = d.getHours() * 60 + d.getMinutes();
		const m1 = Math.min(1440, m0 + Math.ceil(r.ms / 60000));
		if (m1 > m0) rows[dow]!.push({ m0, m1, ms: r.ms });
	}
	return rows;
}

/** 时段分类（按开始小时）：凌晨 0-6 / 上午 6-12 / 下午 12-18 / 晚上 18-24 */
export const POMO_SEGMENTS = ['dawn', 'morning', 'afternoon', 'evening'] as const;
export type PomoSegment = (typeof POMO_SEGMENTS)[number];

/** 各时段专注总时长（ms），键与 POMO_SEGMENTS 一一对应 */
export function pomoSegmentTotals(records: PomoRecord[]): Record<PomoSegment, number> {
	const seg: Record<PomoSegment, number> = { dawn: 0, morning: 0, afternoon: 0, evening: 0 };
	for (const r of records) {
		const h = new Date(r.ts - r.ms).getHours();
		const key: PomoSegment = h < 6 ? 'dawn' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
		seg[key] += r.ms;
	}
	return seg;
}

/** 某年「日 → 专注总时长」映射（年度热力图数据源；未来日期不会出现在 records） */
export function pomoDayTotals(records: PomoRecord[], year: number): Map<string, number> {
	const map = new Map<string, number>();
	const prefix = `${year}-`;
	for (const r of records) {
		const key = pomoDayKey(r.ts);
		if (!key.startsWith(prefix)) continue;
		map.set(key, (map.get(key) ?? 0) + r.ms);
	}
	return map;
}

/** 最近 n 条记录（新→旧） */
export function pomoRecentRecords(records: PomoRecord[], n: number): PomoRecord[] {
	return [...records].sort((a, b) => b.ts - a.ts).slice(0, n);
}
