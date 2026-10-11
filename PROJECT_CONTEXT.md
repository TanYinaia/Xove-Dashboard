# Dashboard — 项目上下文文档

> 本文档供 AI Agent 在新对话中阅读，快速了解项目全貌和开发历史。
> 最近更新：2026-08-22（同步 v0.3.0：新增 i18n 双语、倒计时多实例（≤5）、通用看板「灵感收集」、
> `frontmatterWriter.ts` / `parserDiagnostics.ts`；修正版本号、目录结构、设置项与运行环境说明）

## 项目概述

- **类型**: Obsidian 社区插件 (TypeScript)
- **插件 ID**: `dashboard`（内部 id / CSS class / 视图 id 均保留此名，勿改）
- **显示名称**: Xove Dashboard（v0.3.0 起，仅改 `manifest.name`）
- **版本**: 0.3.0（以 `manifest.json` 为准；`package.json` 的 0.2.8 为未同步的历史遗留，
  发布 bump 时三处应一并更新）
- **最低 Obsidian 版本**: 1.8.0
- **目标**: 在 Obsidian 中提供个人工作控制台，包含任务管理、项目跟踪、机会点管理、笔记统计等功能

## 技术栈

- TypeScript + Obsidian API，无任何运行时依赖
- **构建**：
  - `npm run build:js` —— rollup 3 + 内联 TS 转译，**纯 JS 实现，首选**（`rollup.config.mjs`）
  - `npm run build` / `npm run dev` —— tsc + esbuild（`esbuild.config.mjs`），需要 esbuild 原生二进制
  - 类型检查：`node node_modules/typescript/bin/tsc -noEmit -skipLibCheck`
- eslint + `eslint-plugin-obsidianmd` 规则（`eslint.config.mts`）
- 纯 CSS（无 Tailwind/React/外部依赖），颜色全部走 `--ad-*` 设计令牌
- 数据存储：Vault 中的 Markdown 文件 + YAML frontmatter（中文键名）
- 开发依赖：typescript、esbuild、rollup、eslint、obsidian 类型定义

### 运行环境（当前）

- **开发机（Windows）**：源码编辑、类型检查、打包均在本机完成。
- **构建**：`npm run build:js`（rollup 3 + 内联 TS 转译，纯 JS、无原生二进制依赖，**首选**）；
  `npm run build`（tsc + esbuild）需要 esbuild 原生二进制，受限环境（如 noexec 文件系统）可能跑不通。
  npm 不可用时可直接调 node 二进制：
  `node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs`
- **⚠️ node 兼容性**：node 24 在部分受限内核（如鸿蒙 OHOS，曾现 V8 启动即崩溃
  `Check failed: 12 == (*__errno_location())`）上需加 `--jitless` 运行（禁用 JIT 的同时禁用
  WebAssembly，Node 内置 TS 类型剥离依赖 WASM，故 `.ts` 单测此时跑不了）。普通 Windows/Linux 开发机无需。
- **部署**：插件最终目录（`<Vault>/.obsidian/plugins/dashboard/`）只需 `main.js` + `manifest.json` +
  `styles.css` 三件套；复制后需在 Obsidian 命令面板执行 **Reload app without saving**（不会热重载 JS/CSS）。
- 版本控制：本地 git（仅 `personal` 分支），不配置远程、不推送。

## 目录结构

```
My Dashboard/
├── src/                          ← 唯一源码
│   ├── main.ts                  # 插件入口：注册视图、ribbon、命令、设置页，主题联动，语言应用
│   ├── settings.ts              # 设置接口、默认值、设置面板 UI（含语言、倒计时、看板阶段、首页模块布局）
│   ├── constants.ts             # 跨文件统一 UI 文案（UI_TEXT / MODAL_TEXT）
│   ├── icons.ts                 # 内联 SVG 图标常量（currentColor 自适应主题）
│   ├── i18n/                    # 极简 i18n 基础设施：index.ts（t/tArr/getLang/setLang/isEnglish）
│   │                            # + zh.ts（默认，中英结合）/ en.ts（纯英文）字典
│   ├── data/
│   │   ├── taskParser.ts        # 任务 frontmatter 解析入口（委托 taskParseCore / taskLogic）
│   │   ├── taskParseCore.ts     # frontmatter 解析核心（纯函数 + 单测）
│   │   ├── taskLogic.ts         # 任务状态 / 优先级 / 逾期等逻辑（纯函数 + 单测）
│   │   ├── taskStore.ts         # 任务读写编排（scanAllTasks 等）
│   │   ├── dashboardStore.ts    # 仪表盘数据聚合（纯函数 + 单测）
│   │   ├── opportunityParser.ts # 通用看板数据层（frontmatter 数组读写 + 正文投影；BoardStage 结构）
│   │   ├── frontmatterWriter.ts # 统一 frontmatter 写入器（yamlScalar 转义 + CRLF 安全，全插件唯一实现）
│   │   ├── parserDiagnostics.ts # 解析异常收集（yaml/read/parse 三类，供「N 个文件解析异常」banner）
│   │   ├── virtualList.ts       # 长列表虚拟化纯函数（含 7 单测）
│   │   └── mockData.ts          # UI 骨架用的类型定义与占位数据
│   └── views/
│       ├── DashboardView.ts     # 唯一 ItemView：主页 + 全部项目 + 看板三页（currentPage 三态）
│       ├── ProjectBoard.ts      # 项目总览渲染器（甘特/列表/日历/看板）
│       ├── OpportunityBoard.ts  # 通用看板（灵感收集）渲染器
│       ├── TaskModal.ts         # 新建任务弹窗（含 defaultProject / defaultParent 预填）
│       ├── TaskEditModal.ts     # 任务详情 / 编辑弹窗（支持改名 + 每日节点轴）
│       ├── ProjectModal.ts      # 新建 / 编辑项目弹窗
│       ├── OpportunityModal.ts  # 新建 / 编辑看板条目弹窗
│       ├── BannerModal.ts       # 封面图片位置调整弹窗（拖拽）
│       └── CountdownModal.ts    # 倒计时事件管理弹窗（多实例 ≤5：增删改；single 模式=单卡右键编辑）
├── styles.css                   # 插件全局样式（设计令牌 --ad-* 驱动）
├── manifest.json                # 插件清单（id=dashboard, name=Xove Dashboard）
├── package.json / versions.json / tsconfig.json
├── rollup.config.mjs            # 纯 JS 打包配置（build:js，首选）
├── esbuild.config.mjs           # 官方模板构建配置（dev / build）
├── eslint.config.mts            # ESLint 配置
├── version-bump.mjs             # 版本号同步脚本
├── scripts/
│   └── verify.mjs               # 一键校验脚本（npm run verify）
├── README.md / AGENTS.md / CLAUDE.md   # 文档（AGENTS.md 与 CLAUDE.md 一致，改动需同步）
├── i18n-language-switch-spec.md         # i18n 语言切换功能规格说明
├── 插件图标/                     # 图标 SVG 素材
├── dashboard v0.2.9/ + .zip     # 历史构建产物归档（非当前版本）
├── tools/                       # 历史 HTML 预览 / 编辑器（已弃用，UI 改动直接在 src/ 进行）
├── prototype/                   # 早期 HTML 原型（历史参考）
└── 参考项目/                     # 第三方参考插件源码（非本项目代码）
```

## 核心架构

### 数据存储设计

- **项目** = Vault 中的文件夹，根目录下有 `project-{项目名}.md` 元数据文件
- **任务** = 项目文件夹内的 `.md` 文件（跳过 `project-*.md`）
- 使用**中文 frontmatter 键名**，例如 `状态`、`优先级`、`开始日期`、`截止日期`
- 支持子任务（通过 `父任务` frontmatter 字段关联）

### 数据模型

#### TaskItem 接口（`taskParser.ts`）

```typescript
interface TaskItem {
    id: string;              // 文件路径（相对于 vault 根目录）
    content: string;         // 文件名（不含 .md）
    status: TaskStatus;      // '待办' | '进行中' | '已阻塞' | '已完成' | '已取消'
    priority: TaskPriority | null; // '重要且紧急' | '重要不紧急' | '紧急不重要' | '不重要不紧急'
    startDate: string | null;
    dueDate: string | null;
    tags: string[];
    type: TaskType;          // '普通' | '重复'
    repeatRule: RepeatRule | null;
    reminder: string[];
    notes: string;
    projectId: string;       // 所属项目文件夹名
    color: string;           // 项目颜色
    sourceFile: string;
    isOverdue: boolean;
    remindDate: string | null; // 下次提醒日期 YYYY-MM-DD，为空时默认使用 dueDate
    parent: string;          // 父任务名称（父任务 frontmatter 字段）
}
```

#### ProjectInfo 接口（`taskParser.ts`）

```typescript
interface ProjectInfo {
    name: string;
    color: string;
    description: string;
    startDate: string | null;
    endDate: string | null;
    createDate: string | null;
    taskCount: number;
    activeCount: number;
    path: string;            // 项目文件夹路径
}
```

#### Frontmatter 格式示例

**任务文件**:
```yaml
---
状态: 待办
优先级: 重要且紧急
开始日期: 2026-01-01
截止日期: 2026-01-15
项目: MyProject
tags: ["tag1", "tag2"]
类型: 普通
提醒: ["任务当天", "提前 1 天"]
备注: 补充说明
提醒日期: 2026-01-15
父任务: 父任务名称
---
```

**项目元数据 (project-{项目名}.md)**:
```yaml
---
项目名称: MyProject
颜色: "#3b82f6"
tags: [配置]
描述: 项目描述
开始日期: 2026-01-01
结束日期: 2026-06-30
创建时间: 2026-01-01
---
```

### 关键文件说明

> 行数为 2026-08-22 实测值（v0.3.0）。

| 文件 | 行数 | 职责 |
|------|------|------|
| `main.ts` | 288 | 插件生命周期：注册视图、ribbon 图标、命令面板、设置面板；`setObsidianTheme` 联动 Obsidian 全局外观；应用 i18n 语言、`refreshDashboardTitle` 广播刷新 |
| `settings.ts` | 532 | 设置接口定义、默认值、设置面板 UI（语言、快速捕捉、TODO、项目、看板、新日记、外观、阶段管道、横幅开关、甘特图默认粒度、首页模块布局） |
| `constants.ts` | 209 | 跨文件统一 UI 文案常量 `UI_TEXT` / `MODAL_TEXT`（中文侧，英文走 i18n 字典） |
| `icons.ts` | 54 | 内联 SVG 图标常量，主体填色 `currentColor`（随主题自适应），点缀色走 `.ad-ico-accent` |
| `i18n/index.ts` | 66 | 极简 i18n 基础设施：`t(path, params?)` / `tArr()` 取词、`getLang/setLang/isEnglish`、zh→en 回退链 |
| `i18n/zh.ts` | 220 | 中文（默认，中英结合）字典，值需与插件显示完全一致 |
| `i18n/en.ts` | 219 | 英文（纯英文模式）字典 |
| `taskParser.ts` | 54 | 任务 frontmatter 解析入口，委托 `taskParseCore` / `taskLogic` |
| `taskParseCore.ts` | 247 | frontmatter 解析核心（纯函数 + 单测）：`parseYaml`、TaskItem/ProjectInfo 类型、优先级权重、每日节点 |
| `taskLogic.ts` | 150 | 任务状态 / 优先级 / 逾期 / 提醒日期等逻辑（纯函数 + 单测） |
| `taskStore.ts` | 166 | 任务读取编排（`scanAllTasks` 等） |
| `dashboardStore.ts` | 78 | 仪表盘数据聚合（纯函数 + 单测） |
| `opportunityParser.ts` | 336 | 通用看板数据层：单文件 frontmatter `opportunities` 数组读写、增删改、排序、正文表格 + 明细投影、`BoardStage` 结构 |
| `frontmatterWriter.ts` | 86 | 统一 frontmatter 写入器：`yamlScalar()` 序列化转义 + CRLF 安全，全插件唯一实现（替代各视图手写行级写入） |
| `parserDiagnostics.ts` | 36 | 解析异常收集（yaml/read/parse），供「N 个文件解析异常，点击查看」banner |
| `virtualList.ts` | 60 | 长列表虚拟化纯函数（窗口化渲染，含 7 单测） |
| `mockData.ts` | 160 | DashboardData 接口和占位数据（仅用于 UI 骨架，业务数据均来自 vault） |
| `DashboardView.ts` | 3314 | 唯一 ItemView，`currentPage` 三态（home / project / board）：首页卡片渲染（含倒计时多实例）、vault 数据读写、防抖刷新分发、编辑态布局 |
| `ProjectBoard.ts` | 1677 | 项目总览渲染器：甘特 / 列表 / 日历 / 看板四视图 |
| `OpportunityBoard.ts` | 609 | 通用看板（灵感收集）渲染器：看板 / 列表、单状态分栏 + 内联详情、星标筛选 |
| `TaskModal.ts` | 382 | 新建任务弹窗：完整表单含项目选择、父任务（预填 defaultProject/defaultParent）、重复规则、标签、提醒 |
| `TaskEditModal.ts` | 368 | 任务详情/编辑弹窗：修改状态、优先级、日期、备注，标题变更自动 renameFile，展示每日节点轴 |
| `ProjectModal.ts` | 162 | 新建/编辑项目弹窗：名称、项目类型、颜色选择、日期、描述 |
| `OpportunityModal.ts` | 215 | 新建/编辑看板条目弹窗：标题、状态、标签、背景备注、星标、链接双链（可自动建笔记并打开） |
| `BannerModal.ts` | 140 | 封面图片位置弹窗：预览 + 鼠标/触控拖拽 + 上下限位 |
| `CountdownModal.ts` | 99 | 倒计时事件管理弹窗：多实例（≤5）增删改；`single` 模式仅编辑单卡（右键「编辑」） |

### 设置项（`DashboardSettings`）

```typescript
interface DashboardSettings {
    banner: BannerSettings;            // imageDataUrl, offsetY
    quickCapture: QuickCaptureSettings; // storagePath, namingPattern, templateFolder, templateFile
    diary: DiarySettings;              // storagePath, namingPattern, templateFolder, templateFile
    todoSourceFolder: string;          // 留空则扫描整个 vault
    projectsFolder: string;            // 默认 'Projects'
    currentPoView: string;             // 项目总览当前视图标签（gantt/list/calendar/kanban）
    poProjectOrder: string[];          // 项目总览侧边栏项目顺序（拖拽持久化，切换视图不丢失）
    poTaskOrder: string[];             // 甘特图任务行顺序（拖拽持久化）
    theme: 'auto' | 'dark' | 'light';  // 默认 'auto'：跟随 Obsidian 外观
    dashboardTitle: string;            // 自定义主标题，留空用默认 'MY DASHBOARD'（改后即时生效，免重载）
    npdpStages: string[];              // NPDP 阶段名称列表（默认 立项/规划/开发/测试/上线）
    npdpMaxStage: number;              // NPDP 阶段总数上限（4~6）
    npdpProgressFilter?: number;       // 主页项目进度卡片阶段筛选
    poGanttStatusFilter?: string[];    // 甘特图状态多选筛选
    poGanttScale?: 'day' | 'week' | 'month' | 'quarter'; // 甘特图默认时间粒度
    boardEnabled: boolean;             // 是否启用看板（导航与页面隐藏 + 设置项折叠），默认 true
    boardTitle: string;                // 看板名称，默认 '灵感收集'（导航与页面显示名，可自定义）
    boardStages: BoardStage[];         // 看板阶段列（4-6 列）：id/label/color/hasInput，默认 收集箱/评估中/进行中/已完成/已放弃
    opportunityFile: string;           // 看板数据文件路径，默认 '看板.md'（UI 显示「看板数据文件」）
    currentOppView: string;            // 看板当前视图标签（kanban/list），默认 kanban
    homeModules?: HomeModuleConfig[];  // 首页模块显隐/排序/比例（编辑态拖拽 + 恢复默认布局）
    homeLayoutVersion?: number;        // 首页布局数据版本（HOME_LAYOUT_VERSION=3，旧值自动迁移）
    countdown: CountdownSettings[];    // 倒计时自定义事件数组（事件名 + 目标日期），最多 5 个
    language: 'zh' | 'en';             // 界面语言：zh（中英结合，默认）/ en（纯英文）
}
```

> 注：旧版 `themeSyncObsidian` 字段已移除（主题切换始终联动 Obsidian 外观，仅受 `theme` 控制）。

## 已实现功能

### Dashboard 卡片（`DashboardView` 中按顺序渲染）

1. **Banner 封面**: 点击按钮上传图片，弹窗拖拽调整垂直位置，持久化到插件设置（dataUrl）
2. **Noise 粒子背景**: Canvas 绘制噪点粒子动画，每 2 帧更新
3. **Vault Pulse**: 实时显示笔记总数(NOTES)、未完成任务数(PENDING)、今日新增(TODAY)、连续天数(STREAK)，全部大写，30 秒自动刷新。PENDING 从 `scanAllTasks()` 实时计算（排除已完成/已取消），vault 变更时同步刷新
4. **Header**: eyebrow `SECOND BRAIN` + 主标题（默认 `MY DASHBOARD`，可在设置自定义）+
   `Obsidian · Personal Dashboard v{version}`（版本号动态读 manifest）+ 日期时间（30 秒刷新）、
   星期（实时）、农历（格式"农历 五月廿三"，30 秒刷新）；右侧「🌙 主题」「⚙ 设置」两个按钮
5. **Actions 工具栏**: 主页、新建日记、新建任务、新建项目、全部项目、灵感收集（共 6 个，均为内联 SVG 图标；「灵感收集」按钮名随设置 `boardTitle` 变化）
6. **快速捕捉**: 输入内容直接创建 Markdown 笔记到 vault，支持模板（真实调用 `createCaptureNote` 写入；成功顶部 toast 提示，失败显示红色错误 toast，不再「失败也显示已捕捉」）
7. **TODO**: 从 vault 实时读取任务，remindDate 逻辑（spec VIII），逾期置顶 + 优先级排序，右键菜单（编辑/延后一天/删除），重复任务自动计算下次提醒日期
8. **工作进度**: 双环形图（今日任务完成率 + 全部任务完成率），SVG 实现，从 `scanAllTasks()` 真实计算；完成任务后通过 vault `modify` 事件实时刷新（无需切界面）
9. **本周待办 & 逾期提醒**: 从 `scanAllTasks()` 真实读取
   - **逾期区**（置顶、红色）：所有 `isOverdue` 任务（含本周外），按逾期时间升序（越早逾期越靠前）
   - **本周区**：截止日期落在本周（周一~下周一，含今天、排除逾期与已完成/已取消），按时间升序
   - **紧急程度标签**：本周非逾期任务行尾显示，按优先级配色（重要且紧急→紧急/红、紧急不重要→较急/橙、重要不紧急→一般/蓝、不重要不紧急→不急/灰）
   - **头部**：📅 图标 + 标题；右侧逾期数量红色 badge（闪烁动画），数量为 0 不显示
   - **底部**：「本周共 X 个任务，逾期 Y 个」
   - **交互**：左键→打开编辑弹窗；右键菜单（编辑/删除/打开源文件/延后一天/标记完成），逾期行额外「延后到今天」
10. **项目进度**: NPDP pipeline 视图（立项/规划/开发/测试/上线阶段）
11. **笔记统计**: 52 周热力图（GitHub 风格），实时读取 vault 文件创建时间
12. **倒计时（多实例）**: 每张卡片 = 一个自定义事件（事件名 + 目标日期，最多 5 张，独立增删改）。
    - **布局**：副标题（「距离 {事件}」）在顶部、巨大剩余天数数字居中、页脚（剩余周数 · 已完成百分比 + 进度条）贴卡片下缘（`grid-template-rows: auto 1fr auto`），页脚带细分隔线
    - **进度口径**：以「目标日前一年」为起点、目标日为零点，`pct = 已过时间 / 总周期`，随目标日期动态变化
    - **状态**：未来 → 剩余天数 + 进度条；当天到达 → 「🎉 此时此刻」+ 进度条满；已过期 → 「🏁 旅程已然到达」+ 进度条满
    - **交互**：右键菜单「编辑 / 删除此卡片」；编辑态（长按卡片）「＋ 添加倒计时卡片」；新事件默认名随语言（新年 / New Year），目标日期非法时回退「下一年 1 月 1 日」

### 项目总览视图（点击"全部项目"进入）

点击工具栏"全部项目"后，主页卡片区域切换为项目总览视图（顶部 banner/工具栏不变）。

#### 侧边栏

- 顶部"全部项目"固定不可拖拽，点击显示全部任务
- 项目列表支持拖拽排序（HTML5 Drag & Drop），顺序持久化到 `poProjectOrder` 设置，切换主页再切回顺序保持
- 点击项目切换过滤，右侧所有视图按项目过滤任务
- 右键项目弹出 Obsidian 原生菜单：编辑项目、删除项目
- 底部「新建项目」按钮复用 ProjectModal
- 顶部工具栏「新建任务」按钮（位于「新日记」旁）传入当前 `selectedProject`，打开弹窗时所属项目自动预填为选中项目；侧边栏底部不再单独放置新建任务按钮

#### 视图切换

四个标签：甘特图、列表、日历、看板。打开时只渲染当前激活标签，**其余标签在首次切到时才渲染**（懒渲染，避免一次性构建 SVG 甘特图+日历+看板造成卡顿）；切换时保存当前标签到插件设置 `currentPoView`，下次打开恢复。

#### 甘特图视图

- **缩放级别**：日/周/月/季度切换按钮栏，基于 **SVG 显式宽度时间轴**（width=总天数×每天像素，规避 flexbox 截断）。每天像素 DAY_WIDTH（day=36, week=16, month=7, quarter=4），MIN_DAYS 保底范围（day=30, week=90, month=365, quarter=365）
- **时间轴范围**：围绕今天对称展开（含所有数据 + 至少能溢出视口的半宽），按单位对齐（周=周一、月=1号、季度=首月1号）
- **今日线**：蓝色垂直虚线 + 脉冲动画，默认滚动居中显示（双层 requestAnimationFrame）
- **任务名称列**：固定左侧，支持最多 4 级父子缩进（每级 16px，`padding-left !important`），子任务 `└` 引导线，父任务加粗，hover 显示 "+" 快速添加子任务按钮
- **任务条形**：项目颜色，已完成灰色半透明虚线，父任务 2px 边框，子任务 1px 边框
- **Tooltip**：悬停显示任务名、日期范围、优先级、状态、备注
- **拖拽**：左右边缘修改 startDate/dueDate，整体拖拽平移，写回文件
- **表格联动**：点击条形 → 高亮表格行；点击行 → 高亮条形
- **可拖拽分隔条**：调整甘特图与表格的高度比例
- **排序**：任务整体按左侧项目顺序分组，组内默认按开始日期时间排序；项目顺序修改时右侧任务顺序同步调整；支持拖拽任务行重排并持久化到 `poTaskOrder`

#### 列表视图

- 表格列：复选框、任务名称、优先级、开始日期、截止日期、状态、项目
- 筛选栏：全部/待办/进行中/已阻塞/已完成
- 列排序：点击表头升序/降序，箭头指示
- 右键菜单：编辑、删除、打开源文件

#### 日历视图

- 月视图网格，左右箭头切换月份，"今天"按钮回当前月
- 日期格子内直接渲染任务条（`po-cal__task`，最多 3 条 + 超出计数 `+N`）：
  - 延误任务（未完成且 end < 今天）→ 红色方块（`--overdue`，红底白字）
  - 正常任务 → 项目色左边条（`--normal`，`var(--chip-color)` 来自 `t.color`）
  - 已完成任务 → 划线置灰（`--done`，`text-decoration: line-through`）
  - 延误日整格淡红底（`has-overdue:not(.is-today)`）
- 点击日期下方预览区显示任务详情
- 拖拽任务到其他日期修改 dueDate

#### 看板视图

- 五列：待办、进行中、已阻塞、已完成、已取消
- HTML5 Drag & Drop 跨列拖拽自动修改 status 并写回文件
- 点击卡片打开 TaskEditModal
- 右键菜单：编辑、删除、打开源文件、修改优先级

### 灵感收集（通用看板视图，点击导航「灵感收集」进入）

一套轻量的「收集 → 推进 → 归档」工作流，适合随手记灵感、点子、待跟进事项；是主视图的第三页
（`currentPage = 'opportunity'`）。导航名与页面名由设置 `boardTitle` 控制（默认「灵感收集」，
可改为 机会点 / 管道 等任意名称）。

#### 数据存储

- 所有条目统一存于**一个** Markdown 文件（默认 `看板.md`，设置项 `opportunityFile`）的 frontmatter
  `opportunities` 数组，**不是一条目一文件**
- 正文由插件在标记区内自动重建为「总览表格（标题/阶段/星标/创建时间）+ `## 明细`」，
  仅为 frontmatter 的可读投影；标记区外的用户笔记原样保留
- 需要展开的条目用链接双链（`[[xxx-详情]]`）跳转到独立笔记（弹窗可自动创建并打开）

#### 阶段管道

默认阶段（设置 `boardStages` 可自定义名称/颜色/是否启用输入框，4-6 列）：
`收集箱 → 评估中 → 进行中 → 已完成 / 已放弃`。
「★ 星标」是独立于阶段的标记（重要 / 待跟进），不是状态。

#### 交互

- **看板**：阶段列，跨列拖拽即改阶段；卡片可在列内拖拽手动排序（写入 `排序` 字段，
  排序键为 状态 → order → 创建时间）
- **单状态分栏**：侧栏选中具体阶段时只渲染该 1 列，右侧展开内联详情编辑器
  （标题/阶段/标签/背景备注/星标/链接双链 + 保存 + 删除）
- **列表**：可点列排序
- **侧栏**：按阶段筛选 + ★ 星标筛选；「新建」按钮在看板/列表 Tab 行最右侧
- **右键菜单**：编辑 / 打开链接 / 切换阶段 / 星标 / 删除

### 其他功能

- **Banner 图片**: 上传、拖拽调整位置、dataUrl 持久化到设置
- **Noise 粒子背景** + 青色光晕效果
- **深色/浅色主题切换**: 通过 `--ad-*` CSS 变量实现；`theme` 默认 `auto` 跟随 Obsidian 外观，
  手动选深/浅时直接切换 Obsidian 全局外观（`vault.setConfig('theme')` + body class 兜底）
  （旧 `themeSyncObsidian` 开关已移除：主题联动为固定行为）
- **自定义插件标题**: 设置里改主标题，`refreshDashboardTitle()` 广播到所有已开视图，免重载
- **i18n 双语**: 设置「界面语言」中文（默认，中英结合）/ English（纯英文），切换即时生效；
  `src/i18n/` 提供 `t()`/`tArr()` 取词，当前语言缺失自动回退 zh；品牌锚点词
  （SECOND BRAIN / XOVE DASHBOARD）恒定英文不进字典；英文模式下农历自动隐藏
- **首页模块编辑态**: 长按卡片进入编辑态——拖拽排序、调整卡片比例（宽/高 1-4 格，含最小比例约束）、
  「＋ 添加卡片」/「🗑 拖到此处删除」/「↺ 重置布局」；显隐与顺序持久化到 `homeModules` 设置
- **内联 SVG 图标系统**: `src/icons.ts` 提供 20 个图标（home/allProjects/list/newTask/newDiary/
  newProject/calendar/opportunity/gantt/kanban/search/refresh/filter/settings/notification/more/
  edit/gear/sun/moon），主体填 `currentColor` 自适应深浅主题，点缀色由 `.ad-ico-accent` 控制
- **设置页面**: 语言、快速捕捉、TODO、项目、看板（启用开关/名称/阶段列）、新日记、外观、
  阶段管道、顶部横幅开关、甘特图默认粒度、首页模块布局（中文 UI）
- **解析异常提示**: 解析异常的 md 文件由 `parserDiagnostics.ts` 收集，首页显示
  「N 个文件解析异常（数据可能不完整），点击查看」banner，点击在 Obsidian 打开对应文件
- **新建任务弹窗**: 完整表单（项目选择、父任务、日期、优先级中文统一、状态、类型、重复、提醒、标签、备注 rows=5），必填字段红色高亮验证
- **新建项目弹窗**: 创建文件夹 + project-{name}.md，颜色选择器
- **任务编辑弹窗（任务详情）**: 编辑状态/优先级/日期/备注，展示「每日节点」日期轴（见下方每日节点轴说明）
- **Vault 事件监听**: create/delete/rename/modify 事件自动刷新热力图、pulse、TODO、项目总览
- **农历日期**: 使用 `Intl.DateTimeFormat` 中文农历 API，输出"农历 五月廿三"格式
- **设置按钮**: 右上角设置按钮直接打开插件设置面板
- **Pulse 光标闪烁**: JS 定时器控制蓝色竖线闪烁

## 设计规范

### 配色方案

配色体系于 2026-08-03（v0.2.6 周期）重做为**自包含调色板，不依赖 Obsidian 原生变量**。

- **深色主题**（保持 v0.2.5 的 hex 原值，勿改为 oklch 近似）:
  - 背景: `#0F1014`
  - 卡片: `#16181F`
  - 蓝色强调 `--ad-accent`: `#7BA7FF`
  - 文字: `#E8E6E0`
  - 暗淡文字: `#6B6B7B`
  - 圆角: `--ad-r2: 6px` / `--ad-r3: 10px`
- **浅色主题**（参考 shadcn neutral，oklch 中性阶）:
  - 画布: `oklch(0.99 0 0)`，卡片: 白
  - 文字: `oklch(0.13 0 0)`，边框: `oklch(0.92 0 0)`
  - 强调 `--ad-accent`: `oklch(0.13 0 0)`（黑，对应 shadcn Primary 语义），`--ad-on-accent`: 白
  - 圆角: `--ad-r1/r2/r3` = 0.375 / 0.5 / 0.75rem
- **热力图色阶**: 5 级蓝色（l1-l4），从浅到深
- **浅色覆盖写法**：统一用
  `:is(body.theme-light …:not([data-theme="dark"]), body.theme-dark …[data-theme="light"])`，
  不要再新建只挂 `[data-theme="light"]` 或只挂 `.theme-light` 的单一选择器块（历史上两次
  「浅色不生效 / 全白」bug 均源于此）

### 字体

- 链接 Obsidian CSS 变量: `--font-interface`, `--font-monospace`
- 正文: `var(--font-interface)`
- 等宽: `var(--font-monospace)`

### 命名规范

- **CSS 类名**: Dashboard 用 `ad-` 前缀，项目总览用 `po-` 前缀 + BEM 风格
- **文件名**: PascalCase（组件/视图）、camelCase（工具/数据）
- **接口名**: PascalCase（TaskItem、ProjectInfo）

## 版本历史

- **v0.1.0**: 初始 UI 原型（HTML/CSS 静态页面）
- **v0.1.1**: 完整 UI + banner 图片功能
- **v0.1.2**: 热力图实时数据 + 布局优化
- **v0.1.3**: 视觉打磨 + 模板系统 + 日记功能
- **v0.1.4**: 农历传统格式 + 8 个 bug 修复
- **v0.1.5**: 项目总览视图 + 多项功能与修复
  - 甘特图根本性重写为 **SVG 显式宽度时间轴**（左右分栏 + sticky 表头），日/周/月/季度按单位切格，时间轴不再截断；父子任务层级缩进、今日线居中
  - 列表视图：列排序、状态筛选（全部/待办/进行中/已阻塞/已完成）、右键菜单（编辑/删除/打开源文件）、父任务箭头折叠/展开
  - 日历视图：月份导航、日期格子内显示任务、拖拽修改日期
  - 看板视图：HTML5 Drag & Drop 跨列、右键菜单、修改优先级、已取消列
  - 侧边栏：拖拽排序、右键编辑/删除项目、新建项目
  - 数据模型：新增 color、remindDate、parent 字段（父任务 frontmatter 字段修复：原写在 `---` 外导致读不到）
  - 本周待办 & 逾期提醒卡片：真实 `scanAllTasks()` 数据、逾期置顶红色、紧急程度彩色标签、逾期数量闪烁 badge、底部统计、右键菜单（编辑/删除/打开源文件/延后一天/标记完成/延后到今天）
  - 工作进度卡片：改为真实数据双环形图，完成任务后实时刷新
  - Vault Pulse：PENDING 改为真实未完成任务数（排除已完成/已取消），NOTES/PENDING/TODAY/STREAK 全大写
  - 标题修正为 `Obsidian · Dashboard · v0.1.5`；TODO 卡片标题与统计文字位置互换
  - 顶部副标题、编辑项目弹窗（不再误显示"新建项目"）等修复
  - 设置持久化 currentPoView；右上角设置按钮打开插件设置；任务弹窗优先级统一为中文四级

- **v0.2.0**: 项目类型体系 + 浅色模式重构 + 多项修复
  - **项目类型体系**：新增「项目类型」区分「阶段项目 / 非阶段项目」（中文 frontmatter 键 `项目类型`）。阶段项目有阶段进度条并进入主页项目进度卡片统计；非阶段项目在全部项目页无阶段进度条、主页卡片不展示也不统计。配置弹窗（ProjectModal）同步新增该字段
  - **主页项目进度卡片阶段连线**：圆圈下方连线颜色随阶段进度着色，且到最后一个阶段圆点即截止（不再伸出）
  - **甘特图状态多选筛选**：按状态（待办/进行中/已阻塞/已完成）多选过滤，参考 obsidian-pm 甘特图位置
  - **浅色模式彻底重构**：原浅色覆盖只写在死代码块 `.theme-light`（类选择器），而代码用 `[data-theme="light"]` 属性选择器，导致 banner/pulse/noise 等区域浅色下仍是深色——已删除死块并将覆盖并入 live 选择器。补全所有变量系统够不到的硬编码色浅色覆盖：甘特 SVG（label-row 边框、band-odd、hdr-weekend、gridline-h、weekend）、表格边框、高亮条描边、横幅按钮、脉冲渐变、卡片/Toast/tooltip/看板重黑阴影→柔和浅阴影、热力图描边、select option 兜底；主按钮文字改用 `--ad-on-accent` 保证深浅可读
  - **农历/星期打开即正确**：原依赖 30s 定时器才从写死的 mock 字面量纠正，现初始渲染即按当天真实日期计算（`getLunarDate` + `toLocaleDateString(weekday)`），定时器仍负责跨日刷新
  - **主题切换按钮移到设置按钮左侧**（同一行，用 `.ad-header__btns` 横向 flex 包裹）
  - **Banner 比例** `16:3` → `16:2.5`（顶部 banner 与设置弹窗预览一致）
  - 修复浅色下右上角因错误白底边框产生的「白方块」
  - 版本说明：`Obsidian · Dashboard · v0.2`（主页展示版本由 v0.2.0 简化为 v0.2）
  - **主页卡片刷新卡顿修复**：vault 文件变更改为 200ms 防抖（`scheduleHomeRefresh`）+ 单次 `scanAllTasks` 共享 + `getOrCreateCard` 复用卡片外壳（`empty()` 重建内容而非 `remove()` 重建整卡），消除每次文件改动导致的 TODO/工作进度/本周待办整卡闪烁重绘，同时保留实时更新
  - **日历视图任务可视性增强**：日期格子内直接渲染任务条（最多 3 条 + 超出计数），三态样式——延误任务（未完成且 end < 今天）红色方块、正常任务项目色左边条、已完成任务划线置灰；延误日格子淡红底强调

- **v0.2.1**: Bug 修复 + 项目总览排序优化（三处次级问题在 v0.2.2 修正，见下）
  - **Bug 1 项目顺序持久化**：全部项目页左侧项目拖拽顺序持久化到 `poProjectOrder` 设置，切换主页再切回顺序保持（原每次进入重新 `scanAllProjects()` 导致顺序重置）
  - **Bug 2 快速捕捉真实创建**：捕捉卡片 submit 调用 `createCaptureNote` 真实写入 vault（原仅 Mock 提示）；创建成功顶部提示，失败显示红色错误 toast（不再「失败也显示已捕捉」）
  - **Opt 2 新建任务预填项目**：侧边栏新增「新建任务」按钮，`openTaskModal` 新增 `defaultProject` 参数
  - **Opt 1 甘特图排序优化**：任务按左侧项目顺序分组，单项目内默认按开始日期时间排序；项目顺序修改时右侧任务顺序同步调整；新增任务行拖拽排序并持久化到 `poTaskOrder`
  - 版本号 0.2.0 → 0.2.1
- **v0.2.2**: 修正 v0.2.1 三处未生效问题 + 后续优化
  - **Toast 真正置顶**：`showToast` 原挂到 `containerEl.children[1]`，Obsidian 视图容器 `transform` 祖先使 `position:fixed` 失效、落到页面底部；改为挂到 `document.body`，`fixed` 相对视口稳定置顶；CSS `top: 20px → 64px`（下移到工具栏下方、贴近 banner 顶部）
  - **甘特图按项目顺序（真正生效）**：根因是 `flattenWithLevel` 用 `sortTasks`（优先级/日期）对顶层任务二次重排，覆盖已分组的项目顺序。改为 level 0 保留 `rootTasks` 项目分组顺序、子任务按时间排 → 左侧项目顺序改，甘特图同步；手动拖拽仅在该项目内重排（`groupSort`）
  - **新建任务预填（真正生效）**：`TaskModal` 改用 `option.selected = true`；顶部工具栏「新建任务」按钮（位于「新日记」旁）传入 `this.selectedProject`，侧边栏底部按钮已移除
  - **全部项目性能**：`renderProjectOverviewPanels` 原一次性渲染 4 个面板（SVG 甘特图+列表+日历+看板）再靠 CSS 显隐，造成打开卡顿；改为只渲染当前激活面板，其余在切 tab 时 `renderPoPanel` 懒渲染
  - 版本号仍为 0.2.2（用户要求不擅自 bump / 不擅自 git）

- **v0.2.3**: 每日节点轴（多日任务进度可视化）+ 标签字段规范化
  - **每日节点轴（任务详情弹窗）**：多日任务（含开始+截止且跨天）在「任务详情」弹窗（原名「编辑任务」）展示「每日节点」日期轴，纯展示 + 悬停看备注；打卡只走 TODO 卡片右键菜单「今日完成 / 今日不做」。
    - 轴结束日逻辑：未完成且今天 > 截止 → 延伸到今天（可打卡超期天）；已完成 → 结束日 = max(截止, 完成日)；**提前完成不渲染截止日之后日期**。
    - 四色互斥状态：计划内/未打卡/过去未打卡 = `#232A3C` 深蓝；超期未打卡 = `rgba(153,92,0,0.5)` 深橙；完成 = `rgb(123,167,255)` 浅蓝；超期完成 = `#FB923C` 浅橙。无对勾；悬停 `scale(1.25)` + 对应色光晕。
    - 完成当天格子额外 1px 红色内框线（`.is-complete-day { box-shadow: inset 0 0 0 1px #E5484D; }`）。
    - 每日节点数据存**正文 `## 每日节点` Markdown 列表**（格式 `- 2026-07-20 ✅ 完成 —— 备注`），不再存 frontmatter。
  - **完成时间 frontmatter**：打卡写入 `完成时间: YYYY-MM-DD HH:mm`（精确到时分）。
  - **标签字段规范化**：任务/项目 frontmatter 字段由中文「标签」改为英文 `tags`（Obsidian 原生识别用于筛选）。解析层 `tags` 优先、旧「标签」兜底兼容；新建任务默认 `tags: ['任务']`；项目配置元信息写入 `tags: [配置]`，TaskModal UI 仍显示中文「标签」。
  - **Bug 修复 - 跨周任务漏本周待办**：本周待办过滤改为「与当周重叠」判定（start ≤ weekEnd 且 due ≥ weekStart），跨周未完成任务正常显示。
  - 版本号 0.2.2 → 0.2.3，并已 git 提交。

- **v0.2.4**: 代码审查 16 项修复 + 删除死文件（基于全量源码审查报告）
  - **删除死文件 `ProjectOverviewView.ts`**：387 行未注册、未引用的 mock 原型，编译进 main.js 且误导维护者，已删除。项目总览逻辑全部内联在 `DashboardView.ts`。
  - **数据正确性修复**：
    - 每日节点「只填备注未点完成」不再误记为「已完成」（`taskParser.ts` 新增 `📝 待办` 状态，`TaskEditModal.ts` 区分 todo/skip/done）
    - 已完成任务改其他字段时，完成时间不再被错误刷新成当前时间（内存与文件一致）
    - 倒计时卡片改用**真实当前日期**计算剩余天数/周数/百分比（原写死 mock 的 186 天）
  - **健壮性修复**：
    - frontmatter 解析换用 Obsidian 官方 `parseYaml`，正确处理引号/数组/嵌套
    - 状态/优先级/类型填错时自动回退默认值，不再显示乱码
    - 任务名含 `* " \ / < > : | ?` 等特殊字符自动替换为 `-`，创建不再失败
    - 新增 `ensureFolder` 递归建文件夹，多层路径父目录不存在也能创建
    - 甘特图 6 处日期解析统一加 `T00:00:00`，修复西半球时区差一天
    - 「今天」改为每次打开弹窗重新读取，跨天不再显示昨天
    - 阶段下拉越界自动夹取到上限，编辑项目不再空白
  - **交互/性能修复**：
    - 侧边栏/甘特图拖拽排序 off-by-one 修正（往下拖不再差一格）
    - 换主题同步所有已打开主页（原只刷新最前面一个）
    - 文件改动触发的两遍全量扫描加 300ms 缓存，笔记多时不卡
    - 删除残留的 `mySetting` 设置字段
  - 版本号 0.2.3 → 0.2.4，已 git 提交（commit 185c360）。

- **v0.2.5**（2026-08-03，commit `14b3b08`）: 重复任务体系修复 + 口径统一 + 打包链路补齐
  - **重复任务 7 项问题修复**：下次提醒日期计算、跨天、完成后推进等逻辑修正；重复规则设置 UX 重构
  - **TODO 卡 / 工作进度卡 done 口径统一**：两张卡对「已完成」的判定统一为同一口径，
    并修复统一后出现的「进度 0%、任务消失」回归；「今日完成 / 今日不做」计数口径修正
  - **TODO 卡片 UI 微调**、项目情况卡片底部「N 进行中 · 全部」固定左下角
  - **新增 `rollup.config.mjs` 与 `npm run build:js`**：纯 JS 打包链路，解决受限环境
    （noexec 文件系统）下 esbuild 跑不通、无法出包的问题
  - 版本号 0.2.4 → 0.2.5（`manifest.json` + `versions.json`；`package.json` 本次漏同步，
    已在 0.2.6 补上）

- **v0.2.6**（2026-08-04，commit `b604776`）: 白屏修复 + 自定义标题 + 浅色主题重构
  - **⭐ 视图白屏根因（务必记住）**：`DashboardView` 声明了类字段 `titleEl`，与 Obsidian
    `ItemView` 内置属性同名。类字段初始化在 `super()` 之后执行，静默覆盖父类属性 →
    Obsidian 自己的 `load()` 对 null 调 `setText` 抛错，栈里全是 `app.js`，我们的
    try/catch 接不到。修复：自定义字段一律加 `ad` 前缀。
    （此前两轮误判为 `containerEl.children[1]` 静默早退、误改 `containerEl`，方向都错）
  - **顶部大块空白**：`.ad-noise` canvas 用 `width/height:100%`，父级是 flex 且高度靠
    `flex:1` 时百分比失效，canvas 回退到内在尺寸 1024×1024 占正常流。改用 `inset:0` + 内联兜底
  - **自定义插件标题**：设置项 `dashboardTitle`，默认 `MY DASHBOARD`，
    `refreshDashboardTitle()` 广播刷新，改完即时生效免重载
  - **主题体系重构**：`theme` 增加 `auto`（默认，跟随 Obsidian）、新增 `themeSyncObsidian`；
    浅色模式整体重做为 shadcn neutral 中性色，清除残留蓝色（项目圆点、各类边框光晕等），
    深色模式还原为 v0.2.5 hex 原值
  - 版本号 0.2.5 → 0.2.6，三处同步（manifest / versions / package.json）

- **v0.2.7**（2026-08-11，commit `570846a`）: 项目总览拆分 + 长列表虚拟化 + 文案收口 + 一键校验
  - **项目总览页拆分**：`DashboardView`（原 3042 行）拆出 `ProjectBoard.ts` 渲染器（1679 行），
    宿主仅暴露 `ProjectHost` 接口依赖；首页/甘特/列表/日历/看板接线不变、行为等价
  - **长列表虚拟化**：任务表格窗口化渲染（只建可视区行 + 上下占位行撑滚动，滚动/排序/筛选重算窗口，
    rAF 节流；保留与甘特条按索引联动，改事件委托）；新增 `src/data/virtualList.ts` 纯函数 + 7 单测；
    首页周任务列表加 `content-visibility` 原生渲染优化
  - **中文文案收口**：新增 `src/constants.ts`（`UI_TEXT`），8 个视图/弹窗跨文件 UI 文案统一引用
  - **一键校验脚本**：`npm run verify`（类型检查→规范检查→打包→单测→产物校验，任一步失败即中止）
  - **机会点管理（第三页）**：新增 `opportunityParser.ts` + `OpportunityModal.ts`；
    `DashboardView` 引入 `currentPage` 三态；6 状态看板（拖拽改状态 + 手动排序）、列表、
    单状态分栏 + 内联详情编辑；正文自动投影表格 + 明细；设置项 `opportunityFile` / `currentOppView`
  - **甘特图跨项目移动任务**：把任务行拖到侧栏项目上，`fileManager.renameFile` 搬文件 +
    同步 `项目:` frontmatter，同名冲突中止并 toast
  - **图标系统**：`src/icons.ts` 16 个内联 SVG 替换原字符/emoji 图标，主体 `currentColor`
  - **插件改名**：`manifest.name` 由 `Dashboard` 改为 `Dashboard`
    （id / CSS class / 视图 id 均**不变**，避免样式失效与设置丢失）
  - 若干 bug 修复：看板手动排序不生效、主页内容泄漏到机会点页、浅色下弹窗按钮变纯白、
    单日任务「延后一天」无效
  - 版本号 0.2.6 → 0.2.7，三处同步（manifest / versions / package.json）

## 开发注意事项

1. 所有用户可见文本使用中文
2. 设置页面全部中文
3. 不引入外部依赖（React/Tailwind 等），保持纯 TypeScript + Obsidian API
4. 使用 Obsidian 官方公开 API，不依赖未文档化的内部 API
   （唯一有意例外：`main.ts` 的 `vault.setConfig('theme', …)`，已 try/catch 包裹 + body class 兜底）
5. 修改后运行 `npm run check`（typecheck + lint + build:js + test）验证，任一失败需修复后再结束；
   npm 不可用时直调 node 二进制（rollup / tsc），见上文「运行环境」的 `--jitless` 注意事项
6. **git 纪律**：只用本地 git，不连 GitHub、不 push、不配 remote；无明确指令不得 bump 版本或执行
   任何 git 操作。用户下达「发布版本 X.Y.Z」= 同时授权 bump + 本地 commit（精确暂存发布文件，
   排除 `.workbuddy/` 与 dev 工具；`main.js` 走 gitignore）。
   **切勿 `git checkout .` / `git stash` 全量回退**——working tree 常有大量未提交改动
7. **分支 / 版本模型**：git 仅 `personal` 一个分支（源码真身，`src/`）。**只有一个版本**，
   不维护 `master` / `generic` 分支、也不再派生任何「通用版」。
8. Frontmatter 使用中文键名（状态、优先级、开始日期、截止日期等）；标签字段用英文 `tags`
   （Obsidian 原生识别），解析层对旧「标签」键做兜底兼容
9. 项目文件夹名 = 项目名（无前缀），配置文件命名为 `project-{项目名}.md`
10. CSS 类名 Dashboard 用 `ad-` 前缀，项目总览用 `po-` 前缀，看板用 `op-` 前缀
11. 插件最终目录只需：`main.js`、`manifest.json`、`styles.css`；复制后需在 Obsidian 执行
    **Reload app without saving**（不会热重载 JS/CSS）
12. 涉及网络请求、遥测、云同步、文件删除、修改真实 Vault 数据等操作前需确认
13. 不要在代码中提交 API key、token、本地 Vault 路径等私密数据
14. 项目总览与看板均无 mock 数据回退，完全依赖 vault 真实数据
15. Vault 事件监听在项目视图模式下不刷新热力图/TODO 卡片
16. `parseProjectMeta` 中颜色字段需去除首尾引号
17. **i18n**：`t()` 只返回字符串；数组键（星期/月份/heatDow/stagesDefault）必须用 `tArr()`；
    字典值需与插件当前显示完全一致（zh 为中英结合，勿改成纯中文，除非同步改 en 与代码）

### 踩过的坑（改代码前先看）

- **`ItemView` 子类严禁声明与 Obsidian 内置同名的字段**（`titleEl` / `headerEl` / `iconEl` /
  `contentEl` / `containerEl` / `leaf` …）——会静默覆盖父类属性导致白屏，报错出现在 Obsidian
  自己的 `app.js`，我们接不到。自定义字段加 `ad` 前缀。
- `onOpen` 里先 `this.containerEl.empty()` 再建根元素；不要依赖 `containerEl.children[1]`。
- 全屏覆盖层用 `inset: 0`，不要用 `width/height: 100%`（flex 父级下百分比高度会失效）。
- `overflow-x: auto` 隐含 `overflow-y: hidden`，会截断光晕，需要额外 `padding: 4px 0`。
- 内联 `style="background:…"` 需要 CSS `!important` 才能压过。
- `main.js` 是 gitignore 的构建产物，**绝不能** `git show HEAD:main.js > main.js`（会清空文件）。
