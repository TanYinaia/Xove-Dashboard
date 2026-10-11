import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	skylineCamera, morphCamera, project, depthOf, barHeight, levelOf, mondayOf, buildSkyline, weekMonths,
	riseAt, easeInOutCubic, fitWeeks, focusWindow,
} from './heatmapModel.ts';

test('skylineCamera：窄 yaw(10°) + 34° 仰角（利于在宽卡里横向铺开）', () => {
	const c = skylineCamera();
	assert.ok(Math.abs(c.cs - Math.cos((10 * Math.PI) / 180)) < 1e-9);
	assert.ok(Math.abs(c.sn - Math.sin((10 * Math.PI) / 180)) < 1e-9);
	assert.ok(Math.abs(c.se - Math.sin((34 * Math.PI) / 180)) < 1e-9);
	assert.ok(Math.abs(c.ce - Math.cos((34 * Math.PI) / 180)) < 1e-9);
	assert.ok(c.cs > c.sn * 2, 'yaw 越小，周轴越偏向横向');
});

test('morphCamera：0 = 正俯视（柱高不可见），1 = 等距 3D', () => {
	const flat = morphCamera(0);
	assert.ok(Math.abs(flat.sn) < 1e-9, 'yaw 0 → sn 为 0');
	assert.ok(Math.abs(flat.ce) < 1e-9, 'elevation 90° → ce 为 0，柱高不产生屏幕位移');
	const a = project(flat, 0, 0, 5);
	const b = project(flat, 0, 0, 0);
	assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, '俯视时 z 不影响投影');

	const iso = morphCamera(1);
	const full = skylineCamera();
	assert.ok(Math.abs(iso.cs - full.cs) < 1e-9 && Math.abs(iso.ce - full.ce) < 1e-9);
});

test('riseAt：t=0 全部未升起，t=1 全部升起，且按周次波浪式先后', () => {
	assert.equal(riseAt(0, 0, 10, 0), 0);
	assert.equal(riseAt(1, 9, 10, 6), 1);
	// 同一时刻，较早的一周先升起
	assert.ok(riseAt(0.5, 0, 10, 0) > riseAt(0.5, 9, 10, 0));
	// 单周时不应除零
	assert.equal(riseAt(1, 0, 1, 0), 1);
});

test('easeInOutCubic：端点固定且单调', () => {
	assert.equal(easeInOutCubic(0), 0);
	assert.equal(easeInOutCubic(1), 1);
	assert.ok(easeInOutCubic(0.3) < easeInOutCubic(0.7));
});

test('fitWeeks：容器越宽周数越多，且被夹在上下限内', () => {
	const narrow = fitWeeks(1.9, 7.6);
	const wide = fitWeeks(4.2, 7.6);
	assert.ok(wide > narrow, '宽卡应分配更多周');
	assert.ok(narrow >= 10 && wide <= 53, '结果需夹在 [10, 53]');
	assert.equal(fitWeeks(100, 7.6), 53, '极端宽比 → 封顶');
	assert.equal(fitWeeks(0.2, 7.6), 10, '极端窄比 → 保底 10 周（保证柱体宽度）');
});

test('project：+x 向右、+y 向上偏左、+z 屏幕上移', () => {
	const c = skylineCamera();
	const o = project(c, 0, 0, 0);
	const px = project(c, 1, 0, 0);
	const py = project(c, 0, 1, 0);
	const pz = project(c, 0, 0, 1);

	assert.ok(px[0] > o[0], '+x 应使屏幕 x 增大');
	assert.ok(py[0] < o[0], '+y 应使屏幕 x 减小（向左）');
	assert.ok(py[1] > o[1], '+y 应使屏幕 y 增大（向下/靠前）');
	assert.ok(pz[1] < o[1], '+z 应使屏幕 y 减小（升高）');
	assert.equal(pz[0], o[0], 'z 不改变屏幕 x');
});

test('depthOf：越靠近观察者深度越大，绘制按升序即由远及近', () => {
	const c = skylineCamera();
	assert.ok(depthOf(c, 5, 5) > depthOf(c, 1, 1));
	assert.ok(depthOf(c, 3, 3) > depthOf(c, 3, 0), '同周次下，越靠后的星期越远');
	assert.ok(depthOf(c, 4, 3) > depthOf(c, 1, 3), '同星期下，越新的周越近');
});

test('barHeight：空日为薄片，且有记录时随数量单调不减', () => {
	assert.equal(barHeight(0, 10), 0.2);
	assert.equal(barHeight(5, 0), 0.2, 'max 为 0 时退化为薄片，不应除零');

	const a = barHeight(1, 10);
	const b = barHeight(5, 10);
	const c = barHeight(10, 10);
	assert.ok(a > 0.4 && a < b && b < c);
	assert.ok(Math.abs(c - 7.6) < 1e-9, '最忙的一天约 7.6 格高');
});

test('levelOf：与 2D 图例同一口径的固定阈值', () => {
	assert.equal(levelOf(0), 0);
	assert.equal(levelOf(-1), 0);
	assert.equal(levelOf(1), 1);
	assert.equal(levelOf(2), 2);
	assert.equal(levelOf(3), 2);
	assert.equal(levelOf(4), 3);
	assert.equal(levelOf(6), 3);
	assert.equal(levelOf(7), 4);
	assert.equal(levelOf(999), 4);
});

test('mondayOf：任意一天都归到所在周的周一（周一起始）', () => {
	const mon = (y: number, m: number, d: number): string => {
		const dt = mondayOf(new Date(y, m - 1, d));
		return `${dt.getMonth() + 1}/${dt.getDate()}`;
	};
	assert.equal(mon(2026, 10, 8), '10/5', '周四 → 本周一');
	assert.equal(mon(2026, 10, 5), '10/5', '周一 → 自身');
	assert.equal(mon(2026, 10, 11), '10/5', '周日 → 本周一（不是下周）');
	assert.equal(mon(2026, 10, 12), '10/12', '下周一 → 自身');
});

test('buildSkyline：格数恒为 weeks*7，周一起始，计数与等级正确', () => {
	const counts = new Map<string, number>([['2026-10-08', 7], ['2026-10-05', 1]]);
	const { cells, max } = buildSkyline(counts, new Date(2026, 9, 8), 3); // 2026-10-08 是周四
	assert.equal(cells.length, 21);
	assert.equal(max, 7);

	// 首格 = 3 周前的周一 → 2026-09-21
	assert.equal(cells[0]!.key, '2026-09-21');
	assert.equal(cells[0]!.week, 0);
	assert.equal(cells[0]!.day, 0);

	// 2026-10-05（周一，1 篇）= 第 2 周的 day 0
	const mon = cells.find((c) => c.key === '2026-10-05')!;
	assert.equal(mon.week, 2);
	assert.equal(mon.day, 0);
	assert.equal(mon.level, 1);

	// 2026-10-08（周四，7 篇）= 第 2 周的 day 3
	const thu = cells.find((c) => c.key === '2026-10-08')!;
	assert.equal(thu.week, 2);
	assert.equal(thu.day, 3);
	assert.equal(thu.count, 7);
	assert.equal(thu.level, 4);

	// 未收录的日期为 0
	assert.equal(cells.find((c) => c.key === '2026-09-22')!.count, 0);
});

test('focusWindow：右端对齐「今天」所在周（自然年模式不再聚焦到年底空白周）', () => {
	const count = 16;
	// 滚动模式：endDate = 今天 → 窗口就是末尾 count 周
	const roll = buildSkyline(new Map(), new Date(2026, 9, 9), 53);
	assert.deepEqual(focusWindow(roll.cells, 53, new Date(2026, 9, 9), count), { left: 53 - count, right: 53 });

	// 自然年模式：endDate = 12/31 → 窗口右端仍是今天所在周，而不是数据末尾
	const year = buildSkyline(new Map(), new Date(2026, 11, 31), 53);
	const today = year.cells.find((c) => c.key === '2026-10-09')!;
	const wy = focusWindow(year.cells, 53, new Date(2026, 9, 9), count);
	assert.equal(wy.right, today.week + 1, '右端 = 今天所在周 + 1（不含）');
	assert.equal(wy.left, today.week + 1 - count);
	assert.ok(wy.right < 53, '镜头留在今天，而不是年底未来空白周');

	// date 不在数据范围内 → 退化为末尾 count 周
	assert.deepEqual(focusWindow(year.cells, 53, new Date(2019, 0, 1), count), { left: 53 - count, right: 53 });
});

test('weekMonths：每周取周四所在月份，长度等于周数', () => {
	const { cells } = buildSkyline(new Map(), new Date(2026, 9, 8), 3);
	const months = weekMonths(cells, 3);
	assert.equal(months.length, 3);
	// 2026-09-24 / 2026-10-01 / 2026-10-08 所在月 → 9、10、10（0 基）
	assert.deepEqual(months, [8, 9, 9]);
});