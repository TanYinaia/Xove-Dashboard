import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	taskFromFm, projectFromFm, parseDailyNodesFromBody, serializeDailyNodesBlock,
	priorityWeight, STATUS_LIST, PRIORITY_LIST, TYPE_LIST,
} from './taskParseCore.ts';
import type { DailyNode } from './taskParseCore.ts';

const TODAY = '2026-08-08';

/* ---- taskFromFm: defaults ---- */

test('taskFromFm yields safe defaults on empty frontmatter', () => {
	const t = taskFromFm({}, '', 'proj/t.md', 'proj');
	assert.equal(t.id, 'proj/t.md');
	assert.equal(t.content, 't');
	assert.equal(t.status, '待办');
	assert.equal(t.priority, null);
	assert.equal(t.type, '普通');
	assert.deepEqual(t.tags, []);
	assert.equal(t.repeatRule, null);
	assert.deepEqual(t.reminder, []);
	assert.equal(t.notes, '');
	assert.equal(t.startDate, null);
	assert.equal(t.dueDate, null);
	assert.equal(t.remindDate, null);
	assert.equal(t.parent, '');
	assert.equal(t.completeTime, null);
	assert.equal(t.isOverdue, false);
	assert.equal(t.projectId, 'proj');
	assert.equal(t.color, '#3b82f6');
	assert.deepEqual(t.dailyNodes, {});
});

test('taskFromFm strips extension and nested path to the file name', () => {
	assert.equal(taskFromFm({}, '', 'proj/sub/deep task.md', 'proj').content, 'deep task');
});

/* ---- taskFromFm: status / priority / type validation ---- */

test('taskFromFm passes known statuses and falls back on unknown', () => {
	for (const s of STATUS_LIST) {
		assert.equal(taskFromFm({ 状态: s }, '', 'a.md', 'p').status, s);
	}
	assert.equal(taskFromFm({ 状态: '未知' }, '', 'a.md', 'p').status, '待办');
});

test('taskFromFm maps known priorities, null on unknown/missing', () => {
	for (const pr of PRIORITY_LIST) {
		if (!pr) continue;
		assert.equal(taskFromFm({ 优先级: pr }, '', 'a.md', 'p').priority, pr);
	}
	assert.equal(taskFromFm({ 优先级: '随便' }, '', 'a.md', 'p').priority, null);
	assert.equal(taskFromFm({}, '', 'a.md', 'p').priority, null);
});

test('taskFromFm passes known types and falls back on unknown', () => {
	for (const ty of TYPE_LIST) {
		assert.equal(taskFromFm({ 类型: ty }, '', 'a.md', 'p').type, ty);
	}
	assert.equal(taskFromFm({ 类型: 'x' }, '', 'a.md', 'p').type, '普通');
});

/* ---- taskFromFm: dates & overdue ---- */

test('taskFromFm reads start/due/remind dates', () => {
	const t = taskFromFm({ 开始日期: '2026-08-01', 截止日期: '2026-08-20', 提醒日期: '2026-08-08' }, '', 'a.md', 'p');
	assert.equal(t.startDate, '2026-08-01');
	assert.equal(t.dueDate, '2026-08-20');
	assert.equal(t.remindDate, '2026-08-08');
});

test('taskFromFm flags overdue only for open tasks with a past due date', () => {
	assert.equal(taskFromFm({ 状态: '待办', 截止日期: '2026-08-07' }, '', 'a.md', 'p', undefined, TODAY).isOverdue, true);
	assert.equal(taskFromFm({ 状态: '已完成', 截止日期: '2026-08-07' }, '', 'a.md', 'p', undefined, TODAY).isOverdue, false);
	assert.equal(taskFromFm({ 状态: '已取消', 截止日期: '2026-08-07' }, '', 'a.md', 'p', undefined, TODAY).isOverdue, false);
	assert.equal(taskFromFm({ 状态: '待办', 截止日期: '2026-08-08' }, '', 'a.md', 'p', undefined, TODAY).isOverdue, false);
	assert.equal(taskFromFm({ 状态: '待办', 截止日期: '2026-08-09' }, '', 'a.md', 'p', undefined, TODAY).isOverdue, false);
	assert.equal(taskFromFm({ 状态: '待办' }, '', 'a.md', 'p', undefined, TODAY).isOverdue, false);
});

/* ---- taskFromFm: tags / repeatRule / notes / color ---- */

test('taskFromFm reads tags from "tags" with "标签" fallback', () => {
	assert.deepEqual(taskFromFm({ tags: ['a', 'b'] }, '', 'a.md', 'p').tags, ['a', 'b']);
	assert.deepEqual(taskFromFm({ 标签: ['x'] }, '', 'a.md', 'p').tags, ['x']);
	assert.deepEqual(taskFromFm({}, '', 'a.md', 'p').tags, []);
});

test('taskFromFm passes through repeatRule, reminder, notes', () => {
	const t = taskFromFm(
		{ 重复规则: { 频率: '每天', 间隔天数: 2 }, 提醒: ['09:00'], 备注: 'hello' },
		'', 'a.md', 'p',
	);
	assert.deepEqual(t.repeatRule, { 频率: '每天', 间隔天数: 2 });
	assert.deepEqual(t.reminder, ['09:00']);
	assert.equal(t.notes, 'hello');
});

test('taskFromFm uses project color or the default', () => {
	assert.equal(taskFromFm({}, '', 'a.md', 'p').color, '#3b82f6');
	assert.equal(taskFromFm({}, '', 'a.md', 'p', '#ff0000').color, '#ff0000');
});

/* ---- taskFromFm: daily nodes ---- */

test('taskFromFm parses daily nodes from the body block', () => {
	const content = [
		'---', '状态: 待办', '---', '',
		'## 每日节点',
		'- 2026-08-08 ✅ 完成 —— good',
		'- 2026-08-07 ⏭️ 未做',
		'- 2026-08-06 📝 待办',
	].join('\n');
	const t = taskFromFm({}, content, 'a.md', 'p');
	assert.deepEqual(t.dailyNodes, {
		'2026-08-08': { s: 'done', n: 'good' },
		'2026-08-07': { s: 'skip', n: '' },
		'2026-08-06': { s: 'todo', n: '' },
	});
});

test('taskFromFm falls back to legacy frontmatter daily nodes (string + object)', () => {
	const content = '---\n状态: 待办\n---\nbody text';
	const fm = {
		每日节点: {
			'2026-08-08': 'done',
			'2026-08-07': '~',
			'2026-08-06': { s: 'skip', n: 'rest' },
		},
	};
	const t = taskFromFm(fm, content, 'a.md', 'p');
	assert.deepEqual(t.dailyNodes, {
		'2026-08-08': { s: 'done', n: 'done' },
		'2026-08-07': { s: 'skip', n: '' },
		'2026-08-06': { s: 'skip', n: 'rest' },
	});
});

/* ---- parseDailyNodesFromBody ---- */

test('parseDailyNodesFromBody recognizes heading levels and stops at other headings', () => {
	const content = [
		'---', '---', '',
		'### 每日节点 ',
		'- 2026-08-08 ✅ 完成',
		'## Other',
		'- 2026-08-07 ✅ 完成',
	].join('\n');
	const nodes = parseDailyNodesFromBody(content);
	assert.deepEqual(Object.keys(nodes), ['2026-08-08']);
});

test('parseDailyNodesFromBody maps skip/todo/done markers', () => {
	const content = [
		'## 每日节点',
		'- 2026-08-08 ✅ 完成',
		'- 2026-08-07 ⏭️ 未做',
		'- 2026-08-06 跳过',
		'- 2026-08-05 📝 待办',
		'- 2026-08-04 ⏳ 进行中',
		'- 2026-08-03 随便',
	].join('\n');
	const nodes = parseDailyNodesFromBody(content);
	assert.equal(nodes['2026-08-08']?.s, 'done');
	assert.equal(nodes['2026-08-07']?.s, 'skip');
	assert.equal(nodes['2026-08-06']?.s, 'skip');
	assert.equal(nodes['2026-08-05']?.s, 'todo');
	assert.equal(nodes['2026-08-04']?.s, 'todo');
	assert.equal(nodes['2026-08-03']?.s, 'done');
});

/* ---- serializeDailyNodesBlock ---- */

test('serializeDailyNodesBlock returns empty for no nodes and sorts by date', () => {
	assert.equal(serializeDailyNodesBlock({}), '');
	const block = serializeDailyNodesBlock({
		'2026-08-08': { s: 'done', n: 'note' },
		'2026-08-07': { s: 'skip', n: '' },
		'2026-08-06': { s: 'todo', n: '' },
	});
	assert.equal(block, [
		'## 每日节点',
		'- 2026-08-06 📝 待办',
		'- 2026-08-07 ⏭️ 未做',
		'- 2026-08-08 ✅ 完成 —— note',
	].join('\n'));
});

test('serializeDailyNodesBlock round-trips through parseDailyNodesFromBody', () => {
	const nodes: Record<string, DailyNode> = {
		'2026-08-08': { s: 'done', n: 'note' },
		'2026-08-07': { s: 'skip', n: '' },
		'2026-08-06': { s: 'todo', n: '' },
	};
	assert.deepEqual(parseDailyNodesFromBody(serializeDailyNodesBlock(nodes)), nodes);
});

/* ---- projectFromFm ---- */

test('projectFromFm maps project fields, strips quotes, parses stage', () => {
	const proj = projectFromFm({
		项目名称: 'P', 颜色: '"#fff"', 描述: 'd',
		开始日期: '2026-01-01', 结束日期: '2026-06-01', 创建时间: '2026-01-01 08:00',
		阶段: '3', 项目类型: '非阶段项目',
	});
	assert.equal(proj.name, 'P');
	assert.equal(proj.color, '#fff');
	assert.equal(proj.description, 'd');
	assert.equal(proj.startDate, '2026-01-01');
	assert.equal(proj.endDate, '2026-06-01');
	assert.equal(proj.createDate, '2026-01-01 08:00');
	assert.equal(proj.stage, 3);
	assert.equal(proj.type, 'nostage');
});

test('projectFromFm defaults stage/type and tolerates numeric stage', () => {
	const proj = projectFromFm({ 阶段: 2 });
	assert.equal(proj.stage, 2);
	assert.equal(proj.type, 'stage');
	const bad = projectFromFm({ 阶段: 'abc' });
	assert.equal(bad.stage, 0);
});

/* ---- priorityWeight ---- */

test('priorityWeight orders priorities and defaults', () => {
	assert.equal(priorityWeight('重要且紧急'), 0);
	assert.equal(priorityWeight('重要不紧急'), 1);
	assert.equal(priorityWeight('紧急不重要'), 2);
	assert.equal(priorityWeight('不重要不紧急'), 3);
	assert.equal(priorityWeight(null), 4);
});