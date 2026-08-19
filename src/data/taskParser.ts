import { parseYaml } from 'obsidian';
import { taskFromFm, projectFromFm } from './taskParseCore';
import type { TaskItem, ProjectInfo } from './taskParseCore';
import { reportParseIssue } from './parserDiagnostics';

/* ---- Re-export pure core (types / constants / parsers) ----
   Existing callers keep importing from './taskParser'; the actual
   parsing lives in taskParseCore.ts (no Obsidian runtime dep). */

export type {
	TaskItem, DailyNode, NodeState, TaskStatus, TaskPriority, TaskType,
	RepeatRule, ProjectInfo, ProjectType,
} from './taskParseCore';
export {
	PROJECT_TYPE_LIST, STATUS_LIST, PRIORITY_LIST, TYPE_LIST, priorityWeight,
	parseDailyNodesFromBody, serializeDailyNodesBlock,
} from './taskParseCore';

/* ---- YAML frontmatter parser ----
   Uses Obsidian's official parseYaml for robust, standards-compliant YAML
   handling (quoted values, flow arrays, nested objects, block scalars). */

export function parseFrontmatter(content: string, filePath?: string): Record<string, unknown> {
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== '---') return {};
	let end = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === '---') { end = i; break; }
	}
	if (end === -1) return {};
	const yamlBlock = lines.slice(1, end).join('\n');
	if (!yamlBlock.trim()) return {};
	try {
		const parsed: unknown = parseYaml(yamlBlock);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch (e) {
		// malformed YAML → record it so the UI can surface the broken file
		reportParseIssue({ path: filePath ?? '(unknown)', kind: 'yaml', message: e instanceof Error ? e.message : String(e) });
	}
	return {};
}

/* ---- Task parser ---- */

/** Parse a .md file into a TaskItem using Chinese frontmatter keys */
export function parseTaskFile(filePath: string, content: string, projectId: string, projectColor?: string): TaskItem {
	return taskFromFm(parseFrontmatter(content, filePath), content, filePath, projectId, projectColor);
}

/** Parse project.md frontmatter */
export function parseProjectMeta(content: string, filePath?: string): Partial<ProjectInfo> {
	return projectFromFm(parseFrontmatter(content, filePath));
}