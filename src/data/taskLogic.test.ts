import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TaskItem } from './taskParser.ts';
import {
	fmtDate, todayStr, nowFmt, fmtMD,
	calcNextRemindDate, getTodayUniverse, getTodayTasks,
	isDoneToday, isSkipToday, overdueDays, urgencyMeta,
} from './taskLogic.ts';

function makeTask(partial: Partial<TaskItem> = {}): TaskItem {
	return {
		id: 'p/t.md', content: 't', status: '待办', priority: null,
		startDate: null, dueDate: null, tags: [], type: '普通',
		repeatRule: null, reminder: [], notes: '', completeTime: null,
		dailyNodes: {}, projectId: 'p', color: '#fff', sourceFile: 'p/t.md',
		isOverdue: false, remindDate: null, parent: '',
		...partial,
	};
}

/* ---- fmtDate / todayStr / nowFmt / fmtMD ---- */

test('fmtDate pads month/day', () => {
	assert.equal(fmtDate(new Date(2026, 0, 5)), '2026-01-05');
	assert.equal(fmtDate(new Date(2026, 11, 31)), '2026-12-31');
});

test('todayStr defaults to today and accepts a Date', () => {
	assert.equal(todayStr(new Date(2026, 7, 8)), '2026-08-08');
	assert.equal(todayStr(), fmtDate(new Date()));
});

test('nowFmt includes HH:mm', () => {
	assert.equal(nowFmt(new Date(2026, 7, 8, 9, 5)), '2026-08-08 09:05');
});

test('fmtMD formats YYYY-MM-DD to M/D', () => {
	assert.equal(fmtMD('2026-08-08'), '8/8');
	assert.equal(fmtMD(null), '');
	assert.equal(fmtMD('not-a-date'), 'not-a-date');
});

/* ---- calcNextRemindDate ---- */

test('daily recurrence defaults to +1 day', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每天' } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-08-09');
});

test('daily recurrence respects interval days', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每天', 间隔天数: 3 } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-08-11');
});

test('workday recurrence skips weekends (Sat -> Mon)', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '工作日' } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-08-10'); // Sat
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 7)), '2026-08-10'); // Fri
});

test('weekly recurrence picks the next selected weekday', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每周', 每周几: [3, 5] } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 5)), '2026-08-07'); // Wed -> Fri
	const t2 = makeTask({ type: '重复', repeatRule: { 频率: '每周', 每周几: [1] } });
	assert.equal(calcNextRemindDate(t2, new Date(2026, 7, 6)), '2026-08-10'); // Thu -> next Mon
});

test('weekly recurrence without days defaults to +7', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每周' } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-08-15');
});

test('monthly recurrence on a fixed day', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每月', 每月几号: 15 } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-09-15');
});

test('monthly day 31 clamps to the last day of the month', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每月', 每月几号: 31 } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-09-30');
});

test('monthly recurrence without a day keeps the same day next month', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每月' } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-09-08');
});

test('custom recurrence uses interval days', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '自定义', 间隔天数: 5 } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-08-13');
});

test('recurrence returns null without a rule or for unknown frequency', () => {
	assert.equal(calcNextRemindDate(makeTask(), new Date(2026, 7, 8)), null);
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每季度' } });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), null);
});

test('recurrence stops advancing once past the end date', () => {
	const t = makeTask({ type: '重复', repeatRule: { 频率: '每天' }, dueDate: '2026-08-09' });
	assert.equal(calcNextRemindDate(t, new Date(2026, 7, 8)), '2026-08-09');
	const expired = makeTask({ type: '重复', repeatRule: { 频率: '每天' }, dueDate: '2026-08-08' });
	assert.equal(calcNextRemindDate(expired, new Date(2026, 7, 8)), null);
});

/* ---- getTodayUniverse ---- */

test('universe excludes cancelled and non-today completed tasks', () => {
	const tasks = [
		makeTask({ status: '已取消' }),
		makeTask({ status: '已完成', completeTime: '2026-08-01 10:00' }),
		makeTask({ status: '已完成', completeTime: '2026-08-08 09:00' }),
	];
	const ids = getTodayUniverse(tasks, '2026-08-08').map((t) => t.id);
	assert.deepEqual(ids, ['p/t.md']);
});

test('universe includes recurring tasks whose remind date is today or past', () => {
	const tasks = [
		makeTask({ type: '重复', remindDate: '2026-08-08' }),
		makeTask({ type: '重复', remindDate: '2026-08-07' }),
		makeTask({ type: '重复', remindDate: '2026-08-09' }),
	];
	assert.equal(getTodayUniverse(tasks, '2026-08-08').length, 2);
});

test('universe includes recurring tasks without a remind date when started', () => {
	const tasks = [
		makeTask({ type: '重复', startDate: '2026-08-01' }),
		makeTask({ type: '重复', startDate: '2026-08-09' }),
		makeTask({ type: '重复', startDate: null }),
	];
	assert.equal(getTodayUniverse(tasks, '2026-08-08').length, 2);
});

test('universe includes ordinary tasks matching today or overdue', () => {
	const tasks = [
		makeTask({ remindDate: '2026-08-08' }),
		makeTask({ dueDate: '2026-08-08' }),
		makeTask({ startDate: '2026-08-08' }),
		makeTask({ startDate: '2026-08-01', dueDate: '2026-08-10' }),
		makeTask({ dueDate: '2026-08-05' }), // overdue
		makeTask({ remindDate: '2026-08-09' }), // future -> excluded
		makeTask({ startDate: '2026-08-09' }), // future -> excluded
	];
	assert.equal(getTodayUniverse(tasks, '2026-08-08').length, 5);
});

/* ---- getTodayTasks ---- */

test('today tasks hide completed, done/skipped daily nodes', () => {
	const tasks = [
		makeTask({ status: '已完成', dueDate: '2026-08-08' }),
		makeTask({ type: '重复', completeTime: '2026-08-08 08:00' }),
		makeTask({ dailyNodes: { '2026-08-08': { s: 'done', n: '' } }, dueDate: '2026-08-08' }),
		makeTask({ dailyNodes: { '2026-08-08': { s: 'skip', n: '' } }, dueDate: '2026-08-08' }),
		makeTask({ dailyNodes: { '2026-08-08': { s: 'todo', n: '' } }, dueDate: '2026-08-08' }),
		makeTask({ dueDate: '2026-08-08' }),
	];
	assert.equal(getTodayTasks(tasks, '2026-08-08').length, 2);
});

test('keepDone keeps ordinary done tasks AND a just-advanced recurring task', () => {
	const today = '2026-08-08';
	const tasks = [
		// 普通任务今天完成 → 保留（变灰）
		makeTask({ status: '已完成', completeTime: '2026-08-08 09:00', dueDate: '2026-08-08' }),
		// 重复任务完成 = 推进 remindDate 到未来 + completeTime 置为今天 → 保留（变灰）
		makeTask({ type: '重复', completeTime: '2026-08-08 09:00', remindDate: '2026-08-09' }),
		// 逾期完成的普通任务 → 保留
		makeTask({ status: '已完成', completeTime: '2026-08-08 09:00', dueDate: '2026-08-06' }),
		// 未完成普通任务 → 保留
		makeTask({ dueDate: '2026-08-08' }),
	];
	const result = getTodayTasks(tasks, today, true);
	assert.equal(result.length, 4, 'all four should stay when keepDone is on');
	assert.ok(result.some((t) => t.type === '重复'), 'advanced recurring task must stay (greyed)');
});

/* ---- isDoneToday / isSkipToday ---- */

test('isDoneToday checks status, completeTime and daily node', () => {
	assert.equal(isDoneToday(makeTask({ status: '已完成', dueDate: '2026-08-08' }), '2026-08-08'), true);
	assert.equal(isDoneToday(makeTask({ completeTime: '2026-08-08 08:00' }), '2026-08-08'), true);
	assert.equal(isDoneToday(makeTask({ dailyNodes: { '2026-08-08': { s: 'done', n: '' } }, dueDate: '2026-08-08' }), '2026-08-08'), true);
	assert.equal(isDoneToday(makeTask(), '2026-08-08'), false);
});

test('isSkipToday checks only the daily node', () => {
	assert.equal(isSkipToday(makeTask({ dailyNodes: { '2026-08-08': { s: 'skip', n: '' } }, dueDate: '2026-08-08' }), '2026-08-08'), true);
	assert.equal(isSkipToday(makeTask({ dailyNodes: { '2026-08-08': { s: 'done', n: '' } }, dueDate: '2026-08-08' }), '2026-08-08'), false);
	assert.equal(isSkipToday(makeTask(), '2026-08-08'), false);
});

/* ---- overdueDays ---- */

test('overdueDays computes positive days and clamps to zero', () => {
	assert.equal(overdueDays(null, new Date(2026, 7, 8)), 0);
	assert.equal(overdueDays('2026-08-08', new Date(2026, 7, 8)), 0);
	assert.equal(overdueDays('2026-08-06', new Date(2026, 7, 8)), 2);
	assert.equal(overdueDays('2026-08-09', new Date(2026, 7, 8)), 0);
});

/* ---- urgencyMeta ---- */

test('urgencyMeta maps every priority', () => {
	assert.deepEqual(urgencyMeta('重要且紧急'), { label: '紧急', key: 'high' });
	assert.deepEqual(urgencyMeta('紧急不重要'), { label: '较急', key: 'mid' });
	assert.deepEqual(urgencyMeta('重要不紧急'), { label: '一般', key: 'low' });
	assert.deepEqual(urgencyMeta('不重要不紧急'), { label: '不急', key: 'none' });
	assert.equal(urgencyMeta(null), null);
});