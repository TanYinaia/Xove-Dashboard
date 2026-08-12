# Dashboard（agent-dashboard）

一个自用的 Obsidian 个人工作台插件：把「任务 / 项目 / 机会点 / 笔记统计」收进一个页面，数据全部落在 Vault 的 Markdown 文件里，不依赖任何外部服务。

- **插件 ID**：`agent-dashboard`
- **显示名称**：Dashboard
- **当前版本**：0.2.7
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

### 机会点（Opportunity，personal 分支专属，通用版不含）

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

npm run check               # 一键门禁：类型检查 + lint + 打包 + 单测
npm run build:js            # 【推荐】rollup 打包（纯 JS，标准打包链路）
npm run build               # tsc 类型检查 + esbuild 生产构建
npm run dev                 # esbuild watch 模式
npm run lint                # ESLint（含 eslint-plugin-obsidianmd 规则）
npm run typecheck           # 只做 TypeScript 类型检查
npm run test                # 数据层单元测试（node --test）
```

### 安装到 Obsidian

插件目录 `<Vault>/.obsidian/plugins/agent-dashboard/` 只需要三个文件：

```
main.js        # 构建产物
manifest.json
styles.css
```

- **个人版**：根目录三件套（`My Dashboard/main.js` 等）。
- **通用版**：`generic/` 下的三件套（`generic/main.js` 等），由 `scripts/build-generic.py` 派生。

> ⚠️ 两份产物的 `id` / `name` 完全相同（`agent-dashboard` / `Dashboard`），靠文件夹区分。
> **不要将两者装进同一个 vault**——会互相覆盖。通用版装到独立 vault 或打成 zip 分发。

构建后把对应三件套复制过去，然后在 Obsidian 里执行 **Reload app without saving**（Obsidian 不会热重载插件的 JS/CSS）。

### 构建环境说明

- **开发在鸿蒙（HarmonyOS）**：源码编辑、跑 python 脚本（`build-generic.py`）在此进行。
  但本机 **node 完全跑不起来**，因此生成 `main.js` 的打包（rollup / esbuild / tsc）必须到 **Windows** 执行。
- **打包在 Windows**：`npm install` 之后用 `npm run build:js`（个人版）或 `python scripts/build-generic.py`（通用版）。

### 通用版（Generic）派生

通用版不含「机会点」等个人专属功能，由脚本从个人版源码自动生成，**不是手写的独立分支**：

```bash
# 鸿蒙：派生源码（python 可跑）
/data/service/hnp/bin/python3 scripts/build-generic.py
# Windows：派生源码 + 打包出 generic/main.js
python scripts/build-generic.py
```

- 改功能只改 `src/`；通用版永远跟着 `src/` 走。
- **绝不要手动改 `generic/` 里的文件**——每次跑脚本都会被整体覆盖。

---

## 目录结构

```
My Dashboard/
├── src/                          ← 唯一真身（个人版，personal 分支）
│   ├── main.ts / settings.ts / constants.ts / icons.ts
│   ├── data/                     # taskParser / taskParseCore / taskLogic / taskStore /
│   │                             #   dashboardStore / opportunityParser / virtualList / mockData（均含单测）
│   └── views/                    # DashboardView(宿主) / ProjectBoard / OpportunityBoard /
│                                 #   TaskModal / TaskEditModal / ProjectModal / OpportunityModal / BannerModal
├── styles.css                   # 插件全局样式（设计令牌 --ad-* 驱动）
├── manifest.json / versions.json / package.json
├── rollup.config.mjs            # 纯 JS 打包配置（build:js）
├── esbuild.config.mjs           # 官方模板构建配置（dev / build）
├── eslint.config.mts / tsconfig.json / version-bump.mjs
├── scripts/
│   ├── build-generic.py         # ★ 通用版唯一派生入口
│   └── verify.mjs               # 一键校验脚本（npm run verify）
├── generic/                     # 通用版（派生生成，勿手改）
├── AGENTS.md / CLAUDE.md        # AI 协作开发规范（两份内容一致）
├── PROJECT_CONTEXT.md           # 完整项目上下文与版本历史
├── 项目整理报告.md / 代码审查报告.md / 代码改进建议.md / 架构对比与统一建议.md / 设计规范说明.md
├── 插件图标/                     # 图标 SVG 素材
├── tools/                       # 历史 HTML 预览 / 编辑器（已弃用）
├── prototype/                   # 早期 HTML 原型（历史参考）
└── 参考项目/                     # 第三方参考插件源码（非本项目代码）
```

---

## 设计约定

- 用户可见文案、设置项全部中文
- CSS 类名前缀：主页 `ad-`、项目总览 `po-`、机会点 `op-`
- 颜色一律走 `--ad-*` 设计令牌，浅色覆盖统一写在
  `:is(body.theme-light …:not([data-theme="dark"]), body.theme-dark …[data-theme="light"])` 选择器里
- 不引入 React / Tailwind 等前端框架，不加运行时依赖

## 分支与版本模型

- 当前 git **只有一个 `personal` 分支**（源码真身），不维护独立的 `master` / `generic` 分支。
- **个人版** = `src/`（含机会点等个人专属功能）。
- **通用版** = `generic/`，由 `scripts/build-generic.py` 从 `src/` 派生（去掉机会点），
  不进 git、不是手写的独立分支。详见下方「通用版（Generic）派生」。
- 两份产物的 `id` / `name` 完全一致（`agent-dashboard` / `Dashboard`），
  仅靠 `根目录` 与 `generic/` 两个文件夹区分；不要装进同一 vault。

## License

0-BSD，见 [LICENSE](LICENSE)。
