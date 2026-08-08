# Dashboard（agent-dashboard）

一个自用的 Obsidian 个人工作台插件：把「任务 / 项目 / 机会点 / 笔记统计」收进一个页面，数据全部落在 Vault 的 Markdown 文件里，不依赖任何外部服务。

- **插件 ID**：`agent-dashboard`
- **显示名称**：Dashboard
- **当前版本**：0.2.6
- **最低 Obsidian 版本**：1.8.0
- **依赖**：无运行时依赖（纯 TypeScript + Obsidian API + 原生 CSS）

> 本仓库不是 Obsidian 知识库（Vault），而是插件源码工程。

---

## 功能概览

### 主页（Home）

| 模块 | 说明 |
|------|------|
| Banner 封面 | 上传图片、拖拽调整纵向位置，以 dataUrl 持久化到插件设置 |
| Noise 背景 | Canvas 噪点粒子动画 + 网格底纹 |
| Vault Pulse | 笔记总数 / 未完成任务 / 今日新增 / 连续天数，30 秒自动刷新 |
| Header | 自定义标题、日期、星期、农历（`Intl.DateTimeFormat` 中文农历） |
| 工具栏 | 主页、新建日记、新建任务、新建项目、全部项目、机会点 |
| 快速捕捉 | 输入即在 Vault 建 Markdown 笔记，支持模板与命名规则 |
| TODO | 实时读取 Vault 任务，逾期置顶 + 优先级排序，右键菜单（编辑 / 延后 / 今日完成 / 今日不做 / 删除） |
| 工作进度 | 双环形图（今日完成率 + 全部完成率），SVG 绘制，文件变更即刷新 |
| 本周待办 & 逾期提醒 | 与本周重叠的任务 + 全部逾期任务，紧急程度彩色标签、逾期数量闪烁 badge |
| 项目情况 | NPDP 阶段管道（阶段名与数量可在设置里自定义，4–6 段） |
| 笔记统计 | 52 周 GitHub 风格热力图，按文件创建时间实时统计 |
| 倒计时 | 年度剩余天数 / 周数 / 完成百分比（按真实当前日期计算） |

### 全部项目（Project Overview）

侧边栏（拖拽排序、右键编辑/删除、过滤）+ 四个视图，均为懒渲染：

- **甘特图**：SVG 显式宽度时间轴，日/周/月/季度缩放，今日线居中，父子任务 4 级缩进，拖拽改起止日期、拖到侧栏项目上可跨项目移动任务，按状态多选筛选
- **列表**：列排序、状态筛选、右键菜单
- **日历**：月视图，格子内直接显示任务条（延误红 / 正常项目色 / 已完成划线），拖拽改截止日期
- **看板**：待办 / 进行中 / 已阻塞 / 已完成 / 已取消五列，跨列拖拽即改状态

### 机会点（Opportunity，personal 分支）

产品机会点从「未沟通 → 沟通通过 → 调研中 → 待上会 → 已完成 / 已否决」的全流程看板与列表。所有机会点统一存在一个 Markdown 文件的 frontmatter `opportunities` 数组里，正文自动投影成可读表格 + 明细；支持手动拖拽排序、单状态分栏 + 右侧内联详情编辑、★ 转路标标记。

---

## 数据约定

数据不进数据库，全部是 Vault 里的 Markdown + **中文 frontmatter 键名**。

- **项目** = `项目文件夹/` 目录，目录内 `project-{项目名}.md` 存项目元信息
- **任务** = 项目文件夹内的 `.md` 文件（`project-*.md` 除外）
- **每日节点** = 任务正文的 `## 每日节点` Markdown 列表

任务文件：

```yaml
---
状态: 待办            # 待办 / 进行中 / 已阻塞 / 已完成 / 已取消
优先级: 重要且紧急     # 重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急
开始日期: 2026-01-01
截止日期: 2026-01-15
项目: MyProject
tags: ["任务"]
类型: 普通            # 普通 / 重复
提醒: ["任务当天", "提前 1 天"]
提醒日期: 2026-01-15
父任务: 父任务名称
完成时间: 2026-01-14 18:30
备注: 补充说明
---
```

项目元数据 `project-{项目名}.md`：

```yaml
---
项目名称: MyProject
项目类型: 阶段项目     # 阶段项目 / 非阶段项目
颜色: "#3b82f6"
tags: [配置]
描述: 项目描述
开始日期: 2026-01-01
结束日期: 2026-06-30
创建时间: 2026-01-01
---
```

---

## 开发

```bash
npm install                 # 安装依赖

npm run build:js            # 【推荐】rollup 打包，纯 JS 实现，任何平台可用
npm run build               # tsc 类型检查 + esbuild 生产构建（需要 esbuild 原生二进制）
npm run dev                 # esbuild watch 模式
npm run lint                # ESLint（含 eslint-plugin-obsidianmd 规则）

node node_modules/typescript/bin/tsc -noEmit -skipLibCheck   # 只做类型检查
```

> **平台提示**：在鸿蒙 / 受限文件系统环境下 `npm run build`、`npm run dev` 跑不通（esbuild 需要可执行的原生二进制，而工作目录 noexec）。此时用 `npm run build:js`（rollup 3 + 内联 TS 转译，纯 JS）打包，用上面的 `tsc -noEmit` 单独做类型检查。

### 安装到 Obsidian

插件目录 `<Vault>/.obsidian/plugins/agent-dashboard/` 只需要三个文件：

```
main.js        # 构建产物
manifest.json
styles.css
```

构建后把这三个文件复制过去，然后在 Obsidian 里执行 **Reload app without saving**（Obsidian 不会热重载插件的 JS/CSS）。

---

## 目录结构

```
My Dashboard/
├── src/
│   ├── main.ts                  # 插件入口：注册视图 / 命令 / ribbon / 设置页
│   ├── settings.ts              # 设置接口、默认值、设置面板 UI
│   ├── icons.ts                 # 内联 SVG 图标常量（currentColor 自适应主题）
│   ├── data/
│   │   ├── taskParser.ts        # 任务 / 项目 frontmatter 解析、每日节点读写
│   │   ├── opportunityParser.ts # 机会点数据层（frontmatter 数组读写 + 正文投影）
│   │   └── mockData.ts          # UI 骨架用的类型与占位数据
│   └── views/
│       ├── DashboardView.ts     # 主视图：主页 + 全部项目 + 机会点三页
│       ├── TaskModal.ts         # 新建任务弹窗
│       ├── TaskEditModal.ts     # 任务详情/编辑弹窗（含每日节点轴）
│       ├── ProjectModal.ts      # 新建/编辑项目弹窗
│       ├── OpportunityModal.ts  # 新建/编辑机会点弹窗
│       └── BannerModal.ts       # 封面位置调整弹窗
├── styles.css                   # 插件全局样式（设计令牌 --ad-* 驱动）
├── manifest.json / versions.json / package.json
├── rollup.config.mjs            # 纯 JS 打包配置（build:js）
├── esbuild.config.mjs           # 官方模板构建配置（dev / build）
├── eslint.config.mts / tsconfig.json / version-bump.mjs
├── AGENTS.md / CLAUDE.md        # AI 协作开发规范
├── PROJECT_CONTEXT.md           # 完整项目上下文与版本历史
├── 项目整理报告.md               # 文件清点与无用文件清单
├── dashboard-editor.html        # 可视化布局编辑器（由 build-editor.py 生成）
├── token-playground.html        # 设计令牌调试页
├── light-mode-preview.html      # 深/浅主题对照预览
└── prototype/                   # 早期 HTML 原型（历史参考）
```

---

## 设计约定

- 用户可见文案、设置项全部中文
- CSS 类名前缀：主页 `ad-`、项目总览 `po-`、机会点 `op-`
- 颜色一律走 `--ad-*` 设计令牌，浅色覆盖统一写在
  `:is(body.theme-light …:not([data-theme="dark"]), body.theme-dark …[data-theme="light"])` 选择器里
- 不引入 React / Tailwind 等前端框架，不加运行时依赖

## 分支

- `master`：发布线，只放通用功能，当前停在 v0.2.6
- `personal`：个人使用线 = master + 个人专属功能（机会点等）+ 开发工具，不合并回 master

## License

0-BSD，见 [LICENSE](LICENSE)。
