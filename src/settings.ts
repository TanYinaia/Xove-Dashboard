import { App, PluginSettingTab, Setting, TFile, TFolder } from 'obsidian';
import Dashboard from './main';
import type { BoardStage } from './data/opportunityParser';
import { t, setLang, getLang } from './i18n';

export interface BannerSettings {
	imageDataUrl: string | null;
	offsetY: number;
	/** 是否显示顶部横幅区域（封面图）；默认开启 */
	enabled: boolean;
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

/** 番茄钟时长（分钟） */
export interface PomodoroSettings {
	/** 工作时长（分钟），默认 25 */
	workMin: number;
	/** 休息时长（分钟），默认 5 */
	breakMin: number;
}

/** 通用看板的一个阶段（看板列）— 结构定义见 src/data/opportunityParser.ts 的 BoardStage */
export type { BoardStage } from './data/opportunityParser';

export interface DashboardSettings {
	banner: BannerSettings;
	quickCapture: QuickCaptureSettings;
	diary: DiarySettings;
	todoSourceFolder: string;
	/** 开启后，已完成任务不消失：保留在 TODO 列表中，变灰 + 删除线 */
	todoShowCompleted: boolean;
	/** 任务详情弹窗显示模式：detail（详细，默认，显示全部字段）/ compact（简洁，隐藏所属项目、任务类型、父任务） */
	taskDetailMode: 'detail' | 'compact';
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
	/** 倒计时卡片自定义事件（事件名称 + 目标日期），支持多个（最多 5 个） */
	countdown: CountdownSettings[];
	/** 番茄钟时长（分钟） */
	pomodoro: PomodoroSettings;
	/** 界面语言：zh（中英结合，默认）/ en（纯英文） */
	language: 'zh' | 'en';
	/**
	 * 用户上次运行插件时看到的版本号（用于更新日志弹窗）。
	 * 缺省/undefined = 首次安装：不弹窗，直接记为当前版本。
	 */
	lastSeenVersion?: string;
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
	banner: { imageDataUrl: null, offsetY: 0, enabled: true },
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
	todoShowCompleted: false,
	taskDetailMode: 'detail',
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
	countdown: [{ eventName: '2027', targetDate: '2027-01-01' }],
	pomodoro: { workMin: 25, breakMin: 5 },
	language: 'zh',
	homeModules: [
		{ id: 'quick-capture', enabled: true, order: 0, cols: 1, rows: 1 },
		{ id: 'todo', enabled: true, order: 1, cols: 1, rows: 1 },
		{ id: 'progress', enabled: true, order: 2, cols: 1, rows: 1 },
		{ id: 'weekly', enabled: true, order: 3, cols: 1, rows: 2 },
		{ id: 'projects', enabled: true, order: 4, cols: 3, rows: 1 },
		{ id: 'heatmap', enabled: true, order: 5, cols: 3, rows: 1 },
		{ id: 'countdown', enabled: true, order: 6, cols: 1, rows: 1 },
		{ id: 'pomodoro', enabled: true, order: 7, cols: 1, rows: 1 },
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
	{ id: 'pomodoro', enabled: true, order: 7, cols: 1, rows: 1 },
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

		/* ============ 通用 ============ */
		new Setting(containerEl).setName(t('settings.secGeneral')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.languageName'))
			.setDesc(t('settings.languageDesc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('zh', t('settings.langZh'));
				dropdown.addOption('en', t('settings.langEn'));
				dropdown.setValue(this.plugin.settings.language);
				dropdown.onChange(async (v) => {
					const lang = v as 'zh' | 'en';
					this.plugin.settings.language = lang;
					setLang(lang);
					// 看板默认名随语言：未自定义（空或中文默认）时切换为对应语言默认名
					if (!this.plugin.settings.boardTitle || this.plugin.settings.boardTitle === '灵感收集') {
						this.plugin.settings.boardTitle = lang === 'en' ? 'Inspirations' : '灵感收集';
					}
					// 看板文件路径默认名同样随语言：未自定义（仍是内置 zh 默认）时切换
					if (!this.plugin.settings.opportunityFile || this.plugin.settings.opportunityFile === '看板.md') {
						this.plugin.settings.opportunityFile = lang === 'en' ? 'Kanban.md' : '看板.md';
					}
					await this.plugin.saveSettings();
					// 立即重绘设置面板文案 + 重建所有已打开的仪表盘视图
					this.display();
					this.plugin.refreshLanguage();
				});
			});

		new Setting(containerEl)
			.setName(t('settings.theme'))
			.setDesc(t('settings.themeDesc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('auto', t('settings.themeAuto'));

				dropdown.addOption('dark', t('settings.themeDark'));
				dropdown.addOption('light', t('settings.themeLight'));
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
			.setName(t('settings.pluginTitle'))
			.setDesc(t('settings.pluginTitleDesc'))
			.addText((tc) => tc
				.setPlaceholder('XOVE DASHBOARD')
				.setValue(this.plugin.settings.dashboardTitle)
				.onChange(async (v) => { this.plugin.settings.dashboardTitle = v; await this.plugin.saveSettings(); this.plugin.refreshDashboardTitle(); }),
			);

		new Setting(containerEl)
			.setName(t('settings.bannerEnable'))
			.setDesc(t('settings.bannerEnableDesc'))
			.addToggle((tg) => tg
				.setValue(this.plugin.settings.banner.enabled)
				.onChange(async (v) => {
					this.plugin.settings.banner.enabled = v;
					await this.plugin.saveSettings();
					this.plugin.refreshBanner();
					this.display();
				}),
			);

		/* ============ 存储与模板 ============ */
		new Setting(containerEl).setName(t('settings.secStorage')).setHeading();

		// 快速捕捉
		addFolderDropdown(
			new Setting(containerEl).setName(t('settings.captureStoragePath')).setDesc(t('settings.storagePathDesc')),
			this.app,
			this.plugin.settings.quickCapture.storagePath,
			async (v) => { this.plugin.settings.quickCapture.storagePath = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName(t('settings.captureNamingRule'))
			.setDesc(t('settings.namingRuleDesc'))
			.addText((tc) => tc
				.setPlaceholder(t('settings.namingPlaceholder'))
				.setValue(this.plugin.settings.quickCapture.namingPattern)
				.onChange(async (v) => { this.plugin.settings.quickCapture.namingPattern = v; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName(t('settings.captureTemplateFile'))
			.setDesc(t('settings.captureTemplateFileDesc'))
			.addText((tc) => tc
				.setPlaceholder(t('settings.captureTemplatePlaceholder'))
				.setValue(this.plugin.settings.quickCapture.templateFile)
				.onChange(async (v) => {
					this.plugin.settings.quickCapture.templateFile = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		// 新日记
		addFolderDropdown(
			new Setting(containerEl).setName(t('settings.diaryPath')).setDesc(t('settings.diaryPathDesc')),
			this.app,
			this.plugin.settings.diary.storagePath,
			async (v) => { this.plugin.settings.diary.storagePath = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName(t('settings.diaryNaming'))
			.setDesc(t('settings.namingRuleDesc'))
			.addText((tc) => tc
				.setPlaceholder('YYYY-MM-DD')
				.setValue(this.plugin.settings.diary.namingPattern)
				.onChange(async (v) => { this.plugin.settings.diary.namingPattern = v; await this.plugin.saveSettings(); }),
			);

		new Setting(containerEl)
			.setName(t('settings.diaryTemplateFile'))
			.setDesc(t('settings.diaryTemplateFileDesc'))
			.addText((tc) => tc
				.setPlaceholder(t('settings.diaryTemplatePlaceholder'))
				.setValue(this.plugin.settings.diary.templateFile)
				.onChange(async (v) => {
					this.plugin.settings.diary.templateFile = v.trim();
					await this.plugin.saveSettings();
				}),
			);

		/* ============ 任务与项目 ============ */
		new Setting(containerEl).setName(t('settings.secTasksProjects')).setHeading();

		// TODO 待办
		addFolderDropdown(
			new Setting(containerEl).setName(t('settings.dataSource')).setDesc(t('settings.dataSourceDesc')),
			this.app,
			this.plugin.settings.todoSourceFolder,
			async (v) => { this.plugin.settings.todoSourceFolder = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName(t('settings.todoShowCompleted'))
			.setDesc(t('settings.todoShowCompletedDesc'))
			.addToggle((toggle) => {
			toggle.setValue(this.plugin.settings.todoShowCompleted).onChange(async (v) => {
				this.plugin.settings.todoShowCompleted = v;
				await this.plugin.saveSettings();
				// 立即刷新 TODO 卡片，无需切页
				this.plugin.refreshTodoHome();
			});
			});

		// 任务详情
		new Setting(containerEl)
			.setName(t('settings.taskDetailMode'))
			.setDesc(t('settings.taskDetailModeDesc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('detail', t('settings.taskDetailDetailed'));
				dropdown.addOption('compact', t('settings.taskDetailCompact'));
				dropdown.setValue(this.plugin.settings.taskDetailMode);
				dropdown.onChange(async (v) => {
					this.plugin.settings.taskDetailMode = v as 'detail' | 'compact';
					await this.plugin.saveSettings();
				});
			});

		// 番茄钟时长
		new Setting(containerEl)
			.setName(t('settings.pomodoroWork'))
			.setDesc(t('settings.pomodoroWorkDesc'))
			.addText((tc) => tc
				.setPlaceholder('25')
				.setValue(String(this.plugin.settings.pomodoro?.workMin ?? 25))
				.onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.pomodoro = { ...this.plugin.settings.pomodoro, workMin: Math.min(180, n) };
						await this.plugin.saveSettings();
						this.plugin.refreshHome();
					}
				}),
			);

		new Setting(containerEl)
			.setName(t('settings.pomodoroBreak'))
			.setDesc(t('settings.pomodoroBreakDesc'))
			.addText((tc) => tc
				.setPlaceholder('5')
				.setValue(String(this.plugin.settings.pomodoro?.breakMin ?? 5))
				.onChange(async (v) => {
					const n = parseInt(v, 10);
					if (Number.isFinite(n) && n > 0) {
						this.plugin.settings.pomodoro = { ...this.plugin.settings.pomodoro, breakMin: Math.min(60, n) };
						await this.plugin.saveSettings();
						this.plugin.refreshHome();
					}
				}),
			);

		// 项目
		addFolderDropdown(
			new Setting(containerEl).setName(t('settings.projectFolder')).setDesc(t('settings.projectFolderDesc')),
			this.app,
			this.plugin.settings.projectsFolder,
			async (v) => { this.plugin.settings.projectsFolder = v; await this.plugin.saveSettings(); },
		);

		new Setting(containerEl)
			.setName(t('settings.ganttGranularity'))
			.setDesc(t('settings.ganttGranularityDesc'))
			.addDropdown((dropdown) => {
				dropdown.addOption('week', t('settings.optWeek'));
				dropdown.addOption('day', t('settings.optDay'));
				dropdown.addOption('month', t('settings.optMonth'));
				dropdown.addOption('quarter', t('settings.optQuarter'));
				dropdown.setValue(this.plugin.settings.poGanttScale || 'week');
				dropdown.onChange(async (v) => {
					this.plugin.settings.poGanttScale = v as 'day' | 'week' | 'month' | 'quarter';
					await this.plugin.saveSettings();
				});
			});

		/* ============ 看板 ============ */
		new Setting(containerEl).setName(t('settings.secBoard')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.boardEnable'))
			.setDesc(t('settings.boardEnableDesc'))
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
			.setName(t('settings.boardName'))
			.setDesc(t('settings.boardNameDesc'))
			.addText((tc) => tc
				.setPlaceholder(t('settings.boardNamePlaceholder'))
				.setValue(this.plugin.settings.boardTitle)
				.onChange(async (v) => {
					this.plugin.settings.boardTitle = v.trim() || t('settings.boardNamePlaceholder');
					await this.plugin.saveSettings();
					this.plugin.refreshNav();
				}),
			);

		new Setting(boardOptions)
			.setName(t('settings.boardFile'))
			.setDesc(t('settings.boardFileDesc'))
			.addText((tc) => tc
				.setPlaceholder(t('settings.boardFilePlaceholder'))
				.setValue(this.plugin.settings.opportunityFile)
				.onChange(async (v) => {
					// 适配用户输入：不带 .md 后缀时自动补，已带则原样保留（兼容旧数据）
					const raw = v.trim();
					if (!raw) {
						this.plugin.settings.opportunityFile = getLang() === 'en' ? 'Kanban.md' : '看板.md';
					} else {
						this.plugin.settings.opportunityFile = raw.toLowerCase().endsWith('.md') ? raw : raw + '.md';
					}
					await this.plugin.saveSettings();
				}),
			);

		/* ============ 阶段管道 ============ */
		new Setting(containerEl).setName(t('settings.secPipeline')).setHeading();

		// 看板阶段（折叠组）：看板关闭时整体折叠隐藏（联动）
		const boardStagesWrap = containerEl.createEl('details', { cls: 'dashboard-collapse dashboard-collapse--board' });
		if (!this.plugin.settings.boardEnabled) boardStagesWrap.hide();
		boardStagesWrap.createEl('summary', { text: t('settings.boardStageGroup') });

		new Setting(boardStagesWrap)
			.setName(t('settings.stageCount'))
			.setDesc(t('settings.stageCountDesc'))
			.addDropdown((dropdown) => {
				for (const n of [4, 5, 6]) dropdown.addOption(String(n), t('settings.stageCountOption', { n }));
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
					// 改动数量后展开折叠组，便于继续编辑新阶段
					this.containerEl.querySelector('.dashboard-collapse--board')?.setAttribute('open', '');
				});
			});

		for (let i = 0; i < this.plugin.settings.boardStages.length; i++) {
			const idx = i;
			const st = this.plugin.settings.boardStages[idx];
			new Setting(boardStagesWrap)
				.setName(t('settings.stageLabel', { n: idx + 1 }))
				.setDesc(t('settings.stageNameDescFull', { n: idx + 1 }))
				.addText((tc) => tc
					.setPlaceholder(t('settings.stageNamePlaceholder', { n: idx + 1 }))
					.setValue(st?.label ?? '')
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.label = v; await this.plugin.saveSettings(); this.plugin.refreshNav(); }),
				)
				.addText((tc) => tc
					.setPlaceholder('#888780')
					.setValue(st?.color ?? '')
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.color = v.trim() || '#888780'; await this.plugin.saveSettings(); this.plugin.refreshNav(); }),
				)
				.addToggle((tg) => tg
					.setTooltip(t('settings.stageHasInputTooltip'))
					.setValue(st?.hasInput ?? false)
					.onChange(async (v) => { this.plugin.settings.boardStages[idx]!.hasInput = v; await this.plugin.saveSettings(); }),
				);
		}

		// 项目管道阶段（折叠组）
		const pipelineWrap = containerEl.createEl('details', { cls: 'dashboard-collapse dashboard-collapse--pipeline' });
		pipelineWrap.createEl('summary', { text: t('settings.pipelineStageGroup') });

		new Setting(pipelineWrap)
			.setName(t('settings.pipelineCount'))
			.setDesc(t('settings.pipelineCountDesc'))
			.addDropdown((dropdown) => {
				for (const n of [4, 5, 6]) {
					dropdown.addOption(String(n), t('settings.stageCountOption', { n }));
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
					// 改动数量后展开折叠组，便于继续编辑新阶段
					this.containerEl.querySelector('.dashboard-collapse--pipeline')?.setAttribute('open', '');
					// 刷新主页项目情况卡片（阶段名称/数量变化需同步）
					this.plugin.refreshHome();
				});
			});

		for (let i = 0; i < this.plugin.settings.npdpStages.length; i++) {
			const idx = i;
			new Setting(pipelineWrap)
				.setName(t('settings.stageName', { n: idx + 1 }))
				.setDesc(t('settings.stageNameDesc', { n: idx + 1 }))
				.addText((tc) => tc
					.setPlaceholder(t('settings.stageNamePlaceholder', { n: idx + 1 }))
					.setValue(this.plugin.settings.npdpStages[idx] ?? '')
					.onChange(async (v) => {
						this.plugin.settings.npdpStages[idx] = v;
						await this.plugin.saveSettings();
						// 刷新主页项目情况卡片（阶段名称变化需同步）
						this.plugin.refreshHome();
					}),
				);
		}

		new Setting(pipelineWrap)
			.setName(t('settings.progressFilter'))
			.setDesc(t('settings.progressFilterDesc'))
			.addDropdown((dropdown) => {
				for (let i = 0; i < this.plugin.settings.npdpStages.length; i++) {
					dropdown.addOption(String(i), `≤ ${this.plugin.settings.npdpStages[i]}`);
				}
				dropdown.addOption(String(this.plugin.settings.npdpStages.length), t('settings.pipelineShowAll'));
				dropdown.setValue(String(this.plugin.settings.npdpProgressFilter ?? this.plugin.settings.npdpStages.length));
				dropdown.onChange(async (v) => {
					this.plugin.settings.npdpProgressFilter = parseInt(v);
					await this.plugin.saveSettings();
				});
			});

		/* ============ 关于 ============ */
		new Setting(containerEl).setName(t('settings.secAbout')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.aboutVersion'))
			.setDesc(this.plugin.manifest?.version ? 'v' + this.plugin.manifest.version : '');
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
