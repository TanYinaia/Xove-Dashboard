/* ============================================================
   Dashboard · Mock Data
   Centralized typed data for prototype UI. No real vault access.
   ============================================================ */

export interface TodoItem {
	id: string;
	priority: 'p0' | 'p1' | 'p2' | 'p3';
	text: string;
	done: boolean;
	tag: string;
}

export interface WeeklyItem {
	id: string;
	date: string;
	text: string;
	state?: 'today' | 'soon' | 'later' | 'recurring';
}

export interface OverdueItem {
	id: string;
	date: string;
	text: string;
	owner: string;
}

export interface Project {
	id: string;
	name: string;
	owner: string;
	type: 'dev' | 'ga';
	stage: number;
	stages: string[];
	percent: number;
	next: string;
}

export interface DashboardData {
	today: string;
	weekday: string;
	lunar: string;
	header: {
		eyebrow: string;
		title: string;
		subtitle: string;
	};
	pulse: {
		notes: number;
		pending: number;
		delta_today: number;
		streak_days: number;
	};
	quick_capture: {
		placeholder: string;
		primary_cta: string;
	};
	today_todos: TodoItem[];
	daily_progress: {
		completed: number;
		total: number;
		delta_vs_yesterday: string;
	};
	weekly_and_overdue: {
		overdue: OverdueItem[];
		this_week: WeeklyItem[];
	};
	projects: Project[];
	project_summary: {
		dev: number;
		ga: number;
	};
	notes_stats: {
		total: number;
		active_days: number;
		longest_streak_days: number;
		current_streak_days: number;
		year_label: string;
	};
	countdown: {
		year: number;
		days_left: number;
		weeks_left: number;
		percent_done: number;
		milestone: string;
	};
}

export const MOCK_DATA: DashboardData = {
	today: '2026-06-29',
	weekday: '星期一',
	lunar: '农历 五月十五',
	header: {
		eyebrow: 'SECOND BRAIN',
		title: 'MY DASHBOARD',
		subtitle: 'Obsidian · Personal Dashboard · v0.2.3',
	},
	pulse: {
		notes: 156,
		pending: 23,
		delta_today: 4,
		streak_days: 12,
	},
	quick_capture: {
		placeholder: '把念头、闪念或链接丢进来…',
		primary_cta: '创建',
	},
	today_todos: [
		{ id: 't1', priority: 'p0', text: '提交 GA 项目 PRD v2 给评审', done: false, tag: 'GA' },
		{ id: 't2', priority: 'p1', text: '补全 Dashboard 的 ItemView 骨架', done: false, tag: 'dev' },
		{ id: 't3', priority: 'p1', text: '回 3 条 async 留言（@bobo @lily @mark）', done: false, tag: 'sync' },
		{ id: 't4', priority: 'p2', text: '整理 "weekly review" 模板', done: true, tag: 'note' },
		{ id: 't5', priority: 'p2', text: '读 Diff Screenshot Service RFC', done: false, tag: 'read' },
		{ id: 't6', priority: 'p3', text: '为新笔记 archive/2026-06 归档', done: false, tag: 'chore' },
		{ id: 't7', priority: 'p3', text: '清理 inbox 里 5 条临时文件', done: true, tag: 'chore' },
		{ id: 't8', priority: 'p3', text: 'Backup vault 增量校验', done: false, tag: 'chore' },
	],
	daily_progress: {
		completed: 5,
		total: 10,
		delta_vs_yesterday: '+2',
	},
	weekly_and_overdue: {
		overdue: [
			{ id: 'o1', date: '06-25', text: '向 mentor 提交 Q2 复盘', owner: '@xw' },
			{ id: 'o2', date: '06-27', text: '修 Obsidian 0.15 兼容：WorkspaceLeaf.onload', owner: '@xw' },
		],
		this_week: [
			{ id: 'w1', date: '06-29', text: 'Dashboard 静态原型验收', state: 'today' },
			{ id: 'w2', date: '06-30', text: 'GA 立项会 · 准备 deck 23p', state: 'soon' },
			{ id: 'w3', date: '07-01', text: 'Notes pipeline 重构设计评审', state: 'later' },
			{ id: 'w4', date: '07-02', text: '写一篇关于 vault-as-state 的博客草稿', state: 'later' },
			{ id: 'w5', date: '07-03', text: '周五 weekly review（30min）', state: 'recurring' },
			{ id: 'w6', date: '07-04', text: '整理读书笔记《Designing Data-Intensive Apps》', state: 'later' },
		],
	},
	projects: [
		{ id: 'p1', name: 'Dashboard', owner: '@xw', type: 'dev', stage: 2, stages: ['立项','规划','开发','测试','上线'], percent: 42, next: '完善 ItemView 骨架 & 设置面板' },
		{ id: 'p2', name: 'Diff Screenshot Service', owner: '@team', type: 'dev', stage: 3, stages: ['立项','规划','开发','测试','上线'], percent: 68, next: '测试用例补全 & 性能 profile' },
		{ id: 'p3', name: 'Q2 GA 上线', owner: '@ops', type: 'ga', stage: 1, stages: ['立项','规划','开发','测试','上线'], percent: 18, next: '对齐 GTM 时间线' },
		{ id: 'p4', name: 'Notes Pipeline v2', owner: '@xw', type: 'dev', stage: 1, stages: ['立项','规划','开发','测试','上线'], percent: 25, next: '细化 ingestion 接口' },
		{ id: 'p5', name: '品牌资产 GA', owner: '@design', type: 'ga', stage: 4, stages: ['立项','规划','开发','测试','上线'], percent: 90, next: '上线 checklist 校验' },
		{ id: 'p6', name: 'Blog 长文 · vault-as-state', owner: '@xw', type: 'ga', stage: 0, stages: ['立项','规划','开发','测试','上线'], percent: 8, next: '定 outline & 写开篇' },
	],
	project_summary: { dev: 3, ga: 6 },
	notes_stats: {
		total: 200,
		active_days: 180,
		longest_streak_days: 41,
		current_streak_days: 12,
		year_label: '2026',
	},
	countdown: {
		year: 2026,
		days_left: 186,
		weeks_left: 27,
		percent_done: 49.2,
		milestone: 'Q4 OKR 启动准备',
	},
};
