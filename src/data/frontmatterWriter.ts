import { TFile } from 'obsidian';
import type { App } from 'obsidian';

/* ============================================================
   统一的 frontmatter 写入器 —— 全插件唯一实现。
   此前 ProjectBoard 有 4 处、DashboardView 有 2 处各自手写
   行级扫描写入：ProjectBoard 版本不处理 CRLF（会把整份文件的
   换行符改写），且所有版本都不转义值 —— 描述/备注里出现换行、
   ": "、行首 "#" 等会直接破坏 YAML 结构。这里统一修复：
   1. 值经 yamlScalar() 序列化（裸写 or 双引号转义）；
   2. CRLF-safe（按文件原有换行符回写）；
   3. value === null 表示删除该字段。
   ============================================================ */

/**
 * YAML 标量安全序列化：普通短文本保持裸写（与历史文件格式一致），
 * 含 YAML 特殊字符/换行/首尾空白的值用 JSON.stringify 包成双引号标量
 * （JSON 双引号字符串是合法 YAML 双引号标量，转义集兼容）。
 */
export function yamlScalar(value: string): string {
	if (value === '') return "''";
	// 需要加引号的情形：
	// - 含换行/回车、": "、结尾冒号、" #"（注释）
	// - 以 YAML 特殊起始符开头（# - ? & * ! | > ' " % @ ` [ ] { } ,）
	// - 首尾空白
	const unsafe =
		/[\n\r]/.test(value) ||
		value.includes(': ') ||
		value.endsWith(':') ||
		value.includes(' #') ||
		value.trim() !== value ||
		/^[#\-?&*!|>'"%@`\[\]{},]/.test(value);
	return unsafe ? JSON.stringify(value) : value;
}

/** 值 -> frontmatter 行右侧内容（含转义）。 */
function fmValue(value: string): string {
	return yamlScalar(value);
}

/** Read a file and apply frontmatter field updates (create if missing; null = delete). CRLF-safe. */
export async function writeFrontmatter(app: App, file: TFile, updates: Record<string, string | null>): Promise<void> {
	const content = await app.vault.read(file);
	const eol = content.includes('\r\n') ? '\r\n' : '\n';
	const lines = content.split(/\r?\n/);
	applyFrontmatterUpdates(lines, updates);
	await app.vault.modify(file, lines.join(eol));
}

/** Mutate a lines array: update existing frontmatter fields, insert missing ones before closing ---,
 *  delete fields whose value is null. CRLF-safe (works on already-split lines). */
export function applyFrontmatterUpdates(lines: string[], updates: Record<string, string | null>): void {
	let inFM = false;
	let fmEnd = -1;
	const done = new Set<string>();
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		if (line.trim() === '---') {
			if (!inFM) { inFM = true; continue; }
			fmEnd = i;
			inFM = false;
			continue;
		}
		if (!inFM) continue;
		for (const key of Object.keys(updates)) {
			if (line.startsWith(key + ':')) {
				if (updates[key] === null) {
					lines.splice(i, 1);
					i--;
				} else {
					lines[i] = `${key}: ${fmValue(updates[key] as string)}`;
				}
				done.add(key);
			}
		}
	}
	const missing = Object.keys(updates).filter((k) => !done.has(k) && updates[k] !== null);
	if (missing.length === 0) return;
	if (fmEnd > 0) {
		lines.splice(fmEnd, 0, ...missing.map((k) => `${k}: ${fmValue(updates[k] as string)}`));
	} else {
		// No frontmatter at all — prepend a block
		lines.unshift(...['---', ...missing.map((k) => `${k}: ${fmValue(updates[k] as string)}`), '---', '']);
	}
}
