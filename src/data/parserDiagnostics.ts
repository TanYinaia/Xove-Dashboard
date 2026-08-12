/**
 * Parser diagnostics collector.
 *
 * The parsers used to swallow malformed YAML / read failures silently
 * (returning `{}` or `[]`), which made broken files invisible to the user —
 * tasks/projects would simply vanish with no indication of what went wrong.
 *
 * This module collects those failures in one place so the UI can surface them
 * as a single, actionable banner ("N 个文件解析异常，点击查看").
 */

export type ParseIssueKind = 'yaml' | 'read' | 'parse';

export interface ParseIssue {
	/** Vault-relative path of the offending file. */
	path: string;
	kind: ParseIssueKind;
	message: string;
}

let issues: ParseIssue[] = [];

/** Record a single parse/read failure. */
export function reportParseIssue(issue: ParseIssue): void {
	issues.push(issue);
}

/** Return a snapshot of all issues collected so far. */
export function getParseIssues(): ParseIssue[] {
	return issues.slice();
}

/** Clear all collected issues (call at the start of a fresh scan). */
export function clearParseIssues(): void {
	issues = [];
}
