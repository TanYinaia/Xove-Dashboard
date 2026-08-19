/* ============================================================
   Board Parser（通用看板）
   存储：所有看板条目统一存于一个总 Markdown 文件（默认 看板.md），
   记录在 frontmatter 的 `opportunities` 数组里。被放弃的条目只是数组里
   一条 status=已放弃 记录，不占独立文件；需要展开的内容用 `链接` 双链跳到笔记。
   字段为通用模型：标题 / 状态 / 标签 / 备注 / 链接 / 星标。
   旧「机会点」数据（机会点名称 / 沟通结论 / 调研结论 / 上会结论 / 转路标 / 详情）
   在读取时自动别名映射，保证历史数据不丢失。
   ============================================================ */

import { App, TFile } from 'obsidian';
import { stringifyYaml } from 'obsidian';
import { parseFrontmatter } from './taskParser';
import { reportParseIssue } from './parserDiagnostics';

/* ---- Types ---- */

export interface BoardStage {
	/** 稳定标识（设置里配置，frontmatter 不依赖它，显示用 label） */
	id: string;
	/** 看板列上显示的名称 */
	label: string;
	/** 圆点 / 卡片色（CSS 颜色值） */
	color: string;
	/** 是否在该阶段启用独立输入框（输入框标题与阶段名称联动） */
	hasInput: boolean;
}

export interface BoardItem {
	id: string;            // board-<timestamp>
	title: string;         // 条目名称
	status: string;        // 阶段 label
	tags: string[];
	notes: string;         // 机会级「背景 / 备注」
	stageNotes?: Record<string, string>; // 按阶段 label 存储的输入内容（仅 hasInput 的阶段）；缺省视为空
	link: string;          // 详情双链，如 [[xxx-详情]]，可空
	starred: boolean;      // 星标（重要 / 待跟进，与阶段终态解耦）
	order: number;         // 手动排序权重（同状态内从小到大）
	createDate: string;
	updateDate: string;
}

export interface BoardFormData {
	title: string;
	status: string;
	tags: string[];
	notes: string;
	stageNotes?: Record<string, string>;
	link: string;
	starred: boolean;
}

/* ---- Constants ---- */

export const DEFAULT_BOARD_FILE = '看板.md';

/** 旧「机会点」状态 -> 通用阶段标签 的迁移映射（仅读取时用于兼容历史数据） */
const STATUS_REMAP: Record<string, string> = {
	'未沟通': '收集箱',
	'沟通通过': '评估中',
	'调研中': '评估中',
	'待上会': '进行中',
	'已完成': '已完成',
	'已否决': '已放弃',
};

export function migrateStatus(old: string): string {
	return STATUS_REMAP[old] ?? old;
}

const TABLE_START = '<!-- OPPORTUNITIES_TABLE_START -->';
const TABLE_END = '<!-- OPPORTUNITIES_TABLE_END -->';

/* ---- Weight helpers (for sorting) ---- */

/** Sort: by configured stage order → manual order → createDate desc. */
export function sortBoardItems(items: BoardItem[], stageLabels: string[]): BoardItem[] {
	const known = new Set(stageLabels);
	return [...items].sort((a, b) => {
		const wa = known.has(a.status) ? stageLabels.indexOf(a.status) : stageLabels.length;
		const wb = known.has(b.status) ? stageLabels.indexOf(b.status) : stageLabels.length;
		if (wa !== wb) return wa - wb;
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

/* ---- Frontmatter <-> BoardItem mapping ---- */

function toFmObject(it: BoardItem): Record<string, unknown> {
	const obj: Record<string, unknown> = {
		id: it.id,
		排序: typeof it.order === 'number' ? it.order : 0,
		标题: it.title || '',
		状态: it.status || '收集箱',
		标签: it.tags && it.tags.length ? it.tags : [],
		备注: it.notes || '',
		链接: it.link || '',
		星标: !!it.starred,
		创建时间: it.createDate || '',
		更新时间: it.updateDate || '',
	};
	// 阶段备注为空时不写键，避免在 frontmatter 里留下空对象/undefined
	if (it.stageNotes && Object.keys(it.stageNotes).length) {
		obj['阶段备注'] = it.stageNotes;
	}
	return obj;
}

function coerceBool(v: unknown): boolean {
	return v === true || v === 'true' || v === '是' || v === 'yes' || v === '1';
}

function fromFmObject(raw: Record<string, unknown>, fallbackId: string): BoardItem {
	// 旧键别名（兼容历史「机会点」数据）
	const title = typeof raw['标题'] === 'string' ? (raw['标题'] as string)
		: (typeof raw['机会点名称'] === 'string' ? (raw['机会点名称'] as string) : '');
	const oldComm = typeof raw['沟通结论'] === 'string' ? (raw['沟通结论'] as string) : '';
	const oldRes = typeof raw['调研结论'] === 'string' ? (raw['调研结论'] as string) : '';
	const oldMeet = typeof raw['上会结论'] === 'string' ? (raw['上会结论'] as string) : '';
	let notes = typeof raw['备注'] === 'string' ? (raw['备注'] as string) : '';
	if (!notes && (oldComm || oldRes || oldMeet)) {
		notes = [oldComm, oldRes, oldMeet].filter(Boolean).join('\n');
	}
	let link = typeof raw['链接'] === 'string' ? (raw['链接'] as string) : '';
	if (!link && typeof raw['详情'] === 'string') link = raw['详情'] as string;
	let starred = coerceBool(raw['星标']);
	if (!starred && coerceBool(raw['转路标'])) starred = true;

	// 阶段备注：按阶段 label 存的输入内容（对象）。缺省 / 非法时为空对象，保证读取不崩。
	let stageNotes: Record<string, string> = {};
	const rawStageNotes = raw['阶段备注'];
	if (rawStageNotes && typeof rawStageNotes === 'object' && !Array.isArray(rawStageNotes)) {
		stageNotes = {};
		for (const [k, v] of Object.entries(rawStageNotes as Record<string, unknown>)) {
			if (typeof v === 'string') stageNotes[k] = v;
		}
	}

	const rawStatus = typeof raw['状态'] === 'string' ? (raw['状态'] as string) : '';
	const status = rawStatus ? migrateStatus(rawStatus) : '收集箱';
	const tags = Array.isArray(raw['标签']) ? (raw['标签'] as unknown[]).map(String) : [];
	return {
		id: typeof raw['id'] === 'string' ? (raw['id'] as string) : fallbackId,
		title: title || '',
		status,
		tags,
		notes,
		stageNotes,
		link,
		starred,
		order: typeof raw['排序'] === 'number' ? (raw['排序'] as number) : -1,
		createDate: typeof raw['创建时间'] === 'string' ? (raw['创建时间'] as string) : '',
		updateDate: typeof raw['更新时间'] === 'string' ? (raw['更新时间'] as string) : '',
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

function buildTable(items: BoardItem[]): string {
	const header = '| 标题 | 状态 | 星标 | 创建时间 |';
	const sep = '|---|---|---|---|';
	const rows = items.length
		? items.map((it) => `| ${escCell(it.title)} | ${escCell(it.status)} | ${it.starred ? '★' : '-'} | ${escCell(it.createDate || '-')} |`)
		: ['| _暂无条目_ | | | |'];
	return [header, sep, ...rows].join('\n');
}

/** 可读明细：把每个条目的全部字段写成 Markdown 列表，方便在笔记里直接看。 */
function buildDetails(items: BoardItem[], title: string): string {
	if (!items.length) return `_暂无条目，点击插件「◈ ${title} → + 新建」开始记录。_`;
	const lines: string[] = ['## 明细'];
	items.forEach((it, i) => {
		lines.push(`### ${i + 1}. ${it.title}`);
		lines.push(`- **状态**：${it.status} **星标**：${it.starred ? '★' : '-'}`);
		lines.push(`- **标签**：${it.tags && it.tags.length ? it.tags.join('、') : '-'}`);
		lines.push(`- **背景 / 备注**：${it.notes || '-'}`);
		const sn = it.stageNotes || {};
		for (const [k, v] of Object.entries(sn)) {
			if (v) lines.push(`- **${k}**：${v}`);
		}
		lines.push(`- **链接**：${it.link || '-'}`);
		lines.push(`- **创建 / 更新**：${it.createDate || '-'} / ${it.updateDate || '-'}`);
	});
	return lines.join('\n');
}

/** 标记区内容（表格 + 明细），不含标题与说明，供 buildBody / regenerateBody 复用。 */
function buildRegion(items: BoardItem[], title: string): string {
	return `${TABLE_START}\n## 总览\n${buildTable(items)}\n\n${buildDetails(items, title)}\n${TABLE_END}`;
}

function buildBody(items: BoardItem[], title: string): string {
	const intro = '> [!info] 本文件由 Dashboard 自动维护。上方「总览」为表格，下方「明细」为各条目完整内容；两者均在标记区内由插件生成，请勿手改标记区，标记区外的文字不会被覆盖。';
	return `# ${title}\n\n${intro}\n\n${buildRegion(items, title)}\n`;
}

/**
 * 替换标记区（表格 + 明细），保留标记区外的用户文字。
 * 当标记区缺失时（用户手改 / 旧版本数据），把区域内容追加到现有正文之后，
 * 绝不覆盖用户写在标记区外的任何内容，避免保存时丢字。
 */
function regenerateBody(existingBody: string, items: BoardItem[], title: string): string {
	const s = existingBody.indexOf(TABLE_START);
	const e = existingBody.indexOf(TABLE_END);
	const region = buildRegion(items, title);
	if (s === -1 || e === -1 || e < s) {
		return existingBody.trim() ? `${existingBody}\n\n${region}\n` : `${region}\n`;
	}
	const prefix = existingBody.slice(0, s);
	const suffix = existingBody.slice(e + TABLE_END.length);
	return `${prefix}${region}${suffix}`;
}

/* ---- File-level read / write ---- */

/** Ensure the master file exists (with empty items + table). Idempotent. */
export async function ensureOpportunityFile(app: App, path: string, title: string): Promise<void> {
	const f = app.vault.getFileByPath(path);
	if (f) return;
	const initial = `---\nopportunities: []\n---\n\n${buildBody([], title)}`;
	try {
		await app.vault.create(path, initial);
	} catch (err) {
		// If another process created it in the meantime, treat as success.
		if (err instanceof Error && /already exists/i.test(err.message)) return;
		throw err;
	}
}

/** Read all items from the master file (empty array if missing). */
export async function parseOpportunitiesFile(app: App, path: string, title: string): Promise<BoardItem[]> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		await ensureOpportunityFile(app, path, title);
		return [];
	}
	const content = await app.vault.read(file);
	const fm = parseFrontmatter(content, path);
	const arr = fm['opportunities'];
	if (!Array.isArray(arr)) return [];
	return (arr as unknown[])
		.filter((r) => r && typeof r === 'object')
		// ⚠️ fallbackId 必须稳定（按数组索引），不能用 Date.now()：历史数据无 id 字段时，
		//    若每次读取都生成新 id，updateOpportunity 按 id 找不到条目会静默失败 → 数据「保存后丢失」。
		//    用索引保证同一位置的数据每次读到相同 id，首次保存后 id 即固化为真实值。
		.map((r, i) => fromFmObject(r as Record<string, unknown>, `board-${i}`))
		// 旧数据无 order 字段时，按数组顺序赋默认权重，保证稳定排序且不互相冲突
		.map((it, i) => (it.order >= 0 ? it : ({ ...it, order: i })));
}

/** Write the full items array back to the master file (regenerates table). */
export async function writeOpportunitiesFile(app: App, path: string, items: BoardItem[], title: string): Promise<void> {
	let file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		await ensureOpportunityFile(app, path, title);
		file = app.vault.getAbstractFileByPath(path);
	}
	if (!(file instanceof TFile)) return;
	const content = await app.vault.read(file);
	const fm = parseFrontmatter(content, path);
	fm['opportunities'] = items.map(toFmObject);
	const yaml = stringifyYaml(fm);
	const front = `---\n${yaml.trim()}\n---\n`;
	const body = regenerateBody(stripFrontmatter(content), items, title);
	await app.vault.modify(file, front + body);
}

/* ---- Item-level operations ---- */

export async function createOpportunity(app: App, path: string, data: BoardFormData, title: string): Promise<BoardItem> {
	const items = await parseOpportunitiesFile(app, path, title);
	const now = todayStr();
	const item: BoardItem = {
		id: 'board-' + Date.now(),
		title: data.title,
		status: data.status || '收集箱',
		tags: data.tags || [],
		notes: data.notes || '',
		stageNotes: data.stageNotes || {},
		link: data.link || '',
		starred: !!data.starred,
		order: items.length,
		createDate: now,
		updateDate: now,
	};
	items.push(item);
	await writeOpportunitiesFile(app, path, items, title);
	return item;
}

export async function updateOpportunity(app: App, path: string, id: string, patch: Partial<BoardItem>, title: string): Promise<void> {
	const items = await parseOpportunitiesFile(app, path, title);
	const idx = items.findIndex((i) => i.id === id);
	if (idx < 0) return;
	items[idx] = { ...items[idx], ...patch, id, updateDate: todayStr() } as BoardItem;
	await writeOpportunitiesFile(app, path, items, title);
}

export async function updateBoardItemStatus(app: App, path: string, id: string, status: string, title: string): Promise<void> {
	// 只改状态；星标是独立的「重要 / 待跟进」标记，与阶段终态解耦，不再随状态切换被清除。
	const patch: Partial<BoardItem> = { status };
	await updateOpportunity(app, path, id, patch, title);
}

export async function toggleBoardItemStarred(app: App, path: string, id: string, val: boolean, title: string): Promise<void> {
	await updateOpportunity(app, path, id, { starred: val }, title);
}

export async function deleteOpportunity(app: App, path: string, id: string, title: string): Promise<void> {
	const items = await parseOpportunitiesFile(app, path, title);
	const next = items.filter((i) => i.id !== id);
	await writeOpportunitiesFile(app, path, next, title);
}
