import { Menu } from 'obsidian';
import type { App } from 'obsidian';
import { OpportunityModal } from './OpportunityModal';
import {
	OpportunityItem, OpportunityFormData, OpportunityStatus,
	OPPORTUNITY_STATUS_LIST, OPPORTUNITY_STATUS_CLASS, OPPORTUNITY_STATUS_DOT,
	sortOpportunities,
	ensureOpportunityFile, parseOpportunitiesFile, writeOpportunitiesFile,
	createOpportunity, updateOpportunity, updateOpportunityStatus, toggleOpportunityRoadmap, deleteOpportunity,
	DEFAULT_OPPORTUNITY_FILE,
} from '../data/opportunityParser';

/** Host surface the OpportunityBoard needs from its owner view. */
export interface OpportunityHost {
	app: App;
	plugin: {
		settings: { opportunityFile: string; currentOppView: string };
		saveSettings(): Promise<void>;
	};
	boardEl: HTMLElement | null;
	currentPage: 'home' | 'project' | 'opportunity';
	showToast(message: string, kind?: 'success' | 'error'): void;
}

/** 机会点看板（第三页）渲染器 — extracted from DashboardView. */
export class OpportunityBoard {
	private host: OpportunityHost;

	// Opportunity board state
	private currentOpportunities: OpportunityItem[] = [];
	private selectedOppStatus: string = 'all';
	private oppShowRoadmapOnly: boolean = false;
	private selectedOppDetailId: string | null = null; // 单状态模式下右侧详情面板选中的机会点
	private draggedOppId: string | null = null; // 看板拖拽中正在拖动的机会点 id
	private opMainEl: HTMLElement | null = null;
	private oppSortCol: string = '';
	private oppSortDir: 'asc' | 'desc' = 'asc';
	private oppRefreshTimer: number | null = null;
	private oppCache: { at: number; items: OpportunityItem[] } | null = null;

	constructor(host: OpportunityHost) {
		this.host = host;
	}

	/** Debounced refresh of the opportunity board (250ms) to coalesce rapid vault events. */
	scheduleRefresh(): void {
		if (this.oppRefreshTimer) window.clearTimeout(this.oppRefreshTimer);
		this.oppRefreshTimer = window.setTimeout(() => {
			this.oppRefreshTimer = null;
			void this.refreshOpportunityBoard();
		}, 250);
	}

	/** Cancel pending work (view close). */
	dispose(): void {
		if (this.oppRefreshTimer) { window.clearTimeout(this.oppRefreshTimer); this.oppRefreshTimer = null; }
	}
	private opportunityPath(): string {
		return this.host.plugin.settings.opportunityFile || DEFAULT_OPPORTUNITY_FILE;
	}

	private async loadOpportunities(): Promise<OpportunityItem[]> {
		const now = Date.now();
		if (this.oppCache && now - this.oppCache.at < 300) return this.oppCache.items;
		const path = this.opportunityPath();
		await ensureOpportunityFile(this.host.app, path);
		const items = await parseOpportunitiesFile(this.host.app, path);
		const sorted = sortOpportunities(items);
		this.oppCache = { at: now, items: sorted };
		return sorted;
	}

	private async saveOpportunities(items: OpportunityItem[]): Promise<void> {
		const path = this.opportunityPath();
		await writeOpportunitiesFile(this.host.app, path, items);
		this.oppCache = { at: Date.now(), items: sortOpportunities(items) };
	}

	async show(): Promise<void> {
		if (!this.host.boardEl) return;
		const items = await this.loadOpportunities();
		this.host.boardEl.empty();
		this.host.boardEl.removeClass('ad-board');
		this.host.boardEl.removeClass('po-board');
		this.host.boardEl.addClass('op-board');
		this.host.currentPage = 'opportunity';

		this.currentOpportunities = items;
		this.selectedOppStatus = 'all';
		this.oppShowRoadmapOnly = false;
		this.selectedOppDetailId = null;

		const container = this.host.boardEl.createDiv({ cls: 'po-container op-container' });
		const sidebar = container.createDiv({ cls: 'po-sidebar op-sidebar' });
		this.renderOpportunitySidebar(sidebar);
		this.opMainEl = container.createDiv({ cls: 'po-main op-main' });
		this.renderOpportunityPanels();
	}

	private renderOpportunitySidebar(sidebar: HTMLElement): void {
		sidebar.empty();
		const list = sidebar.createDiv({ cls: 'po-sidebar__list' });
		const items = this.currentOpportunities;
		const total = items.length;

		const allItem = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedOppStatus === 'all' && !this.oppShowRoadmapOnly ? ' is-active' : '') });
		allItem.createSpan({ cls: 'po-dot', attr: { style: 'background:var(--ad-accent);color:var(--ad-accent)' } });
		allItem.createSpan({ text: '全部机会点' });
		allItem.createSpan({ cls: 'po-count', text: String(total) });
		allItem.addEventListener('click', () => {
			this.selectedOppStatus = 'all';
			this.oppShowRoadmapOnly = false;
			this.selectedOppDetailId = null;
			this.renderOpportunitySidebar(sidebar);
			this.renderOpportunityPanels();
		});

		for (const st of OPPORTUNITY_STATUS_LIST) {
			const count = items.filter((i) => i.status === st).length;
			const item = list.createDiv({ cls: 'po-sidebar__item' + (this.selectedOppStatus === st ? ' is-active' : '') });
			item.createSpan({ cls: 'po-dot', attr: { style: 'background:' + OPPORTUNITY_STATUS_DOT[st] + ';color:' + OPPORTUNITY_STATUS_DOT[st] } });
			item.createSpan({ text: st });
			item.createSpan({ cls: 'po-count', text: String(count) });
			item.addEventListener('click', () => {
				this.selectedOppStatus = st;
				this.oppShowRoadmapOnly = false;
				this.selectedOppDetailId = null;
				this.renderOpportunitySidebar(sidebar);
				this.renderOpportunityPanels();
			});
		}

		const rmItem = list.createDiv({ cls: 'po-sidebar__item' + (this.oppShowRoadmapOnly ? ' is-active' : '') });
		rmItem.createSpan({ cls: 'po-dot', attr: { style: 'background:#eab308;color:#eab308' } });
		rmItem.createSpan({ text: '★ 转路标' });
		rmItem.createSpan({ cls: 'po-count', text: String(items.filter((i) => i.toRoadmap).length) });
		rmItem.addEventListener('click', () => {
			this.oppShowRoadmapOnly = !this.oppShowRoadmapOnly;
			this.selectedOppStatus = 'all';
			this.selectedOppDetailId = null;
			this.renderOpportunitySidebar(sidebar);
			this.renderOpportunityPanels();
		});
	}

	private renderOpportunityPanels(): void {
		if (!this.opMainEl) return;
		this.opMainEl.empty();
		const items = this.filteredOpportunities();
		const tabs = this.opMainEl.createDiv({ cls: 'po-tabs' });
		const tabDefs = [
			{ key: 'kanban', label: '▦ 看板' },
			{ key: 'list', label: '☰ 列表' },
		];
		const content = this.opMainEl.createDiv({ cls: 'po-content' });
		const panels: Record<string, HTMLElement> = {};
		const cur = this.host.plugin.settings.currentOppView || 'kanban';
		for (const td of tabDefs) {
			const btn = tabs.createEl('button', { cls: 'po-tab' + (td.key === cur ? ' is-active' : ''), text: td.label });
			btn.dataset.view = td.key;
			panels[td.key] = content.createDiv({ cls: 'po-panel' + (td.key === cur ? ' is-active' : ''), attr: { 'data-view': td.key } });
		}
		const newBtn = tabs.createEl('button', { cls: 'po-add-btn op-new-btn', text: '+ 新建机会点' });
		newBtn.addEventListener('click', (e) => { e.stopPropagation(); void this.createOpportunityFile(); });
		this.renderOppPanel(cur, panels[cur]!, items);
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
			if (panels[view]) this.renderOppPanel(view, panels[view], this.filteredOpportunities());
		});
	}

	private filteredOpportunities(): OpportunityItem[] {
		let items = this.currentOpportunities;
		if (this.oppShowRoadmapOnly) items = items.filter((i) => i.toRoadmap);
		else if (this.selectedOppStatus !== 'all') items = items.filter((i) => i.status === this.selectedOppStatus);
		return items;
	}

	private renderOppPanel(key: string, panel: HTMLElement, items: OpportunityItem[]): void {
		panel.empty();
		if (key === 'kanban') this.renderOpportunityKanban(panel, items);
		else if (key === 'list') this.renderOpportunityList(panel, items);
	}

	private renderOpportunityKanban(panel: HTMLElement, items: OpportunityItem[]): void {
		const singleMode = this.selectedOppStatus !== 'all' && !this.oppShowRoadmapOnly;
		const statuses = singleMode ? [this.selectedOppStatus as OpportunityStatus] : OPPORTUNITY_STATUS_LIST;
		const board = panel.createDiv({ cls: 'po-kanban op-kanban' + (singleMode ? ' op-kanban--single' : '') });

		// 单状态模式：默认选中排序第一个；若当前选中项已不在本状态则回退
		if (singleMode) {
			const ordered = sortOpportunities(items);
			if (!this.selectedOppDetailId || !items.some((i) => i.id === this.selectedOppDetailId)) {
				this.selectedOppDetailId = ordered.length ? (ordered[0]?.id ?? null) : null;
			}
		}

		for (const st of statuses) {
			const colEl = board.createDiv({ cls: 'po-kanban__col op-kanban__col' });
			colEl.dataset.status = st;
			const hd = colEl.createDiv({ cls: 'po-kanban__hd' });
			hd.createSpan({ text: st });
			const ct = items.filter((i) => i.status === st).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
			hd.createSpan({ cls: 'po-kanban__count', text: String(ct.length) });
			if (ct.length === 0) colEl.createDiv({ cls: 'op-empty-col' });

			ct.forEach((it) => {
				const card = colEl.createDiv({ cls: 'po-kanban__card op-card' + (singleMode && it.id === this.selectedOppDetailId ? ' is-selected' : '') });
				card.draggable = true;
				card.dataset.oppId = it.id;
				const chip = card.createDiv({ cls: 'op-st ' + OPPORTUNITY_STATUS_CLASS[st] });
				chip.textContent = st;
				const title = card.createDiv({ cls: 'op-card__title' });
				title.textContent = it.title;
				const desc = card.createDiv({ cls: 'op-card__desc' });
				desc.textContent = it.background || it.commConclusion || '';
				if (it.toRoadmap) card.createDiv({ cls: 'op-badge--roadmap', text: '★ 转路标' });
				card.addEventListener('click', () => {
					if (singleMode) {
						this.selectedOppDetailId = it.id;
						board.querySelectorAll('.op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.op-detail');
						if (detail instanceof HTMLElement) this.renderOppDetail(detail, it);
					} else {
						this.openOpportunityModal(it);
					}
				});
				card.addEventListener('contextmenu', (e) => {
					e.preventDefault();
					const menu = new Menu();
					menu.addItem((m) => m.setTitle('编辑').setIcon('pencil').onClick(() => this.openOpportunityModal(it)));
					if (singleMode) menu.addItem((m) => m.setTitle('在右侧查看').setIcon('eye').onClick(() => {
						this.selectedOppDetailId = it.id;
						board.querySelectorAll('.op-card').forEach((c) => c.removeClass('is-selected'));
						card.addClass('is-selected');
						const detail = board.querySelector('.op-detail');
						if (detail instanceof HTMLElement) this.renderOppDetail(detail, it);
					}));
					menu.addItem((m) => m.setTitle('打开详情双链').setIcon('file-text').onClick(() => void this.openOpportunityDetail(it)));
					menu.addSeparator();
					for (const s of OPPORTUNITY_STATUS_LIST) {
						menu.addItem((m) => m.setTitle('状态: ' + s).onClick(() => void this.setOpportunityStatus(it, s)));
					}
					menu.addSeparator();
					menu.addItem((m) => m.setTitle(it.toRoadmap ? '取消转路标' : '标记为转路标').setIcon('flag').onClick(() => void this.setOpportunityRoadmap(it, !it.toRoadmap)));
					menu.addItem((m) => m.setTitle('删除').setIcon('trash').onClick(() => void this.deleteOpportunityItem(it)));
					menu.showAtMouseEvent(e);
				});
			card.addEventListener('dragstart', (e) => {
				this.draggedOppId = it.id;
				e.dataTransfer?.setData('text/opp-id', it.id);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
				card.addClass('po-kanban__card--dragging');
			});
			card.addEventListener('dragend', () => { this.draggedOppId = null; card.removeClass('po-kanban__card--dragging'); });
			// 拖到某张卡片之前插入（用于列内/跨列排序）
			card.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; card.addClass('op-card--drag-over'); });
			card.addEventListener('dragleave', () => card.removeClass('op-card--drag-over'));
			card.addEventListener('drop', (e) => {
				e.preventDefault();
				e.stopPropagation();
				card.removeClass('op-card--drag-over');
				const id = this.draggedOppId ?? e.dataTransfer?.getData('text/opp-id');
				this.draggedOppId = null;
				if (!id) return;
				void this.reorderOpportunity(id, st, it.id);
			});
			});

			colEl.addEventListener('dragover', (e) => { e.preventDefault(); colEl.addClass('po-kanban__col--drag-over'); });
			colEl.addEventListener('dragleave', () => colEl.removeClass('po-kanban__col--drag-over'));
			// 拖到列空白区域：追加到该列末尾（跨列即改状态）
		colEl.addEventListener('drop', (e) => {
			e.preventDefault();
			colEl.removeClass('po-kanban__col--drag-over');
			const id = this.draggedOppId ?? e.dataTransfer?.getData('text/opp-id');
			this.draggedOppId = null;
			if (!id) return;
			void this.reorderOpportunity(id, st);
		});
		}

		// 单状态模式：右侧详情面板（内联编辑器）
		if (singleMode) {
			const detail = board.createDiv({ cls: 'op-detail' });
			const sel = items.find((i) => i.id === this.selectedOppDetailId) || sortOpportunities(items)[0];
			if (sel) this.renderOppDetail(detail, sel);
			else detail.createSpan({ text: '（该状态暂无机会点）' });
		}
	}

	/** 手动排序：把 draggedId 放到 targetStatus 列中 beforeId 之前（省略 beforeId 则追加到末尾）。 */
	private async reorderOpportunity(draggedId: string, targetStatus: OpportunityStatus, beforeId?: string): Promise<void> {
		if (beforeId && beforeId === draggedId) return;
		const items = this.currentOpportunities;
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
		const reordered: OpportunityItem[] = [];
		let n = 0;
		for (let k = 0; k < colItems.length + 1; k++) {
			if (k === insertIdx) { reordered.push({ ...dragged, status: targetStatus, order: n }); n++; }
			if (k < colItems.length) { reordered.push({ ...colItems[k], order: n } as OpportunityItem); n++; }
		}
		const map = new Map(reordered.map((i) => [i.id, i]));
		const next = items.map((i) => map.get(i.id) ?? i);
		this.currentOpportunities = sortOpportunities(next);
		await this.saveOpportunities(this.currentOpportunities);
		void this.refreshOpportunityBoard();
	}

	/** 单状态模式下，右侧内联详情编辑器 */
	private renderOppDetail(container: HTMLElement, item: OpportunityItem): void {
		container.empty();
		const wrap = container.createDiv({ cls: 'op-detail__inner' });
		wrap.createDiv({ cls: 'op-detail__hd', text: '机会点详情' });

		const titleInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		titleInput.value = item.title; titleInput.placeholder = '机会点名称';

		const statusSel = wrap.createEl('select', { cls: 'ad-modal-input' });
		for (const s of OPPORTUNITY_STATUS_LIST) {
			const o = statusSel.createEl('option', { value: s, text: s });
			if (s === item.status) o.selected = true;
		}

		const tagInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		tagInput.value = (item.tags || []).join('、'); tagInput.placeholder = '标签，顿号/逗号分隔';

		const bg = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '3' } });
		bg.value = item.background || ''; bg.placeholder = '背景 / 描述';

		const comm = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2' } });
		comm.value = item.commConclusion || ''; comm.placeholder = '沟通结论';

		const res = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2' } });
		res.value = item.researchConclusion || ''; res.placeholder = '调研结论';

		const meet = wrap.createEl('textarea', { cls: 'ad-modal-input', attr: { rows: '2' } });
		meet.value = item.meetingConclusion || ''; meet.placeholder = '上会结论';

		const rmRow = wrap.createDiv({ cls: 'op-detail__row' });
		const rmChk = rmRow.createEl('input', { attr: { type: 'checkbox' } });
		rmChk.checked = item.toRoadmap;
		rmChk.disabled = item.status !== '已完成';
		rmRow.createSpan({ text: ' 转路标（仅「已完成」可勾）' });

		const detailInput = wrap.createEl('input', { cls: 'ad-modal-input', attr: { type: 'text' } });
		detailInput.value = item.detail || ''; detailInput.placeholder = '详情双链，如 [[机会点-xxx-详情]]';
		const openBtn = wrap.createEl('button', { cls: 'op-detail__btn op-detail__btn--ghost', text: '打开详情双链' });
		openBtn.addEventListener('click', () => void this.openOpportunityDetail({ ...item, detail: detailInput.value }));

		const btnRow = wrap.createDiv({ cls: 'op-detail__actions' });
		const saveBtn = btnRow.createEl('button', { cls: 'op-detail__btn op-detail__btn--primary', text: '保存' });
		const delBtn = btnRow.createEl('button', { cls: 'op-detail__btn op-detail__btn--danger', text: '删除' });

		saveBtn.addEventListener('click', () => {
			void this.saveOpportunityDetail(item, {
				title: titleInput.value.trim(),
				status: statusSel.value as OpportunityStatus,
				tags: tagInput.value.split(/[，,、]/).map((t) => t.trim()).filter(Boolean),
				background: bg.value.trim(),
				commConclusion: comm.value.trim(),
				researchConclusion: res.value.trim(),
				meetingConclusion: meet.value.trim(),
				toRoadmap: rmChk.checked,
				detail: detailInput.value.trim(),
			});
		});
		delBtn.addEventListener('click', () => void this.deleteOpportunityItem(item));
	}

	private async saveOpportunityDetail(item: OpportunityItem, f: {
		title: string; status: OpportunityStatus; tags: string[]; background: string;
		commConclusion: string; researchConclusion: string; meetingConclusion: string; toRoadmap: boolean; detail: string;
	}): Promise<void> {
		const path = this.opportunityPath();
		await updateOpportunity(this.host.app, path, item.id, {
			title: f.title, status: f.status, tags: f.tags, background: f.background,
			commConclusion: f.commConclusion, researchConclusion: f.researchConclusion,
			meetingConclusion: f.meetingConclusion, toRoadmap: f.toRoadmap, detail: f.detail,
		});
		const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) this.currentOpportunities[idx] = { ...cur, ...f };
		}
		this.currentOpportunities = sortOpportunities(this.currentOpportunities);
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.host.showToast('已保存');
		void this.refreshOpportunityBoard();
	}

	private renderOpportunityList(panel: HTMLElement, items: OpportunityItem[]): void {
		const chips = panel.createDiv({ cls: 'op-chips' });
		const mkChip = (label: string, active: boolean, onClick: () => void) => {
			const c = chips.createEl('button', { cls: 'op-chip' + (active ? ' is-active' : ''), text: label });
			c.addEventListener('click', onClick);
		};
		mkChip('全部', this.selectedOppStatus === 'all' && !this.oppShowRoadmapOnly, () => {
			this.selectedOppStatus = 'all'; this.oppShowRoadmapOnly = false; this.rerenderOppSidebarAndPanels();
		});
		for (const st of OPPORTUNITY_STATUS_LIST) {
			mkChip(st, this.selectedOppStatus === st, () => {
				this.selectedOppStatus = st; this.oppShowRoadmapOnly = false; this.rerenderOppSidebarAndPanels();
			});
		}

		const table = panel.createEl('table', { cls: 'po-tb2 op-tb' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		const cols: { key: string; label: string }[] = [
			{ key: 'title', label: '名称' },
			{ key: 'status', label: '状态' },
			{ key: 'createDate', label: '创建时间' },
			{ key: 'toRoadmap', label: '转路标' },
		];
		for (const c of cols) {
			const th = headRow.createEl('th', { text: c.label });
			th.addEventListener('click', () => this.sortOppList(c.key));
		}
		const tbody = table.createEl('tbody');
		for (const it of this.sortedOppList(items)) {
			const tr = tbody.createEl('tr');
			tr.createEl('td', { text: it.title });
			const stTd = tr.createEl('td');
			stTd.createSpan({ cls: 'op-st ' + OPPORTUNITY_STATUS_CLASS[it.status], text: it.status });
			tr.createEl('td', { text: it.createDate || '-' });
			tr.createEl('td', { text: it.toRoadmap ? '★' : '-' });
			tr.addEventListener('click', () => this.openOpportunityModal(it));
		}
	}

	private rerenderOppSidebarAndPanels(): void {
		const sidebar = this.host.boardEl?.querySelector('.op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderOpportunitySidebar(sidebar);
		this.renderOpportunityPanels();
	}

	private sortOppList(key: string): void {
		if (this.oppSortCol === key) this.oppSortDir = this.oppSortDir === 'asc' ? 'desc' : 'asc';
		else { this.oppSortCol = key; this.oppSortDir = 'asc'; }
		const panel = this.opMainEl?.querySelector('.po-panel[data-view="list"]') as HTMLElement | undefined;
		if (panel) this.renderOppPanel('list', panel, this.filteredOpportunities());
	}

	private sortedOppList(items: OpportunityItem[]): OpportunityItem[] {
		const col = this.oppSortCol;
		const dir = this.oppSortDir === 'asc' ? 1 : -1;
		const cellStr = (v: unknown): string => {
			if (typeof v === 'string') return v;
			if (typeof v === 'number' || typeof v === 'boolean') return String(v);
			return '';
		};
		return [...items].sort((a, b) => {
			let av: string; let bv: string;
			if (col === 'toRoadmap') { av = a.toRoadmap ? '1' : '0'; bv = b.toRoadmap ? '1' : '0'; }
			else { av = cellStr((a as unknown as Record<string, unknown>)[col] ?? ''); bv = cellStr((b as unknown as Record<string, unknown>)[col] ?? ''); }
			return av.localeCompare(bv, 'zh-CN') * dir;
		});
	}

	private openOpportunityModal(item?: OpportunityItem): void {
		const modal = new OpportunityModal({
			app: this.host.app,
			editData: item,
			onSave: (data: OpportunityFormData) => { void this.onOpportunitySave(data, item); },
		});
		modal.open();
	}

	private async openOpportunityDetail(it: OpportunityItem): Promise<void> {
		const link = (it.detail || '').trim();
		if (!link) { this.host.showToast('该机会点暂无详情双链'); return; }
		await this.host.app.workspace.openLinkText(link.replace(/^\[\[/, '').replace(/\]\]$/, ''), '', true);
	}

	private async onOpportunitySave(data: OpportunityFormData, item?: OpportunityItem): Promise<void> {
		const path = this.opportunityPath();
		if (item) {
			const patch: Partial<OpportunityItem> = {
				title: data.title, status: data.status, tags: data.tags, background: data.background,
				commConclusion: data.commConclusion, researchConclusion: data.researchConclusion,
				meetingConclusion: data.meetingConclusion,
				toRoadmap: data.toRoadmap, detail: data.detail,
			};
			await updateOpportunity(this.host.app, path, item.id, patch);
			const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
			if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) this.currentOpportunities[idx] = { ...cur, ...patch };
		}
		} else {
			const created = await createOpportunity(this.host.app, path, data);
			this.currentOpportunities.push(created);
		}
		this.currentOpportunities = sortOpportunities(this.currentOpportunities);
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.host.showToast(item ? '机会点已更新' : '机会点已创建');
		void this.refreshOpportunityBoard();
	}

	private async createOpportunityFile(): Promise<void> {
		this.openOpportunityModal(undefined);
	}

	private async setOpportunityStatus(item: OpportunityItem, status: OpportunityStatus): Promise<void> {
		const path = this.opportunityPath();
		await updateOpportunityStatus(this.host.app, path, item.id, status);
		const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) {
				this.currentOpportunities[idx] = {
					...cur,
					status,
					toRoadmap: status === '已完成' ? cur.toRoadmap : false,
				};
			}
		}
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.host.showToast('状态已更新为「' + status + '」');
		void this.refreshOpportunityBoard();
	}

	private async setOpportunityRoadmap(item: OpportunityItem, val: boolean): Promise<void> {
		const path = this.opportunityPath();
		await toggleOpportunityRoadmap(this.host.app, path, item.id, val);
		const idx = this.currentOpportunities.findIndex((i) => i.id === item.id);
		if (idx >= 0) {
			const cur = this.currentOpportunities[idx];
			if (cur) this.currentOpportunities[idx] = { ...cur, toRoadmap: val };
		}
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		void this.refreshOpportunityBoard();
	}

	private async deleteOpportunityItem(item: OpportunityItem): Promise<void> {
		const path = this.opportunityPath();
		await deleteOpportunity(this.host.app, path, item.id);
		this.currentOpportunities = this.currentOpportunities.filter((i) => i.id !== item.id);
		this.oppCache = { at: Date.now(), items: this.currentOpportunities };
		this.host.showToast('机会点已删除');
		void this.refreshOpportunityBoard();
	}

	private async refreshOpportunityBoard(): Promise<void> {
		if (this.host.currentPage !== 'opportunity') return;
		const items = await this.loadOpportunities();
		// 异步加载期间用户可能已切到其它页面；渲染前重校验，避免把机会点内容渲染进其它页面。
		if (this.host.currentPage !== 'opportunity' || !this.host.boardEl) return;
		this.currentOpportunities = items;
		const sidebar = this.host.boardEl?.querySelector('.op-sidebar') as HTMLElement | undefined;
		if (sidebar) this.renderOpportunitySidebar(sidebar);
		this.renderOpportunityPanels();
	}

}