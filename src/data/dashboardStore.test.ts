import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardStore } from './dashboardStore.ts';
import type { TaskItem } from './taskParseCore.ts';

function makeTask(id: string): TaskItem {
	return {
		id, content: id, status: '待办', priority: null,
		startDate: null, dueDate: null, tags: [], type: '普通',
		repeatRule: null, reminder: [], notes: '', completeTime: null,
		dailyNodes: {}, projectId: 'p', color: '#fff', sourceFile: id,
		isOverdue: false, remindDate: null, parent: '',
	};
}

function setup() {
	let pending: (() => void) | null = null;
	const schedule = (fn: () => void): number => { pending = fn; return 1; };
	const cancel = (): void => { pending = null; };
	let scanCount = 0;
	let invalidateCount = 0;
	let failScan = false;
	let current: TaskItem[] = [];
	const source = {
		invalidate() { invalidateCount++; },
		async scanAllTasks() {
			scanCount++;
			if (failScan) throw new Error('scan failed');
			return current;
		},
	};
	const store = new DashboardStore(source, schedule, cancel);
	const firePending = async () => {
		const fn = pending;
		pending = null;
		fn?.();
		await Promise.resolve();
		await Promise.resolve();
	};
	return {
		store, source,
		get scanCount() { return scanCount; },
		get invalidateCount() { return invalidateCount; },
		get pending() { return pending; },
		set failScan(v: boolean) { failScan = v; },
		set tasks(v: TaskItem[]) { current = v; },
		firePending,
	};
}

test('getTasks is null before the first refresh', () => {
	const s = setup();
	assert.equal(s.store.getTasks(), null);
});

test('refresh scans, caches the snapshot, and notifies once', async () => {
	const s = setup();
	let notified = 0;
	s.store.subscribe(() => notified++);
	s.tasks = [makeTask('a'), makeTask('b')];
	await s.store.refresh();
	assert.equal(s.scanCount, 1);
	assert.equal(s.invalidateCount, 1);
	assert.equal(notified, 1);
	assert.equal(s.store.getTasks()?.length, 2);
});

test('unsubscribe stops further notifications', async () => {
	const s = setup();
	let notified = 0;
	const unsub = s.store.subscribe(() => notified++);
	unsub();
	s.tasks = [makeTask('a')];
	await s.store.refresh();
	assert.equal(notified, 0);
});

test('requestRefresh coalesces multiple calls into one scan', async () => {
	const s = setup();
	let notified = 0;
	s.store.subscribe(() => notified++);
	s.store.requestRefresh(200);
	s.store.requestRefresh(200);
	s.store.requestRefresh(200);
	assert.ok(s.pending, 'exactly one pending callback after coalescing');
	await s.firePending();
	assert.equal(s.scanCount, 1);
	assert.equal(notified, 1);
	assert.equal(s.pending, null);
	assert.equal(s.store.getTasks()?.length, 0);
});

test('invalidate clears the cached snapshot and forwards to the source', async () => {
	const s = setup();
	s.tasks = [makeTask('a')];
	await s.store.refresh();
	assert.equal(s.store.getTasks()?.length, 1);
	s.store.invalidate();
	assert.equal(s.store.getTasks(), null);
	assert.equal(s.invalidateCount, 2);
});

test('refresh swallows scan errors and still notifies', async () => {
	const s = setup();
	let notified = 0;
	s.store.subscribe(() => notified++);
	s.failScan = true;
	await s.store.refresh();
	assert.equal(notified, 1);
	assert.equal(s.store.getTasks(), null);
});

test('dispose cancels a pending refresh and drops listeners', async () => {
	const s = setup();
	let notified = 0;
	s.store.subscribe(() => notified++);
	s.store.requestRefresh(200);
	assert.ok(s.pending);
	s.store.dispose();
	assert.equal(s.pending, null);
	s.tasks = [makeTask('a')];
	await s.store.refresh();
	assert.equal(notified, 0);
});