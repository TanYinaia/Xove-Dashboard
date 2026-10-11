import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	appendPomoRecord, nextRoundFor, parsePomoFile, pomoDayKey, pomoDayTotals,
	pomoFilePath, pomoHourTotals, pomoRecentRecords, pomoSegmentTotals,
	pomoTrendDays, pomoWeekdayBars, readPomoRecords, serializePomoRecords,
	trimPomoRecords, writePomoRecords, POMO_FILE,
} from './pomoStats.ts';
import { fmtDate } from './taskLogic.ts';

/** 固定「今天」：2026-10-01 15:00 本地时间 */
function now(): Date {
	return new Date(2026, 9, 1, 15, 0, 0);
}

test('pomoDayKey/trim 保留最近 365 天（含今天）', () => {
	const records = [
		{ ts: new Date(2025, 0, 1, 9).getTime(), ms: 1500000, round: 1 },   // 2025-01-01：太老
		{ ts: new Date(2025, 9, 2, 9).getTime(), ms: 1500000, round: 1 },   // 2025-10-02：恰好 364 天前
		{ ts: now().getTime(), ms: 1500000, round: 2 },
	];
	const trimmed = trimPomoRecords(records, now());
	assert.equal(trimmed.length, 2);
	// 2025-10-01 = 今天往前 365 天里的第 1 天（今天 - 364 天）→ 保留
	const cutoff = new Date(2026, 9, 1);
	cutoff.setDate(cutoff.getDate() - 364);
	assert.equal(fmtDate(cutoff), '2025-10-02');
	assert.ok(trimmed.every((r) => r.ts >= cutoff.getTime()));
});

test('appendPomoRecord 追加且不修改原数组', () => {
	const base = [{ ts: now().getTime(), ms: 1000, round: 1 }];
	const next = appendPomoRecord(base, { ts: now().getTime() + 1, ms: 2000, round: 2 }, now());
	assert.equal(base.length, 1);
	assert.equal(next.length, 2);
});

test('nextRoundFor 按当天已记录轮次 +1', () => {
	const records = [
		{ ts: new Date(2026, 9, 1, 9).getTime(), ms: 1000, round: 1 },
		{ ts: new Date(2026, 9, 1, 11).getTime(), ms: 1000, round: 2 },
		{ ts: new Date(2026, 8, 30, 11).getTime(), ms: 1000, round: 3 },
	];
	assert.equal(nextRoundFor(records, now().getTime()), 3);
});

test('parsePomoFile 兼容 {version,records} / 裸数组 / 坏数据', () => {
	const rec = { ts: 1700000000000, ms: 1500000, round: 1 };
	const ok1 = parsePomoFile(JSON.stringify({ version: 1, records: [rec] }));
	assert.equal(ok1.length, 1);
	const ok2 = parsePomoFile(JSON.stringify([rec]));
	assert.equal(ok2.length, 1);
	assert.equal(parsePomoFile('[]').length, 0);
	assert.equal(parsePomoFile('not json').length, 0);
	assert.equal(parsePomoFile(null as unknown as string).length, 0);
	assert.equal(parsePomoFile('{"records":"nope"}').length, 0);
	const bad = parsePomoFile(JSON.stringify([
		rec,
		{ ts: 'x', ms: 1, round: 1 },
		{ ts: 1, ms: -5, round: 1 },
		{ ts: 1700000000000, ms: 1500000 }, // 缺 round → 补 1
	]));
	assert.equal(bad.length, 2);
	assert.equal(bad[1]!.round, 1);
});

test('serialize/parse 往返一致且按时间排序', () => {
	const a = { ts: 1700000000000, ms: 1500000, round: 2 };
	const b = { ts: 1700000100000, ms: 1500000, round: 3 };
	const parsed = parsePomoFile(serializePomoRecords([b, a]));
	assert.deepEqual(parsed.map((r) => r.ts), [a.ts, b.ts]);
});

test('内存 adapter 读写 pomodoro.json', async () => {
	const files = new Map<string, string>();
	const adapter = {
		async exists(p: string) { return files.has(p); },
		async read(p: string) { return files.get(p) ?? ''; },
		async write(p: string, data: string) { files.set(p, data); },
		async mkdir() { /* noop */ },
	};
	assert.equal(await readPomoRecords(adapter, '/plugins/xove-dashboard').then((r) => r.length), 0);
	await writePomoRecords(adapter, '/plugins/xove-dashboard', [{ ts: 1700000000000, ms: 1500000, round: 1 }]);
	assert.equal(files.get(pomoFilePath('/plugins/xove-dashboard/')), JSON.stringify({ version: 1, records: [{ ts: 1700000000000, ms: 1500000, round: 1 }] }, null, 2));
	assert.equal((await readPomoRecords(adapter, '/plugins/xove-dashboard')).length, 1);
	assert.equal(pomoFilePath('/plugins/xove-dashboard/').endsWith('/' + POMO_FILE), true);
});

test('summarize/pomoTrendDays 概览与趋势数据', async () => {
	const { summarizePomo } = await import('./pomoStats.ts');
	const today9 = new Date(2026, 9, 1, 9).getTime();
	const yesterday = new Date(2026, 8, 30, 9).getTime();
	const records = [
		{ ts: today9, ms: 1500000, round: 1 },
		{ ts: today9 + 3600000, ms: 1500000, round: 2 },
		{ ts: yesterday, ms: 3000000, round: 1 },
	];
	const s = summarizePomo(records, now());
	assert.deepEqual([s.todayCount, s.todayMs, s.totalCount, s.totalMs], [2, 3000000, 3, 6000000]);
	const trend = pomoTrendDays(records, now(), 7);
	assert.equal(trend.length, 7);
	assert.equal(trend[6]!.key, '2026-10-01');
	assert.equal(trend[6]!.count, 2);
	assert.equal(trend[6]!.avgMs, 1500000);
	assert.equal(trend[5]!.key, '2026-09-30');
	assert.equal(trend[5]!.totalMs, 3000000);
	assert.equal(trend[4]!.count, 0);
	assert.equal(trend[4]!.avgMs, 0);
});

test('pomoHourTotals / pomoSegmentTotals 按开始小时聚合', () => {
	// 10:00-10:25 的会话 → 记完成时刻 10:25，开始小时 = 10
	const ts = new Date(2026, 9, 1, 10, 25).getTime();
	const records = [{ ts, ms: 1500000, round: 1 }];
	assert.deepEqual(pomoHourTotals(records)[10], 1500000);
	const seg = pomoSegmentTotals(records);
	assert.deepEqual(seg, { dawn: 0, morning: 1500000, afternoon: 0, evening: 0 });
	// 凌晨 3 点开始
	const night = pomoSegmentTotals([{ ts: new Date(2026, 9, 1, 3, 25).getTime(), ms: 1500000, round: 1 }]);
	assert.equal(night.dawn, 1500000);
});

test('pomoWeekdayBars 横条落在开始日的正确分钟区间（周一=0）', () => {
	// 2026-09-28 是周一；10:00 开始、25 分钟会话
	const ts = new Date(2026, 8, 28, 10, 25).getTime();
	const rows = pomoWeekdayBars([{ ts, ms: 1500000, round: 1 }]);
	assert.equal(rows[0]!.length, 1);
	assert.deepEqual(rows[0]![0], { m0: 600, m1: 625, ms: 1500000 });
	// 周日会话落在下标 6
	const sun = new Date(2026, 8, 27, 22, 50).getTime();
	const rows2 = pomoWeekdayBars([{ ts: sun, ms: 600000, round: 1 }]);
	assert.equal(rows2[6]!.length, 1);
});

test('pomoDayTotals 只统计指定年份', () => {
	const records = [
		{ ts: new Date(2026, 0, 5, 9).getTime(), ms: 1500000, round: 1 },
		{ ts: new Date(2025, 0, 5, 9).getTime(), ms: 1500000, round: 1 },
	];
	const map = pomoDayTotals(records, 2026);
	assert.equal(map.size, 1);
	assert.equal(map.get('2026-01-05'), 1500000);
});

test('pomoRecentRecords 新→旧、限条数', () => {
	const records = [
		{ ts: 1, ms: 10, round: 1 },
		{ ts: 3, ms: 10, round: 1 },
		{ ts: 2, ms: 10, round: 1 },
	];
	assert.deepEqual(pomoRecentRecords(records, 2).map((r) => r.ts), [3, 2]);
});
