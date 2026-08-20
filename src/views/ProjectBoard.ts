import { Menu, TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import {
	TaskItem, ProjectInfo, TaskStatus, NodeState, priorityWeight,
	parseFrontmatter, STATUS_LIST,
} from '../data/taskParser';
import type { TaskStore } from '../data/taskStore';
import { fmtDate } from '../data/taskLogic';
import { computeWindow, filterWithOrig } from '../data/virtualList';
import { UI_TEXT } from '../constants';
import { ICON_gantt, ICON_list, ICON_calendar, ICON_kanban, injectSvg } from '../icons';

/** 宿主接口：ProjectBoard 渲染器所需的宿主依赖。 */
export interface ProjectHost {
	app: App;
	plugin: {
		settings: {
			projectsFolder: string;
			currentPoView: string;
			poProjectOrder: string[];
			poTaskOrder: string[];
			npdpStages: string[];
			poGanttStatusFilter?: string[];
			poGanttScale?: 'day' | 'week' | 'month' | 'quarter';
		};
		saveSettings(): Promise<void>;
	};
	boardEl: HTMLElement | null;
	currentPage: 'home' | 'project' | 'opportunity' | 'worklog';
	exitEditMode(): void;
	selectedProject: string | null;
	showToast(message: string, kind?: 'success' | 'error'): void;
	taskStore: TaskStore;
	openTaskEditModal(task: TaskItem, presetTodayNode?: NodeState): void;
	writeFrontmatter(file: TFile, updates: Record<string, string | null>): Promise<void>;
	deleteTask(task: TaskItem): Promise<void>;
	editProject(proj: ProjectInfo): Promise<void>;
	createProjectFile(): Promise<void>;
	openTaskModalWithParent(parentName: string, projectName: string): Promise<void>;
	toggleTask(task: TaskItem, row: HTMLElement): Promise<void>;
}

/** 项目总览（第二页）渲染器 — 从 DashboardView 抽出。 */
export class ProjectBoard {
	private host: ProjectHost;

	// Project overview state
	private currentProjects: ProjectInfo[] = [];
	private currentTasks: TaskItem[] = [];
	private currentView: string = 'gantt';
	private poMainEl: HTMLElement | null = null;
	private calYear: number = new Date().getFullYear();
	private calMonth: number = new Date().getMonth();
	private sortCol: string = '';
	private sortDir: 'asc' | 'desc' = 'asc';
	private taskListFilter: string = 'all';
	private collapsedParents: Set<string> = new Set();
	private highlightedBar: Element | null = null;
	private highlightedRow: HTMLElement | null = null;
	private ganttZoom: 'day' | 'week' | 'month' | 'quarter' = 'week';
	private ganttStatusFilter: TaskStatus[] = [];

	// ---- host 依赖别名（保持搬移方法体原样） ----
	private get app() { return this.host.app; }
	private get plugin() { return this.host.plugin; }
	private get boardEl() { return this.host.boardEl; }
	private get currentPage() { return this.host.currentPage; }
	private set currentPage(v: 'home' | 'project' | 'opportunity' | 'worklog') { this.host.currentPage = v; }
	private get selectedProject() { return this.host.selectedProject; }
	private set selectedProject(v: string | null) { this.host.selectedProject = v; }
	private get showToast() { return this.host.showToast.bind(this.host); }
	private get taskStore() { return this.host.taskStore; }
	private get openTaskEditModal() { return this.host.openTaskEditModal.bind(this.host); }
	private get writeFrontmatter() { return this.host.writeFrontmatter.bind(this.host); }
	private get deleteTask() { return this.host.deleteTask.bind(this.host); }
	private get editProject() { return this.host.editProject.bind(this.host); }
	private get createProjectFile() { return this.host.createProjectFile.bind(this.host); }
	private get openTaskModalWithParent() { return this.host.openTaskModalWithParent.bind(this.host); }
	private get toggleTask() { return this.host.toggleTask.bind(this.host); }

	constructor(host: ProjectHost) {
		this.host = host;
	}

	/** 从首页卡片进入：定位到某项目并切换到甘特视图。 */
	async openProjectGantt(proj: ProjectInfo): Promise<void> {
		this.host.selectedProject = proj.name;
		this.currentView = 'gantt';
		await this.show(true);
	}


	/**
	 * 渲染项目总览。
	 * @param preserveSelection 为 true 时（如从首页项目卡片跳入）保留调用方已设置的
	 *        selectedProject / currentView，不重置为「全部项目」；为 false 时（点击工具栏
	 *        「全部项目」）重置为显示所有项目并恢复上次记忆的视图标签。
	 */
	async show(preserveSelection = false): Promise<void> {
		if (!this.boardEl) return;
		// 离开首页时自动退出编辑态（修复「切到项目总览后编辑态残留」）
		this.host.exitEditMode();

		// Scan FIRST (async) so the board is never left half-built if a vault event
		// fires mid-render. We only mutate the DOM after data is ready, which keeps
		// the project-overview build atomic and avoids stale/doubled home cards.
		const projects = await this.taskStore.scanAllProjects();
		const allTasks = await this.taskStore.scanAllTasks();

		this.boardEl.empty();
		this.boardEl.addClass('po-board');
		this.boardEl.removeClass('ad-board');
		this.boardEl.removeClass('op-board');
		this.currentPage = 'project';

		this.currentProjects = projects;
		this.currentTasks = allTasks;
		this.applyProjectOrder();
		this.ganttStatusFilter = (this.plugin.settings.poGanttStatusFilter || []) as TaskStatus[];
		// 恢复上次记忆的甘特图时间粒度（日/周/月/季度），默认周
		this.ganttZoom = this.plugin.settings.poGanttScale || 'week';
		if (!preserveSelection) {
			this.selectedProject = null;
			this.currentView = this.plugin.settings.currentPoView || 'gantt';
		}

		// Container with sidebar + main
		const container = this.boardEl.createDiv({ cls: 'po-container' });

		// Sidebar
		const sidebar = container.createDiv({ cls: 'po-sidebar' });
		this.renderSidebar(sidebar);

		// Main content area
		this.poMainEl = container.createDiv({ cls: 'po-main' });
		this.renderPanels();
	}



	/** Re-render only the main content panels (tabs + panels) */
	private renderPanels(): void {
		if (!this.poMainEl) return;
		this.poMainEl.empty();

		const filteredTasks = this.selectedProject
			? this.currentTasks.filter((t) => t.projectId === this.selectedProject)
			: this.currentTasks;

		// Tabs
		const tabs = this.poMainEl.createDiv({ cls: 'po-tabs' });
		const tabDefs = [
			{ key: 'gantt', label: UI_TEXT.poGantt, icon: ICON_gantt },
			{ key: 'list', label: UI_TEXT.poList, icon: ICON_list },
			{ key: 'calendar', label: UI_TEXT.poCalendar, icon: ICON_calendar },
			{ key: 'kanban', label: UI_TEXT.poKanban, icon: ICON_kanban },
		];
		const content = this.poMainEl.createDiv({ cls: 'po-content' });
		const panels: Record<string, HTMLElement> = {};
		for (const td of tabDefs) {
			const btn = tabs.createEl('button', { cls: 'po-tab' + (td.key === this.currentView ? ' is-active' : '') });
			const tabGlyph = btn.createSpan({ cls: 'ad-glyph' });
			injectSvg(tabGlyph, td.icon);
			btn.createSpan({ text: td.label });
			btn.dataset.view = td.key;
			panels[td.key] = content.createDiv({ cls: 'po-panel' + (td.key === this.currentView ? ' is-active' : ''), attr: { 'data-view': td.key } });
		}

		// Stage pipeline (compact dots) at the tab row's right side — only for 阶段项目
		if (this.selectedProject) {
			const selProj = this.currentProjects.find((p) => p.name === this.selectedProject);
			if (selProj && (selProj.type ?? 'stage') === 'stage') {
				this.renderStagePipeline(tabs);
			}
		}

		// Render only the ACTIVE panel up front. The other three are built lazily when
		// their tab is first opened — avoids building Gantt SVG + calendar + kanban all
		// at once on every open (perf).
		this.renderPanel(this.currentView, panels[this.currentView]!, filteredTasks);

		// Tab switch (lazy-render target panel)
		tabs.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.po-tab') as HTMLElement;
			if (!btn) return;
			const view = btn.dataset.view;
			if (!view) return;
			tabs.querySelectorAll('.po-tab').forEach((t) => t.removeClass('is-active'));
			btn.addClass('is-active');
			Object.values(panels).forEach((p) => p.classList.remove('is-active'));
			if (panels[view]) panels[view].addClass('is-active');
			this.currentView = view;
			this.plugin.settings.currentPoView = view;
			void this.plugin.saveSettings();
			if (panels[view]) this.renderPanel(view, panels[view], filteredTasks);
		});
	}



	/** Render a single PO panel by key (used for both initial render and lazy tab switch) */
	private renderPanel(key: string, panel: HTMLElement, tasks: TaskItem[]): void {
		panel.empty();
		if (key === 'gantt') this.renderGanttPanel(panel, tasks, this.currentProjects);
		else if (key === 'list') this.renderTaskTable(panel, 'po-tb2', tasks, this.currentProjects);
		else if (key === 'calendar') this.renderCalendarPanel(panel, tasks, this.currentProjects);
		else if (key === 'kanban') this.renderKanbanPanel(panel, tasks, this.currentProjects);
	}



	/** Render NPDP stage pipeline for selected project — compact card-style dots (like home page project card) */
	private renderStagePipeline(container: HTMLElement): void {
		const proj = this.currentProjects.find((p) => p.name === this.selectedProject);
		if (!proj || (proj.type ?? 'stage') !== 'stage') return;
		const stages = this.plugin.settings.npdpStages;
		const currentStage = proj.stage ?? 0;

		const bar = container.createDiv({ cls: 'ad-proj__stages po-stage-compact' });
		// Auto-size by stage count
		const stageMinW = Math.max(20, Math.min(36, Math.floor(160 / stages.length)));
		bar.style.gap = `${Math.max(1, Math.floor(4 / (stages.length / 4)))}px`;

		stages.forEach((label, i) => {
			const isDone = i < currentStage;
			const isCurrent = i === currentStage;
			const s = bar.createDiv({ cls: 'ad-proj__stage' + (isDone ? ' is-done' : '') + (isCurrent ? ' is-current' : '') });
			s.style.minWidth = stageMinW + 'px';
			s.createSpan({ cls: 'ad-pip' });
			s.appendText(label);

			s.addEventListener('click', () => void this.setProjectStage(proj, i));
		});
	}



	/** Set project stage and persist to project-{name}.md frontmatter */
	private async setProjectStage(proj: ProjectInfo, stage: number): Promise<void> {
		proj.stage = stage;
		// Persist stage to the project's config file (CRLF-safe)
		const folderName = proj.path.split('/').pop() || proj.name;
		const projectFilePath = `${proj.path}/project-${folderName}.md`;
		const file = this.app.vault.getAbstractFileByPath(projectFilePath);
		if (file instanceof TFile) {
			await this.writeFrontmatter(file, { '\u9636\u6BB5': String(stage) });
		}
		this.renderPanels();
		const sidebar = this.boardEl?.querySelector('.po-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderSidebar(sidebar);
		this.showToast(`\u2728 ${proj.name} \u9636\u6BB5\u5DF2\u66F4\u65B0\u4E3A "${this.plugin.settings.npdpStages[stage]}"`);
	}



	/** Render the project sidebar with filtering */
	private renderSidebar(sidebar: HTMLElement): void {
		sidebar.empty();
		const list = sidebar.createDiv({ cls: 'po-sidebar__list' });

		// "全部项目" item
		const totalTasks = this.currentProjects.reduce((s, p) => s + p.taskCount, 0);
		const totalActive = this.currentProjects.reduce((s, p) => s + p.activeCount, 0);

		const allItem = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedProject === null ? ' is-active' : '') });
		allItem.createSpan({ cls: 'po-dot', attr: { style: 'background:#7BA7FF;color:#7BA7FF' } });
		allItem.createSpan({ text: '\u5168\u90E8\u9879\u76EE' });
		allItem.createSpan({ cls: 'po-count', text: totalActive + '/' + totalTasks });
		allItem.addEventListener('click', () => {
			this.selectedProject = null;
			this.renderSidebar(sidebar);
			this.renderPanels();
		});

		// Individual projects with right-click menu
		this.currentProjects.forEach((p) => {
			const item = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedProject === p.name ? ' is-active' : '') });
			item.createSpan({ cls: 'po-dot', attr: { style: 'background:' + p.color + ';color:' + p.color } });
			item.createSpan({ text: p.name });
			item.createSpan({ cls: 'po-count', text: p.activeCount + '/' + p.taskCount });
			item.addEventListener('click', () => {
				this.selectedProject = p.name;
				this.renderSidebar(sidebar);
				this.renderPanels();
			});
			// Right-click context menu
			item.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((menuItem) => {
					menuItem.setTitle('\u7F16\u8F91\u9879\u76EE').setIcon('pencil').onClick(() => {
						void this.editProject(p);
					});
				});
				menu.addItem((menuItem) => {
					menuItem.setTitle('\u5220\u9664\u9879\u76EE').setIcon('trash').onClick(() => {
						void this.deleteProject(p, sidebar);
					});
				});
				menu.showAtMouseEvent(e);
			});
			// Drag & drop reorder
			item.draggable = true;
			item.dataset.projIdx = String(this.currentProjects.indexOf(p));
			item.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/proj-idx', String(this.currentProjects.indexOf(p)));
				item.addClass('po-sidebar__item--dragging');
			});
			item.addEventListener('dragend', () => item.removeClass('po-sidebar__item--dragging'));
			item.addEventListener('dragover', (e) => { e.preventDefault(); item.addClass('po-sidebar__item--drag-over'); });
			item.addEventListener('dragleave', () => item.removeClass('po-sidebar__item--drag-over'));
		item.addEventListener('drop', (e) => {
			e.preventDefault();
			item.removeClass('po-sidebar__item--drag-over');
			// 跨项目移动：从甘特图「任务名称」行拖来的任务
			const taskId = e.dataTransfer?.getData('text/task-id');
			if (taskId) {
				void this.moveTaskToProject(taskId, p.name, sidebar);
				return;
			}
			const fromIdx = parseInt(e.dataTransfer?.getData('text/proj-idx') || '-1');
			const toIdx = this.currentProjects.indexOf(p);
			if (fromIdx < 0 || fromIdx === toIdx) return;
		const moved = this.currentProjects.splice(fromIdx, 1)[0];
		if (moved) {
			// Account for the shift after removal: when dragging down
			// (fromIdx < toIdx) the target's index moved one left, so we
			// insert at toIdx - 1 to land in the intended slot.
			const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
			this.currentProjects.splice(insertAt, 0, moved);
		}
			this.renderSidebar(sidebar);
			this.renderPanels();
			// Persist the new project order so it survives switching views
			this.plugin.settings.poProjectOrder = this.currentProjects.map((p) => p.name);
			void this.plugin.saveSettings();
		});
		});

		// New project button
		const addBtn = sidebar.createEl('button', { cls: 'po-add-btn', text: '+ \u65B0\u5EFA\u9879\u76EE' });
		addBtn.addEventListener('click', () => {
			void this.createProjectFile();
		});

	}



	/**
	 * 把某个任务（由甘特图「任务名称」行拖来）移动到目标项目文件夹。
	 * 项目归属由文件夹决定，故用 fileManager.renameFile 搬运 .md 文件；
	 * 同步遗留的 项目: frontmatter 字段，并在同名冲突时中止。
	 */
	private async moveTaskToProject(taskId: string, targetProject: string, sidebar: HTMLElement): Promise<void> {
		const rootPath = this.plugin.settings.projectsFolder || 'Projects';
		const parts = taskId.split('/');
		const curProj = parts.length > 1 ? parts[1] : '';
		if (curProj === targetProject) { this.showToast('任务已在该项目'); return; }
		const file = this.app.vault.getAbstractFileByPath(taskId);
		if (!(file instanceof TFile)) { this.showToast('找不到任务文件'); return; }
		const fileName = parts[parts.length - 1] || '';
		const newPath = `${rootPath}/${targetProject}/${fileName}`;
		if (this.app.vault.getAbstractFileByPath(newPath)) {
			this.showToast(`目标项目已存在同名任务「${fileName}」，未移动`);
			return;
		}
		await this.app.fileManager.renameFile(file, newPath);
		// 同步遗留的 项目: 字段（若存在）
		const moved = this.app.vault.getAbstractFileByPath(newPath);
		if (moved instanceof TFile) {
			const content = await this.app.vault.read(moved);
			const fm = parseFrontmatter(content);
			if (typeof fm['项目'] === 'string' && fm['项目'] !== targetProject) {
				await this.writeFrontmatter(moved, { '项目': targetProject });
			}
		}
		this.showToast(`已移动到「${targetProject}」`);
		// 重新扫描项目与任务，刷新计数与视图
		this.currentProjects = await this.taskStore.scanAllProjects();
		this.currentTasks = await this.taskStore.scanAllTasks();
		this.applyProjectOrder();
		this.renderSidebar(sidebar);
		this.renderPanels();
	}



	/** Delete project with confirmation */
	private async deleteProject(proj: ProjectInfo, sidebar: HTMLElement): Promise<void> {
		const confirmed = confirm(`\u786E\u5B9A\u5220\u9664\u9879\u76EE "${proj.name}" \u53CA\u5176\u6240\u6709\u4EFB\u52A1\u6587\u4EF6\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002`);
		if (!confirmed) return;

		const folder = this.app.vault.getAbstractFileByPath(proj.path);
		if (folder instanceof TFolder) {
			await this.app.fileManager.trashFile(folder);
			this.showToast('\u274C \u9879\u76EE\u5DF2\u5220\u9664: ' + proj.name);
			await this.refresh();
		}
	}



	/** Sort currentProjects by the persisted sidebar order (new projects go last) */
	private applyProjectOrder(): void {
		const order = this.plugin.settings.poProjectOrder;
		if (!order || order.length === 0) return;
		this.currentProjects.sort((a, b) => {
			const ia = order.indexOf(a.name);
			const ib = order.indexOf(b.name);
			const wa = ia < 0 ? Number.MAX_SAFE_INTEGER : ia;
			const wb = ib < 0 ? Number.MAX_SAFE_INTEGER : ib;
			return wa - wb;
		});
	}



	/** Refresh project overview data and re-render */
	async refresh(): Promise<void> {
		// Only meaningful while the project overview is the active board.
		if (this.currentPage !== 'project') return;
		const projects = await this.taskStore.scanAllProjects();
		const allTasks = await this.taskStore.scanAllTasks();
		// 异步扫描期间用户可能已切页；渲染前重校验，避免把项目页内容渲染进其它页面。
		if (this.currentPage !== 'project' || !this.boardEl) return;
		this.currentProjects = projects;
		this.currentTasks = allTasks;
		this.applyProjectOrder();

		// Re-render sidebar and panels
		const sidebar = this.boardEl?.querySelector('.po-sidebar') as HTMLElement;
		if (sidebar) this.renderSidebar(sidebar);
		this.renderPanels();
	}



	/* ---- Gantt Panel (ported architecture: SVG axis + left labels / right scroll) ---- */
	private renderGanttPanel(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		// Apply Gantt status filter (multi-select) — like reference obsidian-pm FilterDropdown
		if (this.ganttStatusFilter.length > 0) {
			tasks = tasks.filter((t) => this.ganttStatusFilter.includes(t.status));
		}

		// Filter tasks that have at least one date (used only for the timeline range)
		const tasksWithDates = tasks.filter((t) => t.startDate || t.dueDate);

		if (tasks.length === 0) {
			panel.createDiv({ cls: 'po-empty', text: UI_TEXT.noTasks });
			return;
		}

		// ---------- Build parent/child hierarchy from the FULL task list ----------
		// Reference obsidian-pm builds the tree from ALL tasks, then renders. A parent
		// task without dates must still be in the tree so its children get the correct
		// indentation level — otherwise every task falls back to level 0 and nothing indents.
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		const taskByName = new Map<string, TaskItem>();
		const taskById = new Map<string, TaskItem>();
		tasks.forEach((t) => {
			taskByName.set(t.content, t);
			taskById.set(t.id, t);
		});

		const childrenOf = new Map<string, TaskItem[]>();
		const rootTasks: TaskItem[] = [];
		tasks.forEach((t) => {
			if (t.parent && (taskByName.has(t.parent) || taskById.has(t.parent))) {
				const parentTask = taskByName.get(t.parent) || taskById.get(t.parent);
				const parentKey = parentTask ? parentTask.content : t.parent;
				const children = childrenOf.get(parentKey) || [];
				children.push(t);
				childrenOf.set(parentKey, children);
			} else {
				rootTasks.push(t);
			}
		});

		// Group root tasks by left sidebar project order; time-sub-sort within each project
		const projOrder = projects.map((p) => p.name);
		const byProject: Record<string, TaskItem[]> = {};
		const ungrouped: TaskItem[] = [];
		for (const t of rootTasks) {
			const pi = projOrder.indexOf(t.projectId);
			if (pi >= 0) {
				if (!byProject[t.projectId]) byProject[t.projectId] = [];
				byProject[t.projectId]!.push(t);
			} else {
				ungrouped.push(t);
			}
		}
		const timeSort = (a: TaskItem, b: TaskItem): number => {
			const sa = a.startDate || '9999-12-31';
			const sb = b.startDate || '9999-12-31';
			if (sa !== sb) return sa.localeCompare(sb);
			const da = a.dueDate || '';
			const db = b.dueDate || '';
			if (da !== db) return da.localeCompare(db);
			return a.content.localeCompare(b.content);
		};
		// Apply manual drag order WITHIN each project group (so it never overrides the
		// required project-level grouping). Falls back to time sort when no manual order.
		const manualOrder = this.plugin.settings.poTaskOrder || [];
		const manualIdx = new Map<string, number>();
		manualOrder.forEach((id, i) => manualIdx.set(id, i));
		const groupSort = (a: TaskItem, b: TaskItem): number => {
			const ia = manualIdx.has(a.id) ? (manualIdx.get(a.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
			const ib = manualIdx.has(b.id) ? (manualIdx.get(b.id) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
			if (ia !== ib) return ia - ib;
			return timeSort(a, b);
		};
		const groupedRoots: TaskItem[] = [];
		for (const p of projOrder) {
			if (byProject[p]) groupedRoots.push(...byProject[p].slice().sort(groupSort));
		}
		groupedRoots.push(...ungrouped.slice().sort(groupSort));
		rootTasks.length = 0;
		rootTasks.push(...groupedRoots);

		// Flatten in tree order — every task gets a row; level drives label indentation.
		// Root tasks keep the project-group order built above; children are time-sorted
		// within their parent. This makes the Gantt follow the left sidebar project order
		// (and re-order when the project order changes).
		const orderedTasks: TaskItem[] = [];
		const taskLevels = new Map<string, number>();
		const flattenWithLevel = (taskList: TaskItem[], level: number): void => {
			const list = level === 0 ? taskList : [...taskList].sort(timeSort);
			for (const t of list) {
				orderedTasks.push(t);
				taskLevels.set(t.id, Math.min(level, 3));
				const kids = childrenOf.get(t.content) || [];
				// Skip children of collapsed parents (collapse/expand via arrow)
				if (kids.length && !this.collapsedParents.has(t.content)) flattenWithLevel(kids, level + 1);
			}
		};
		flattenWithLevel(rootTasks, 0);

		// Manual task order is already applied per-project-group above (groupSort), so it
		// never overrides the project-level grouping required by the sorting spec.

		// ---------- Timeline config: linear per-day width, like obsidian-pm ----------
		const granularity: 'day' | 'week' | 'month' | 'quarter' = this.ganttZoom || 'week';
		const DAY_WIDTH: Record<string, number> = { day: 36, week: 16, month: 7, quarter: 4 };
		const MIN_DAYS: Record<string, number> = { day: 30, week: 90, month: 365, quarter: 365 };
		const dayWidth = DAY_WIDTH[granularity] ?? 16;
		const HEADER_HEIGHT = 56;
		const ROW_HEIGHT = 34;

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// Raw date range from data + today + padding
	let minD = new Date('2099-12-31T00:00:00');
	let maxD = new Date('2000-01-01T00:00:00');
		tasksWithDates.forEach((t) => {
			if (t.startDate) {
				const s = new Date(t.startDate + 'T00:00:00');
				if (!isNaN(s.getTime()) && s < minD) minD = new Date(s);
			}
			if (t.dueDate) {
				const e = new Date(t.dueDate + 'T00:00:00');
				if (!isNaN(e.getTime()) && e > maxD) maxD = new Date(e);
			}
		});
		if (today < minD) minD = new Date(today);
		if (today > maxD) maxD = new Date(today);
		minD.setDate(minD.getDate() - 7);
		maxD.setDate(maxD.getDate() + 14);

		// Enforce a minimum visible span per granularity so the axis is always wide enough
		const minDaysForZoom = MIN_DAYS[granularity] ?? 30;
		let spanDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000);
		if (spanDays < minDaysForZoom) {
			const extra = Math.ceil((minDaysForZoom - spanDays) / 2);
			minD.setDate(minD.getDate() - extra);
			maxD.setDate(maxD.getDate() + extra);
		}

		// Snap the start to the 1st of the month for non-day granularities (cleaner headers)
		if (granularity !== 'day') {
			minD = new Date(minD.getFullYear(), minD.getMonth(), 1);
		}

		const totalDays = Math.round((maxD.getTime() - minD.getTime()) / 86400000);
		const totalWidth = totalDays * dayWidth;

		// date -> x (px)
		const dateToX = (d: Date): number => {
			const dd = new Date(d);
			dd.setHours(0, 0, 0, 0);
			return Math.round((dd.getTime() - minD.getTime()) / 86400000) * dayWidth;
		};
		// x (px) -> date
		const xToDate = (x: number): Date => {
			const d = new Date(minD);
			d.setDate(d.getDate() + Math.round(x / dayWidth));
			return d;
		};

		// ISO 8601 week number (1-53)
		const isoWeek = (d: Date): number => {
			const t = new Date(d);
			t.setHours(0, 0, 0, 0);
			t.setDate(t.getDate() + 4 - (t.getDay() || 7));
			const yearStart = new Date(t.getFullYear(), 0, 1);
			return Math.ceil((((t.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
		};

		// ---------- SVG helper ----------
		const SVGNS = 'http://www.w3.org/2000/svg';
		const svgEl = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
			const el = document.createElementNS(SVGNS, tag);
			for (const k in attrs) el.setAttribute(k, String(attrs[k]));
			return el;
		};
		const svgText = (x: number, y: number, text: string, cls: string): SVGTextElement => {
			const t = svgEl('text', { x, y, class: cls }) as SVGTextElement;
			t.textContent = text;
			return t;
		};

		// ---------- DOM scaffold ----------
		const zoomBar = panel.createDiv({ cls: 'po-gantt__zoom' });
		const zoomLevels: Array<{ key: string; label: string }> = [
			{ key: 'day', label: '日' },
			{ key: 'week', label: '周' },
			{ key: 'month', label: '月' },
			{ key: 'quarter', label: '季度' },
		];
		zoomLevels.forEach((z) => {
			const btn = zoomBar.createEl('button', { cls: 'po-gantt__zoom-btn' + (z.key === granularity ? ' is-active' : ''), text: z.label });
			btn.addEventListener('click', () => {
				this.ganttZoom = z.key as typeof this.ganttZoom;
				// 持久化用户选择的时间粒度，重启插件后保持
				this.plugin.settings.poGanttScale = this.ganttZoom;
				void this.plugin.saveSettings();
				panel.empty();
				this.renderGanttPanel(panel, tasks, projects);
			});
		});

		// Status filter (multi-select) — modeled on reference obsidian-pm FilterDropdown
		zoomBar.createSpan({ cls: 'po-gantt__sep' });
		const filterBtn = zoomBar.createEl('button', { cls: 'po-gantt__zoom-btn' + (this.ganttStatusFilter.length ? ' is-active' : '') });
		const updateFilterLabel = (): void => {
			filterBtn.textContent = this.ganttStatusFilter.length ? `状态: ${this.ganttStatusFilter.length}` : '状态筛选';
			filterBtn.toggleClass('is-active', this.ganttStatusFilter.length > 0);
		};
		updateFilterLabel();
		filterBtn.addEventListener('click', (e) => {
			const menu = new Menu();
			for (const st of STATUS_LIST) {
				menu.addItem((item) => item
					.setTitle(st)
					.setChecked(this.ganttStatusFilter.includes(st))
					.onClick(() => {
					const idx = this.ganttStatusFilter.indexOf(st);
					if (idx >= 0) this.ganttStatusFilter.splice(idx, 1);
					else this.ganttStatusFilter.push(st);
					updateFilterLabel();
					this.plugin.settings.poGanttStatusFilter = [...this.ganttStatusFilter];
					void this.plugin.saveSettings();
					this.renderPanels();
				}));
			}
			if (this.ganttStatusFilter.length) {
				menu.addSeparator();
				menu.addItem((item) => item.setTitle('清除筛选').onClick(() => {
				this.ganttStatusFilter.length = 0;
				updateFilterLabel();
				this.plugin.settings.poGanttStatusFilter = [];
				void this.plugin.saveSettings();
				this.renderPanels();
				}));
			}
			menu.showAtMouseEvent(e);
		});

		const gantt = panel.createDiv({ cls: 'po-gantt' });
		const wrapper = gantt.createDiv({ cls: 'po-gantt__wrap' });

		// Left panel: task labels
		const left = wrapper.createDiv({ cls: 'po-gantt__left' });
		const leftHeader = left.createDiv({ cls: 'po-gantt__left-hd' });
		leftHeader.style.height = HEADER_HEIGHT + 'px';
		leftHeader.createSpan({ text: UI_TEXT.poTaskName, cls: 'po-gantt__left-hd-label' });
		const leftBody = left.createDiv({ cls: 'po-gantt__left-body' });

		// Right panel: scrollable SVG timeline
		const right = wrapper.createDiv({ cls: 'po-gantt__right' });

		// Sticky header (SVG) — pinned to top on vertical scroll, scrolls horizontally with body
		const headerSticky = right.createDiv({ cls: 'po-gantt__hdr-sticky' });
		headerSticky.style.width = totalWidth + 'px';
		headerSticky.style.height = HEADER_HEIGHT + 'px';
		const headerSvg = svgEl('svg', { width: totalWidth, height: HEADER_HEIGHT, class: 'po-gantt__hdr-svg' }) as SVGSVGElement;
		headerSticky.appendChild(headerSvg);

		// Timeline SVG — tucked under the sticky header via negative margin-top
		const svgWrap = right.createDiv({ cls: 'po-gantt__svgwrap' });
		svgWrap.style.width = totalWidth + 'px';
		svgWrap.style.marginTop = `-${HEADER_HEIGHT}px`;
		const totalRows = orderedTasks.length;
		const svgHeight = HEADER_HEIGHT + (totalRows + 1) * ROW_HEIGHT;
		const svg = svgEl('svg', { width: totalWidth, height: svgHeight, class: 'po-gantt__svg' }) as SVGSVGElement;
		svgWrap.appendChild(svg);

		// ---------- Header rendering ----------
		headerSvg.appendChild(svgEl('rect', { x: 0, y: 0, width: totalWidth, height: HEADER_HEIGHT, class: 'po-gantt__hdr-bg' }));

		const renderMonthBands = (y: number, h: number): void => {
			let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
			while (m < maxD) {
				const nm = new Date(m.getFullYear(), m.getMonth() + 1, 1);
				const x1 = Math.max(0, dateToX(m));
				const x2 = Math.min(totalWidth, dateToX(nm));
				headerSvg.appendChild(svgEl('rect', {
					x: x1, y, width: Math.max(0, x2 - x1), height: h,
					class: (m.getMonth() % 2 === 0) ? 'po-gantt__band-even' : 'po-gantt__band-odd',
				}));
				headerSvg.appendChild(svgText(x1 + 6, y + h - 7, (m.getMonth() + 1) + '月', 'po-gantt__hdr-month-top'));
				m = nm;
			}
		};
		const renderYearBands = (y: number, h: number): void => {
			let yd = new Date(minD.getFullYear(), 0, 1);
			while (yd < maxD) {
				const ny = new Date(yd.getFullYear() + 1, 0, 1);
				const x1 = Math.max(0, dateToX(yd));
				const x2 = Math.min(totalWidth, dateToX(ny));
				headerSvg.appendChild(svgEl('rect', {
					x: x1, y, width: Math.max(0, x2 - x1), height: h,
					class: (yd.getFullYear() % 2 === 0) ? 'po-gantt__band-even' : 'po-gantt__band-odd',
				}));
				headerSvg.appendChild(svgText(x1 + 6, y + h - 7, String(yd.getFullYear()), 'po-gantt__hdr-year'));
				yd = ny;
			}
		};

		if (granularity === 'day') {
			renderMonthBands(0, 24);
			for (let i = 0; i < totalDays; i++) {
				const d = new Date(minD); d.setDate(d.getDate() + i);
				const x = i * dayWidth;
				const isWeekend = d.getDay() === 0 || d.getDay() === 6;
				if (isWeekend) {
					headerSvg.appendChild(svgEl('rect', { x, y: 24, width: dayWidth, height: HEADER_HEIGHT - 24, class: 'po-gantt__hdr-weekend' }));
				}
				if (dayWidth >= 20) {
					headerSvg.appendChild(svgText(x + dayWidth / 2, 42, String(d.getDate()), 'po-gantt__hdr-day'));
				}
			}
		} else if (granularity === 'week') {
			renderMonthBands(0, 24);
			const nativeDow = minD.getDay();
			const isoDow = nativeDow === 0 ? 7 : nativeDow;
			const offsetToMonday = isoDow === 1 ? 0 : 8 - isoDow;
			if (offsetToMonday > 0) {
				headerSvg.appendChild(svgText((offsetToMonday * dayWidth) / 2, 44, 'W' + isoWeek(minD), 'po-gantt__hdr-week'));
			}
			let i = offsetToMonday;
			while (i < totalDays) {
				const d = new Date(minD); d.setDate(d.getDate() + i);
				const x = i * dayWidth;
				const daysInWeek = Math.min(7, totalDays - i);
				const w = daysInWeek * dayWidth;
				headerSvg.appendChild(svgText(x + w / 2, 44, 'W' + isoWeek(d), 'po-gantt__hdr-week'));
				headerSvg.appendChild(svgEl('line', { x1: x, y1: 24, x2: x, y2: HEADER_HEIGHT, class: 'po-gantt__hdr-tick' }));
				i += 7;
			}
		} else if (granularity === 'month') {
			renderYearBands(0, 24);
			let m = new Date(minD.getFullYear(), minD.getMonth(), 1);
			while (m < maxD) {
				const nm = new Date(m.getFullYear(), m.getMonth() + 1, 1);
				const x1 = Math.max(0, dateToX(m));
				const x2 = Math.min(totalWidth, dateToX(nm));
				headerSvg.appendChild(svgText(x1 + (x2 - x1) / 2, 44, (m.getMonth() + 1) + '月', 'po-gantt__hdr-month'));
				headerSvg.appendChild(svgEl('line', { x1, y1: 24, x2: x1, y2: HEADER_HEIGHT, class: 'po-gantt__hdr-tick' }));
				m = nm;
			}
		} else {
			renderYearBands(0, 24);
			let q = new Date(minD.getFullYear(), Math.floor(minD.getMonth() / 3) * 3, 1);
			while (q < maxD) {
				const nq = new Date(q.getFullYear(), q.getMonth() + 3, 1);
				const x1 = Math.max(0, dateToX(q));
				const x2 = Math.min(totalWidth, dateToX(nq));
				const qq = Math.floor(q.getMonth() / 3) + 1;
				headerSvg.appendChild(svgText(x1 + (x2 - x1) / 2, 44, 'Q' + qq + ' ' + q.getFullYear(), 'po-gantt__hdr-quarter'));
				headerSvg.appendChild(svgEl('line', { x1, y1: 24, x2: x1, y2: HEADER_HEIGHT, class: 'po-gantt__hdr-tick' }));
				q = nq;
			}
		}

		// ---------- Grid lines + weekend shading ----------
		for (let i = 0; i < totalDays; i++) {
			const d = new Date(minD); d.setDate(d.getDate() + i);
			const x = i * dayWidth;
			const isWeekend = d.getDay() === 0 || d.getDay() === 6;
			const isFirst = d.getDate() === 1;
			const isQuarterStart = isFirst && d.getMonth() % 3 === 0;

			if (isWeekend && granularity === 'day') {
				svg.appendChild(svgEl('rect', { x, y: HEADER_HEIGHT, width: dayWidth, height: svgHeight - HEADER_HEIGHT, class: 'po-gantt__weekend' }));
			}
			const drawV = (granularity === 'day' && (d.getDay() === 1)) ||
				(granularity === 'week' && (d.getDay() === 1)) ||
				(granularity === 'month' && isFirst) ||
				(granularity === 'quarter' && isQuarterStart);
			if (drawV) {
				svg.appendChild(svgEl('line', { x1: x, y1: HEADER_HEIGHT, x2: x, y2: svgHeight, class: 'po-gantt__gridline-v' }));
			}
		}
		for (let r = 0; r <= totalRows; r++) {
			const y = HEADER_HEIGHT + r * ROW_HEIGHT;
			svg.appendChild(svgEl('line', { x1: 0, y1: y, x2: totalWidth, y2: y, class: 'po-gantt__gridline-h' }));
		}

		// ---------- Today line ----------
		const todayX = dateToX(today);
		if (todayX >= 0 && todayX <= totalWidth) {
			svg.appendChild(svgEl('line', { x1: todayX, y1: HEADER_HEIGHT - 8, x2: todayX, y2: svgHeight, class: 'po-gantt__today' }));
			headerSvg.appendChild(svgEl('polygon', {
				points: `${todayX},${HEADER_HEIGHT - 16} ${todayX + 6},${HEADER_HEIGHT - 8} ${todayX},${HEADER_HEIGHT} ${todayX - 6},${HEADER_HEIGHT - 8}`,
				class: 'po-gantt__today-diamond',
			}));
		}

		// ---------- Tooltip ----------
		const tooltip = panel.createDiv({ cls: 'po-gantt__tooltip' });

		// ---------- Task bars (SVG rects) + left labels ----------
		const bars: SVGElement[] = [];
		const labelRows: HTMLElement[] = [];
		orderedTasks.forEach((t, idx) => {
			const level = taskLevels.get(t.id) || 0;
			const isParent = childrenOf.has(t.content);
			const color = colorMap[t.projectId] || '#3b82f6';

			// Left label row (indentation by depth)
			const lr = leftBody.createDiv({ cls: 'po-gantt__label-row' + (level > 0 ? ' po-gantt__label-row--child' : '') });
			lr.style.height = ROW_HEIGHT + 'px';
			lr.style.paddingLeft = (level * 18 + 8) + 'px';
			lr.dataset.taskId = t.id;
			if (isParent) {
				const collapsed = this.collapsedParents.has(t.content);
				const dot = lr.createSpan({ cls: 'po-gantt__label-dot', text: collapsed ? '▸' : '▾' });
				dot.addEventListener('click', (e) => {
					e.stopPropagation();
					if (collapsed) this.collapsedParents.delete(t.content);
					else this.collapsedParents.add(t.content);
					panel.empty();
					this.renderGanttPanel(panel, tasks, projects);
				});
			}
			lr.createSpan({ cls: 'po-gantt__label-title', text: t.content });
			const addBtn = lr.createSpan({ cls: 'po-gantt__label-add', text: '+' });
			addBtn.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.openTaskModalWithParent(t.content, t.projectId);
			});
			lr.addEventListener('click', () => this.openTaskEditModal(t));
			// Right-click context menu: edit / delete
			lr.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				const menu = new Menu();
				menu.addItem((item) => {
					item.setTitle(UI_TEXT.taskDetail).setIcon('pencil').onClick(() => this.openTaskEditModal(t));
				});
				menu.addItem((item) => {
					item.setTitle('删除任务').setIcon('trash').onClick(() => void this.deleteTask(t));
				});
				menu.showAtMouseEvent(e);
			});

			// Drag to reorder task rows (persisted)
			lr.draggable = true;
			lr.addEventListener('dragstart', (e) => {
				e.dataTransfer?.setData('text/task-id', t.id);
				lr.addClass('po-row--dragging');
			});
			lr.addEventListener('dragend', () => lr.removeClass('po-row--dragging'));
			lr.addEventListener('dragover', (e) => { e.preventDefault(); lr.addClass('po-row--drag-over'); });
			lr.addEventListener('dragleave', () => lr.removeClass('po-row--drag-over'));
			lr.addEventListener('drop', (e) => {
				e.preventDefault();
				lr.removeClass('po-row--drag-over');
				const draggedId = e.dataTransfer?.getData('text/task-id');
				if (!draggedId || draggedId === t.id) return;
				const rows = Array.from(leftBody.querySelectorAll<HTMLElement>('.po-gantt__label-row'));
				const ids = rows.map((r) => r.dataset.taskId).filter((id): id is string => !!id);
				const from = ids.indexOf(draggedId);
				const to = ids.indexOf(t.id);
				if (from < 0 || to < 0) return;
			ids.splice(from, 1);
			ids.splice(from < to ? to - 1 : to, 0, draggedId);
				this.plugin.settings.poTaskOrder = ids;
				void this.plugin.saveSettings();
				this.renderPanels();
			});

			labelRows.push(lr);

		// Bar
		if (!t.startDate && !t.dueDate) return;
		const startDate = t.startDate ? new Date(t.startDate + 'T00:00:00') : new Date(t.dueDate! + 'T00:00:00');
		const endDate = t.dueDate ? new Date(t.dueDate + 'T00:00:00') : new Date(startDate);
		if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return;
		const x = dateToX(startDate);
		const xEnd = dateToX(new Date(endDate.getTime() + 86400000));
		const width = Math.max(2, xEnd - x);
		const barY = HEADER_HEIGHT + idx * ROW_HEIGHT + 8;
		const barH = ROW_HEIGHT - 16;
		const barCls = 'po-gantt__bar' + (t.status === '已完成' ? ' is-completed' : '') +
			(isParent ? ' po-gantt__bar--parent' : '') + (level > 0 ? ' po-gantt__bar--child' : '');
		const bar = svgEl('rect', {
			x, y: barY, width, height: barH, rx: 4, class: barCls,
		}) as SVGRectElement;
		bar.setAttribute('fill', color);
		bar.dataset.taskId = t.id;
		(bar as SVGElement & { _dragged?: boolean })._dragged = false;
		if (t.startDate && t.dueDate) bar.classList.add('po-gantt__bar--movable');
		bars.push(bar);

		// Group wraps bar + edge handles so the hover hint reveals them together
		const group = svgEl('g', { class: 'po-gantt__bar-group' }) as SVGGElement;
		group.appendChild(bar);

		const HANDLE_W = 8;
		let leftHandle: SVGRectElement | null = null;
		let rightHandle: SVGRectElement | null = null;

		// Shared drag starter: side = 'left'|'right' resize edges, 'move' whole bar.
		// Bar + both edge handles are repositioned together during drag so the
		// transparent handles always track the block (no snapping on release).
		const beginDrag = (b: SVGRectElement, side: 'left' | 'right' | 'move', e: MouseEvent): void => {
			e.preventDefault();
			if (side !== 'move') e.stopPropagation();
			const startX = e.clientX;
			const origX = parseFloat(b.getAttribute('x') || '0');
			const origW = parseFloat(b.getAttribute('width') || '0');
			let moved = false;
			b.classList.add('po-gantt__bar--grabbing');
			const syncHandles = (): void => {
				const cx = parseFloat(b.getAttribute('x') || '0');
				const cw = parseFloat(b.getAttribute('width') || '0');
				if (leftHandle) leftHandle.setAttribute('x', String(cx));
				if (rightHandle) rightHandle.setAttribute('x', String(cx + cw - HANDLE_W));
			};
			const onMove = (e2: MouseEvent) => {
				const dx = e2.clientX - startX;
				if (Math.abs(dx) < 3) return;
				moved = true;
				if (side === 'left') {
					const nx = Math.max(0, origX + dx);
					const nw = origW - (nx - origX);
					if (nw >= dayWidth) { b.setAttribute('x', String(nx)); b.setAttribute('width', String(nw)); }
				} else if (side === 'right') {
					b.setAttribute('width', String(Math.max(dayWidth, origW + dx)));
				} else {
					b.setAttribute('x', String(origX + dx));
				}
				syncHandles();
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				b.classList.remove('po-gantt__bar--grabbing');
				if (!moved) return;
				(b as SVGElement & { _dragged?: boolean })._dragged = true;
				tooltip.removeClass('is-visible');
				const nx = parseFloat(b.getAttribute('x') || '0');
				const nw = parseFloat(b.getAttribute('width') || '0');
				const startD = xToDate(nx);
				const endD = xToDate(nx + nw);
				endD.setDate(endD.getDate() - 1); // inclusive end day
				void this.updateTaskDates(t, fmtDate(startD), fmtDate(endD));
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		};

		// Edge resize handles (hover hint + drag). Only rendered when wide enough to avoid overlap.
		if (width > HANDLE_W * 2) {
			for (const side of ['left', 'right'] as const) {
				const hx = side === 'left' ? x : x + width - HANDLE_W;
				const handle = svgEl('rect', {
					x: hx, y: barY, width: HANDLE_W, height: barH, rx: 3, class: 'po-gantt__bar-handle',
				}) as SVGRectElement;
				handle.addEventListener('mousedown', (e) => beginDrag(bar, side, e));
				group.appendChild(handle);
				if (side === 'left') leftHandle = handle; else rightHandle = handle;
			}
		}

		// Tooltip on hover
		bar.addEventListener('mouseenter', (e: MouseEvent) => {
			const prioLabel = t.priority || UI_TEXT.notSet;
			tooltip.empty();
			tooltip.createEl('strong', { text: t.content });
			tooltip.createEl('br');
			tooltip.appendText((t.startDate || '?') + ' → ' + (t.dueDate || '?'));
			tooltip.createEl('br');
			tooltip.appendText(prioLabel + ' · ' + t.status);
			tooltip.addClass('is-visible');
			this.positionTooltip(tooltip, e);
		});
		bar.addEventListener('mousemove', (e: MouseEvent) => this.positionTooltip(tooltip, e));
		bar.addEventListener('mouseleave', () => tooltip.removeClass('is-visible'));

		// Click: edit + link highlight
		bar.addEventListener('click', () => {
			if ((bar as SVGElement & { _dragged?: boolean })._dragged) {
				(bar as SVGElement & { _dragged?: boolean })._dragged = false;
				return;
			}
			this.openTaskEditModal(t);
			this.clearHighlights(bars, tableResult.rows);
			if (tableResult.rows[idx]) {
				tableResult.rows[idx].addClass('po-row--highlight');
				tableResult.rows[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
				this.highlightedRow = tableResult.rows[idx];
			}
			bar.classList.add('po-bar--highlight');
			this.highlightedBar = bar;
		});

		// Drag whole bar to move (edge resize is handled by the handles above)
		bar.addEventListener('mousedown', (e: MouseEvent) => beginDrag(bar, 'move', e));

		svg.appendChild(group);
		});

		// ---------- Scroll sync (right <-> left) ----------
		const syncSpacer = (): void => {
			const hBar = right.offsetHeight - right.clientHeight;
			leftBody.style.paddingBottom = hBar + 'px';
		};
		right.addEventListener('scroll', () => {
			syncSpacer();
			leftBody.scrollTop = right.scrollTop;
		});
		left.addEventListener('wheel', (e: WheelEvent) => {
			right.scrollTop += e.deltaY;
			right.scrollLeft += e.deltaX;
			e.preventDefault();
		}, { passive: false });

		// ---------- Center today line on load ----------
		const scrollToToday = (): void => {
			if (!right.clientWidth) return;
			right.scrollLeft = Math.max(0, todayX - right.clientWidth / 2);
		};
		window.requestAnimationFrame(() => {
			syncSpacer();
			scrollToToday();
		});

		// ---------- Resize handle + task table (kept from original) ----------
		const resizeHandle = panel.createDiv({ cls: 'po-resize' });
		this.setupResizeHandle(resizeHandle, gantt);

		const tableResult = this.renderTaskTable(panel, 'po-tb1', tasks, projects);

		// 行点击 → 高亮对应甘特条（事件委托，兼容窗口化渲染）
		tableResult.tbody.addEventListener('click', (e) => {
			const tr = (e.target as HTMLElement).closest('tr') as HTMLElement;
			const idxStr = tr?.dataset.origIndex;
			if (idxStr === undefined) return;
			const idx = Number(idxStr);
			this.clearHighlights(bars, tableResult.rows);
			if (bars[idx]) {
				bars[idx].classList.add('po-bar--highlight');
				this.highlightedBar = bars[idx];
			}
			tr.addClass('po-row--highlight');
			this.highlightedRow = tr;
		});
	}



	private positionTooltip(tooltip: HTMLElement, e: MouseEvent): void {
		const parent = tooltip.parentElement;
		if (!parent) return;
		const rect = parent.getBoundingClientRect();
		tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
		tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
	}



	private clearHighlights(bars: Element[], rows: (HTMLElement | null)[]): void {
		if (this.highlightedBar) { this.highlightedBar.classList.remove('po-bar--highlight'); this.highlightedBar = null; }
		if (this.highlightedRow) { this.highlightedRow.removeClass('po-row--highlight'); this.highlightedRow = null; }
		bars.forEach((b) => b.classList.remove('po-bar--highlight'));
		rows.forEach((r) => r?.removeClass('po-row--highlight'));
	}



	private setupResizeHandle(handle: HTMLElement, gantt: HTMLElement): void {
		let startY = 0;
		let startH = 0;
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			startY = e.clientY;
			startH = gantt.offsetHeight;
			const onMove = (ev: MouseEvent) => {
				const dh = ev.clientY - startY;
				gantt.addClass('po-gantt--resized');
				gantt.style.height = Math.max(100, startH + dh) + 'px';
			};
			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}



	/** Update task start/due dates in source file (unified writer: CRLF-safe + value escaping) */
	private async updateTaskDates(task: TaskItem, newStart: string, newEnd: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		await this.writeFrontmatter(file, {
			'\u5F00\u59CB\u65E5\u671F': newStart,
			'\u622A\u6B62\u65E5\u671F': newEnd,
		});
		task.startDate = newStart;
		task.dueDate = newEnd;
	}	private renderTaskTable(panel: HTMLElement, tbodyId: string, tasks: TaskItem[], projects: ProjectInfo[]): { tbody: HTMLElement; rows: (HTMLElement | null)[] } {
		const section = panel.createDiv({ cls: 'po-tasklist' });
		const toolbar = section.createDiv({ cls: 'po-toolbar' });
		toolbar.createSpan({ cls: 'po-toolbar__label', text: UI_TEXT.filter });
		[UI_TEXT.all, '待办', '进行中', '已阻塞', '已完成'].forEach((f, i) => {
			const key = i === 0 ? 'all' : f;
			const chip = toolbar.createEl('button', { cls: 'po-chip' + (key === this.taskListFilter ? ' is-active' : ''), text: f });
			chip.dataset.filter = key;
		});

		const wrap = section.createDiv({ cls: 'po-table-wrap' });
		const table = wrap.createEl('table', { cls: 'po-table' });
		const thead = table.createEl('thead');
		const hr = thead.createEl('tr');
		const colDefs = [
			{ key: '', label: '' },
			{ key: 'name', label: UI_TEXT.poTaskName },
			{ key: 'priority', label: UI_TEXT.poPriority },
			{ key: 'startDate', label: UI_TEXT.poStart },
			{ key: 'dueDate', label: UI_TEXT.poDue },
			{ key: 'status', label: UI_TEXT.poStatus },
			{ key: 'project', label: UI_TEXT.poProject },
		];

		const thEls: HTMLElement[] = [];
		colDefs.forEach((col) => {
			const th = hr.createEl('th', { text: col.label });
			th.dataset.sortKey = col.key;
			thEls.push(th);
			if (col.key) {
				th.addClass('po-th--sortable');
				th.createSpan({ cls: 'po-sort-arrow' });
			}
		});

		const tbody = table.createEl('tbody');
		tbody.id = tbodyId;

		// Sort tasks
		let sortedTasks = [...tasks];
		const applySort = () => {
			if (!this.sortCol) { sortedTasks = [...tasks]; return; }
			sortedTasks = [...tasks].sort((a, b) => {
				let va = '', vb = '';
				switch (this.sortCol) {
					case 'name': va = a.content; vb = b.content; break;
					case 'priority': va = String(priorityWeight(a.priority)); vb = String(priorityWeight(b.priority)); break;
					case 'startDate': va = a.startDate || 'zzz'; vb = b.startDate || 'zzz'; break;
					case 'dueDate': va = a.dueDate || 'zzz'; vb = b.dueDate || 'zzz'; break;
					case 'status': va = a.status; vb = b.status; break;
					case 'project': va = a.projectId; vb = b.projectId; break;
				}
				const cmp = va.localeCompare(vb, 'zh-CN');
				return this.sortDir === 'asc' ? cmp : -cmp;
			});
		};
		applySort();

		// ---- 窗口化渲染：只创建可视区行，避免上千任务一次性渲染全部 DOM ----
		const FILTER_KEYS: Record<string, (st: string) => boolean> = {
			'all': () => true,
			'待办': (st) => st === '待办',
			'进行中': (st) => st === '进行中',
			'已阻塞': (st) => st === '已阻塞',
			'已完成': (st) => st === '已完成',
		};
		const ROW_HEIGHT_FALLBACK = 33;
		const OVERSCAN = 10;
		let rowHeight = ROW_HEIGHT_FALLBACK;
		let rowHeightMeasured = false;
		// 可见项 = 过滤后的任务；orig 保留在原 sortedTasks 中的下标，供与甘特条按索引联动
		let visible = filterWithOrig(sortedTasks, (t) => FILTER_KEYS[this.taskListFilter]?.(t.status) ?? true);
		// 全量行槽位（null = 未挂载），供甘特点击回链高亮
		const rows: (HTMLElement | null)[] = new Array<HTMLElement | null>(sortedTasks.length).fill(null);
		let lastRendered: number[] = [];

		const renderWindow = (): void => {
			const win = computeWindow({
				scrollTop: wrap.scrollTop,
				viewportHeight: wrap.clientHeight,
				rowHeight,
				total: visible.items.length,
				overscan: OVERSCAN,
			});
			for (const o of lastRendered) rows[o] = null;
			lastRendered = [];
			tbody.empty();
			if (win.end > win.start) {
				const mkSpacer = (h: number): HTMLTableRowElement => {
					const tr = tbody.createEl('tr');
				const td = tr.createEl('td', { cls: 'po-spacer-cell' });
				td.colSpan = colDefs.length;
				td.style.height = h + 'px';
				return tr;
				};
				mkSpacer(win.start * rowHeight);
				for (let v = win.start; v < win.end; v++) {
					const o = visible.orig[v];
					if (o === undefined) continue;
					const task = visible.items[v];
				if (!task) continue;
				const tr = this.buildPoRow(tbody, task, projects, o);
					rows[o] = tr;
					lastRendered.push(o);
				}
				mkSpacer((visible.items.length - win.end) * rowHeight);
			}
			if (!rowHeightMeasured) {
				const first = tbody.querySelector('tr.po-data-row');
				if (first) {
					const h = (first as HTMLElement).offsetHeight;
					if (h > 0) {
						rowHeight = h;
						rowHeightMeasured = true;
						renderWindow();
					}
				}
			}
		};
		renderWindow();
		// 布局完成后以真实可视高度重算一次窗口
		window.requestAnimationFrame(() => renderWindow());

		// 滚动 → 重算窗口（rAF 节流）
		let scrollRaf = 0;
		wrap.addEventListener('scroll', () => {
			if (scrollRaf) return;
			scrollRaf = window.requestAnimationFrame(() => {
				scrollRaf = 0;
				renderWindow();
			});
		});

		// Sort click
		thead.addEventListener('click', (e) => {
			const th = (e.target as HTMLElement).closest('th') as HTMLElement;
			if (!th?.dataset.sortKey) return;
			const key = th.dataset.sortKey;
			if (this.sortCol === key) {
				this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
			} else {
				this.sortCol = key;
				this.sortDir = 'asc';
			}
			thEls.forEach((h) => {
				const arrow = h.querySelector('.po-sort-arrow');
				if (arrow) arrow.textContent = '';
			});
			const arrow = th.querySelector('.po-sort-arrow');
			if (arrow) arrow.textContent = this.sortDir === 'asc' ? ' ↑' : ' ↓';

			applySort();
			visible = filterWithOrig(sortedTasks, (t) => FILTER_KEYS[this.taskListFilter]?.(t.status) ?? true);
			wrap.scrollTop = 0;
			renderWindow();
		});

		// Filter click
		toolbar.addEventListener('click', (e) => {
			const chip = (e.target as HTMLElement).closest('.po-chip') as HTMLElement;
			if (!chip) return;
			toolbar.querySelectorAll('.po-chip').forEach((c) => c.removeClass('is-active'));
			chip.addClass('is-active');
			this.taskListFilter = chip.dataset.filter ?? 'all';
			visible = filterWithOrig(sortedTasks, (t) => FILTER_KEYS[this.taskListFilter]?.(t.status) ?? true);
			wrap.scrollTop = 0;
			renderWindow();
		});

		return { tbody, rows };
	}

	/** 构建单行（窗口化渲染按需调用）。origIndex 为该行在完整任务列表中的下标（与甘特条联动）。 */
	private buildPoRow(tbody: HTMLElement, t: TaskItem, projects: ProjectInfo[], origIndex: number): HTMLElement {
		const statusMap: Record<string, string> = { '待办':'po-todo', '进行中':'po-progress', '已阻塞':'po-blocked', '已完成':'po-done', '已取消':'po-cancelled' };
		const prioMap: Record<string, string> = { '重要且紧急':'po-p-high', '重要不紧急':'po-p-med', '紧急不重要':'po-p-med', '不重要不紧急':'po-p-low' };
		const prioShort: Record<string, string> = { '重要且紧急':'高', '重要不紧急':'中', '紧急不重要':'中', '不重要不紧急':'低' };

		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		const tr = tbody.createEl('tr');
		tr.addClass('po-data-row');
		tr.dataset.taskId = t.id;
		tr.dataset.status = t.status;
		tr.dataset.origIndex = String(origIndex);

		// Checkbox
		const tdCb = tr.createEl('td');
		const cb = tdCb.createSpan({ cls: 'po-check' + (t.status === '已完成' ? ' is-done' : '') });
		cb.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.toggleTask(t, tr);
		});

		// Task name (clickable to edit)
		const nameEl = tr.createEl('td', { text: t.content, cls: 'po-name-cell' });
		nameEl.addEventListener('click', () => {
			this.openTaskEditModal(t);
		});

		// Priority
		const tdPrio = tr.createEl('td');
		if (t.priority) tdPrio.createSpan({ cls: 'po-prio ' + (prioMap[t.priority] || ''), text: prioShort[t.priority] || t.priority });

		// Start date
		tr.createEl('td', { cls: 'po-mono', text: t.startDate || '-' });

		// Due date
		tr.createEl('td', { cls: 'po-mono', text: t.dueDate || '-' });

		// Status
		const tdSt = tr.createEl('td');
		tdSt.createSpan({ cls: 'po-status ' + (statusMap[t.status] || ''), text: t.status });

		// Project
		const tdProj = tr.createEl('td');
		const projColor = colorMap[t.projectId] || '#3b82f6';
		tdProj.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + projColor } });
		tdProj.appendText(t.projectId);

		// Right-click context menu
		tr.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => {
				item.setTitle(UI_TEXT.edit).setIcon('pencil').onClick(() => this.openTaskEditModal(t));
			});
			menu.addItem((item) => {
				item.setTitle(UI_TEXT.delete).setIcon('trash').onClick(() => void this.deleteTask(t));
			});
			menu.addItem((item) => {
				item.setTitle(UI_TEXT.openSource).setIcon('file-text').onClick(() => {
					if (t.sourceFile) void this.app.workspace.openLinkText(t.sourceFile, '', true);
				});
			});
			menu.showAtMouseEvent(e);
		});
		return tr;
	}




	/* ---- Calendar Panel ---- */
	private renderCalendarPanel(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		const grid = panel.createDiv({ cls: 'po-cal' });

		// Build project color lookup
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		const today = new Date();
		const todayStr = fmtDate(today);

		// Use calYear/calMonth state
		const renderMonth = () => {
			grid.empty();
			const y = this.calYear, m = this.calMonth;
			const dim = new Date(y, m + 1, 0).getDate();
			const fd = new Date(y, m, 1).getDay();
			const adj = fd === 0 ? 6 : fd - 1;

			// Header with navigation
			const header = grid.createDiv({ cls: 'po-cal__header' });
			header.createSpan({ cls: 'po-cal__title', text: y + '\u5E74' + (m + 1) + '\u6708' });
			const nav = header.createDiv({ cls: 'po-cal__nav' });
			const prevBtn = nav.createEl('button', { cls: 'po-cal__btn', text: '\u2190' });
			const todayBtn = nav.createEl('button', { cls: 'po-cal__btn', text: '\u4ECA\u5929' });
			const nextBtn = nav.createEl('button', { cls: 'po-cal__btn', text: '\u2192' });

			prevBtn.addEventListener('click', () => {
				this.calMonth--;
				if (this.calMonth < 0) { this.calMonth = 11; this.calYear--; }
				renderMonth();
			});
			nextBtn.addEventListener('click', () => {
				this.calMonth++;
				if (this.calMonth > 11) { this.calMonth = 0; this.calYear++; }
				renderMonth();
			});
			todayBtn.addEventListener('click', () => {
				this.calYear = today.getFullYear();
				this.calMonth = today.getMonth();
				renderMonth();
			});

			// Weekdays
			const weekdays = grid.createDiv({ cls: 'po-cal__weekdays' });
			['\u4E00', '\u4E8C', '\u4E09', '\u56DB', '\u4E94', '\u516D', '\u65E5'].forEach((d) => weekdays.createSpan({ text: d }));

			// Days
			const days = grid.createDiv({ cls: 'po-cal__days' });
			for (let i = 0; i < adj; i++) days.createDiv({ cls: 'po-cal__day' });
			for (let d = 1; d <= dim; d++) {
				const ds = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
				const isToday = ds === todayStr;
				const dayTasks = tasks.filter((t) => {
					const effectiveDate = t.remindDate || t.dueDate;
					return effectiveDate === ds || t.startDate === ds;
				});
				const hasOverdue = dayTasks.some((t) => t.status !== '\u5DF2\u5B8C\u6210' && t.status !== '\u5DF2\u53D6\u6D88' && t.dueDate && new Date(t.dueDate) < today);
				const cls = 'po-cal__day' + (isToday ? ' is-today' : '') +
					(dayTasks.length ? (hasOverdue ? ' has-overdue has-tasks' : ' has-tasks') : '');
				const dayEl = days.createDiv({ cls, attr: { 'data-date': ds } });
				dayEl.createSpan({ cls: 'po-cal__day-num', text: String(d) });
				// Show up to 3 task names inside the cell
				const shown = dayTasks.slice(0, 3);
				shown.forEach((t) => {
					const taskEl = dayEl.createDiv({ cls: 'po-cal__day-task', text: t.content });
					taskEl.style.color = t.status === '\u5DF2\u5B8C\u6210' ? 'var(--ad-text-dim)' : '';
				});
				if (dayTasks.length > 3) {
					dayEl.createDiv({ cls: 'po-cal__day-more', text: '+' + (dayTasks.length - 3) });
				}
			}

			// Preview area
			const preview = grid.createDiv({ cls: 'po-cal__preview', text: '\u70B9\u51FB\u65E5\u671F\u67E5\u770B\u5F53\u5929\u4EFB\u52A1' });

			// Click date to show tasks
			grid.addEventListener('click', (e) => {
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (!dayEl || !dayEl.dataset.date) return;
				const dt = dayEl.dataset.date;
				const dayTasks = tasks.filter((t) => {
					const effectiveDate = t.remindDate || t.dueDate;
					return effectiveDate === dt || t.startDate === dt;
				});
				preview.empty();
				if (dayTasks.length) {
					dayTasks.forEach((t) => {
						const row = preview.createDiv({ cls: 'po-cal__task' });
						row.draggable = true;
						row.dataset.taskId = t.id;
						const projColor = colorMap[t.projectId] || '#3b82f6';
						row.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + projColor } });
						const nameSpan = row.createSpan({ cls: 'po-cal__task-name po-clickable', text: t.content });
						nameSpan.addEventListener('click', (ev) => {
							ev.stopPropagation();
							this.openTaskEditModal(t);
						});
						row.createSpan({ cls: 'po-status ' + (t.status === '\u5DF2\u5B8C\u6210' ? 'po-done' : 'po-todo'), text: t.status });

						// Drag to move task to another date
						row.addEventListener('dragstart', (ev) => {
							ev.dataTransfer?.setData('text/plain', t.id);
						});
					});
				} else {
					preview.createSpan({ text: '\u8BE5\u65E5\u671F\u6682\u65E0\u4EFB\u52A1' });
				}
			});

			// Drop on calendar days to move task
			grid.addEventListener('dragover', (e) => {
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (dayEl?.dataset.date) { e.preventDefault(); dayEl.addClass('po-cal__day--drag-over'); }
			});
			grid.addEventListener('dragleave', (e) => {
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (dayEl) dayEl.removeClass('po-cal__day--drag-over');
			});
			grid.addEventListener('drop', (e) => {
				e.preventDefault();
				const dayEl = (e.target as HTMLElement).closest('.po-cal__day') as HTMLElement;
				if (!dayEl?.dataset.date) return;
				dayEl.removeClass('po-cal__day--drag-over');
				const taskId = e.dataTransfer?.getData('text/plain');
				if (!taskId) return;
				const task = tasks.find((t) => t.id === taskId);
				if (!task) return;
				const newDate = dayEl.dataset.date;
				void this.updateTaskDate(task, newDate);
			});
		};

		renderMonth();
	}



	/** Update task dueDate (and remindDate if exists) in source file (unified writer) */
	private async updateTaskDate(task: TaskItem, newDate: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		// 与旧实现语义一致：仅在对应字段已存在时才改写，不凭空插入
		const updates: Record<string, string> = {};
		if (task.dueDate) updates['\u622A\u6B62\u65E5\u671F'] = newDate;
		if (task.remindDate) updates['\u63D0\u9192\u65E5\u671F'] = newDate;
		if (Object.keys(updates).length > 0) {
			await this.writeFrontmatter(file, updates);
		}

		task.dueDate = newDate;
		if (task.remindDate) task.remindDate = newDate;
		this.showToast('\u2728 \u4EFB\u52A1\u65E5\u671F\u5DF2\u66F4\u65B0');
		await this.refresh();
	}



	/* ---- Kanban Panel ---- */
	private renderKanbanPanel(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		const board = panel.createDiv({ cls: 'po-kanban' });
		const cols = [
			{ key: '\u5F85\u529E', label: '\u5F85\u529E' },
			{ key: '\u8FDB\u884C\u4E2D', label: '\u8FDB\u884C\u4E2D' },
			{ key: '\u5DF2\u963B\u585E', label: '\u5DF2\u963B\u585E' },
			{ key: '\u5DF2\u5B8C\u6210', label: '\u5DF2\u5B8C\u6210' },
			{ key: '\u5DF2\u53D6\u6D88', label: '\u5DF2\u53D6\u6D88' },
		];

		// Build project color lookup
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });

		cols.forEach((col) => {
			const colEl = board.createDiv({ cls: 'po-kanban__col' });
			colEl.dataset.status = col.key;
			const hd = colEl.createDiv({ cls: 'po-kanban__hd' });
			hd.createSpan({ text: col.label });
			const ct = tasks.filter((t) => t.status === col.key);
			hd.createSpan({ cls: 'po-kanban__count', text: String(ct.length) });

			ct.forEach((t) => {
				const card = colEl.createDiv({ cls: 'po-kanban__card' });
				card.draggable = true;
				card.dataset.taskId = t.id;
				card.createDiv({ text: t.content });
				const meta = card.createDiv({ cls: 'po-kanban__meta' });
				const dateRange = [t.startDate, t.dueDate].filter(Boolean).join(' \u2192 ');
				if (dateRange) meta.createSpan({ text: dateRange });
				const proj = meta.createSpan();
				const projColor = colorMap[t.projectId] || '#3b82f6';
				proj.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + projColor } });
				proj.appendText(t.projectId);

				// Click to edit
				card.addEventListener('click', () => {
					this.openTaskEditModal(t);
				});

				// Right-click context menu
				card.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((item) => {
						item.setTitle('\u7F16\u8F91').setIcon('pencil').onClick(() => this.openTaskEditModal(t));
					});
					menu.addItem((item) => {
						item.setTitle('\u5220\u9664').setIcon('trash').onClick(() => void this.deleteTask(t));
					});
					menu.addItem((item) => {
						item.setTitle('\u6253\u5F00\u6E90\u6587\u4EF6').setIcon('file-text').onClick(() => {
							if (t.sourceFile) void this.app.workspace.openLinkText(t.sourceFile, '', true);
						});
					});
					// Priority submenu
					menu.addSeparator();
					const priorities = ['\u91CD\u8981\u4E14\u7D27\u6025', '\u91CD\u8981\u4E0D\u7D27\u6025', '\u7D27\u6025\u4E0D\u91CD\u8981', '\u4E0D\u91CD\u8981\u4E0D\u7D27\u6025'];
					priorities.forEach((prio) => {
						menu.addItem((item) => {
							item.setTitle('\u4F18\u5148\u7EA7: ' + prio).onClick(() => void this.updateTaskPriority(t, prio));
						});
					});
					menu.showAtMouseEvent(e);
				});

				// Drag start
				card.addEventListener('dragstart', (e) => {
					e.dataTransfer?.setData('text/plain', t.id);
					card.addClass('po-kanban__card--dragging');
				});
				card.addEventListener('dragend', () => {
					card.removeClass('po-kanban__card--dragging');
				});
			});

			// Drop zone
			colEl.addEventListener('dragover', (e) => {
				e.preventDefault();
				colEl.addClass('po-kanban__col--drag-over');
			});
			colEl.addEventListener('dragleave', () => {
				colEl.removeClass('po-kanban__col--drag-over');
			});
			colEl.addEventListener('drop', (e) => {
				e.preventDefault();
				colEl.removeClass('po-kanban__col--drag-over');
				const taskId = e.dataTransfer?.getData('text/plain');
				if (!taskId) return;
				const task = tasks.find((t) => t.id === taskId);
				if (!task || task.status === col.key) return;
				void this.updateTaskStatus(task, col.key as TaskStatus);
			});
		});
	}



	/** Update task status in source file (unified writer) */
	private async updateTaskStatus(task: TaskItem, newStatus: TaskStatus): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		await this.writeFrontmatter(file, { '\u72B6\u6001': newStatus });
		task.status = newStatus;
		this.showToast('\u2728 \u4EFB\u52A1\u72B6\u6001\u5DF2\u66F4\u65B0: ' + newStatus);
		await this.refresh();
	}



	/** Update task priority in source file (unified writer: inserts the field when missing) */
	private async updateTaskPriority(task: TaskItem, newPriority: string): Promise<void> {
		if (!task.sourceFile) return;
		const file = this.app.vault.getAbstractFileByPath(task.sourceFile);
		if (!(file instanceof TFile)) return;

		await this.writeFrontmatter(file, { '\u4F18\u5148\u7EA7': newPriority });
		task.priority = newPriority as TaskItem['priority'];
		this.showToast('\u2728 \u4F18\u5148\u7EA7\u5DF2\u66F4\u65B0: ' + newPriority);
		await this.refresh();
	}

}
