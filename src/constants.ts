/** 视图通用中文文案常量 —— 统一维护入口，避免中文 UI 文案散落在各视图里的硬编码。 */

export const UI_TEXT = {
	// 通用动作
	save: '保存',
	cancel: '取消',
	edit: '编辑',
	delete: '删除',
	openSource: '打开源文件',
	taskDetail: '任务详情',
	notSet: '未设置',
	all: '全部',

	// 项目总览（第二页）
	filter: '筛选',
	noTasks: '暂无任务数据',
	poGantt: '甘特图',
	poList: '列表',
	poCalendar: '日历',
	poKanban: '看板',
	poTaskName: '任务名称',
	poPriority: '优先级',
	poStart: '开始',
	poDue: '截止',
	poStatus: '状态',
	poProject: '项目',

	// 看板（第三页）
	opAll: '全部',
	opRoadmap: '★ 星标',
} as const;
