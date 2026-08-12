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
 *  Owns the short-lived task-scan cache so the view only consumes results. */
export class TaskStore {
	private taskScanCache: TaskItem[] | null = null;
	private taskScanCacheAt = 0;
	private warnedProjectsFallback = false;

	constructor(
		private app: App,
		private getSettings: () => TaskStoreSettings,
		private onWarn?: (msg: string) => void,
	) {}

	/** Clear the task scan cache on relevant vault events, so a burst of
	 *  back-to-back edits is never served stale data. */
	invalidate(): void {
		this.taskScanCache = null;
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
		const rootPath = this.getSettings().projectsFolder;
		const projects: ProjectInfo[] = [];
		clearParseIssues();

		const root = this.app.vault.getAbstractFileByPath(rootPath);
		if (!root || !(root instanceof TFolder)) {
			// Config folder missing → keep the vault-root fallback for compatibility,
			// but warn once so the user knows to configure it (avoids silent full-vault scans).
			if (!this.warnedProjectsFallback) {
				this.warnedProjectsFallback = true;
				this.onWarn?.('未找到项目文件夹「' + rootPath + '」，请在设置中配置以缩小扫描范围');
				console.warn('[AgentDashboard] projectsFolder "' + rootPath + '" not found; fell back to scanning the whole vault root.');
			}
			const vaultRoot = this.app.vault.getRoot();
			if (vaultRoot) {
				await this.scanProjectsInFolder(vaultRoot, projects);
			}
			return projects;
		}

		await this.scanProjectsInFolder(root, projects);
		return projects;
	}

	/** Scan a folder and its children for project-{name}.md */
	private async scanProjectsInFolder(folder: TFolder, projects: ProjectInfo[]): Promise<void> {
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
				await this.scanProjectsInFolder(child, projects);
			}
		}
	}

	/** Scan .md files in a folder (skip project-{name}.md) and parse with parseTaskFile */
	async scanTasksInFolder(folder: TFolder, projectId?: string, projectColor?: string): Promise<TaskItem[]> {
		const tasks: TaskItem[] = [];
		for (const child of folder.children) {
			if (child instanceof TFolder) {
				// Recurse into sub-folders
				const subTasks = await this.scanTasksInFolder(child, projectId, projectColor);
				tasks.push(...subTasks);
			} else if (child instanceof TFile && child.name.endsWith('.md') && !child.name.startsWith('project-')) {
				try {
					const content = await this.app.vault.cachedRead(child);
					const task = parseTaskFile(child.path, content, projectId || folder.name, projectColor);
					tasks.push(task);
				} catch (e) {
					reportParseIssue({ path: child.path, kind: 'read', message: e instanceof Error ? e.message : String(e) });
				}
			}
		}
		return tasks;
	}

	/** Scan all tasks across all projects. Short-lived cache (300ms) so
	 *  back-to-back scans (e.g. pulse + home cards) share one result. */
	async scanAllTasks(): Promise<TaskItem[]> {
		const now = Date.now();
		if (this.taskScanCache && now - this.taskScanCacheAt < 300) return this.taskScanCache;
		const projects = await this.scanAllProjects();
		const allTasks: TaskItem[] = [];
		for (const proj of projects) {
			const folder = this.app.vault.getAbstractFileByPath(proj.path);
			if (folder instanceof TFolder) {
				const tasks = await this.scanTasksInFolder(folder, proj.name, proj.color);
				allTasks.push(...tasks);
			}
		}
		this.taskScanCache = allTasks;
		this.taskScanCacheAt = now;
		return allTasks;
	}
}