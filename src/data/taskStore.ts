import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import { parseTaskFile, parseProjectMeta } from './taskParser';
import type { ProjectInfo, TaskItem } from './taskParser';
import { reportParseIssue, clearParseIssues, getParseIssues } from './parserDiagnostics';
import type { ParseIssue } from './parserDiagnostics';

/** Settings the store needs to scan projects/tasks. */
export interface TaskStoreSettings {
	projectsFolder: string;
	npdpStages: string[];
}

/** Vault-based scan logic (previously inlined in DashboardView).
 *  Owns the short-lived scan cache so the view only consumes results. */
export class TaskStore {
	/** 共享扫描缓存：projects 与 tasks 来自同一次遍历（300ms）。
	 *  此前 scanAllTasks 会先跑一遍 scanAllProjects（内部已读取每个任务文件），
	 *  再对每个项目把任务文件重读一遍 —— 每文件 2 次 IO；pulse 与首页卡片
	 *  又是两条路径，容易连续全量重扫。现在全部共享这一次遍历。 */
	private scanCache: { at: number; projects: ProjectInfo[]; tasks: TaskItem[] } | null = null;
	private warnedProjectsFallback = false;

	constructor(
		private app: App,
		private getSettings: () => TaskStoreSettings,
		private onWarn?: (msg: string) => void,
	) {}

	/** Clear the scan cache on relevant vault events, so a burst of
	 *  back-to-back edits is never served stale data. */
	invalidate(): void {
		this.scanCache = null;
	}

	/** Snapshot of parse/read failures collected during the last vault scan. */
	getParseIssues(): ParseIssue[] {
		return getParseIssues();
	}

	/** Whether a file change can affect the home cards. Task files are markdown
	 *  under the configured projects folder; if that folder is missing the scanner
	 *  falls back to the whole vault root, so any markdown change is then relevant. */
	isTaskRelevantPath(path: string): boolean {
		const pf = this.getSettings().projectsFolder;
		if (!path.endsWith('.md')) return false;
		const root = this.app.vault.getAbstractFileByPath(pf);
		if (!(root instanceof TFolder)) return true;
		return path === pf || path.startsWith(pf + '/');
	}

	/** Scan vault for all project folders with project.md */
	async scanAllProjects(): Promise<ProjectInfo[]> {
		return (await this.scanAllWithTasks()).projects;
	}

	/** Scan all tasks across all projects. Shares one traversal with
	 *  scanAllProjects via the 300ms cache, so back-to-back scans
	 *  (e.g. pulse + home cards + project board) read each file once. */
	async scanAllTasks(): Promise<TaskItem[]> {
		return (await this.scanAllWithTasks()).tasks;
	}

	/**
	 * 单次遍历同时产出项目与任务；任务文件并发读取（cachedRead 走 Obsidian
	 * 缓存，Promise.all 并发安全），替代此前「逐文件串行 await」的实现。
	 */
	private async scanAllWithTasks(): Promise<{ projects: ProjectInfo[]; tasks: TaskItem[] }> {
		const now = Date.now();
		if (this.scanCache && now - this.scanCache.at < 300) return this.scanCache;
		clearParseIssues();

		const rootPath = this.getSettings().projectsFolder;
		const projects: ProjectInfo[] = [];
		const allTasks: TaskItem[] = [];
		let root: TFolder | null = null;

		const rootFile = this.app.vault.getAbstractFileByPath(rootPath);
		if (rootFile instanceof TFolder) {
			root = rootFile;
		} else {
			// Config folder missing → keep the vault-root fallback for compatibility,
			// but warn once so the user knows to configure it (avoids silent full-vault scans).
			if (!this.warnedProjectsFallback) {
				this.warnedProjectsFallback = true;
				this.onWarn?.('未找到项目文件夹「' + rootPath + '」，请在设置中配置以缩小扫描范围');
				console.warn('[Dashboard] projectsFolder "' + rootPath + '" not found; fell back to scanning the whole vault root.');
			}
			root = this.app.vault.getRoot();
		}

		if (root) await this.scanProjectsInFolder(root, projects, allTasks);
		this.scanCache = { at: now, projects, tasks: allTasks };
		return this.scanCache;
	}

	/** Scan a folder and its children for project-{name}.md;
	 *  each project's tasks are also appended into acc (single traversal). */
	private async scanProjectsInFolder(folder: TFolder, projects: ProjectInfo[], acc: TaskItem[]): Promise<void> {
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				// Config file: project-{folderName}.md
				const projectFilePath = `${child.path}/project-${child.name}.md`;
				const projectFile = this.app.vault.getAbstractFileByPath(projectFilePath);
				if (projectFile instanceof TFile) {
					let meta: Partial<ProjectInfo> = {};
					try {
						const content = await this.app.vault.cachedRead(projectFile);
						meta = parseProjectMeta(content, projectFile.path);
					} catch (e) {
						reportParseIssue({ path: projectFile.path, kind: 'read', message: e instanceof Error ? e.message : String(e) });
					}
					const projColor = meta.color || '#3b82f6';
					const taskFiles = await this.scanTasksInFolder(child, meta.name || child.name, projColor);
					acc.push(...taskFiles);
					const activeCount = taskFiles.filter((t) => t.status !== '已完成' && t.status !== '已取消').length;
					const projStage = meta.stage ?? 0;
					const stages = this.getSettings().npdpStages;
					projects.push({
						name: meta.name || child.name,
						color: projColor,
						description: meta.description || '',
						startDate: meta.startDate || null,
						endDate: meta.endDate || null,
						createDate: meta.createDate || null,
						taskCount: taskFiles.length,
						activeCount,
						path: child.path,
						stage: Math.min(projStage, stages.length - 1),
						stages,
						type: meta.type ?? 'stage',
					});
				}
				// Recurse into sub-folders
				await this.scanProjectsInFolder(child, projects, acc);
			}
		}
	}

	/** Scan .md files in a folder (skip project-{name}.md) and parse with parseTaskFile.
	 *  Collects files recursively first, then reads them concurrently — the previous
	 *  one-await-per-file loop was the serial-IO bottleneck on large vaults. */
	async scanTasksInFolder(folder: TFolder, projectId?: string, projectColor?: string): Promise<TaskItem[]> {
		const files: TFile[] = [];
		const collect = (f: TFolder): void => {
			for (const child of f.children) {
				if (child instanceof TFolder) {
					collect(child);
				} else if (child instanceof TFile && child.name.endsWith('.md') && !child.name.startsWith('project-')) {
					files.push(child);
				}
			}
		};
		collect(folder);
		const results = await Promise.all(files.map(async (file) => {
			try {
				const content = await this.app.vault.cachedRead(file);
				return parseTaskFile(file.path, content, projectId || folder.name, projectColor);
			} catch (e) {
				reportParseIssue({ path: file.path, kind: 'read', message: e instanceof Error ? e.message : String(e) });
				return null;
			}
		}));
		return results.filter((t): t is TaskItem => t !== null);
	}
}
