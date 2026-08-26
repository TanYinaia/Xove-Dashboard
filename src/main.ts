import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, DEFAULT_HOME_MODULES, HOME_LAYOUT_VERSION, DashboardSettings, DashboardSettingTab, CountdownSettings } from './settings';
import { DashboardView, VIEW_TYPE } from './views/DashboardView';
import type { BoardStage } from './data/opportunityParser';
import { setLang, getLang } from './i18n';

export default class Dashboard extends Plugin {
	settings!: DashboardSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

		this.addRibbonIcon('layout-dashboard', 'Xove dashboard', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-dashboard',
			name: 'Open dashboard',
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new DashboardSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		const loaded = ((await this.loadData()) ?? {}) as Partial<DashboardSettings> & {
			quickCapture?: { templateFolder?: string; templateFile?: string };
			diary?: { templateFolder?: string; templateFile?: string };
		};
		// ⚠️ 必须在 Object.assign 之前取原始版本号：合并后缺失字段会被默认值填成最新版，
		//    迁移判断就永远不会触发（老用户的错误比例将无法被纠正）。
		const storedLayoutVersion = typeof loaded.homeLayoutVersion === 'number' ? loaded.homeLayoutVersion : 0;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		// 迁移：旧版「模板文件夹 + 模板文件名」合并为「模板文件（完整路径）」
		for (const key of ['quickCapture', 'diary'] as const) {
			const grp = loaded[key];
			if (grp && grp.templateFolder && grp.templateFile && !grp.templateFile.includes('/') && !grp.templateFile.endsWith('.md')) {
				(this.settings[key] as { templateFile: string }).templateFile = `${grp.templateFolder}/${grp.templateFile}`;
			}
		}
		// 归一化首页模块布局：旧版数据可能缺失 cols/rows 字段，导致所有卡片回退为 1:1
		// 且比例/顺序无法持久化。此处补全缺失字段、补齐新增模块，并按需执行版本迁移。
		this.normalizeHomeModules(storedLayoutVersion);
		// 迁移看板阶段结构：旧数据用 kind(终态)，新结构用 hasInput(是否启用输入框)。
		this.normalizeBoardStages();
		// 同步 i18n 模块的语言状态（zh=中英结合默认 / en=纯英文）
		setLang(this.settings.language ?? 'zh');
		// 向后兼容迁移：倒计时单对象→数组、banner 增加 enabled、看板默认名随语言
		this.normalizeSettings();
	}

	/**
	 * 归一化 + 迁移首页模块布局，保证 homeModules 始终是一份完整可用的数据：
	 * 1. 缺失/损坏 → 直接用默认布局；
	 * 2. 补齐新增模块（老 data.json 不含新卡片时不会「丢卡」）；
	 * 3. 修正非法的 cols/rows/order/enabled；
	 * 4. 版本迁移：storedVersion < HOME_LAYOUT_VERSION 时，把 cols/rows 重置为最新默认值
	 *    （保留用户的显隐与排序）。此前比例功能存在 bug 从未真正落盘，故一次性纠正是安全的。
	 */
	private normalizeHomeModules(storedVersion: number): void {
		const defaults = new Map(DEFAULT_HOME_MODULES.map((m) => [m.id, m]));
		let hm = this.settings.homeModules;
		let changed = false;

		if (!Array.isArray(hm) || hm.length === 0) {
			hm = DEFAULT_HOME_MODULES.map((m) => ({ ...m }));
			this.settings.homeModules = hm;
			changed = true;
		}

		// 补齐 data.json 中缺失的模块（版本升级新增卡片时不丢卡）
		for (const d of DEFAULT_HOME_MODULES) {
			if (!hm.some((m) => m.id === d.id)) {
				hm.push({ ...d, order: hm.length });
				changed = true;
			}
		}

		const migrate = storedVersion < HOME_LAYOUT_VERSION;
		for (const m of hm) {
			const d = defaults.get(m.id);
			const dc = d?.cols ?? 1;
			const dr = d?.rows ?? 1;
			// 迁移：强制回到最新默认比例（仅比例，显隐/顺序保留）
			if (migrate && d) {
				if (m.cols !== dc || m.rows !== dr) { m.cols = dc; m.rows = dr; changed = true; }
			}
			if (typeof m.cols !== 'number' || !Number.isFinite(m.cols) || m.cols < 1 || m.cols > 4) { m.cols = dc; changed = true; }
			if (typeof m.rows !== 'number' || !Number.isFinite(m.rows) || m.rows < 1 || m.rows > 4) { m.rows = dr; changed = true; }
			if (typeof m.order !== 'number' || !Number.isFinite(m.order)) { m.order = 0; changed = true; }
			if (typeof m.enabled !== 'boolean') { m.enabled = true; changed = true; }
		}

		// order 去重并压实为 0..n-1，避免相同 order 导致排序不稳定（表现为「顺序时好时坏」）
		const sorted = [...hm].sort((a, b) => a.order - b.order);
		sorted.forEach((m, i) => {
			if (m.order !== i) { m.order = i; changed = true; }
		});

		if (this.settings.homeLayoutVersion !== HOME_LAYOUT_VERSION) {
			this.settings.homeLayoutVersion = HOME_LAYOUT_VERSION;
			changed = true;
		}
		if (changed) void this.saveSettings();
	}

	/**
	 * 迁移看板阶段结构（向后兼容旧 data.json）：
	 * 旧结构 BoardStage 含 kind(终态)，新结构改为 hasInput(是否在该阶段启用输入框)。
	 * 迁移规则：由旧 kind 推导 hasInput（终态 done/dropped → false，其余 → true），
	 * 随后删除 kind 字段，保证旧数据无缝升级且不丢失任何阶段。
	 */
	private normalizeBoardStages(): void {
		const defs = DEFAULT_SETTINGS.boardStages;
		let stages = this.settings.boardStages;
		let changed = false;

		if (!Array.isArray(stages) || stages.length === 0) {
			stages = defs.map((s) => ({ ...s }));
			this.settings.boardStages = stages;
			changed = true;
		}

		for (const st of stages) {
			if (!st || typeof st !== 'object') continue;
			const raw = st as BoardStage & { kind?: string };
			if ('kind' in raw) {
				// 旧数据：由 kind 推导 hasInput，再删除 kind
				if (typeof raw.hasInput !== 'boolean') {
					raw.hasInput = raw.kind === 'done' || raw.kind === 'dropped' ? false : true;
				}
				delete (raw as { kind?: string }).kind;
				changed = true;
			} else if (typeof raw.hasInput !== 'boolean') {
				raw.hasInput = true;
				changed = true;
			}
		}

		if (changed) void this.saveSettings();
	}

	/** 向后兼容迁移（旧 data.json 升级，不丢数据）：
	 *  1. 倒计时由「单对象」升级为「数组」（最多 5 个）；
	 *  2. banner 增加 enabled 开关，旧数据默认开启；
	 *  3. 看板默认名随语言：中文默认「灵感收集」，英文默认「Inspirations」。
	 */
	private normalizeSettings(): void {
		let changed = false;

		// 1) 倒计时：单对象 → 数组（最多 5 个，且每个结构合法）
		const cd = this.settings.countdown as unknown;
		if (!Array.isArray(cd)) {
			const single = (cd && typeof cd === 'object')
				? (cd as CountdownSettings)
				: { eventName: '2027', targetDate: '2027-01-01' };
			this.settings.countdown = [single];
			changed = true;
		} else {
			let arr = cd as CountdownSettings[];
			if (arr.length > 5) { arr = arr.slice(0, 5); changed = true; }
			const valid = arr.filter((c) => c && typeof c === 'object' && typeof (c as CountdownSettings).eventName === 'string');
			if (valid.length !== arr.length || arr.length === 0) {
				this.settings.countdown = valid.length ? valid : [{ eventName: '2027', targetDate: '2027-01-01' }];
				changed = true;
			}
		}

		// 2) banner.enabled：旧数据缺失时默认开启
		if (typeof this.settings.banner?.enabled !== 'boolean') {
			this.settings.banner = { ...(this.settings.banner || { imageDataUrl: null, offsetY: 0 }), enabled: true };
			changed = true;
		}

		// 3) 看板默认名随语言（未自定义时）
		if (!this.settings.boardTitle || this.settings.boardTitle === '灵感收集') {
			this.settings.boardTitle = getLang() === 'en' ? 'Inspirations' : '灵感收集';
			changed = true;
		}

		if (changed) void this.saveSettings();
	}

	/** 恢复首页默认布局（显隐 / 顺序 / 比例全部回到默认） */
	async resetHomeLayout(): Promise<void> {
		this.settings.homeModules = DEFAULT_HOME_MODULES.map((m) => ({ ...m }));
		this.settings.homeLayoutVersion = HOME_LAYOUT_VERSION;
		await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Switch Obsidian's own light/dark appearance.
	 *
	 * `vault.setConfig('theme', ...)` is an internal (undocumented) API — it is the
	 * only way to drive the global appearance from a plugin, so it is called
	 * defensively and the body classes are updated as a fallback in case the
	 * internal call is missing or renamed in a future Obsidian release.
	 */
	setObsidianTheme(mode: 'light' | 'dark'): void {
		try {
			const vault = this.app.vault as unknown as { setConfig?: (key: string, value: unknown) => void };
			// 'moonstone' = light, 'obsidian' = dark (Obsidian's internal naming).
			vault.setConfig?.('theme', mode === 'light' ? 'moonstone' : 'obsidian');
		} catch (err) {
			console.error('[Dashboard] failed to set Obsidian theme', err);
		}
		// Reflect immediately regardless of the internal API's behaviour.
		document.body.classList.toggle('theme-light', mode === 'light');
		document.body.classList.toggle('theme-dark', mode === 'dark');
		this.app.workspace.trigger('css-change');
	}

	/** Current effective Obsidian appearance. */
	currentObsidianTheme(): 'light' | 'dark' {
		return document.body.classList.contains('theme-light') ? 'light' : 'dark';
	}

	/** Refresh the header theme toggle (icon + tooltip) in every open dashboard view. */
	refreshThemeButtons(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshThemeButton();
		}
	}

	/** Push the current custom-title setting into any open dashboard view. */
	refreshDashboardTitle(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshTitle();
		}
	}

	/** 设置页修改首页模块显隐/排序后，立即重建所有已打开的仪表盘首页 */
	refreshHome(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.rebuildHome();
		}
	}

	/** 语言切换后重建所有已打开的仪表盘视图（全部文案重渲染，无需重载） */
	refreshLanguage(): void {
		void (async () => {
			await this.app.workspace.detachLeavesOfType(VIEW_TYPE);
			await this.activateView();
		})();
	}

	/** 设置页修改看板开关/名称/阶段配置后，立即刷新所有已打开视图的导航与看板页（无需重启） */
	refreshNav(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshNav();
		}
	}

	/** 设置页切换「完成后不消失」等开关后，立即刷新所有已打开首页的 TODO 与本周待办卡片（无需切页） */
	refreshTodoHome(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) {
				view.refreshTodo();
				view.refreshWeekly();
			}
		}
	}

	/** 设置页开关顶部横幅后，立即重建所有已打开仪表盘视图的横幅显隐 */
	refreshBanner(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			const view = leaf.view;
			if (view instanceof DashboardView) view.refreshBanner();
		}
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0 && existing[0]) {
			void this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeaf('tab');
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE, active: true });
		void this.app.workspace.revealLeaf(leaf);
	}
}
