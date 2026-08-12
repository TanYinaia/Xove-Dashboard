import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, AgentDashboardSettings, AgentDashboardSettingTab } from './settings';
import { DashboardView, VIEW_TYPE } from './views/DashboardView';

export default class AgentDashboard extends Plugin {
	settings!: AgentDashboardSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new DashboardView(leaf, this));

		this.addRibbonIcon('layout-dashboard', 'Agent dashboard', () => {
			void this.activateView();
		});

		this.addCommand({
			id: 'open-dashboard',
			name: 'Open dashboard',
			callback: () => {
				void this.activateView();
			},
		});

		this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
	}

	onunload(): void {}

	async loadSettings(): Promise<void> {
		const loaded = ((await this.loadData()) ?? {}) as Partial<AgentDashboardSettings> & {
			quickCapture?: { templateFolder?: string; templateFile?: string };
			diary?: { templateFolder?: string; templateFile?: string };
		};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
		// 迁移：旧版「模板文件夹 + 模板文件名」合并为「模板文件（完整路径）」
		for (const key of ['quickCapture', 'diary'] as const) {
			const grp = loaded[key];
			if (grp && grp.templateFolder && grp.templateFile && !grp.templateFile.includes('/') && !grp.templateFile.endsWith('.md')) {
				(this.settings[key] as { templateFile: string }).templateFile = `${grp.templateFolder}/${grp.templateFile}`;
			}
		}
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
			console.error('[AgentDashboard] failed to set Obsidian theme', err);
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
