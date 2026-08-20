/**
 * 工作日志数据层：解析每日笔记正文中的「时间 标题」条目，并支持按月聚合与增删改。
 * 数据全部存于 Vault 内的每日笔记 Markdown 文件（正文），不引入任何外部依赖。
 */

import { App, TFile } from 'obsidian';
import { DashboardSettings } from '../settings';
import { applyNamingPattern } from './naming';

/** 一条工作日志条目 */
export interface WorkLogEntry {
	/** `${date}#${lineIndex}`，文件内稳定定位键 */
	id: string;
	/** 'YYYY-MM-DD' */
	date: string;
	/** 'HH:mm' */
	startTime: string;
	/** 'HH:mm'（可选） */
	endTime?: string;
	/** 纯标题（不含标签/链接） */
	title: string;
	/** 形如 ['#项目X'] */
	tags: string[];
	/** wikilink 目标（去括号），如 'Dashboard插件' */
	project?: string;
	/** 该条目在文件中的绝对行号（含 frontmatter），用于编辑/删除 */
	lineIndex: number;
	/** 所属每日笔记路径 */
	sourcePath: string;
}

/** 新增/编辑时由调用方传入的字段（其余由 store 计算） */
export type WorkLogEntryInput = Omit<WorkLogEntry, 'id' | 'lineIndex' | 'sourcePath'>;

const ENTRY_RE =
	/^(?:\s*[-*]\s+)?(\d{1,2}):(\d{2})(?:\s*(?:-|–|~)\s*(\d{1,2}):(\d{2}))?\s+(.+?)\s*$/;
const LINK_RE = /\[\[([^\]]+)\]\]/g;

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

export function dateStr(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isValidTime(hh: string, mm: string): boolean {
	const h = parseInt(hh, 10);
	const m = parseInt(mm, 10);
	return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** 从一行原始文本中提取 tags / project / 纯净标题 */
function extractMeta(raw: string): { title: string; tags: string[]; project?: string } {
	let title = raw;
	let project: string | undefined;
	const linkMatch = LINK_RE.exec(raw);
	if (linkMatch) project = linkMatch[1]!.split('|')[0]!.trim();
	const tags: string[] = [];
	title = title
		.replace(LINK_RE, '')
		.replace(/#([^\s#]+)/g, (_m, t: string) => {
			tags.push('#' + t);
			return '';
		})
		.replace(/\s+/g, ' ')
		.trim();
	return { title, tags, project };
}

/** 把条目序列化为一行（`- HH:mm–HH:mm 标题 #标签 [[项目]]`） */
export function serializeEntry(e: WorkLogEntryInput): string {
	const t = e.startTime + (e.endTime ? '–' + e.endTime : '');
	const tail = [
		...e.tags.map((x) => (x.startsWith('#') ? x : '#' + x)),
		e.project ? `[[${e.project}]]` : '',
	]
		.filter(Boolean)
		.join(' ');
	return `- ${t} ${e.title}${tail ? ' ' + tail : ''}`;
}

export class WorkLogStore {
	constructor(private app: App, private getSettings: () => DashboardSettings) {}

	/** 每日笔记路径（基于命名规则）。month 为 0 基（与 Date.getMonth 一致）。 */
	private dailyNotePath(date: Date): string {
		const wl = this.getSettings().workLog;
		const filename = applyNamingPattern(wl.namingPattern, date);
		return `${wl.storagePath}/${filename}.md`;
	}

	/** 给定 'YYYY-MM-DD'，返回对应每日笔记路径（公开，供 UI 打开文件用） */
	notePath(date: string): string {
		const [y, m, d] = date.split('-').map((x) => parseInt(x, 10));
		return this.dailyNotePath(new Date(y, m - 1, d));
	}

	/** 解析单个每日笔记正文 → 条目数组（含 lineIndex）。frontmatter 区间被跳过。 */
	static parseEntries(content: string, date: string, path: string): WorkLogEntry[] {
		const lines = content.split(/\r?\n/);
		const out: WorkLogEntry[] = [];
		let inFM = false;
		let fmEnded = false;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			if (!fmEnded) {
				if (line.trim() === '---') {
					inFM = !inFM;
					if (!inFM) fmEnded = true;
				}
				continue;
			}
			if (inFM) continue; // 仍在 frontmatter 内（首格未闭合的兜底）
			const m = ENTRY_RE.exec(line);
			if (!m) continue;
			const sh = m[1]!;
			const sm = m[2]!;
			const eh = m[3];
			const em = m[4];
			if (!isValidTime(sh, sm)) continue;
			if (eh !== undefined && em !== undefined && !isValidTime(eh, em)) continue;
			const start = `${pad(parseInt(sh, 10))}:${pad(parseInt(sm, 10))}`;
			const end = eh !== undefined && em !== undefined ? `${pad(parseInt(eh, 10))}:${pad(parseInt(em, 10))}` : undefined;
			const { title, tags, project } = extractMeta(m[5]!);
			if (!title) continue;
			out.push({
				id: `${date}#${i}`,
				date,
				startTime: start,
				endTime: end,
				title,
				tags,
				project,
				lineIndex: i,
				sourcePath: path,
			});
		}
		// 按开始时间升序（时间相同则保持原行序）
		out.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : a.lineIndex - b.lineIndex));
		return out;
	}

	/** 月视图聚合：遍历当月每一天，按命名规则解析对应文件，返回 Map<dateStr, WorkLogEntry[]> */
	async getMonthEntries(year: number, month: number): Promise<Map<string, WorkLogEntry[]>> {
		const map = new Map<string, WorkLogEntry[]>();
		const days = new Date(year, month + 1, 0).getDate();
		for (let d = 1; d <= days; d++) {
			const date = new Date(year, month, d);
			const ds = dateStr(date);
			const path = this.dailyNotePath(date);
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				map.set(ds, []);
				continue;
			}
			const content = await this.app.vault.cachedRead(file);
			map.set(ds, WorkLogStore.parseEntries(content, ds, path));
		}
		return map;
	}

	/** 确保当日笔记存在（不存在则按模板/默认标题创建），返回文件路径 */
	async ensureDailyNote(date: Date): Promise<string> {
		const wl = this.getSettings().workLog;
		const folder = wl.storagePath;
		await this.ensureFolder(folder);
		const path = this.dailyNotePath(date);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return path;

		const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
		let content = `# ${filename}\n`;
		if (wl.templateFile) {
			const tplPath = wl.templateFile.endsWith('.md') ? wl.templateFile : `${wl.templateFile}.md`;
			const tplFile = this.app.vault.getAbstractFileByPath(tplPath);
			if (tplFile instanceof TFile) {
				const tpl = await this.app.vault.read(tplFile);
				content = tpl
					.replace(/\{\{date\}\}/g, dateStr(date))
					.replace(/\{\{title\}\}/g, filename);
			}
		}
		await this.app.vault.create(path, content);
		return path;
	}

	/** 新增：在当日笔记正文末尾追加一行 */
	async addEntry(date: string, entry: WorkLogEntryInput): Promise<void> {
		const [y, m, d] = date.split('-').map((x) => parseInt(x, 10));
		const path = await this.ensureDailyNote(new Date(y, m - 1, d));
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		const block = serializeEntry(entry);
		// 去掉末尾空行后追加，保持文件整洁
		while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
		lines.push(block);
		await this.app.vault.modify(file, lines.join(eol));
	}

	/** 编辑：按 id 重定位对应行后替换（行号失效则按 id 兜底追加） */
	async updateEntry(entry: WorkLogEntry): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		const parsed = WorkLogStore.parseEntries(content, entry.date, entry.sourcePath);
		const target = parsed.find((p) => p.id === entry.id);
		const block = serializeEntry(entry);
		if (target) {
			lines[target.lineIndex] = block;
		} else {
			// id 未命中（文件曾被外部改动导致行号漂移）→ 兜底追加
			while (lines.length && (lines[lines.length - 1] ?? '').trim() === '') lines.pop();
			lines.push(block);
		}
		await this.app.vault.modify(file, lines.join(eol));
	}

	/** 删除：按 id 重定位对应行后删除（行号失效则按 id 兜底忽略） */
	async deleteEntry(entry: WorkLogEntry): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
		if (!(file instanceof TFile)) return;
		const content = await this.app.vault.read(file);
		const eol = content.includes('\r\n') ? '\r\n' : '\n';
		const lines = content.split(/\r?\n/);
		const parsed = WorkLogStore.parseEntries(content, entry.date, entry.sourcePath);
		const target = parsed.find((p) => p.id === entry.id);
		if (target) {
			lines.splice(target.lineIndex, 1);
			await this.app.vault.modify(file, lines.join(eol));
		}
	}

	/** 递归创建文件夹（createFolder 仅支持单层） */
	private async ensureFolder(path: string): Promise<void> {
		const parts = path.split('/').filter(Boolean);
		let cur = '';
		for (const part of parts) {
			cur = cur ? `${cur}/${part}` : part;
			if (!this.app.vault.getAbstractFileByPath(cur)) {
				await this.app.vault.createFolder(cur);
			}
		}
	}
}
