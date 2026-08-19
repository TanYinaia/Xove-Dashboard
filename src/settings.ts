import { App, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import Dashboard from './main';
import type { BoardStage } from './data/opportunityParser';

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

/** 倒计时卡片自定义事件：事件名称与目标日期 */
export interface CountdownSettings {
	/** 事件名称，如「高考」「新年」；文案显示「距离 {eventName} 还有」 */
	eventName: string;
	/** 目标日期，ISO yyyy-mm-dd；非法或留空时回退到「下一年 1 月 1 日」 */
	targetDate: string;
}

/** 通用看板的一个阶段（看板列）— 结构定义见 src/data/opportunityParser.ts 的 BoardStage */
export type { BoardStage } from './data/opportunityParser';

export interface DashboardSettings {
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
	boardEnabled: boolean;
	boardTitle: string;
	boardStages: BoardStage[];
	opportunityFile: string;
	currentOppView: string;
	/** 首页模块显隐与排序：每个模块一个开关 + 顺序权重 + 比例；重置见「恢复默认布局」 */
	homeModules?: HomeModuleConfig[];
	/** 首页布局数据版本；低于 HOME_LAYOUT_VERSION 时由 main.ts 迁移并重置默认比例 */
	homeLayoutVersion?: number;
	/** 倒计时卡片自定义事件（事件名称 + 目标日期） */
	countdown: CountdownSettings;
}

/**
 * 首页布局数据版本。
 * 每当「默认比例」发生变更、且需要覆盖用户 data.json 中的旧值时递增。
 * v2：修正 projects（项目情况）为宽 2 高 1；heatmap（笔记统计）最低宽 3 高 1（即 3:1）。
 * v3：默认布局重排为 快捕/todo/进度 各 1×1、本周待办 1×2、项目情况 3×1、笔记统计 3×1、倒计时 1×1。
 */
export const HOME_LAYOUT_VERSION = 3;

/** 首页单个模块的显隐/排序/比例配置 */
export interface HomeModuleConfig {
	id: string;
	enabled: boolean;
	order: number;
	/** 宽度所占网格列数（1-4，4 = 页面最宽），默认 1 */
	cols?: number;
	/** 高度所占网格行比例（与 cols 共同决定卡片比例；如 2×1 为宽卡，1×2 为竖卡），默认 1 */
	rows?: number;
}

export const DEFAULT_SETTINGS: DashboardSettings = {
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
	boardEnabled: true,
	boardTitle: '灵感收集',
	boardStages: [
		{ id: 'inbox', label: '收集箱', color: '#888780', hasInput: true },
		{ id: 'eval', label: '评估中', color: '#378ADD', hasInput: true },
		{ id: 'doing', label: '进行中', color: '#185FA5', hasInput: true },
		{ id: 'done', label: '已完成', color: '#639922', hasInput: false },
		{ id: 'dropped', label: '已放弃', color: '#E24B4A', hasInput: false },
	],
	opportunityFile: '看板.md',
	currentOppView: 'kanban',
	homeLayoutVersion: HOME_LAYOUT_VERSION,
	countdown: { eventName: '2027', targetDate: '2027-01-01' },
	homeModules: [
		{ id: 'quick-capture', enabled: true, order: 0, cols: 1, rows: 1 },
		{ id: 'todo', enabled: true, order: 1, cols: 1, rows: 1 },
		{ id: 'progress', enabled: true, order: 2, cols: 1, rows: 1 },
		{ id: 'weekly', enabled: true, order: 3, cols: 1, rows: 2 },
		{ id: 'projects', enabled: true, order: 4, cols: 3, rows: 1 },
		{ id: 'heatmap', enabled: true, order: 5, cols: 3, rows: 1 },
		{ id: 'countdown', enabled: true, order: 6, cols: 1, rows: 1 },
	],
};

/** 首页模块默认布局（与 DEFAULT_SETTINGS.homeModules 保持一致，供「恢复默认布局」深拷贝） */
export const DEFAULT_HOME_MODULES: HomeModuleConfig[] = [
	{ id: 'quick-capture', enabled: true, order: 0, cols: 1, rows: 1 },
	{ id: 'todo', enabled: true, order: 1, cols: 1, rows: 1 },
	{ id: 'progress', enabled: true, order: 2, cols: 1, rows: 1 },
	{ id: 'weekly', enabled: true, order: 3, cols: 1, rows: 2 },
	{ id: 'projects', enabled: true, order: 4, cols: 3, rows: 1 },
	{ id: 'heatmap', enabled: true, order: 5, cols: 3, rows: 1 },
	{ id: 'countdown', enabled: true, order: 6, cols: 1, rows: 1 },
];

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

export class DashboardSettingTab extends PluginSettingTab {
	plugin: Dashboard;

	constructor(app: App, plugin: Dashboard) {
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
			.setDesc('支持变量：YYYY 年、MM 月(2位)、MMM 月缩写(如 8月)、DD 日；ddd 周日、dddd 星期日；HH 24时、hh 12时、mm 分、ss/SS 秒、A 上午/下午')
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

		/* ---- 看板 ---- */
		new Setting(containerEl).setName('看板').setHeading();

		new Setting(containerEl)
			.setName('启用看板')
			.setDesc('关闭后，顶部导航的看板入口与对应页面都会被隐藏；下方看板设置项同步折叠')
			.addToggle((t) => t
				.setValue(this.plugin.settings.boardEnabled)
				.onChange(async (v) => {
					this.plugin.settings.boardEnabled = v;
					await this.plugin.saveSettings();
					// 让所有已打开的仪表盘视图立即同步显示/隐藏看板入口，无需重启
					this.plugin.refreshNav();
					this.display();
				}),
			);

		// 看板相关设置项容器：看板关闭时整体折叠隐藏（联动）
		const boardOptions = containerEl.createDiv({ cls: 'dashboard-board-options' });
		if (!this.plugin.settings.boardEnabled) boardOptions.hide();

		new Setting(boardOptions)
			.setName('看板名称')
			.setDesc('导航与页面上显示的板块名称，可自定义（如 机会点 / 灵感收集 / 管道）')
			.addText((t) => t
				.setPlaceholder('看板')
				.setValue(this.plugin.settings.boardTitle)
				.onChange(async (v) => {
					this.plugin.settings.boardTitle = v.trim() || '看板';
					await this.plugin.saveSettings();
					this.plugin.refreshNav();
				}),
			);

		new Setting(boardOptions)
			.setName('看板数据文件')
			.setDesc('所有看板条目统一存于此 Markdown 文件（frontmatter 数组）。填写库内相对路径，可含子文件夹，如 看板.md。留空或文件不存在时会自动在该路径新建。')
			.addText((t) => t
				.setPlaceholder('看板.md')
				.setValue(this.plugin.settings.opportunityFile)
				.onChange(async (v) => {
					this.plugin.settings.opportunityFile = v.trim() || '看板.md';
					await this.plugin.saveSettings();
				}),
			);

		new Setting(boardOptions)
			.setName('阶段数量')
			.setDesc('看板列的数量（4-6 个）')
			.addDropdown((dropdown) => {
				for (const n of [4, 5, 6]) dropdown.addOption(String(n), `${n} 个阶段`);
				dropdown.setValue(String(this.plugin.settings.boardStages.length));
				dropdown.onChange(async (v) => {
					const newCount = parseInt(v);
					const cur = this.plugin.settings.boardStages;
					if (newCount > cur.length) {
						let i = cur.length;
						while (this.plugin.settings.boardStages.length < newCount) {
							this.plugin.settings.boardStages.push({ id: `stage${i + 1}`, label: `阶段${i + 1}`, color: '#888780', hasInput: false });
							i++;
						}
					} else {
						this.plugin.settings.boardStages = cur.slice(0, newCount);
					}
					await this.plugin.saveSettings();
					// 让已打开的机会页阶段列立即同步（无需切页）
					this.plugin.refreshNav();
					this.display();
				});
			});

		for (let i = 0; i < this.plugin.settings.boardStages.length; i++) {
			const idx = i;
			const st = this.plugin.settings.boardStages[idx];
			new Setting(boardOptions)
				.setName(`阶段 ${idx + 1}`)
				.setDesc(`自定义第 ${idx + 1} 个阶段的名称、颜色，以及是否在该阶段启用输入框`)
				.addText((t) => t
					.setPlaceholder(`阶段 ${idx + 1}`)
					.setValue(st?.label ?? '')
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.label = v; await this.plugin.saveSettings(); this.plugin.refreshNav(); }),
				)
				.addText((t) => t
					.setPlaceholder('#888780')
					.setValue(st?.color ?? '')
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.color = v.trim() || '#888780'; await this.plugin.saveSettings(); this.plugin.refreshNav(); }),
				)
				.addToggle((tg) => tg
					.setTooltip('启用后，处于该阶段的条目在编辑时会出现一个标题与该阶段名一致的输入框')
					.setValue(st?.hasInput ?? false)
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.hasInput = v; await this.plugin.saveSettings(); }),
				);
		}

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
			.setDesc('支持变量：YYYY 年、MM 月(2位)、MMM 月缩写(如 8月)、DD 日；ddd 周日、dddd 星期日；HH 24时、hh 12时、mm 分、ss/SS 秒、A 上午/下午')
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
		this.app.workspace.getLeavesOfType('dashboard-view').forEach((leaf) => {
			leaf.view?.containerEl?.querySelector('.dashboard-plugin')?.setAttribute('data-theme', effective);
		});
		// Fallback for any stray element still in the DOM.
		document.querySelectorAll('.dashboard-plugin').forEach((el) => el.setAttribute('data-theme', effective));
		this.plugin.refreshThemeButtons();
	}
}
