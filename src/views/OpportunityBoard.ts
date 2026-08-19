import { Menu } from 'obsidian';
import type { App } from 'obsidian';
import { OpportunityModal } from './OpportunityModal';
import {
	BoardItem, BoardFormData, BoardStage,
	sortBoardItems, migrateStatus,
	ensureOpportunityFile, parseOpportunitiesFile, writeOpportunitiesFile,
	createOpportunity, updateOpportunity, updateBoardItemStatus, toggleBoardItemStarred, deleteOpportunity,
	DEFAULT_BOARD_FILE,
} from '../data/opportunityParser';
import { UI_TEXT } from '../constants';

/** Host surface the OpportunityBoard needs from its owner view. */
export interface OpportunityHost {
	app: App;
	plugin: {
		settings: { opportunityFile: string; boardTitle: string; boardStages: BoardStage[]; currentOppView: string };
		saveSettings(): Promise<void>;
	};
	boardEl: HTMLElement | null;
	currentPage: 'home' | 'project' | 'opportunity';
	exitEditMode(): void;
	showToast(message: string, kind?: 'success' | 'error'): void;
}

/** 通用看板（第三页）渲染器 — extracted from DashboardView. */
export class OpportunityBoard {
	private host: OpportunityHost;

	// Board state
	private currentItems: BoardItem[] = [];
	private selectedStatus: string = 'all';
	private showStarredOnly: boolean = false;
	private selectedDetailId: string | null = null;
	private draggedId: string | null = null;
	private mainEl: HTMLElement | null = null;
	private sortCol: string = '';
	private sortDir: 'asc' | 'desc' = 'asc';
	private refreshTimer: number | null = null;
	private cache: { at: number; items: BoardItem[] } | null = null;

	constructor(host: OpportunityHost) {
		this.host = host;
	}

	/** Debounced refresh of the board (250ms) to coalesce rapid vault events. */
	scheduleRefresh(): void {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshBoard();
		}, 250);
	}

	/** Cancel pending work (view close). */
	dispose(): void {
		if (this.refreshTimer) { window.clearTimeout(this.refreshTimer); this.refreshTimer = null; }
	}

	private boardTitle(): string {
		return this.host.plugin.settings.boardTitle || '看板';
	}

	private boardPath(): string {
		return this.host.plugin.settings.opportunityFile || DEFAULT_BOARD_FILE;
	}

	/** 配置的阶段 label 列表（排序用） */
	private stageLabels(): string[] {
		return this.host.plugin.settings.boardStages.map((s) => s.label);
	}

	private stageByLabel(label: string): BoardStage | undefined {
		return this.host.plugin.settings.boardStages.find((s) => s.label === label);
	}

	private stageColor(label: string): string {
		const st = this.stageByLabel(label);
		return st ? st.color : 'var(--ad-muted)';
	}

	private async loadItems(): Promise<BoardItem[]> {
		const now = Date.now();
		if (this.cache && now - this.cache.at < 300) return this.cache.items;
		const path = this.boardPath();
		const title = this.boardTitle();
		await ensureOpportunityFile(this.host.app, path, title);
		const items = await parseOpportunitiesFile(this.host.app, path, title);
		const sorted = sortBoardItems(items, this.stageLabels());
		this.cache = { at: now, items: sorted };
		return sorted;
	}

	private async saveItems(items: BoardItem[]): Promise<void> {
		const path = this.boardPath();
		await writeOpportunitiesFile(this.host.app, path, items, this.boardTitle());
		this.cache = { at: Date.now(), items: sortBoardItems(items, this.stageLabels()) };
	}

	async show(): Promise<void> {
		if (!this.host.boardEl) return;
		this.host.exitEditMode();
		const items = await this.loadItems();
		this.host.boardEl.empty();
		this.host.boardEl.removeClass('ad-board');
		this.host.boardEl.removeClass('po-board');
		this.host.boardEl.addClass('op-board');
		this.host.currentPage = 'opportunity';

		this.currentItems = items;
		this.selectedStatus = 'all';
		this.showStarredOnly = false;
		this.selectedDetailId = null;

		const container = this.host.boardEl.createDiv({ cls: 'po-container op-container' });
		const sidebar = container.createDiv({ cls: 'po-sidebar op-sidebar' });
		this.renderSidebar(sidebar);
		this.mainEl = container.createDiv({ cls: 'po-main op-main' });
		this.renderPanels();
	}

	private renderSidebar(sidebar: HTMLElement): void {
		sidebar.empty();
		const list = sidebar.createDiv({ cls: 'po-sidebar__list' });
		const items = this.currentItems;
		const total = items.length;

		const allItem = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedStatus === 'all' && !this.showStarredOnly ? ' is-active' : '') });
		allItem.createSpan({ cls: 'po-dot', attr: { style: 'background:var(--ad-accent);color:var(--ad-accent)' } });
		allItem.createSpan({ text: UI_TEXT.opAll });
		allItem.createSpan({ cls: 'po-count', text: String(total) });
		allItem.addEventListener('click', () => {
			this.selectedStatus = 'all';
			this.showStarredOnly = false;
			this.selectedDetailId = null;
			this.renderSidebar(sidebar);
			this.renderPanels();
		});

		for (const st of this.host.plugin.settings.boardStages) {
			const count = items.filter((i) => i.status === st.label).length;
			const item = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedStatus === st.label ? ' is-active' : '') });
			item.createSpan({ cls: 'po-dot', attr: { style: 'background:' + st.color + ';color:' + st.color } });
			item.createSpan({ text: st.label });
			item.createSpan({ cls: 'po-count', text: String(count) });
			item.addEventListener('click', () => {
				this.selectedStatus = st.label;
				this.showStarredOnly = false;
				this.selectedDetailId = null;
				this.renderSidebar(sidebar);
				this.renderPanels();
			});
		}

		const starItem = list.createDiv({ cls: 'po-sidebar__item' + (this.showStarredOnly ? ' is-active' : '') });
		starItem.createSpan({ cls: 'po-dot', attr: { style: 'background:#eab308;color:#eab308' } });
		starItem.createSpan({ text: UI_TEXT.opRoadmap });
		starItem.createSpan({ cls: 'po-count', text: String(items.filter((i) => i.starred).length) });
		starItem.addEventListener('click', () => {
			this.showStarredOnly = !this.showStarredOnly;
			this.selectedStatus = 'all';
			this.selectedDetailId = null;
			this.renderSidebar(sidebar);
			this.renderPanels();
		});
	}

	private renderPanels(): void {
		if (!this.mainEl) return;
		this.mainEl.empty();
		const items = this.filteredItems();
		const tabs = this.mainEl.createDiv({ cls: 'po-tabs' });
		const tabDefs = [
			{ key: 'kanban', label: '▦ 看板' },
			{ key: 'list', label: '☰ 列表' },
		];
		const content = this.mainEl.createDiv({ cls: 'po-content' });
		const panels: Record<string, HTMLElement> = {};
		const cur = this.host.plugin.settings.currentOppView || 'kanban';
		for (const td of tabDefs) {
			const btn = tabs.createEl('button', { cls: 'po-tab' + (td.key === cur ? ' is-active' : ''), text: td.label });
			btn.dataset.view = td.key;
			panels[td.key] = content.createDiv({ cls: 'po-panel' + (td.key === cur ? ' is-active' : ''), attr: { 'data-view': td.key } });
		}
		const newBtn = tabs.createEl('button', { cls: 'po-add-btn op-new-btn', text: '+ 新建' + this.boardTitle() });
		newBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.createItem(); });
		this.renderPanel(cur, panels[cur]!, items);
		tabs.addEventListener('click', (e) => {
			const btn = (e.target as HTMLElement).closest('.po-tab') as HTMLElement;
			if (!btn) return;
			const view = btn.dataset.view;
			if (!view) return;
			tabs.querySelectorAll('.po-tab').forEach((t) => t.removeClass('is-active'));
			btn.addClass('is-active');
			Object.values(panels).forEach((p) => p.classList.remove('is-active'));
			if (panels[view]) panels[view].addClass('is-active');
			this.host.plugin.settings.currentOppView = view;
			void this.host.plugin.saveSettings();
			if (panels[view]) this.renderPanel(view, panels[view], this.filteredItems());
		});
	}

	private filteredItems(): BoardItem[] {
		let items = this.currentItems;
		if (this.showStarredOnly) items = items.filter((i) => i.starred);
		else if (this.selectedStatus !== 'all') items = items.filter((i) => i.status === this.selectedStatus);
		return items;
	}

	private renderPanel(key: string, panel: HTMLElement, items: BoardItem[]): void {
		panel.empty();
		if (key === 'kanban') this.renderKanban(panel, items);
		else if (key === 'list') this.renderList(panel, items);
	}

	/** 看板列：配置阶段 + 数据中出现的未知状态（防御性补列，避免历史数据被隐藏） */
	private activeStages(): BoardStage[] {
		const configured = this.host.plugin.settings.boardStages;
		const dataStatuses = Array.from(new Set(this.currentItems.map((i) => i.status)));
		const extra = dataStatuses.filter((s) => !configured.some((c) => c.label === s));
		return [
			...configured,
			...extra.map((label) => ({ id: label, label, color: 'var(--ad-muted)', hasInput: false })),
		];
	}

	private renderKanban(panel: HTMLElement, items: BoardItem[]): void {
		const singleMode = this.selectedStatus !== 'all' && !this.showStarredOnly;
		const stages = singleMode ? this.activeStages().filter((s) => s.label === this.selectedStatus) : this.activeStages();
		const board = panel.createDiv({ cls: 'po-kanban op-kanban' + (singleMode ? ' op-kanban--single' : '') });

		if (singleMode) {
			const ordered = sortBoardItems(items, this.stageLabels());
			if (!this.selectedDetailId || !items.some((i) => i.id === this.selectedDetailId)) {
				this.selectedDetailId = ordered.length ? (ordered[0]?.id ?? null) : null;
			}
		}

		for (const st of stages) {
			const colEl = board.createDiv({ cls: 'po-kanban__col op-kanban__col' });
			colEl.dataset.status = st.label;
			const hd = colEl.createDiv({ cls: 'po-kanban__hd' });
			hd.createSpan({ text: st.label });
			const ct = items.filter((i) => i.status === st.label).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
			hd.createSpan({ cls: 'po-kanban__count', text: String(ct.length) });
			if (ct.length === 0) colEl.createDiv({ cls: 'op-empty-col' });

			ct.forEach((it) => {
				const card = colEl.createDiv({ cls: 'po-kanban__card op-card' + (singleMode && it.id === this.selectedDetailId ? ' is-selected' : '') });
				card.draggable = true;
				card.dataset.oppId = it.id;
				const chip = card.createDiv({ cls: 'op-st' });
				chip.style.background = this.stageColor(it.status);
				chip.textContent = it.status;
				const title = card.createDiv({ cls: 'op-card__title' });
				title.textContent = it.title;
				const desc = card.createDiv({ cls: 'op-card__desc' });
				desc.textContent = it.notes || it.link || '';
				if (it.starred) card.createDiv({ cls: 'op-badge--roadmap', text: UI_TEXT.opRoadmap });
				card.addEventListener('click', () => {
					if (singleMode) {
						this.selectedDetailId = it.id;
						board.querySelectorAll('.op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.op-detail');
						if (detail instanceof HTMLElement) this.renderDetail(detail, it);
					} else {
						this.openModal(it);
					}
				});
				card.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((m) => m.setTitle(UI_TEXT.edit).setIcon('pencil').onClick(() => this.openModal(it)));
					if (singleMode) menu.addItem((m) => m.setTitle('在右侧查看').setIcon('eye').onClick(() => {
						this.selectedDetailId = it.id;
						board.querySelectorAll('.op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.op-detail');
						if (detail instanceof HTMLElement) this.renderDetail(detail, it);
					}));
					menu.addItem((m) => m.setTitle('打开链接').setIcon('file-text').onClick(() => void this.openLink(it)));
					menu.addSeparator();
					for (const s of this.host.plugin.settings.boardStages) {
						menu.addItem((m) => m.setTitle('状态: ' + s.label).onClick(() => void this.setItemStatus(it, s.label)));
					}
					menu.addSeparator();
					menu.addItem((m) => m.setTitle(it.starred ? '取消星标' : '标记为星标').setIcon('flag').onClick(() => void this.setItemStarred(it, !it.starred)));
					menu.addItem((m) => m.setTitle(UI_TEXT.delete).setIcon('trash').onClick(() => void this.deleteItem(it)));
					menu.showAtMouseEvent(e);
				});
				card.addEventListener('dragstart', (e) => {
					this.draggedId = it.id;
					e.dataTransfer?.setData('text/opp-id', it.id);
					if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
					card.addClass('po-kanban__card--dragging');
				});
				card.addEventListener('dragend', () => { this.draggedId = null; card.removeClass('po-kanban__card--dragging'); });
				card.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; card.addClass('op-card--drag-over'); });
				card.addEventListener('dragleave', () => card.removeClass('op-card--drag-over'));
				card.addEventListener('drop', (e) => {
					e.preventDefault();
					e.stopPropagation();
					card.removeClass('op-card--drag-over');
					const id = this.draggedId ?? e.dataTransfer?.getData('text/opp-id');
					this.draggedId = null;
					if (!id) return;
					void this.reorder(id, st.label, it.id);
				});
			});

			colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.addClass('po-kanban__col--drag-over'); });
			colEl.addEventListener('dragleave', () => colEl.removeClass('po-kanban__col--drag-over'));
			colEl.addEventListener('drop', (e) => {
				e.preventDefault();
				colEl.removeClass('po-kanban__col--drag-over');
				const id = this.draggedId ?? e.dataTransfer?.getData('text/opp-id');
				this.draggedId = null;
				if (!id) return;
				void this.reorder(id, st.label);
			});
		}

		if (singleMode) {
			const detail = board.createDiv({ cls: 'op-detail' });
			const sel = items.find((i) => i.id === this.selectedDetailId) || sortBoardItems(items, this.stageLabels())[0];
			if (sel) this.renderDetail(detail, sel);
			else detail.createSpan({ text: '（该状态暂无条目）' });
		}
	}

	/** 手动排序：把 draggedId 放到 targetStatus 列中 beforeId 之前（省略 beforeId 则追加到末尾）。 */
	private async reorder(draggedId: string, targetStatus: string, beforeId?: string): Promise<void> {
		if (beforeId && beforeId === draggedId) return;
		const items = this.currentItems;
		const dragged = items.find((i) => i.id === draggedId);
		if (!dragged) return;
		const colItems = items
			.filter((i) => i.status === targetStatus && i.id !== draggedId)
			.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
		let insertIdx = colItems.length;
		if (beforeId) {
			const bi = colItems.findIndex((i) => i.id === beforeId);
			insertIdx = bi < 0 ? colItems.length : bi;
		}
		const reordered: BoardItem[] = [];
		let n = 0;
		for (let k = 0; k < colItems.length + 1; k++) {
			if (k === insertIdx) { reordered.push({ ...dragged, status: targetStatus, order: n }); n++; }
			if (k < colItems.length) { reordered.push({ ...colItems[k], order: n } as BoardItem); n++; }
		}
		const map = new Map(reordered.map((i) => [i.id, i]));
		const next = items.map((i) => map.get(i.id) ?? i);
		this.currentItems = sortBoardItems(next, this.stageLabels());
		await this.saveItems(this.currentItems);
		void this.refreshBoard();
	}

	/** 单状态模式下，右侧内联详情编辑器 */
	private renderDetail(container: HTMLElement, item: BoardItem): void {
		container.empty();
		const wrap = container.createDiv({ cls: 'op-detail__inner' });
		wrap.createDiv({ cls: 'op-detail__hd', text: this.boardTitle() + '详情' });

		const titleInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		titleInput.value = item.title; titleInput.placeholder = this.boardTitle() + '名称';

		const statusSel = wrap.createEl('select', { cls: 'ad-modal-input' });
		for (const s of this.host.plugin.settings.boardStages) {
			const o = statusSel.createEl('option', { value: s.label, text: s.label });
			if (s.label === item.status) o.selected = true;
		}

		const tagInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		tagInput.value = (item.tags || []).join('、'); tagInput.placeholder = '标签，顿号/逗号分隔';

		const notes = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '3' } });
		notes.value = item.notes || ''; notes.placeholder = '背景 / 备注';

		// 阶段输入框：仅渲染「启用输入框」的阶段，标题与阶段名一致联动
		const stageInputs: Array<{ label: string; area: HTMLTextAreaElement }> = [];
		for (const s of this.host.plugin.settings.boardStages) {
			if (!s.hasInput) continue;
			wrap.createDiv({ cls: 'op-detail__stage-label', text: s.label });
			const area = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2', placeholder: '填写该阶段相关记录…' } });
			area.value = (item.stageNotes || {})[s.label] || '';
			stageInputs.push({ label: s.label, area });
		}

		const linkInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		linkInput.value = item.link || ''; linkInput.placeholder = '链接双链，如 [[xxx-详情]]';

		const rmRow = wrap.createDiv({ cls: 'op-detail__row' });
		const rmChk = rmRow.createEl('input', { attr: { type: 'checkbox' } });
		rmChk.checked = item.starred;
		rmRow.createSpan({ text: ' 星标（重要/待跟进）' });

		const openBtn = wrap.createEl('button', { cls: 'op-detail__btn op-detail__btn--ghost', text: '打开链接' });
		openBtn.addEventListener('click', () => void this.openLink({ ...item, link: linkInput.value }));

		const btnRow = wrap.createDiv({ cls: 'op-detail__actions' });
		const saveBtn = btnRow.createEl('button', { cls: 'op-detail__btn op-detail__btn--primary', text: UI_TEXT.save });
		const delBtn = btnRow.createEl('button', { cls: 'op-detail__btn op-detail__btn--danger', text: UI_TEXT.delete });

		saveBtn.addEventListener('click', () => {
			// 汇总阶段输入框：保留「当前不可见阶段」的历史内容，覆盖可见阶段（留空=清空）
			const visibleLabels = new Set(this.host.plugin.settings.boardStages.filter((s) => s.hasInput).map((s) => s.label));
			const sn: Record<string, string> = {};
			for (const [k, v] of Object.entries(item.stageNotes || {})) {
				if (!visibleLabels.has(k)) sn[k] = v;
			}
			for (const si of stageInputs) {
				const v = si.area.value.trim();
				if (v) sn[si.label] = v;
			}
			void this.saveDetail(item, {
				title: titleInput.value.trim(),
				status: statusSel.value,
				tags: tagInput.value.split(/[，,、]/).map((t) => t.trim()).filter(Boolean),
				notes: notes.value.trim(),
				stageNotes: sn,
				link: linkInput.value.trim(),
				starred: rmChk.checked,
			});
		});
		delBtn.addEventListener('click', () => void this.deleteItem(item));
	}

	private async saveDetail(item: BoardItem, f: BoardFormData): Promise<void> {
		const path = this.boardPath();
		await updateOpportunity(this.host.app, path, item.id, {
			title: f.title, status: f.status, tags: f.tags, notes: f.notes, stageNotes: f.stageNotes, link: f.link, starred: f.starred,
		}, this.boardTitle());
		const idx = this.currentItems.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentItems[idx];
			if (cur) this.currentItems[idx] = { ...cur, ...f };
		}
		this.currentItems = sortBoardItems(this.currentItems, this.stageLabels());
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast('已保存');
		void this.refreshBoard();
	}

	private renderList(panel: HTMLElement, items: BoardItem[]): void {
		const chips = panel.createDiv({ cls: 'op-chips' });
		const mkChip = (label: string, active: boolean, onClick: () => void) => {
			const c = chips.createEl('button', { cls: 'op-chip' + (active ? ' is-active' : ''), text: label });
			c.addEventListener('click', onClick);
		};
		mkChip('全部', this.selectedStatus === 'all' && !this.showStarredOnly, () => {
			this.selectedStatus = 'all'; this.showStarredOnly = false; this.rerenderSidebarAndPanels();
		});
		for (const st of this.host.plugin.settings.boardStages) {
			mkChip(st.label, this.selectedStatus === st.label, () => {
				this.selectedStatus = st.label; this.showStarredOnly = false; this.rerenderSidebarAndPanels();
			});
		}

		const table = panel.createEl('table', { cls: 'po-tb2 op-tb' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		const cols: { key: string; label: string }[] = [
			{ key: 'title', label: '名称' },
			{ key: 'status', label: '状态' },
			{ key: 'createDate', label: '创建时间' },
			{ key: 'starred', label: '星标' },
		];
		for (const c of cols) {
			const th = headRow.createEl('th', { text: c.label });
			th.addEventListener('click', () => this.sortList(c.key));
		}
		const tbody = table.createEl('tbody');
		for (const it of this.sortedList(items)) {
			const tr = tbody.createEl('tr');
			tr.createEl('td', { text: it.title });
			const stTd = tr.createEl('td');
			const chip = stTd.createSpan({ cls: 'op-st' });
			chip.style.background = this.stageColor(it.status);
			chip.textContent = it.status;
			tr.createEl('td', { text: it.createDate || '-' });
			tr.createEl('td', { text: it.starred ? '★' : '-' });
			tr.addEventListener('click', () => this.openModal(it));
		}
	}

	private rerenderSidebarAndPanels(): void {
		const sidebar = this.host.boardEl?.querySelector('.op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderSidebar(sidebar);
		this.renderPanels();
	}

	private sortList(key: string): void {
		if (this.sortCol === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
		else { this.sortCol = key; this.sortDir = 'asc'; }
		const panel = this.mainEl?.querySelector('.po-panel[data-view="list"]') as HTMLElement | undefined;
		if (panel) this.renderPanel('list', panel, this.filteredItems());
	}

	private sortedList(items: BoardItem[]): BoardItem[] {
		const col = this.sortCol;
		const dir = this.sortDir === 'asc' ? 1 : -1;
		const cellStr = (v: unknown): string => {
			if (typeof v === 'string') return v;
			if (typeof v === 'number' || typeof v === 'boolean') return String(v);
			return '';
		};
		return [...items].sort((a, b) => {
			let av: string; let bv: string;
			if (col === 'starred') { av = a.starred ? '1' : '0'; bv = b.starred ? '1' : '0'; }
			else { av = cellStr((a as unknown as Record<string, unknown>)[col] ?? ''); bv = cellStr((b as unknown as Record<string, unknown>)[col] ?? ''); }
			return av.localeCompare(bv, 'zh-CN') * dir;
		});
	}

	private openModal(item?: BoardItem): void {
		const modal = new OpportunityModal({
			app: this.host.app,
			stages: this.host.plugin.settings.boardStages,
			title: this.boardTitle(),
			boardFile: this.boardPath(),
			editData: item,
			onSave: (data: BoardFormData) => { void this.onSave(data, item); },
		});
		modal.open();
	}

	private async openLink(it: BoardItem): Promise<void> {
		const link = (it.link || '').trim();
		if (!link) { this.host.showToast('该条目暂无链接'); return; }
		await this.host.app.workspace.openLinkText(link.replace(/^\[\[/, '').replace(/\]\]$/, ''), '', true);
	}

	private async onSave(data: BoardFormData, item?: BoardItem): Promise<void> {
		const path = this.boardPath();
		const title = this.boardTitle();
		if (item) {
			const patch: Partial<BoardItem> = {
				title: data.title, status: data.status, tags: data.tags, notes: data.notes, stageNotes: data.stageNotes, link: data.link, starred: data.starred,
			};
			await updateOpportunity(this.host.app, path, item.id, patch, title);
			const idx = this.currentItems.findIndex((i) => i.id === item.id);
			if (idx >= 0) {
				const cur = this.currentItems[idx];
				if (cur) this.currentItems[idx] = { ...cur, ...patch };
			}
		} else {
			const created = await createOpportunity(this.host.app, path, data, title);
			this.currentItems.push(created);
		}
		this.currentItems = sortBoardItems(this.currentItems, this.stageLabels());
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast(item ? (this.boardTitle() + '已更新') : (this.boardTitle() + '已创建'));
		void this.refreshBoard();
	}

	private async createItem(): Promise<void> {
		this.openModal(undefined);
	}

	private async setItemStatus(item: BoardItem, status: string): Promise<void> {
		const path = this.boardPath();
		await updateBoardItemStatus(this.host.app, path, item.id, status, this.boardTitle());
		const idx = this.currentItems.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentItems[idx];
			if (cur) {
				// 只改状态；星标是独立的「重要 / 待跟进」标记，不随状态切换被清除
				this.currentItems[idx] = { ...cur, status };
			}
		}
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast('状态已更新为「' + status + '」');
		void this.refreshBoard();
	}

	private async setItemStarred(item: BoardItem, val: boolean): Promise<void> {
		const path = this.boardPath();
		await toggleBoardItemStarred(this.host.app, path, item.id, val, this.boardTitle());
		const idx = this.currentItems.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentItems[idx];
			if (cur) this.currentItems[idx] = { ...cur, starred: val };
		}
		this.cache = { at: Date.now(), items: this.currentItems };
		void this.refreshBoard();
	}

	private async deleteItem(item: BoardItem): Promise<void> {
		const path = this.boardPath();
		await deleteOpportunity(this.host.app, path, item.id, this.boardTitle());
		this.currentItems = this.currentItems.filter((i) => i.id !== item.id);
		this.cache = { at: Date.now(), items: this.currentItems };
		this.host.showToast(this.boardTitle() + '已删除');
		void this.refreshBoard();
	}

	private async refreshBoard(): Promise<void> {
		if (this.host.currentPage !== 'opportunity') return;
		const items = await this.loadItems();
		if (this.host.currentPage !== 'opportunity' || !this.host.boardEl) return;
		this.currentItems = items;
		const sidebar = this.host.boardEl?.querySelector('.op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderSidebar(sidebar);
		this.renderPanels();
	}

}
