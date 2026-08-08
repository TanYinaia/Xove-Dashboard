/* ============================================================
   Opportunity Parser
   存储：所有机会点统一存于一个总 Markdown 文件（默认 机会点管理.md），
   记录在 frontmatter 的 `opportunities` 数组里。被否的机会点只是数组里
   一条 `已否决` 记录，不占独立文件；需要展开的机会点用 `详情` 双链跳到笔记。
   ============================================================ */

import { App, TFile } from 'obsidian';
import { stringifyYaml } from 'obsidian';
import { parseFrontmatter } from './taskParser';

/* ---- Types ---- */

export type OpportunityStatus = '未沟通' | '沟通通过' | '调研中' | '待上会' | '已完成' | '已否决';

export interface OpportunityItem {
	id: string;            // opp-<timestamp>
	title: string;         // 机会点名称
	status: OpportunityStatus;
	tags: string[];
	background: string;       // 背景/描述
	commConclusion: string;   // 沟通结论
	researchConclusion: string; // 调研结论
	meetingConclusion: string; // 上会结论
	toRoadmap: boolean;       // 转路标标记（仅已完成上可勾）
	detail: string;           // 详情双链，如 [[机会点-xxx-详情]]，可空
	order: number;            // 手动排序权重（同状态内从小到大）
	createDate: string;
	updateDate: string;
}

export interface OpportunityFormData {
	title: string;
	status: OpportunityStatus;
	tags: string[];
	background: string;
	commConclusion: string;
	researchConclusion: string;
	meetingConclusion: string;
	toRoadmap: boolean;
	detail: string;
}

/* ---- Constants ---- */

export const DEFAULT_OPPORTUNITY_FILE = '机会点管理.md';

export const OPPORTUNITY_STATUS_LIST: OpportunityStatus[] = [
	'未沟通', '沟通通过', '调研中', '待上会', '已完成', '已否决',
];
export const DONE_OPPORTUNITY_STATUSES: OpportunityStatus[] = ['已完成', '已否决'];

/** Sidebar / chip 配色用 class（配合 .op-status / .op-st-*） */
export const OPPORTUNITY_STATUS_CLASS: Record<OpportunityStatus, string> = {
	'未沟通': 'op-st-new',
	'沟通通过': 'op-st-talk',
	'调研中': 'op-st-research',
	'待上会': 'op-st-meeting',
	'已完成': 'op-st-done',
	'已否决': 'op-st-rejected',
};

/** 英文 slug，供 data-st 属性选择器（避免中文选择器） */
export const OPPORTUNITY_STATUS_SLUG: Record<OpportunityStatus, string> = {
	'未沟通': 'new',
	'沟通通过': 'talk',
	'调研中': 'research',
	'待上会': 'meeting',
	'已完成': 'done',
	'已否决': 'rejected',
};

/** 侧栏圆点色 */
export const OPPORTUNITY_STATUS_DOT: Record<OpportunityStatus, string> = {
	'未沟通': 'var(--ad-muted)',
	'沟通通过': '#60a5fa',
	'调研中': '#a855f7',
	'待上会': '#eab308',
	'已完成': '#22c55e',
	'已否决': 'var(--ad-rejected)',
};

const TABLE_START = '<!-- OPPORTUNITIES_TABLE_START -->';
const TABLE_END = '<!-- OPPORTUNITIES_TABLE_END -->';

/* ---- Weight helpers (for sorting) ---- */

export function opportunityStatusWeight(s: OpportunityStatus): number {
	return OPPORTUNITY_STATUS_LIST.indexOf(s);
}
/** Sort: by status order → manual order → createDate desc */
export function sortOpportunities(items: OpportunityItem[]): OpportunityItem[] {
	return [...items].sort((a, b) => {
		const sw = opportunityStatusWeight(a.status) - opportunityStatusWeight(b.status);
		if (sw) return sw;
		const ow = (a.order ?? 0) - (b.order ?? 0);
		if (ow) return ow;
		return (b.createDate || '').localeCompare(a.createDate || '');
	});
}

/* ---- Date helper ---- */

function todayStr(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---- Frontmatter <-> OpportunityItem mapping ---- */

function toFmObject(it: OpportunityItem): Record<string, unknown> {
	return {
		id: it.id,
		排序: typeof it.order === 'number' ? it.order : 0,
		机会点名称: it.title || '',
		状态: it.status || '未沟通',
		tags: it.tags && it.tags.length ? it.tags : [],
		背景: it.background || '',
		沟通结论: it.commConclusion || '',
		调研结论: it.researchConclusion || '',
		上会结论: it.meetingConclusion || '',
		转路标: !!it.toRoadmap,
		详情: it.detail || '',
		创建时间: it.createDate || '',
		更新时间: it.updateDate || '',
	};
}

function coerceBool(v: unknown): boolean {
	return v === true || v === 'true' || v === '是' || v === 'yes' || v === '1';
}

function fromFmObject(raw: Record<string, unknown>, fallbackId: string): OpportunityItem {
	const rawStatus = typeof raw['状态'] === 'string' ? (raw['状态']) : '';
	const status: OpportunityStatus = (OPPORTUNITY_STATUS_LIST as string[]).includes(rawStatus)
		? (rawStatus as OpportunityStatus)
		: '未沟通';
	const tags = Array.isArray(raw['tags']) ? (raw['tags'] as unknown[]).map(String) : [];
	return {
		id: typeof raw['id'] === 'string' ? (raw['id']) : fallbackId,
		title: typeof raw['机会点名称'] === 'string' ? (raw['机会点名称']) : '',
		status,
		tags,
		background: typeof raw['背景'] === 'string' ? (raw['背景']) : '',
		commConclusion: typeof raw['沟通结论'] === 'string' ? (raw['沟通结论']) : '',
		researchConclusion: typeof raw['调研结论'] === 'string' ? (raw['调研结论']) : '',
		meetingConclusion: typeof raw['上会结论'] === 'string' ? (raw['上会结论']) : '',
		toRoadmap: coerceBool(raw['转路标']),
		detail: typeof raw['详情'] === 'string' ? (raw['详情']) : '',
		order: typeof raw['排序'] === 'number' ? (raw['排序']) : -1,
		createDate: typeof raw['创建时间'] === 'string' ? (raw['创建时间']) : '',
		updateDate: typeof raw['更新时间'] === 'string' ? (raw['更新时间']) : '',
	};
}

/* ---- Body (unified table) handling ---- */

function stripFrontmatter(content: string): string {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== '---') return content;
	let i = 1;
	for (; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') { i++; break; }
	}
	return lines.slice(i).join('\n');
}

function escCell(s: string): string {
	return (s || '').replace(/\|/g, '\\|') || '-';
}

function buildTable(items: OpportunityItem[]): string {
	const header = '| 标题 | 状态 | 转路标 | 创建时间 |';
	const sep = '|---|---|---|---|';
	const rows = items.length
		? items.map((it) => `| ${escCell(it.title)} | ${it.status} | ${it.toRoadmap ? '★' : '-'} | ${escCell(it.createDate || '-')} |`)
		: ['| _暂无机会点_ | | | |'];
	return [header, sep, ...rows].join('\n');
}

/** 可读明细：把每个机会点的全部字段写成 Markdown 列表，方便在笔记里直接看。 */
function buildDetails(items: OpportunityItem[]): string {
	if (!items.length) return '_暂无机会点，点击插件「◈ 机会点 → + 新建机会点」开始记录。_';
	const lines: string[] = ['## 明细'];
	items.forEach((it, i) => {
		lines.push(`### ${i + 1}. ${it.title}`);
		lines.push(`- **状态**：${it.status} **转路标**：${it.toRoadmap ? '★' : '-'}`);
		lines.push(`- **标签**：${it.tags && it.tags.length ? it.tags.join('、') : '-'}`);
		lines.push(`- **背景**：${it.background || '-'}`);
		lines.push(`- **沟通结论**：${it.commConclusion || '-'}`);
		lines.push(`- **调研结论**：${it.researchConclusion || '-'}`);
		lines.push(`- **上会结论**：${it.meetingConclusion || '-'}`);
		lines.push(`- **详情**：${it.detail || '-'}`);
		lines.push(`- **创建 / 更新**：${it.createDate || '-'} / ${it.updateDate || '-'}`);
	});
	return lines.join('\n');
}

function buildBody(items: OpportunityItem[]): string {
	const intro = '> [!info] 本文件由 Agent Dashboard 自动维护。上方「总览」为表格，下方「明细」为各机会点完整内容；两者均在标记区内由插件生成，请勿手改标记区，标记区外的文字不会被覆盖。';
	return `# 机会点管理\n\n${intro}\n\n${TABLE_START}\n## 总览\n${buildTable(items)}\n\n${buildDetails(items)}\n${TABLE_END}\n`;
}

/** Replace the region between markers (table + details), preserving any user notes outside them. */
function regenerateBody(existingBody: string, items: OpportunityItem[]): string | null {
	const s = existingBody.indexOf(TABLE_START);
	const e = existingBody.indexOf(TABLE_END);
	if (s === -1 || e === -1) return null;
	const prefix = existingBody.slice(0, s);
	const suffix = existingBody.slice(e + TABLE_END.length);
	return `${prefix}${TABLE_START}\n## 总览\n${buildTable(items)}\n\n${buildDetails(items)}\n${TABLE_END}${suffix}`;
}

/* ---- File-level read / write ---- */

/** Ensure the master file exists (with empty opportunities + table). */
export async function ensureOpportunityFile(app: App, path: string): Promise<void> {
	const f = app.vault.getAbstractFileByPath(path);
	if (f instanceof TFile) return;
	const initial = `---\nopportunities: []\n---\n\n${buildBody([])}`;
	await app.vault.create(path, initial);
}

/** Read all opportunities from the master file (empty array if missing). */
export async function parseOpportunitiesFile(app: App, path: string): Promise<OpportunityItem[]> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		await ensureOpportunityFile(app, path);
		return [];
	}
	const content = await app.vault.read(file);
	const fm = parseFrontmatter(content);
	const arr = fm['opportunities'];
	if (!Array.isArray(arr)) return [];
	return (arr as unknown[])
		.filter((r) => r && typeof r === 'object')
		.map((r, i) => fromFmObject(r as Record<string, unknown>, `opp-${i}-${Date.now()}`))
		// 旧数据无 order 字段时，按数组顺序赋默认权重，保证稳定排序且不互相冲突
		.map((it, i) => (it.order >= 0 ? it : ({ ...it, order: i })));
}

/** Write the full opportunities array back to the master file (regenerates table). */
export async function writeOpportunitiesFile(app: App, path: string, items: OpportunityItem[]): Promise<void> {
	let file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		await ensureOpportunityFile(app, path);
		file = app.vault.getAbstractFileByPath(path);
	}
	if (!(file instanceof TFile)) return;
	const content = await app.vault.read(file);
	const fm = parseFrontmatter(content);
	fm['opportunities'] = items.map(toFmObject);
	const yaml = stringifyYaml(fm);
	const front = `---\n${yaml.trim()}\n---\n`;
	const body = regenerateBody(stripFrontmatter(content), items) ?? ('\n' + buildBody(items));
	await app.vault.modify(file, front + body);
}

/* ---- Item-level operations ---- */

export async function createOpportunity(app: App, path: string, data: OpportunityFormData): Promise<OpportunityItem> {
	const items = await parseOpportunitiesFile(app, path);
	const now = todayStr();
	const item: OpportunityItem = {
		id: 'opp-' + Date.now(),
		title: data.title,
		status: data.status || '未沟通',
		tags: data.tags || [],
		background: data.background || '',
		commConclusion: data.commConclusion || '',
		researchConclusion: data.researchConclusion || '',
		meetingConclusion: data.meetingConclusion || '',
		toRoadmap: false,
		detail: data.detail || '',
		order: items.length,
		createDate: now,
		updateDate: now,
	};
	items.push(item);
	await writeOpportunitiesFile(app, path, items);
	return item;
}

export async function updateOpportunity(app: App, path: string, id: string, patch: Partial<OpportunityItem>): Promise<void> {
	const items = await parseOpportunitiesFile(app, path);
	const idx = items.findIndex((i) => i.id === id);
	if (idx < 0) return;
	items[idx] = { ...items[idx], ...patch, id, updateDate: todayStr() } as OpportunityItem;
	await writeOpportunitiesFile(app, path, items);
}

export async function updateOpportunityStatus(app: App, path: string, id: string, status: OpportunityStatus): Promise<void> {
	const patch: Partial<OpportunityItem> = { status };
	// Leaving 已完成 clears the 转路标 flag.
	if (status !== '已完成') patch.toRoadmap = false;
	await updateOpportunity(app, path, id, patch);
}

export async function toggleOpportunityRoadmap(app: App, path: string, id: string, val: boolean): Promise<void> {
	await updateOpportunity(app, path, id, { toRoadmap: val });
}

export async function deleteOpportunity(app: App, path: string, id: string): Promise<void> {
	const items = await parseOpportunitiesFile(app, path);
	const next = items.filter((i) => i.id !== id);
	await writeOpportunitiesFile(app, path, next);
}
