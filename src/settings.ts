import { App, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import AgentDashboard from './main';

export interface BannerSettings {
	imageDataUrl: string | null;
	offsetY: number;
}

export interface QuickCaptureSettings {
	storagePath: string;
	namingPattern: string;
	templateFile: string;
}

export interface DiarySettings {
	storagePath: string;
	namingPattern: string;
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
	dashboardTitle: string;
	npdpStages: string[];
	npdpMaxStage: number;
	npdpProgressFilter?: number;
	poGanttStatusFilter?: string[];
	poGanttScale?: 'day' | 'week' | 'month' | 'quarter';
	opportunityFile: string;
	currentOppView: string;
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
	banner: { imageDataUrl: null, offsetY: 0 },
	quickCapture: {
		storagePath: '00 inbox/速记',
		namingPattern: 'YYYY-MM-DD HH-mm 捕捉',
		templateFile: '',
	},
	diary: {
		storagePath: 'Daily',
		namingPattern: 'YYYY-MM-DD',
		templateFile: '',
	},
	todoSourceFolder: '',
	projectsFolder: 'Projects',
	currentPoView: 'gantt',
	poProjectOrder: [],
	poTaskOrder: [],
	theme: 'auto',
	dashboardTitle: '',
	npdpStages: ['立项', '规划', '开发', '测试', '上线'],
	npdpMaxStage: 5,
	npdpProgressFilter: 5,
	poGanttStatusFilter: [],
	poGanttScale: 'week',
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

function addFolderDropdown(setting: Setting, app: App, current: string, onChange: (v: string) => Promise<void>): void {
	setting.addDropdown((dropdown) => {
		const folders = getVaultFolders(app);
		for (const f of folders) dropdown.addOption(f, f);
		if (current && !folders.includes(current)) dropdown.addOption(current, current);
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
			.setName('模板文件')
			.setDesc('输入模板路径，不使用模板则为空')
			.addText((t) => t
				.setPlaceholder('Templates/速记.md')
				.setValue(this.plugin.settings.quickCapture.templateFile)
				.onChange(async (v) => {
					this.plugin.settings.quickCapture.templateFile = v.trim();
					await this.plugin.saveSettings();
				}),
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

		new Setting(containerEl)
			.setName('甘特图默认时间粒度')
			.setDesc('项目总览的甘特图默认以该粒度展示。重新打开项目总览或重载插件后生效；也可在甘特图界面直接点击缩放按钮临时切换（会自动记住）')
			.addDropdown((dropdown) => {
				dropdown.addOption('week', '周（默认）');
				dropdown.addOption('day', '日');
				dropdown.addOption('month', '月');
				dropdown.addOption('quarter', '季度');
				dropdown.setValue(this.plugin.settings.poGanttScale || 'week');
				dropdown.onChange(async (v) => {
					this.plugin.settings.poGanttScale = v as 'day' | 'week' | 'month' | 'quarter';
					await this.plugin.saveSettings();
				});
			});

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
			.setName('模板文件')
			.setDesc('输入模板路径，不使用模板则为空')
			.addText((t) => t
				.setPlaceholder('Templates/日记.md')
				.setValue(this.plugin.settings.diary.templateFile)
				.onChange(async (v) => {
					this.plugin.settings.diary.templateFile = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		/* ---- 外观 ---- */
		new Setting(containerEl).setName('外观').setHeading();

		new Setting(containerEl)
			.setName('主题')
			.setDesc('跟随 Obsidian 外观，或手动指定深色/浅色。手动选择会同时切换 Obsidian 整体外观，仪表盘自动跟随')
			.addDropdown((dropdown) => {
				dropdown.addOption('auto', '跟随 Obsidian');

				dropdown.addOption('dark', '深色');
				dropdown.addOption('light', '浅色');
				dropdown.setValue(this.plugin.settings.theme);
				dropdown.onChange(async (v) => {
					const mode = v as 'auto' | 'dark' | 'light';
					if (mode !== 'auto') {
						// 手动选择深色/浅色时，直接切换 Obsidian 整体外观，仪表盘通过 'auto' 跟随。
						this.plugin.setObsidianTheme(mode);
						this.plugin.settings.theme = 'auto';
						dropdown.setValue('auto');
					} else {
						this.plugin.settings.theme = 'auto';
					}
					await this.plugin.saveSettings();
					this.applyTheme();
				});
			});

		new Setting(containerEl)
			.setName('插件标题')
			.setDesc('自定义仪表盘主标题（即“MY DASHBOARD”那一行）。留空则使用默认标题 “MY DASHBOARD”，修改后立即生效，无需重载')
			.addText((t) => t
				.setPlaceholder('MY DASHBOARD')
				.setValue(this.plugin.settings.dashboardTitle)
				.onChange(async (v) => { this.plugin.settings.dashboardTitle = v; await this.plugin.saveSettings(); this.plugin.refreshDashboardTitle(); }),
			);

		/* ---- 阶段管道 ---- */
		new Setting(containerEl).setName('阶段管道').setHeading();

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
