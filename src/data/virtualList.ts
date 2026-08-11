/** 长列表窗口化渲染的纯函数辅助（无 DOM 依赖，可单测）。 */

export interface WindowRange {
	/** 起始行号（包含） */
	start: number;
	/** 结束行号（不含） */
	end: number;
}

export interface ComputeWindowOptions {
	/** 滚动容器已滚过的像素 */
	scrollTop: number;
	/** 滚动容器可视高度（像素） */
	viewportHeight: number;
	/** 单行像素高度（固定行高） */
	rowHeight: number;
	/** 总行数 */
	total: number;
	/** 可视区外缓冲行数（默认 10） */
	overscan?: number;
}

/**
 * 根据滚动位置计算应渲染的行窗口。
 * 假定行高均匀；返回 [start, end)，total > 0 时保证至少渲染一行。
 */
export function computeWindow(opts: ComputeWindowOptions): WindowRange {
	const total = Math.max(0, Math.floor(opts.total));
	if (total === 0) return { start: 0, end: 0 };
	const rowHeight = opts.rowHeight > 0 ? opts.rowHeight : 1;
	const overscan = Math.max(0, opts.overscan ?? 10);
	const viewportHeight = Math.max(0, opts.viewportHeight);
	const visible = Math.max(1, Math.ceil(viewportHeight / rowHeight));
	const first = Math.max(0, Math.floor(opts.scrollTop / rowHeight) - overscan);
	const end = Math.min(total, first + visible + overscan * 2);
	const start = Math.min(Math.max(0, first), Math.max(0, total - 1));
	return { start, end };
}

export interface FilteredWithOrig<T> {
	/** 过滤后保留的项（按原顺序） */
	items: T[];
	/** 每项在原数组中的下标（用于与其它视图按索引联动） */
	orig: number[];
}

/**
 * 按条件过滤数组，同时保留每个保留项在原数组中的下标。
 * 窗口化渲染时用于：滚动窗口基于“可见项”，而高亮/联动仍用原下标。
 */
export function filterWithOrig<T>(items: T[], isVisible: (item: T) => boolean): FilteredWithOrig<T> {
	const kept: T[] = [];
	const orig: number[] = [];
	items.forEach((item, i) => {
		if (isVisible(item)) {
			kept.push(item);
			orig.push(i);
		}
	});
	return { items: kept, orig };
}