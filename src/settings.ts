import { App, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import AgentDashboard from './main';

export interface BannerSettings {
	imageDataUrl: string | null;
	offsetY: number;
}

export interface QuickCaptureSettings {
	storagePath: string;
	namingPattern: string;
	templateFolder: string;
	templateFile: string;
}

export interface DiarySettings {
	storagePath: string;
	namingPattern: string;
	templateFolder: string;
	templateFile: string;
}

export interface AgentDashboardSettings {
	banner: BannerSettings;
	quickCapture: QuickCaptureSettings;
	diary: DiarySettings;
	todoSourceFolder: string;
	projectsFolder: string;
	currentPoView: string;
	poProjectOrder: string[];
	poTaskOrder: string[];
	theme: 'auto' | 'dark' | 'light';
	/** When true, the dashboard theme button also switches Obsidian's global appearance. */
	themeSyncObsidian: boolean;
	dashboardTitle: string;
	npdpStages: string[];
	npdpMaxStage: number;
	npdpProgressFilter?: number;
	poGanttStatusFilter?: string[];
	opportunityFile: string;
	currentOppView: string;
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
	banner: { imageDataUrl: null, offsetY: 0 },
	quickCapture: {
		storagePath: '00 inbox/速记',
		namingPattern: 'YYYY-MM-DD HH-mm 捕捉',
		templateFolder: '',
		templateFile: '',
	},
	diary: {
		storagePath: 'Daily',
		namingPattern: 'YYYY-MM-DD',
		templateFolder: '',
		templateFile: '',
	},
	todoSourceFolder: '',
	projectsFolder: 'Projects',
	currentPoView: 'gantt',
	poProjectOrder: [],
	poTaskOrder: [],
	theme: 'auto',
	themeSyncObsidian: true,
	dashboardTitle: '',
	npdpStages: ['立项', '规划', '开发', '测试', '上线'],
	npdpMaxStage: 5,
	npdpProgressFilter: 5,
	poGanttStatusFilter: [],
	opportunityFile: 'Projects/机会点管理.md',
	currentOppView: 'kanban',
};

/* ---- helpers ---- */

function getVaultFolders(app: App): string[] {
	const folders = new Set<string>();
	folders.add('/');
	for (const file of app.vault.getFiles()) {
		if (file instanceof TFile && file.parent && file.parent.path !== '/') {
			folders.add(file.parent.path);
		}
	}
	const root = app.vault.getRoot();
	if (root) collectFolders(root, folders);
	return Array.from(folders).sort();
}

function collectFolders(folder: TFolder, out: Set<string>): void {
	for (const child of folder.children) {
		if (child instanceof TFolder) {
			out.add(child.path);
			collectFolders(child, out);
		}
	}
}

function getTemplateFiles(app: App, folder: string): string[] {
	if (!folder) return [];
	return app.vault
		.getMarkdownFiles()
		.filter((f) => f.path.startsWith(folder + '/'))
		.map((f) => f.basename)
		.sort();
}

function addFolderDropdown(setting: Setting, app: App, current: string, onChange: (v: string) => Promise<void>): void {
	setting.addDropdown((dropdown) => {
		const folders = getVaultFolders(app);
		for (const f of folders) dropdown.addOption(f, f);
		if (current && !folders.includes(current)) dropdown.addOption(current, current);
		dropdown.setValue(current);
		dropdown.onChange(async (v) => onChange(v));
	});
}

function addTemplateDropdown(setting: Setting, app: App, folder: string, current: string, onChange: (v: string) => Promise<void>): void {
	setting.addDropdown((dropdown) => {
		dropdown.addOption('', '不使用模板');
		const files = getTemplateFiles(app, folder);
		for (const f of files) dropdown.addOption(f, f);
		if (current && !files.includes(current)) dropdown.addOption(current, current);
		dropdown.setValue(current);
		dropdown.onChange(async (v) => onChange(v));
	});
}

export class AgentDashboardSettingTab extends PluginSettingTab {
	plugin: AgentDashboard;

	constructor(app: App, plugin: AgentDashboard) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		/* ---- 快速捕捉 ---- */
		new Setting(containerEl).setName('快速捕捉').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('存储路径').setDesc('捕捉笔记的存放位置'),
			this.app,
			this.plugin.settings.quickCapture.storagePath,
			async (v) => { this.plugin.settings.quickCapture.storagePath = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName('文件命名规则')
			.setDesc('支持变量：YYYY 年、MM 月、DD 日、HH 时、mm 分、SS 秒')
			.addText((t) => t
				.setPlaceholder('YYYY-MM-DD HH-mm 捕捉')
				.setValue(this.plugin.settings.quickCapture.namingPattern)
				.onChange(async (v) => { this.plugin.settings.quickCapture.namingPattern = v; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('模板文件夹')
			.setDesc('输入模板所在文件夹路径，如 templates')
			.addText((t) => t
				.setPlaceholder('templates')
				.setValue(this.plugin.settings.quickCapture.templateFolder)
				.onChange(async (v) => {
					this.plugin.settings.quickCapture.templateFolder = v;
					this.plugin.settings.quickCapture.templateFile = '';
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		const qcFolder = this.plugin.settings.quickCapture.templateFolder;
		addTemplateDropdown(
			new Setting(containerEl).setName('模板文件').setDesc('选择模板。支持 {{date}} {{time}} {{title}} {{content}}'),
			this.app, qcFolder, this.plugin.settings.quickCapture.templateFile,
			async (v) => { this.plugin.settings.quickCapture.templateFile = v; await this.plugin.saveSettings(); },
		);

		/* ---- TODO ---- */
		new Setting(containerEl).setName('TODO 待办').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('数据来源文件夹').setDesc('扫描该文件夹下的 Markdown 文件解析任务。留空则扫描整个知识库'),
			this.app,
			this.plugin.settings.todoSourceFolder,
			async (v) => { this.plugin.settings.todoSourceFolder = v; await this.plugin.saveSettings(); },
		);

		/* ---- 项目 ---- */
		new Setting(containerEl).setName('项目').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('项目文件夹').setDesc('存放项目文件的文件夹路径'),
			this.app,
			this.plugin.settings.projectsFolder,
			async (v) => { this.plugin.settings.projectsFolder = v; await this.plugin.saveSettings(); },
		);

		/* ---- 机会点 ---- */
		new Setting(containerEl).setName('机会点').setHeading();

		new Setting(containerEl)
			.setName('机会点文件路径')
			.setDesc('所有机会点统一存于此 Markdown 文件（frontmatter 数组）。填写库内相对路径，可含子文件夹，如 Projects/机会点管理.md。留空或文件不存在时会自动在该路径新建。')
			.addText((t) => t
				.setPlaceholder('Projects/机会点管理.md')
				.setValue(this.plugin.settings.opportunityFile)
				.onChange(async (v) => {
					this.plugin.settings.opportunityFile = v.trim() || 'Projects/机会点管理.md';
					await this.plugin.saveSettings();
				}),
			);

		/* ---- 新日记 ---- */
		new Setting(containerEl).setName('新日记').setHeading();

		addFolderDropdown(
			new Setting(containerEl).setName('日记存储路径').setDesc('日记笔记的存放位置'),
			this.app,
			this.plugin.settings.diary.storagePath,
			async (v) => { this.plugin.settings.diary.storagePath = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName('日记命名规则')
			.setDesc('支持变量：YYYY 年、MM 月、DD 日、HH 时、mm 分、SS 秒')
			.addText((t) => t
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.diary.namingPattern)
				.onChange(async (v) => { this.plugin.settings.diary.namingPattern = v; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName('日记模板文件夹')
			.setDesc('输入模板所在文件夹路径')
			.addText((t) => t
				.setPlaceholder('templates')
				.setValue(this.plugin.settings.diary.templateFolder)
				.onChange(async (v) => {
					this.plugin.settings.diary.templateFolder = v;
					this.plugin.settings.diary.templateFile = '';
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		const diaryFolder = this.plugin.settings.diary.templateFolder;
		addTemplateDropdown(
			new Setting(containerEl).setName('日记模板文件').setDesc('选择日记模板'),
			this.app, diaryFolder, this.plugin.settings.diary.templateFile,
			async (v) => { this.plugin.settings.diary.templateFile = v; await this.plugin.saveSettings(); },
		);

		/* ---- 外观 ---- */
		new Setting(containerEl).setName('外观').setHeading();

		new Setting(containerEl)
			.setName('主题')
			.setDesc('默认跟随 Obsidian 外观（深色/浅色随系统切换）')
			.addDropdown((dropdown) => {
				dropdown.addOption('auto', '跟随 Obsidian (Auto)');

				dropdown.addOption('dark', '深色 (Dark)');
				dropdown.addOption('light', '浅色 (Light)');
				dropdown.setValue(this.plugin.settings.theme);
				dropdown.onChange(async (v) => {
					const mode = v as 'auto' | 'dark' | 'light';
					if (this.plugin.settings.themeSyncObsidian && mode !== 'auto') {
						// Drive Obsidian's global appearance; the dashboard follows it via 'auto'.
						this.plugin.setObsidianTheme(mode);
						this.plugin.settings.theme = 'auto';
						dropdown.setValue('auto');
					} else {
						this.plugin.settings.theme = mode;
					}
					await this.plugin.saveSettings();
					this.applyTheme();
				});
			});

		new Setting(containerEl)
			.setName('主题联动 Obsidian')
			.setDesc('开启后，主页右上角的主题按钮会直接切换 Obsidian 整体外观（深色/浅色），仪表盘自动跟随；关闭则只切换仪表盘自身配色')
			.addToggle((t) => t
				.setValue(this.plugin.settings.themeSyncObsidian)
				.onChange(async (v) => {
					this.plugin.settings.themeSyncObsidian = v;
					await this.plugin.saveSettings();
					this.plugin.refreshThemeButtons();
				}),
			);

		new Setting(containerEl)
			.setName('插件标题')
			.setDesc('自定义仪表盘主标题（即“个人中心”那一行）。留空则使用默认标题 “MY DASHBOARD”，修改后立即生效，无需重载')
			.addText((t) => t
				.setPlaceholder('MY DASHBOARD')
				.setValue(this.plugin.settings.dashboardTitle)
				.onChange(async (v) => { this.plugin.settings.dashboardTitle = v; await this.plugin.saveSettings(); this.plugin.refreshDashboardTitle(); }),
			);

		/* ---- NPDP 阶段管道 ---- */
		new Setting(containerEl).setName('NPDP 阶段管道').setHeading();

		new Setting(containerEl)
			.setName('阶段数量')
			.setDesc('设置项目阶段的数量（4-6个）')
			.addDropdown((dropdown) => {
				for (const n of [4, 5, 6]) {
					dropdown.addOption(String(n), `${n} 个阶段`);
				}
				dropdown.setValue(String(this.plugin.settings.npdpMaxStage));
				dropdown.onChange(async (v) => {
					const newCount = parseInt(v);
					const current = this.plugin.settings.npdpStages;
					if (newCount > current.length) {
						while (this.plugin.settings.npdpStages.length < newCount) {
							this.plugin.settings.npdpStages.push(`阶段${this.plugin.settings.npdpStages.length + 1}`);
						}
					} else {
						this.plugin.settings.npdpStages = current.slice(0, newCount);
					}
					this.plugin.settings.npdpMaxStage = newCount;
					await this.plugin.saveSettings();
					this.display();
				});
			});

		for (let i = 0; i < this.plugin.settings.npdpStages.length; i++) {
			const idx = i;
			new Setting(containerEl)
				.setName(`阶段 ${idx + 1} 名称`)
				.setDesc(`自定义第 ${idx + 1} 个阶段的名称`)
				.addText((t) => t
					.setPlaceholder(`阶段 ${idx + 1}`)
					.setValue(this.plugin.settings.npdpStages[idx] ?? '')
					.onChange(async (v) => {
						this.plugin.settings.npdpStages[idx] = v;
						await this.plugin.saveSettings();
					}),
				);
		}

		new Setting(containerEl)
			.setName('项目进度卡片筛选')
			.setDesc('主页"项目进度"卡片显示不超过所选阶段的项目')
			.addDropdown((dropdown) => {
				for (let i = 0; i < this.plugin.settings.npdpStages.length; i++) {
					dropdown.addOption(String(i), `≤ ${this.plugin.settings.npdpStages[i]}`);
				}
				dropdown.addOption(String(this.plugin.settings.npdpStages.length), '显示全部');
				dropdown.setValue(String(this.plugin.settings.npdpProgressFilter ?? this.plugin.settings.npdpStages.length));
				dropdown.onChange(async (v) => {
					this.plugin.settings.npdpProgressFilter = parseInt(v);
					await this.plugin.saveSettings();
				});
			});
	}

	private applyTheme(): void {
		const t = this.plugin.settings.theme;
		const effective = t === 'auto'
			? (document.body.classList.contains('theme-light') ? 'light' : 'dark')
			: t;
		// Refresh every open dashboard view (not just the foreground one), so a
		// theme switch in Settings applies immediately to all of them.
		this.app.workspace.getLeavesOfType('agent-dashboard-view').forEach((leaf) => {
			leaf.view?.containerEl?.querySelector('.agent-dashboard')?.setAttribute('data-theme', effective);
		});
		// Fallback for any stray element still in the DOM.
		document.querySelectorAll('.agent-dashboard').forEach((el) => el.setAttribute('data-theme', effective));
		this.plugin.refreshThemeButtons();
	}
}
