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
export const CHANGELOG_ORDER: string[] = ['0.3.0', '0.3.1'];