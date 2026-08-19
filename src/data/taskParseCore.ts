/* ============================================================
   Pure task/project parsing core — no Obsidian imports, kept
   unit-testable with node:test. taskParser.ts wraps these with
   Obsidian's parseYaml.
   ============================================================ */

export type TaskStatus = '待办' | '进行中' | '已阻塞' | '已完成' | '已取消';
export type TaskPriority = '重要且紧急' | '重要不紧急' | '紧急不重要' | '不重要不紧急';
export type TaskType = '普通' | '重复';

export type NodeState = 'todo' | 'done' | 'skip';
export interface DailyNode { s: NodeState; n: string; }

export interface RepeatRule {
	频率?: string;
	每周几?: number[];
	每月几号?: number;
	间隔天数?: number;
}

export interface TaskItem {
	id: string;              // file path relative to vault root
	content: string;         // filename (without .md)
	status: TaskStatus;
	priority: TaskPriority | null;
	startDate: string | null;
	dueDate: string | null;
	tags: string[];
	type: TaskType;
	repeatRule: RepeatRule | null;
	reminder: string[];
	notes: string;
	completeTime: string | null;
	dailyNodes: Record<string, DailyNode>;
	projectId: string;       // top-level project folder name
	color: string;           // project color
	sourceFile: string;
	isOverdue: boolean;
	remindDate: string | null; // next remind date YYYY-MM-DD
	parent: string;          // parent task name (父任务)
}

export type ProjectType = 'stage' | 'nostage';

export interface ProjectInfo {
	name: string;           // folder name
	color: string;
	description: string;
	startDate: string | null;
	endDate: string | null;
	createDate: string | null;
	taskCount: number;
	activeCount: number;
	path: string;
	stage: number;          // 0-based index into stages (0 = first stage)
	stages?: string[];      // NPDP stage labels from settings
	type: ProjectType;      // 'stage' = 阶段项目, 'nostage' = 非阶段项目
}

/** Project type options for the new/edit project modal */
export const PROJECT_TYPE_LIST: { value: ProjectType; label: string }[] = [
	{ value: 'stage', label: '阶段项目' },
	{ value: 'nostage', label: '非阶段项目' },
];

/* ---- Constants ---- */

const DONE_STATUSES: TaskStatus[] = ['已完成', '已取消'];

export const STATUS_LIST: TaskStatus[] = ['待办', '进行中', '已阻塞', '已完成', '已取消'];
export const PRIORITY_LIST: (TaskPriority | '')[] = ['重要且紧急', '重要不紧急', '紧急不重要', '不重要不紧急', ''];
export const TYPE_LIST: TaskType[] = ['普通', '重复'];

export function priorityWeight(p: TaskPriority | null): number {
	switch (p) {
		case '重要且紧急': return 0;
		case '重要不紧急': return 1;
		case '紧急不重要': return 2;
		case '不重要不紧急': return 3;
		default: return 4;
	}
}

/* ---- Helpers ---- */

function getString(fm: Record<string, unknown>, key: string): string | null {
	const v = fm[key];
	if (typeof v === 'string') return v;
	// parseYaml may return numbers (e.g. 阶段: 2) or booleans; coerce so existing
	// callers that expect strings keep working.
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	return null;
}

function getStringArray(fm: Record<string, unknown>, key: string): string[] {
	const v = fm[key];
	return Array.isArray(v) ? v.map(String) : [];
}

/** Strip frontmatter, return the markdown body. */
function bodyOf(content: string): string {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== '---') return content;
	let i = 1;
	for (; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') { i++; break; }
	}
	return lines.slice(i).join('\n');
}

/**
 * Parse daily nodes from a "## 每日节点" markdown list block in the body.
 * Line format: "- 2026-07-22 ✅ 完成 —— 备注文字"  /  "- 2026-07-23 ⏭️ 未做"  /  "- 2026-07-24 📝 待办"
 */
export function parseDailyNodesFromBody(content: string): Record<string, DailyNode> {
	const out: Record<string, DailyNode> = {};
	const lines = bodyOf(content).split(/\r?\n/);
	let inBlock = false;
	for (const raw of lines) {
		const line = raw ?? '';
		const h = line.match(/^#{1,6}\s+(.+?)\s*$/);
		if (h) { inBlock = (h[1] ?? '').trim() === '每日节点'; continue; }
		if (!inBlock) continue;
		const m = line.match(/^\s*-\s*(\d{4}-\d{2}-\d{2})\b(.*)$/);
		if (!m) continue;
		const date = m[1] ?? '';
		const rest = m[2] ?? '';
		// Three states: skip (未做/跳过), todo (待办/备注 only), done (default).
		const s: NodeState = /未做|跳过|⏭/.test(rest) ? 'skip' : /待办|📝|⏳/.test(rest) ? 'todo' : 'done';
		let n = '';
		const nm = rest.match(/(?:——|—|--)\s*(.+?)\s*$/);
		if (nm) n = (nm[1] ?? '').trim();
		out[date] = { s, n };
	}
	return out;
}

/** Serialize daily nodes into a "## 每日节点" markdown list block (sorted by date). */
export function serializeDailyNodesBlock(nodes: Record<string, DailyNode>): string {
	const dates = Object.keys(nodes).sort();
	if (!dates.length) return '';
	const lines = ['## 每日节点'];
	for (const d of dates) {
		const node = nodes[d];
		if (!node) continue;
		const mark = node.s === 'skip' ? '⏭️ 未做' : node.s === 'todo' ? '📝 待办' : '✅ 完成';
		const note = node.n ? ` —— ${node.n}` : '';
		lines.push(`- ${d} ${mark}${note}`);
	}
	return lines.join('\n');
}

/** Legacy: parse daily nodes from a frontmatter object (backward compat). */
function parseDailyNodes(raw: unknown): Record<string, DailyNode> {
	const out: Record<string, DailyNode> = {};
	if (!raw || typeof raw !== 'object') return out;
	for (const [date, val] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof val === 'string') {
			out[date] = val === '~' ? { s: 'skip', n: '' } : { s: 'done', n: val };
		} else if (val && typeof val === 'object') {
			const v = val as Record<string, unknown>;
			const s = v['s'];
			const n = typeof v['n'] === 'string' ? v['n'] : '';
			out[date] = s === 'skip' ? { s: 'skip', n } : { s: 'done', n };
		}
	}
	return out;
}

function localTodayStr(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---- Task parser (frontmatter object -> TaskItem) ---- */

/** Build a TaskItem from already-parsed frontmatter + raw markdown content. */
export function taskFromFm(
	fm: Record<string, unknown>,
	content: string,
	filePath: string,
	projectId: string,
	projectColor?: string,
	today: string = localTodayStr(),
): TaskItem {
	const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || filePath;

	const dueDate = getString(fm, '截止日期');
	const rawStatus = getString(fm, '状态') || '待办';
	// Validate against known statuses; fall back to 待办 on unknown values.
	const status: TaskStatus = (STATUS_LIST as string[]).includes(rawStatus) ? (rawStatus as TaskStatus) : '待办';
	const isOverdue = !!dueDate && dueDate < today && !DONE_STATUSES.includes(status);

	// Priority: validate against known values; null if absent or unrecognized.
	const rawPriority = getString(fm, '优先级');
	const priority: TaskPriority | null = rawPriority && (PRIORITY_LIST as string[]).includes(rawPriority)
		? (rawPriority as TaskPriority)
		: null;

	// Type: validate against known values; fall back to 普通.
	const rawType = getString(fm, '类型') || '普通';
	const type: TaskType = (TYPE_LIST as string[]).includes(rawType) ? (rawType as TaskType) : '普通';

	return {
		id: filePath,
		content: fileName,
		status,
		priority,
		startDate: getString(fm, '开始日期'),
		dueDate,
		tags: (() => {
			const t = getStringArray(fm, 'tags');
			return t.length ? t : getStringArray(fm, '标签');
		})(),
		type,
		repeatRule: (fm['重复规则'] as RepeatRule) || null,
		reminder: getStringArray(fm, '提醒'),
		notes: getString(fm, '备注') || '',
		projectId,
		color: projectColor || '#3b82f6',
		sourceFile: filePath,
		isOverdue,
		remindDate: getString(fm, '提醒日期'),
		parent: getString(fm, '父任务') || '',
		completeTime: getString(fm, '完成时间'),
		dailyNodes: (() => {
			// Body block is the source of truth; fall back to legacy frontmatter.
			const body = parseDailyNodesFromBody(content);
			return Object.keys(body).length ? body : parseDailyNodes(fm['每日节点']);
		})(),
	};
}

/* ---- Project parser (frontmatter object -> ProjectInfo) ---- */

/** Build a Partial<ProjectInfo> from already-parsed frontmatter. */
export function projectFromFm(fm: Record<string, unknown>): Partial<ProjectInfo> {
	return {
		name: getString(fm, '项目名称') || undefined,
		color: (getString(fm, '颜色') || '').replace(/^"|"$/g, '') || undefined,
		description: getString(fm, '描述') || undefined,
		startDate: getString(fm, '开始日期') || undefined,
		endDate: getString(fm, '结束日期') || undefined,
		createDate: getString(fm, '创建时间') || undefined,
		stage: parseInt(getString(fm, '阶段') || '0') || 0,
		type: getString(fm, '项目类型') === '非阶段项目' ? 'nostage' : 'stage',
	};
}