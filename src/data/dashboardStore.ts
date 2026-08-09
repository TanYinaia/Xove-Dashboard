import type { TaskItem } from './taskParseCore';

/** Minimal dependency surface the DashboardStore needs from the scan layer. */
export interface TaskSource {
	invalidate(): void;
	scanAllTasks(): Promise<TaskItem[]>;
}

/** Lightweight state/refresh coordinator (item 1.3 groundwork).
 *  Vault events call requestRefresh() (coalesced); subscribers are notified
 *  only after a fresh scan so views re-render from a single snapshot. */
export class DashboardStore {
	private listeners = new Set<() => void>();
	private refreshTimer: number | null = null;
	private tasks: TaskItem[] | null = null;
	private taskSource: TaskSource;
	private schedule: (fn: () => void, ms: number) => number;
	private cancel: (id: number) => void;

	constructor(
		taskSource: TaskSource,
		schedule: (fn: () => void, ms: number) => number = (fn, ms) => window.setTimeout(fn, ms),
		cancel: (id: number) => void = (id) => window.clearTimeout(id),
	) {
		this.taskSource = taskSource;
		this.schedule = schedule;
		this.cancel = cancel;
	}

	/** Register a listener; returns an unsubscribe function. */
	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);
		return () => { this.listeners.delete(fn); };
	}

	private notify(): void {
		for (const fn of this.listeners) fn();
	}

	/** Invalidate caches on a relevant vault change. */
	invalidate(): void {
		this.taskSource.invalidate();
		this.tasks = null;
	}

	/** Coalesced refresh: one scan ~delay after the last request. */
	requestRefresh(delay = 200): void {
		if (this.refreshTimer !== null) this.cancel(this.refreshTimer);
		this.refreshTimer = this.schedule(() => {
			this.refreshTimer = null;
			void this.refresh();
		}, delay);
	}

	/** Scan now, update the cached snapshot, then notify subscribers. */
	async refresh(): Promise<void> {
		this.taskSource.invalidate();
		try {
			this.tasks = await this.taskSource.scanAllTasks();
		} catch {
			this.tasks = null;
		}
		this.notify();
	}

	/** Latest scanned task snapshot (null until the first refresh). */
	getTasks(): TaskItem[] | null {
		return this.tasks;
	}

	/** Cancel pending work and drop listeners (view close). */
	dispose(): void {
		if (this.refreshTimer !== null) {
			this.cancel(this.refreshTimer);
			this.refreshTimer = null;
		}
		this.listeners.clear();
	}
}