/**
 * 版本变更记录：用于「更新日志弹窗」（UpdateLogModal）。
 * 维护规则：每次发版在此处追加一条 { 版本号: 该版新增/修复摘要 }，zh/en 双语。
 * CHANGELOG_ORDER 保证展示顺序；跨多版本更新时会按顺序列出 (lastSeen, 当前] 之间的全部条目。
 */
export interface ChangelogEntry {
	zh: string;
	en: string;
}

export const CHANGELOG: Record<string, ChangelogEntry> = {
	'0.4.0': {
		zh: '新增收藏笔记卡片，常用笔记一键收藏，点开即达\n新增最近打开卡片，最近看过的文档快速回去接着写\n项目支持归档，结束后不再出现在首页\n项目阶段数量上限提高，多阶段项目不再挤不下\n倒计时支持按月重复（选 1–31 号，过了自动滚到下月）与按日到点，卡片实时显示今日剩余时间与进度条\n番茄钟显示当天专注总时长，新增统计界面\n全部项目右侧视图（甘特图 / 列表 / 日历 / 看板 / 依赖图 / 文件 / 统计）可按需开关，关闭的版块完全不占用性能\n设置新增顶部统计条（VAULT PULSE）开关\n优化全部项目切换视图动效，过渡更顺滑\n修复看板任务过多时的面板高度问题\n修复外部修改插件配置会被旧值覆盖且无提示的问题（配置文件变更自动同步）\n修复其他已知问题',
		en: 'New Favorite Notes card — pin go-to notes and open them with one click\nNew Recent Files card — jump back to documents you just read\nProjects can now be archived and no longer show on the home page\nHigher stage-count cap for multi-phase projects\nCountdown: repeat by month (pick day 1–31, auto-rolls to the next month) or by day to a set time, with live remaining time and progress on the card\nPomodoro shows today’s focus total, plus a new stats view\nProject views (gantt / list / calendar / board / deps / files / stats) can be toggled off in settings — disabled views cost zero performance\nNew setting to toggle the VAULT PULSE stats bar at the top\nSmoother cross-fade when switching project views\nFixed board panel height when tasks overflow (now scrolls)\nFixed external config edits being silently overwritten (config file changes now sync automatically)\nFixed other known issues',
	},
	'0.3.1': {
		zh: '新增番茄钟卡片（自定义时长 / 完成声音提醒 / 状态栏实时显示）\n优化 TODO 卡片与项目完成状态展示\n新增每日节点回看：在任务详情中点击任意日期节点，即可查看当日备注\n修复灵感看板弹窗输入框高度不可调、项目阶段修改后主页不同步等问题',
		en: 'New Pomodoro card (custom durations, finish sound, live status bar)\nPolished TODO card and project completion display\nNew daily node review: click any day in task details to view its note\nFixed resizable textarea in opportunity modal and phase sync with the home page',
	},
	'0.3.0': {
		zh: '设置菜单分组重构 · 任务详情简洁/详细模式 · 项目日历图标与英文文案优化 · 「完成后不消失」支持本周待办与逾期任务',
		en: 'Settings regrouped · task detail compact/detailed mode · calendar icon & English copy polish · "keep completed" now applies to weekly & overdue tasks',
	},
};

/** 版本号按时间升序排列，用于遍历 (lastSeen, 当前] 之间的更新记录 */
export const CHANGELOG_ORDER: string[] = ['0.3.0', '0.3.1', '0.4.0'];