/* ============================================================
   Pure task logic (date / recurrence / today-universe rules).
   No Obsidian imports — kept unit-testable with node:test.
   ============================================================ */

import type { TaskItem } from './taskParser';

/** YYYY-MM-DD from a Date. */
export function fmtDate(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as YYYY-MM-DD. */
export function todayStr(today: Date = new Date()): string {
	return fmtDate(today);
}

/** Current datetime as YYYY-MM-DD HH:mm (precise to minute). */
export function nowFmt(today: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())} ${p(today.getHours())}:${p(today.getMinutes())}`;
}

/** Format YYYY-MM-DD → M/D for compact display. */
export function fmtMD(s: string | null): string {
	if (!s) return '';
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	return m ? `${parseInt(m[2] ?? '0', 10)}/${parseInt(m[3] ?? '0', 10)}` : s;
}

/** Compute the next reminder date for a recurring task (null = no rule / expired). */
export function calcNextRemindDate(task: TaskItem, today: Date = new Date()): string | null {
	const rule = task.repeatRule;
	if (!rule) return null;

	const freq = rule['频率'] || '';
	const next = new Date(today);

	if (freq === '每天') {
		const interval = rule['间隔天数'];
		next.setDate(next.getDate() + (interval && interval >= 1 ? interval : 1));
	} else if (freq === '工作日') {
		do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
	} else if (freq === '每周') {
		const days = rule['每周几'];
		if (days && days.length) {
			const todayDow = today.getDay() === 0 ? 7 : today.getDay();
			const sorted = [...days].sort((a, b) => a - b);
			const nextDay = sorted.find((d) => d > todayDow);
			if (nextDay) {
				next.setDate(next.getDate() + (nextDay - todayDow));
			} else {
				next.setDate(next.getDate() + (7 - todayDow + (sorted[0] ?? 1)));
			}
		} else {
			next.setDate(next.getDate() + 7);
		}
	} else if (freq === '每月') {
		const dayOfMonth = rule['每月几号'];
		if (dayOfMonth) {
			next.setMonth(next.getMonth() + 1);
			next.setDate(Math.min(dayOfMonth, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
		} else {
			next.setMonth(next.getMonth() + 1);
		}
	} else if (freq === '自定义') {
		const interval = rule['间隔天数'];
		next.setDate(next.getDate() + (interval || 1));
	} else {
		return null;
	}

	// Bounds: if the next occurrence falls after the end date, the recurrence has
	// expired — stop advancing so the task can be closed.
	const nextStr = fmtDate(next);
	if (task.dueDate && nextStr > task.dueDate) return null;
	return nextStr;
}

/** Universe of tasks relevant to "today" (TODO list + progress rings).
 *  INCLUDES tasks completed earlier today (stable denominator for the ring);
 *  excludes cancelled tasks and prior-day completions. */
export function getTodayUniverse(tasks: TaskItem[], today: string = todayStr()): TaskItem[] {
	return tasks.filter((t) => {
		if (t.status === '已取消') return false;
		if (t.completeTime && t.completeTime.startsWith(today)) return true;
		if (t.status === '已完成') return false;
		// Recurring: show if next 提醒日期 is today or already past (a missed
		// occurrence stays pending and reachable, instead of vanishing).
		if (t.type === '重复') {
			if (t.remindDate) return t.remindDate <= today;
			return !t.startDate || t.startDate <= today;
		}
		if (t.remindDate === today) return true;
		if (t.dueDate === today) return true;
		if (t.startDate === today) return true;
		if (t.startDate && t.dueDate && t.startDate <= today && t.dueDate >= today) return true;
		if (t.dueDate && t.dueDate < today) return true; // overdue counts as today's
		if (!t.remindDate && t.startDate && t.startDate <= today) return true;
		return false;
	});
}

/** Today's *pending* tasks — what the TODO list actually shows.
 *  Hides already-completed tasks and today's checked-in daily nodes. */
export function getTodayTasks(tasks: TaskItem[], today: string = todayStr()): TaskItem[] {
	return getTodayUniverse(tasks, today).filter((t) => {
		if (t.status === '已完成') return false;
		if (t.completeTime && t.completeTime.startsWith(today)) return false; // recurring occurrence done today
		// Multi-day task: hide today if today's node already done/skipped
		if (t.dailyNodes && t.dailyNodes[today] && (t.dailyNodes[today].s === 'done' || t.dailyNodes[today].s === 'skip')) return false;
		return true;
	});
}

/** "Done today" = whole task 已完成, OR today's daily node is done,
 *  OR a recurring task already advanced today (完成时间 == today). */
export function isDoneToday(t: TaskItem, today: string = todayStr()): boolean {
	if (t.status === '已完成') return true;
	if (t.completeTime && t.completeTime.startsWith(today)) return true;
	const node = t.dailyNodes && t.dailyNodes[today];
	return !!node && node.s === 'done';
}

/** "Skip today" = today's daily node marked skip — resolved for today,
 *  so it leaves the denominator (not an open task, not a completion). */
export function isSkipToday(t: TaskItem, today: string = todayStr()): boolean {
	const node = t.dailyNodes && t.dailyNodes[today];
	return !!node && node.s === 'skip';
}

/** Days between dueDate and today (>= 0). */
export function overdueDays(dueDate: string | null, today: Date = new Date()): number {
	if (!dueDate) return 0;
	const d = new Date(dueDate + 'T00:00:00');
	const t = new Date(today); t.setHours(0, 0, 0, 0);
	return Math.max(0, Math.round((t.getTime() - d.getTime()) / 86400000));
}

/** Urgency label + color key derived from task priority (紧急程度). */
export function urgencyMeta(priority: TaskItem['priority']): { label: string; key: string } | null {
	switch (priority) {
		case '重要且紧急': return { label: '紧急', key: 'high' };
		case '紧急不重要': return { label: '较急', key: 'mid' };
		case '重要不紧急': return { label: '一般', key: 'low' };
		case '不重要不紧急': return { label: '不急', key: 'none' };
		default: return null;
	}
}