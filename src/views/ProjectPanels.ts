import { Menu, TFile, TFolder, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskItem, ProjectInfo, TaskStatus } from '../data/taskParser';
import type { TaskStore } from '../data/taskStore';
import { fmtDate } from '../data/taskLogic';
import { UI_TEXT } from '../constants';
import { t } from '../i18n';

/** 三个扩展面板（依赖图 / 文件 / 统计）所需的宿主能力 —— ProjectBoard 的
 *  ProjectHost 结构兼容，直接把 this.host 传进来即可。 */
export interface PanelHost {
	app: App;
	plugin: {
		settings: { projectsFolder: string };
		saveSettings(): Promise<void>;
	};
	taskStore: TaskStore;
	selectedProject: string | null;
	showToast(message: string, kind?: 'success' | 'error'): void;
	openTaskEditModal(task: TaskItem): void;
	deleteTask(task: TaskItem): Promise<void>;
}

/* ---- 共享小工具 ---- */

/** 状态 → 主题色（状态点/分布条共用；取值与 .po-todo/.po-progress 等 CSS 调色一致） */
const STATUS_COLORS: Record<TaskStatus, string> = {
	'待办': '#94a3b8',
	'进行中': '#7BA7FF',
	'已阻塞': '#EAB308',
	'已完成': '#10B981',
	'已取消': '#6b7280',
};

const PRIORITY_COLORS: Record<string, string> = {
	'重要且紧急': '#EF4444',
	'重要不紧急': '#7BA7FF',
	'紧急不重要': '#EAB308',
	'不重要不紧急': '#94a3b8',
	'': '#4b5563',
};

function truncName(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

/* ============================================================
   依赖图 — 有向节点图，按最长路径分层自动布局（左 → 右）
   边来源：前置任务（实线强调）+ 父任务层级（虚线弱化）
   ============================================================ */

interface DepEdge { from: string; to: string; kind: 'dep' | 'parent' }

export class DepGraphPanel {
	constructor(private host: PanelHost) {}

	render(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		panel.empty();
		if (!tasks.length) {
			panel.createDiv({ cls: 'po-empty', text: t('ui.depsEmpty') });
			return;
		}

		/* ---- 1. 建点/边：名称解析优先同项目（父任务/前置任务按名称引用） ---- */
		const byName = new Map<string, TaskItem[]>();
		for (const task of tasks) {
			const list = byName.get(task.content) || [];
			list.push(task);
			byName.set(task.content, list);
		}
		const resolve = (name: string, projectId: string): TaskItem | undefined => {
			const list = byName.get(name);
			if (!list) return undefined;
			return list.find((x) => x.projectId === projectId) ?? list[0];
		};

		const nodes = tasks;
		const edgeKey = new Set<string>();
		const edges: DepEdge[] = [];
		const addEdge = (from: TaskItem, to: TaskItem, kind: DepEdge['kind']): void => {
			if (from.id === to.id) return;
			const key = kind + '|' + from.id + '|' + to.id;
			if (edgeKey.has(key)) return;
			edgeKey.add(key);
			edges.push({ from: from.id, to: to.id, kind });
		};
		for (const task of tasks) {
			for (const depName of task.deps || []) {
				const src = resolve(depName, task.projectId);
				if (src) addEdge(src, task, 'dep');
			}
			if (task.parent) {
				const src = resolve(task.parent, task.projectId);
				if (src) addEdge(src, task, 'parent');
			}
		}

		/* ---- 2. 分层：Kahn 最长路径；环上节点用松弛近似并提示 ---- */
		const level = new Map<string, number>();
		const indeg = new Map<string, number>();
		const outgoing = new Map<string, TaskItem[]>();
		const nodeById = new Map<string, TaskItem>();
		for (const task of nodes) {
			level.set(task.id, 0);
			indeg.set(task.id, 0);
			outgoing.set(task.id, []);
			nodeById.set(task.id, task);
		}
		for (const e of edges) {
			indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
			outgoing.get(e.from)?.push(nodeById.get(e.to)!);
		}
		const queue: string[] = [];
		for (const task of nodes) if ((indeg.get(task.id) ?? 0) === 0) queue.push(task.id);
		let settled = 0;
		while (queue.length) {
			const id = queue.shift()!;
			settled++;
			for (const next of outgoing.get(id) ?? []) {
				const cand = (level.get(id) ?? 0) + 1;
				if (cand > (level.get(next.id) ?? 0)) level.set(next.id, cand);
				const d = (indeg.get(next.id) ?? 1) - 1;
				indeg.set(next.id, d);
				if (d === 0) queue.push(next.id);
			}
		}
		// 环上节点：按边反复松弛（环内顺序近似，足够示意）
		const hasCycle = settled < nodes.length;
		if (hasCycle) {
			for (let i = 0; i < nodes.length; i++) {
				for (const e of edges) {
					const cand = (level.get(e.from) ?? 0) + 1;
					if (cand > (level.get(e.to) ?? 0)) level.set(e.to, cand);
				}
			}
		}

		/* ---- 3. 布局：level → 列，列内按传入顺序排布 ---- */
		const NODE_W = 148;
		const NODE_H = 44;
		const GAP_X = 64;
		const GAP_Y = 12;
		const PAD = 10;
		const columns = new Map<number, TaskItem[]>();
		for (const task of nodes) {
			const lv = Math.max(0, level.get(task.id) ?? 0);
			const col = columns.get(lv) || [];
			col.push(task);
			columns.set(lv, col);
		}
		const maxLevel = Math.max(...columns.keys());
		const maxColLen = Math.max(...Array.from(columns.values(), (c) => c.length));
		const posX = (lv: number): number => PAD + lv * (NODE_W + GAP_X);
		const posY = (i: number): number => PAD + i * (NODE_H + GAP_Y);
		const posOf = new Map<string, { x: number; y: number }>();
		for (const [lv, col] of columns) {
			col.forEach((task, i) => posOf.set(task.id, { x: posX(lv), y: posY(i) }));
		}
		const totalW = PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * GAP_X;
		const totalH = PAD * 2 + maxColLen * NODE_H + Math.max(0, maxColLen - 1) * GAP_Y;

		/* ---- 4. DOM：顶部图例 + 滚动画布 ---- */
		const bar = panel.createDiv({ cls: 'po-dep__bar' });
		const colorMap: Record<string, string> = {};
		projects.forEach((p) => { colorMap[p.name] = p.color; });
		const legend = bar.createDiv({ cls: 'po-dep__legend' });
		legend.createSpan({ cls: 'po-dep__lg po-dep__lg--dep', text: t('ui.depsEdgeDep') });
		legend.createSpan({ cls: 'po-dep__lg po-dep__lg--parent', text: t('ui.depsEdgeParent') });
		if (hasCycle) legend.createSpan({ cls: 'po-dep__cycle', text: '⚠ ' + t('ui.depsCycle') });
		if (!edges.length) legend.createSpan({ cls: 'po-dep__hint', text: t('ui.depsNoEdges') });

		const scroll = panel.createDiv({ cls: 'po-dep__scroll' });
		const SVGNS = 'http://www.w3.org/2000/svg';
		const svgEl = (tag: string, attrs: Record<string, string | number> = {}): SVGElement => {
			const el = document.createElementNS(SVGNS, tag);
			for (const k in attrs) el.setAttribute(k, String(attrs[k]));
			return el;
		};
		const svg = svgEl('svg', { width: totalW, height: totalH, class: 'po-dep__svg' });
		scroll.appendChild(svg);

		// 箭头 marker（前置=强调色，父子=灰）
		const defs = svgEl('defs');
		const mkArrow = (id: string, cls: string): SVGElement => {
			const m = svgEl('marker', { id, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
			m.appendChild(svgEl('path', { d: 'M 0 1 L 9 5 L 0 9 z', class: cls }));
			return m;
		};
		defs.appendChild(mkArrow('po-dep-arrow-dep', 'po-dep__arrow-dep'));
		defs.appendChild(mkArrow('po-dep-arrow-parent', 'po-dep__arrow-parent'));
		svg.appendChild(defs);

		// 边（先画，压在节点下面）：贝塞尔从源右侧到目标左侧
		for (const e of edges) {
			const a = posOf.get(e.from);
			const b = posOf.get(e.to);
			if (!a || !b) continue;
			const x1 = a.x + NODE_W;
			const y1 = a.y + NODE_H / 2;
			const x2 = b.x;
			const y2 = b.y + NODE_H / 2;
			const dx = Math.max(24, (x2 - x1) / 2);
			const path = svgEl('path', {
				d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
				class: 'po-dep__edge' + (e.kind === 'dep' ? ' is-dep' : ' is-parent'),
				fill: 'none',
			});
			path.setAttribute('marker-end', e.kind === 'dep' ? 'url(#po-dep-arrow-dep)' : 'url(#po-dep-arrow-parent)');
			svg.appendChild(path);
		}

		// 节点
		for (const task of nodes) {
			const p = posOf.get(task.id);
			if (!p) continue;
			const g = svgEl('g', {
				transform: `translate(${p.x}, ${p.y})`,
				class: 'po-dep__node' + (task.status === '已完成' ? ' is-done' : '') + (task.status === '已取消' ? ' is-cancelled' : ''),
			}) as SVGGElement;
			const rect = svgEl('rect', { width: NODE_W, height: NODE_H, rx: 9, class: 'po-dep__node-rect' });
			const color = colorMap[task.projectId] || '#3b82f6';
			rect.setAttribute('stroke', color);
			rect.setAttribute('fill', color);
			rect.setAttribute('fill-opacity', '0.10');
			g.appendChild(rect);
			g.appendChild(svgEl('circle', { cx: 13, cy: NODE_H / 2, r: 4, fill: STATUS_COLORS[task.status] ?? '#94a3b8', class: 'po-dep__node-dot' }));
			const name = svgEl('text', { x: 23, y: 18, class: 'po-dep__node-name' }) as SVGTextElement;
			name.textContent = truncName(task.content, 11);
			g.appendChild(name);
			const meta = svgEl('text', { x: 23, y: 33, class: 'po-dep__node-meta' }) as SVGTextElement;
			// 短日期（MM-DD）保证「日期 → 日期 · 状态」在节点宽度内完整显示
			const shortDate = (iso: string | null): string => (iso ? iso.slice(5) : '?');
			const dates = task.startDate || task.dueDate
				? `${shortDate(task.startDate)} → ${shortDate(task.dueDate)}`
				: (task.deps?.length ? '← ' + truncName(task.deps.join('、'), 14) : UI_TEXT.notSet);
			meta.textContent = truncName(`${dates} · ${UI_TEXT.statusLabel(task.status)}`, 20);
			g.appendChild(meta);

			const title = svgEl('title');
			title.textContent = `${task.content}\n${task.projectId} · ${task.status}${task.priority ? ' · ' + task.priority : ''}\n${task.startDate ?? '?'} → ${task.dueDate ?? '?'}`;
			g.appendChild(title);

			g.addEventListener('click', () => this.host.openTaskEditModal(task));
			g.addEventListener('contextmenu', (ev) => {
				ev.preventDefault();
				const menu = new Menu();
				menu.addItem((item) => item.setTitle(UI_TEXT.edit).setIcon('pencil').onClick(() => this.host.openTaskEditModal(task)));
				menu.addItem((item) => item.setTitle(UI_TEXT.openSource).setIcon('file-text').onClick(() => {
					if (task.sourceFile) void this.host.app.workspace.openLinkText(task.sourceFile, '', true);
				}));
				menu.addSeparator();
				menu.addItem((item) => item.setTitle(UI_TEXT.delete).setIcon('trash').onClick(() => void this.host.deleteTask(task)));
				menu.showAtMouseEvent(ev);
			});
			svg.appendChild(g);
		}
	}
}

/* ============================================================
   文件 — 项目根目录文件树（模板生成的任务/配置文件）+ 过滤 + 重新扫描
   ============================================================ */

export class FilesPanel {
	constructor(private host: PanelHost) {}

	/** 已展开的文件夹路径；null = 尚未初始化（首渲染自动展开根 + 各项目文件夹） */
	private expanded: Set<string> | null = null;
	/** 上次渲染的树根路径：切换项目后根变化时重置展开状态，避免残留其它项目的展开路径 */
	private expandedRoot: string | null = null;
	private filter = '';

	render(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		panel.empty();
		const rootPath = this.host.plugin.settings.projectsFolder;
		// 选中项目 → 只显示该项目的文件夹（项目显示名可能 ≠ 文件夹名，按 ProjectInfo.path 精确定位）
		const sel = this.host.selectedProject
			? projects.find((p) => p.name === this.host.selectedProject)
			: null;
		const found = this.host.app.vault.getAbstractFileByPath(sel ? sel.path : rootPath);
		const folder = found instanceof TFolder ? found : this.host.app.vault.getRoot();

		if (this.expanded === null || this.expandedRoot !== folder.path) {
			this.expanded = new Set([folder.path]);
			if (!sel) {
				for (const child of folder.children) {
					if (child instanceof TFolder) this.expanded.add(child.path);
				}
			}
			this.expandedRoot = folder.path;
		}

		// 任务文件索引：路径 → TaskItem（状态点/右键菜单用）
		const taskByPath = new Map<string, TaskItem>();
		for (const task of tasks) taskByPath.set(task.sourceFile, task);

		/* ---- 工具栏：标题 + 过滤输入 + 重新扫描 ---- */
		const bar = panel.createDiv({ cls: 'po-files__bar' });
		const ttl = bar.createDiv({ cls: 'po-files__ttl' });
		ttl.setText(sel ? sel.name : t('ui.filesRoot'));
		ttl.setAttr('title', folder.path);
		const scanBtn = bar.createEl('button', { cls: 'po-files__scan', attr: { 'aria-label': t('ui.filesScan') } });
		setIcon(scanBtn, 'refresh-cw');
		scanBtn.addEventListener('click', () => {
			void (async () => {
				this.host.taskStore.invalidate();
				const fresh = await this.host.taskStore.scanAllTasks();
				if (!panel.isConnected) return;
				this.render(panel, fresh, projects);
				this.host.showToast(t('ui.filesScan') + ' ✓');
			})();
		});

		const searchWrap = panel.createDiv({ cls: 'po-files__search' });
		const input = searchWrap.createEl('input', {
			cls: 'po-files__input',
			attr: { type: 'text', placeholder: t('ui.filesFilterPh'), spellcheck: 'false' },
		});
		input.value = this.filter;
		input.addEventListener('input', () => {
			this.filter = input.value.trim().toLowerCase();
			this.renderTree(tree, folder, taskByPath);
		});

		const tree = panel.createDiv({ cls: 'po-files__tree' });
		this.renderTree(tree, folder, taskByPath);
	}

	/** 渲染树主体（过滤词非空 → 平铺匹配文件） */
	private renderTree(tree: HTMLElement, folder: TFolder, taskByPath: Map<string, TaskItem>): void {
		tree.empty();
		if (this.filter) {
			const matches: TFile[] = [];
			const walk = (f: TFolder): void => {
				for (const child of f.children) {
					if (child instanceof TFolder) walk(child);
					else if (child instanceof TFile && child.path.toLowerCase().includes(this.filter)) matches.push(child);
				}
			};
			walk(folder);
			matches.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
			if (!matches.length) {
				tree.createDiv({ cls: 'po-empty', text: t('ui.filesEmptyDir') });
				return;
			}
			for (const file of matches.slice(0, 200)) {
				this.renderFileRow(tree, file, 0, taskByPath, file.path);
			}
			return;
		}
		const hasChildren = folder.children.length > 0;
		if (!hasChildren) {
			tree.createDiv({ cls: 'po-empty', text: t('ui.filesEmptyDir') });
			return;
		}
		this.renderFolderInto(tree, folder, 0, taskByPath);
	}

	/** 递归渲染一个已展开的文件夹内容（folders 优先，名称排序） */
	private renderFolderInto(container: HTMLElement, folder: TFolder, depth: number, taskByPath: Map<string, TaskItem>): void {
		const folders = folder.children.filter((c): c is TFolder => c instanceof TFolder)
			.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
		const files = folder.children.filter((c): c is TFile => c instanceof TFile)
			.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
		for (const sub of folders) this.renderFolderRow(container, sub, depth, taskByPath);
		for (const file of files) this.renderFileRow(container, file, depth, taskByPath, file.name);
	}

	private renderFolderRow(container: HTMLElement, f: TFolder, depth: number, taskByPath: Map<string, TaskItem>): void {
		const isOpen = this.expanded?.has(f.path) ?? false;
		const row = container.createDiv({ cls: 'po-files__row po-files__row--folder' + (isOpen ? ' is-open' : '') });
		row.style.paddingLeft = 8 + depth * 16 + 'px';
		row.createSpan({ cls: 'po-files__arrow', text: isOpen ? '▾' : '▸' });
		const ico = row.createSpan({ cls: 'po-files__icon' });
		setIcon(ico, 'folder');
		row.createSpan({ cls: 'po-files__name', text: f.name });
		const mdCount = f.children.filter((c) => c instanceof TFile && c.extension === 'md').length;
		row.createSpan({ cls: 'po-files__count', text: String(mdCount) });
		row.addEventListener('click', () => {
			if (!this.expanded) return;
			// 展开状态是唯一状态源：切换后整树重渲染（树规模 = 项目数级别），保持滚动位置
			if (this.expanded.has(f.path)) this.expanded.delete(f.path);
			else this.expanded.add(f.path);
			const tree = row.closest('.po-files__tree') as HTMLElement | null;
			if (!tree) return;
			const scrollTop = tree.scrollTop;
			const rootPath = this.host.plugin.settings.projectsFolder;
			const root = this.host.app.vault.getAbstractFileByPath(rootPath);
			this.renderTree(tree, root instanceof TFolder ? root : this.host.app.vault.getRoot(), taskByPath);
			tree.scrollTop = scrollTop;
		});
		// 初始已展开：子项紧随该行按顺序渲染（展开/收起走整树重渲染）
		if (isOpen) this.renderFolderInto(container, f, depth + 1, taskByPath);
	}

	private renderFileRow(container: HTMLElement, file: TFile, depth: number, taskByPath: Map<string, TaskItem>, label: string): void {
		const task = taskByPath.get(file.path);
		const isConfig = file.name.startsWith('project-');
		const row = container.createDiv({ cls: 'po-files__row po-files__row--file' + (task && task.status === '已完成' ? ' is-done' : '') });
		row.style.paddingLeft = 8 + depth * 16 + 'px';
		row.createSpan({ cls: 'po-files__arrow po-files__arrow--ph' });   // 占位，与文件夹行的箭头对齐
		// 状态点：任务文件按状态着色；配置/其它文件用中性点
		if (task) row.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + (STATUS_COLORS[task.status] ?? '#94a3b8') } });
		else row.createSpan({ cls: 'po-files__fdot' });
		const ico = row.createSpan({ cls: 'po-files__icon' });
		setIcon(ico, isConfig ? 'settings' : 'file-text');
		row.createSpan({ cls: 'po-files__name', text: label, attr: { title: file.path } });
		if (isConfig) row.createSpan({ cls: 'po-files__badge', text: t('ui.filesConfigBadge') });
		if (task && task.status !== '待办') {
			row.createSpan({ cls: 'po-files__status', text: UI_TEXT.statusLabel(task.status) });
		}
		row.addEventListener('click', () => {
			void this.host.app.workspace.openLinkText(file.path, '', true);
		});
		row.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) => item.setTitle(UI_TEXT.openSource).setIcon('file-text')
				.onClick(() => void this.host.app.workspace.openLinkText(file.path, '', true)));
			if (task) {
				menu.addItem((item) => item.setTitle(UI_TEXT.edit).setIcon('pencil').onClick(() => this.host.openTaskEditModal(task)));
				menu.addSeparator();
				menu.addItem((item) => item.setTitle(UI_TEXT.delete).setIcon('trash').onClick(() => void this.host.deleteTask(task)));
			}
			menu.showAtMouseEvent(e);
		});
	}
}

/* ============================================================
   统计 — 完成率 / 状态 / 优先级 / 标签分布 / 工时（每日节点完成累计）
   ============================================================ */

interface DistRow { label: string; count: number; color: string }

export class StatsPanel {
	constructor(private host: PanelHost) {}

	render(panel: HTMLElement, tasks: TaskItem[], projects: ProjectInfo[]): void {
		panel.empty();
		if (!tasks.length) {
			panel.createDiv({ cls: 'po-empty', text: UI_TEXT.noTasks });
			return;
		}

		const total = tasks.length;
		const doneCount = tasks.filter((x) => x.status === '已完成').length;
		const cancelled = tasks.filter((x) => x.status === '已取消').length;
		const active = tasks.filter((x) => x.status === '进行中').length;
		const blocked = tasks.filter((x) => x.status === '已阻塞').length;
		const overdue = tasks.filter((x) => x.isOverdue).length;
		const rateBase = Math.max(0, total - cancelled);
		const rate = rateBase > 0 ? Math.round((doneCount / rateBase) * 100) : 0;

		const wrap = panel.createDiv({ cls: 'po-stats' });

		/* ---- KPI 行 ---- */
		const kpis = wrap.createDiv({ cls: 'po-stats__kpis' });
		const kpi = (num: string | number, label: string, extraCls = '', title = ''): void => {
			const card = kpis.createDiv({ cls: 'po-stats__kpi' + (extraCls ? ' ' + extraCls : '') });
			if (title) card.setAttr('title', title);
			card.createSpan({ cls: 'po-stats__kpi-num', text: String(num) });
			card.createSpan({ cls: 'po-stats__kpi-lb', text: label });
		};
		kpi(total, t('ui.statsTotal'));
		kpi(doneCount, t('ui.statsDone'), 'is-done');
		kpi(active, t('ui.statsActive'), 'is-active');
		kpi(blocked, t('ui.statsBlocked'), 'is-blocked');
		kpi(overdue, t('ui.statsOverdue'), 'is-over');
		// 完成率：大号数字 + 进度条（口径：已完成 / (全部 − 已取消)）
		const rateCard = kpis.createDiv({ cls: 'po-stats__kpi po-stats__kpi--rate' });
		rateCard.setAttr('title', t('ui.statsCompletionHint'));
		rateCard.createSpan({ cls: 'po-stats__kpi-num', text: rate + '%' });
		rateCard.createSpan({ cls: 'po-stats__kpi-lb', text: t('ui.statsCompletion') });
		const track = rateCard.createDiv({ cls: 'po-stats__rate-track' });
		track.createDiv({ cls: 'po-stats__rate-fill', attr: { style: 'width:' + rate + '%' } });

		const grid = wrap.createDiv({ cls: 'po-stats__grid' });

		/* ---- 分布卡通用渲染 ---- */
		const distCard = (title: string, rows: DistRow[], sum: number): HTMLElement => {
			const card = grid.createDiv({ cls: 'po-stats__card' });
			card.createDiv({ cls: 'po-stats__card-hd', text: title });
			if (!rows.length || sum === 0) {
				card.createDiv({ cls: 'po-stats__none', text: '—' });
				return card;
			}
			for (const r of rows) {
				const row = card.createDiv({ cls: 'po-stats__row' });
				row.createSpan({ cls: 'po-stats__row-lb', text: r.label, attr: { title: r.label } });
				const tr = row.createDiv({ cls: 'po-stats__track' });
				const pct = sum > 0 ? Math.round((r.count / sum) * 100) : 0;
				tr.createDiv({ cls: 'po-stats__fill', attr: { style: 'width:' + pct + '%;background:' + r.color } });
				row.createSpan({ cls: 'po-stats__row-n', text: `${r.count} · ${pct}%` });
			}
			return card;
		};

		// 状态分布（固定顺序，0 值也显示行保持对齐）
		const statusRows: DistRow[] = (['待办', '进行中', '已阻塞', '已完成', '已取消'] as TaskStatus[]).map((st) => ({
			label: UI_TEXT.statusLabel(st),
			count: tasks.filter((x) => x.status === st).length,
			color: STATUS_COLORS[st],
		}));
		distCard(t('ui.statsByStatus'), statusRows, total);

		// 优先级分布
		const prioKeys = ['重要且紧急', '重要不紧急', '紧急不重要', '不重要不紧急', ''];
		const prioRows: DistRow[] = prioKeys.map((p) => ({
			label: p || UI_TEXT.notSet,
			count: tasks.filter((x) => (x.priority ?? '') === p).length,
			color: PRIORITY_COLORS[p] ?? '#4b5563',
		}));
		distCard(t('ui.statsByPriority'), prioRows, total);

		// 标签分布（Top 8 + 无标签）
		const tagCounts = new Map<string, number>();
		let untagged = 0;
		for (const x of tasks) {
			if (x.tags.length) for (const tag of x.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			else untagged++;
		}
		const tagRows: DistRow[] = Array.from(tagCounts.entries())
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
			.slice(0, 8)
			.map(([tag, count]) => ({ label: '#' + tag, count, color: '#7BA7FF' }));
		if (untagged > 0) tagRows.push({ label: t('ui.statsNoTags'), count: untagged, color: '#4b5563' });
		distCard(t('ui.statsByTag'), tagRows, total);

		/* ---- 工时卡（跨两列）：每日节点完成次数累计 ---- */
		const card = grid.createDiv({ cls: 'po-stats__card po-stats__card--span2' });
		card.createDiv({ cls: 'po-stats__card-hd', text: t('ui.statsHours') });

		let totalHours = 0;
		const byDay = new Map<string, number>();
		const byProject = new Map<string, number>();
		const taskWithHours = new Set<string>();
		for (const x of tasks) {
			for (const [date, node] of Object.entries(x.dailyNodes)) {
				if (!node || node.s !== 'done') continue;
				totalHours++;
				byDay.set(date, (byDay.get(date) ?? 0) + 1);
				byProject.set(x.projectId, (byProject.get(x.projectId) ?? 0) + 1);
				taskWithHours.add(x.id);
			}
		}

		const hoursSummary = card.createDiv({ cls: 'po-stats__hours' });
		const cell = (num: string, label: string): void => {
			const c = hoursSummary.createDiv({ cls: 'po-stats__hours-cell' });
			c.createSpan({ cls: 'po-stats__kpi-num', text: num });
			c.createSpan({ cls: 'po-stats__kpi-lb', text: label });
		};
		cell(String(totalHours), t('ui.statsTotalHours'));
		cell(String(taskWithHours.size), t('ui.statsLoggedTasks'));

		// 近 14 天趋势柱状图
		const trendWrap = card.createDiv({ cls: 'po-stats__trend-wrap' });
		trendWrap.createDiv({ cls: 'po-stats__sub', text: t('ui.statsTrend') });
		const trend = trendWrap.createDiv({ cls: 'po-stats__trend' });
		const today = new Date();
		const days: string[] = [];
		for (let i = 13; i >= 0; i--) {
			const d = new Date(today);
			d.setDate(d.getDate() - i);
			days.push(fmtDate(d));
		}
		const maxDay = Math.max(1, ...days.map((d) => byDay.get(d) ?? 0));
		for (const d of days) {
			const n = byDay.get(d) ?? 0;
			const col = trend.createDiv({ cls: 'po-stats__tcol' + (n > 0 ? '' : ' is-zero') });
			col.setAttr('title', d + ' · ' + n);
			const barEl = col.createDiv({ cls: 'po-stats__tbar' });
			barEl.createDiv({ cls: 'po-stats__tfill', attr: { style: 'height:' + Math.max(n > 0 ? 6 : 2, Math.round((n / maxDay) * 56)) + 'px' } });
			col.createSpan({ cls: 'po-stats__tlb', text: String(parseInt(d.slice(8), 10)) });
		}

		// 各项目工时（仅显示选中范围内有工时/有任务的项目）
		const projWrap = card.createDiv({ cls: 'po-stats__proj' });
		projWrap.createDiv({ cls: 'po-stats__sub', text: t('ui.statsPerProject') });
		const projSet = new Set(tasks.map((x) => x.projectId));
		const projRows: DistRow[] = [];
		for (const p of projects) {
			if (!projSet.has(p.name)) continue;
			projRows.push({ label: p.name, count: byProject.get(p.name) ?? 0, color: p.color });
		}
		// 不属于任何已识别项目的任务（理论少见）
		for (const pid of projSet) {
			if (!projects.some((p) => p.name === pid)) {
				projRows.push({ label: pid, count: byProject.get(pid) ?? 0, color: '#6b7280' });
			}
		}
		const maxProj = Math.max(1, ...projRows.map((r) => r.count));
		if (!projRows.length) {
			projWrap.createDiv({ cls: 'po-stats__none', text: '—' });
		}
		for (const r of projRows) {
			const row = projWrap.createDiv({ cls: 'po-stats__row' });
			row.createSpan({ cls: 'po-mini-dot', attr: { style: 'background:' + r.color } });
			row.createSpan({ cls: 'po-stats__row-lb', text: r.label, attr: { title: r.label } });
			const tr = row.createDiv({ cls: 'po-stats__track' });
			tr.createDiv({ cls: 'po-stats__fill', attr: { style: 'width:' + Math.round((r.count / maxProj) * 100) + '%;background:' + r.color } });
			row.createSpan({ cls: 'po-stats__row-n', text: String(r.count) });
		}

		card.createDiv({ cls: 'po-stats__hint', text: 'ℹ ' + t('ui.statsHoursHint') });
	}
}
