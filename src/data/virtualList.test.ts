import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWindow, filterWithOrig } from './virtualList.ts';

test('computeWindow 空列表返回空窗口', () => {
	assert.deepEqual(computeWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: 40, total: 0 }), { start: 0, end: 0 });
});

test('computeWindow 少量行全部渲染', () => {
	assert.deepEqual(computeWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: 40, total: 5 }), { start: 0, end: 5 });
});

test('computeWindow 长列表仅渲染可视区 + 缓冲', () => {
	const w = computeWindow({ scrollTop: 0, viewportHeight: 400, rowHeight: 40, total: 1000, overscan: 5 });
	assert.equal(w.start, 0);
	assert.equal(w.end, 20); // 可视 10 + 两侧缓冲 5*2
});

test('computeWindow 中段滚动窗口定位正确', () => {
	const w = computeWindow({ scrollTop: 4000, viewportHeight: 400, rowHeight: 40, total: 1000, overscan: 3 });
	assert.ok(w.start >= 100 - 3 && w.start <= 100); // 首个可见行 100，向上减缓冲
	assert.ok(w.end > w.start);
});

test('computeWindow 底部溢出时钳制到末行', () => {
	const w = computeWindow({ scrollTop: 1e9, viewportHeight: 400, rowHeight: 40, total: 1000 });
	assert.equal(w.end, 1000);
	assert.ok(w.start < 1000);
});

test('filterWithOrig 保留原下标', () => {
	const items = ['a', 'b', 'c', 'd'];
	const { items: kept, orig } = filterWithOrig(items, (x) => x !== 'b');
	assert.deepEqual(kept, ['a', 'c', 'd']);
	assert.deepEqual(orig, [0, 2, 3]);
});

test('filterWithOrig 全部过滤为空', () => {
	const { items, orig } = filterWithOrig([1, 2, 3], () => false);
	assert.deepEqual(items, []);
	assert.deepEqual(orig, []);
});