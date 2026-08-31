# Xove Dashboard

[English](#english) · [中文](#中文)

> Turn your Obsidian home tab into a **personal command center** — tasks, projects, inspiration, note stats, and countdowns, all on one screen.

Xove Dashboard is more than another to-do list. It's a **home-tab-first personal work console** that turns your Obsidian home into a customizable dashboard, aggregating tasks, projects, an inspiration board, note activity, and important countdowns so you see the big picture the moment you open Obsidian.

---

## English

### ✨ Highlights

- **Markdown at its core**: tasks, projects, and the board are stored as plain Markdown + YAML frontmatter. Your data stays yours — editable, portable, and backup-friendly.
- **A real "home = command center"**: no pop-up dashboards. Greeting, TODO, weekly tasks, project progress, note heatmap, and countdowns all live on one canvas.
- **Free home layout**: long-press a card to drag & reorder, resize width/height, add or remove modules, and reset the layout with one click — your home, your rules.
- **Complete task model**: four-quadrant priorities, start/due dates, parent & child tasks, repeating tasks (auto-advance to the next reminder), a daily check-in axis, and overdue-on-top sorting.
- **Four project views**: Gantt / list / calendar / kanban — the same project, four perspectives, cross-view linked highlights.
- **Inspiration board**: a dedicated capture → evaluate → progress → archive workflow with star-marked importance and drag-to-change-stage.
- **Multi-countdowns**: track up to 5 events at once (exam, launch, project milestone…) with live progress bars.
- **Bilingual**: switch the interface between Chinese and English in one click.
- **Dark / light themes**: follows Obsidian automatically, or force either mode with a finely tuned palette.
- **Zero dependencies**: pure TypeScript + Obsidian API. No network calls, no telemetry, no data leaves your vault.

### 📦 Feature Overview

#### Home

| Module | Description |
| --- | --- |
| **Top banner** | Upload a cover image and drag to adjust its vertical position |
| **Vault Pulse** | Notes / pending / added-today / current streak, refreshed live |
| **Quick capture** | Type and hit Enter to save a Markdown note instantly (template supported) |
| **TODO** | Today's tasks, overdue pinned on top, sorted by priority |
| **Progress** | Dual ring charts: today's completion + overall completion |
| **This week & overdue** | This week's tasks plus a red overdue section, with colored urgency tags |
| **Project pipeline** | Initiate → Plan → Develop → Test → Launch stage pipeline |
| **Note stats** | GitHub-style 52-week activity heatmap |
| **Countdown** | Up to 5 custom events with live progress bars |

#### Project overview (click "All projects")

- Draggable project sidebar (order persisted), right-click to edit/delete.
- **Four views**: Gantt / list / calendar / kanban, with cross-view highlight linking.
- **Gantt**: day / week / month / quarter zoom, drag bars to edit dates (edge or whole), parent-child indentation, today line, adjustable header-height divider.
- **List**: column sorting, status filter, context menu.
- **Calendar**: tasks rendered inside month-grid cells, drag to change date.
- **Kanban**: To-do / In progress / Blocked / Done / Cancelled, cross-column drag updates status.

#### Inspiration board (click "Inspirations")

- A separate kanban workflow: **Inbox → Evaluating → In progress → Done / Dropped**.
- Cross-column drag to change stage, star items as important, inline detail editing, and a list view.
- All items live in a single Markdown file; a readable table projection is generated in the body.

#### Task management

- **Four-quadrant priority**: Urgent & important / Important, not urgent / Urgent, not important / Neither.
- **Repeating tasks**: daily / workdays / weekly days / monthly date / custom interval; completion auto-advances to the next reminder.
- **Parent & child tasks**: multi-level nesting with completion links.
- **Daily check-in axis**: multi-day tasks show a per-day check-in axis in the detail modal, with a four-color status.
- **Reminders**: on the day / 1 day / 3 days / 1 week before.
- Tags, notes, postpone a day, mark done / postpone to today, and more.

### 🚀 Installation

#### First-time install

1. Download `main.js`, `manifest.json`, `styles.css` from the latest Release.
2. Create a folder `YourVault/.obsidian/plugins/xove-dashboard/` and put the three files inside:
   ```
   YourVault/.obsidian/plugins/xove-dashboard/
       ├── main.js
       ├── manifest.json
       └── styles.css
   ```
3. Open Obsidian → **Settings → Community plugins**.
4. Enable **Xove Dashboard**.

> If it doesn't appear immediately, run **Reload app without saving** (`Ctrl+R`) from the command palette.

#### Upgrade from an older version (v0.2.x → 0.3.0)

> Since 0.3.0 the plugin was renamed from `dashboard` to `xove-dashboard` (both the plugin ID and the install folder changed).

The old version used a folder named `dashboard` or `agent-dashboard`; the new version uses `xove-dashboard`. Because the ID changed, settings are not carried over automatically.

1. **Back up** your old plugin folder (including its `data.json`).
2. Put the new `xove-dashboard/` folder into `.obsidian/plugins/`.
3. *(Optional)* To keep your settings, copy the old `data.json` into the new `xove-dashboard/data.json`.
4. In **Settings → Community plugins**, disable and remove the old `Dashboard`, then delete its old folder.
5. Enable **Xove Dashboard**.

### 📖 Quick Start

1. **Set up your task system** — click **＋ New project** to create a project (e.g. Work / Study), set color, dates, and description. Enter "All projects", select it, click **＋ New task** (project auto-filled), and fill in name, priority, dates, type, reminder, tags, notes.
2. **Bring the home to life** — capture ideas in the **Quick capture** box; mark today's tasks done in TODO (repeating tasks auto-advance); track progress with the ring charts and this-week/overdue cards.
3. **See the big picture** — in "All projects", use Gantt for timeline, Calendar for scheduling, and Kanban for status flow. Drag to edit — changes write back to Markdown in real time.
4. **Capture inspiration** — open "Inspirations", drop ideas into the Inbox, then drag them through Evaluating → In progress → Done.
5. **Customize** — **Settings → Xove Dashboard**: language, home layout (long-press a card to edit), custom title, board stages, project pipeline stages, storage paths, and theme.

### 🛠 Quick Reference

| I want to… | How |
| --- | --- |
| New task | Toolbar **＋ New task** |
| New project | Toolbar **＋ New project** |
| Diary / capture | Toolbar **＋ New note** / Quick capture box |
| Mark a task done | Click the circle before the task |
| Edit a task | Click the task text / right-click → Edit |
| Postpone a day | Right-click → Postpone one day |
| Advance a repeating task | Click the circle |
| Rearrange home layout | Long-press a card to enter edit mode |
| Toggle theme | Top **☾** button |
| Change plugin title | Settings → Plugin title |

### 💡 FAQ

**Where is my data stored?**
As Markdown files (frontmatter) in your vault. No database, nothing external.

**Is mobile supported?**
Not yet — this plugin is desktop-only.

**Can I rename the "Inspirations" board?**
Yes. Settings → Board → Board name — change it to anything (Opportunities / Pipeline / Ideas…).

**How many countdowns can I track?**
Up to 5.

**Does it phone home / collect data?**
No. Zero network calls, zero telemetry — everything stays local.

### 📄 Notes

- Desktop only; not available on mobile.
- Plugin ID: `xove-dashboard` · Version: 0.3.0 · Min Obsidian version: 1.8.0.

---

## 中文

[English](#english) · [中文](#中文)

> 把 Obsidian 首页变成你的「个人工作控制台」——任务、项目、灵感、笔记统计、倒计时，一屏尽览。

Xove Dashboard 不是又一个任务清单插件，而是一套**以首页为核心的个人工作控制台**。它把 Obsidian 的首页变成一个可自定义的仪表盘，聚合你的任务、项目、灵感看板、笔记活动与重要倒计时，让你打开 Obsidian 就能掌握全局。

### ✨ 亮点

- **一切基于 Markdown**：任务、项目、看板全部存为普通 Markdown + frontmatter，数据在你手里，随时可编辑、可迁移、可备份。
- **真正的「首页即控制台」**：不打开任何弹窗页面，问候语、TODO、本周待办、项目进度、笔记热力图、倒计时，全部聚合在首页一张画布上。
- **首页模块自由布局**：长按卡片即可拖拽排序、调整宽高比例、增删模块、一键重置布局——你的首页你说了算。
- **任务体系完整**：优先级四象限、开始/截止日期、父子任务、重复任务（自动推进下次提醒）、每日节点打卡轴、逾期置顶。
- **项目总览四视图**：甘特图 / 列表 / 日历 / 看板，同一个项目四种视角，跨视图联动。
- **灵感收集看板**：独立的「收集 → 推进 → 归档」工作流，星标标重要，拖拽改阶段。
- **倒计时多实例**：同时跟踪最多 5 个重要事件，实时进度条。
- **中英双语**：界面一键切换中文 / English。
- **深色 / 浅色主题**：自动跟随 Obsidian 外观，也可手动强制。
- **零外部依赖**：纯 TypeScript + Obsidian API，无网络请求、无遥测、无数据外传。

### 📦 功能总览

#### 首页（Home）

| 模块 | 说明 |
| --- | --- |
| **顶部横幅** | 上传封面图并拖拽调整位置 |
| **Vault Pulse** | 笔记数 / 未完成数 / 今日新增 / 连续天数，实时刷新 |
| **快速捕捉** | 输入即存为 Markdown 笔记，支持模板 |
| **TODO** | 今日任务，逾期置顶 + 优先级排序 |
| **工作进度** | 双环形图：今日完成率 + 全部完成率 |
| **本周待办 & 逾期** | 本周任务 + 逾期红色置顶，紧急程度彩色标签 |
| **项目进度** | 立项 → 规划 → 开发 → 测试 → 上线 阶段管道 |
| **笔记统计** | GitHub 风格 52 周热力图 |
| **倒计时** | 最多 5 个自定义事件，实时进度条 |

#### 项目总览（点击「全部项目」）

- 侧边栏项目列表，可拖拽排序、右键编辑/删除。
- **四个视图**：甘特图 / 列表 / 日历 / 看板，跨视图高亮联动。
- **甘特图**：日 / 周 / 月 / 季度缩放，任务条边缘/整体拖拽改日期，父子缩进，今日线，可调高度分隔条。
- **列表**：列排序、状态筛选、右键菜单。
- **日历**：月视图网格内直接渲染任务条，拖拽改日期。
- **看板**：待办 / 进行中 / 已阻塞 / 已完成 / 已取消，跨列拖拽改状态。

#### 灵感收集（点击导航「灵感收集」）

- 独立的灵感看板：**收集箱 → 评估中 → 进行中 → 已完成 / 已放弃**。
- 跨列拖拽改阶段、★ 星标标记重要性、内联详情编辑、列表视图。
- 所有条目存于一个 Markdown 文件，正文自动生成可读表格投影。

#### 任务管理

- **四象限优先级**：重要且紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急。
- **重复任务**：每天 / 工作日 / 每周几 / 每月几号 / 自定义间隔，完成自动推进下次提醒。
- **父子任务**：多级嵌套，父任务完成态联动。
- **每日节点轴**：多日任务在详情弹窗中展示每日打卡日期轴，四色状态一目了然。
- **提醒**：任务当天 / 提前 1 天 / 提前 3 天 / 提前 1 周。
- 标签、备注、延期一天、标记完成/延后到今天等快捷操作。

### 🚀 安装

#### 首次安装

1. 下载最新 Release 中的 `main.js`、`manifest.json`、`styles.css`。
2. 在代码库中创建文件夹 `你的代码库/.obsidian/plugins/xove-dashboard/`，把三个文件放进去：
   ```
   YourVault/.obsidian/plugins/xove-dashboard/
       ├── main.js
       ├── manifest.json
       └── styles.css
   ```
3. 打开 Obsidian → **设置 → 第三方插件（Community plugins）**。
4. 启用 **Xove Dashboard**。

> 若安装后未立即出现，在命令面板执行 **重新加载应用，不保存**（`Ctrl+R`）。

#### 从旧版升级（v0.2.x → 0.3.0）

> v0.3.0 起插件由 `dashboard` 改名为 `xove-dashboard`（插件 ID 与安装目录都变了）。

旧版目录名为 `dashboard` 或 `agent-dashboard`；新版用 `xove-dashboard`。由于 ID 改变，配置不会自动继承。

1. **备份**旧插件目录（含其 `data.json`）。
2. 把新的 `xove-dashboard/` 文件夹放入 `.obsidian/plugins/`。
3. *（可选）* 保留配置：把旧 `data.json` 复制到新 `xove-dashboard/data.json`。
4. 在 **设置 → 第三方插件** 禁用并移除旧的 `Dashboard`，删除其旧目录。
5. 启用 **Xove Dashboard**。

### 📖 快速上手

1. **建立任务体系** — 点击工具栏 **＋ 新建项目**创建项目（设置颜色、起止日期、描述），进入「全部项目」选中后点 **＋ 新建任务**（所属项目自动预填），填写名称、优先级、日期、类型、提醒、标签、备注。
2. **让首页活起来** — 在首页「快速捕捉」输入直接存笔记；TODO 点圆圈标记完成；用工作进度双环图 + 本周待办把握每天节奏。
3. **掌控全局** — 在「全部项目」用甘特图看时间线、日历看排期、看板看状态流转；拖拽改日期实时写回 Markdown。
4. **记录灵感** — 打开「灵感收集」，丢进收集箱，随后拖到评估中、进行中直到已完成。
5. **自定义** — **设置 → Xove Dashboard**：语言、首页布局（长按卡片编辑）、自定义标题、看板阶段、项目阶段管道、存储路径、主题。

### 🛠 常用操作速查

| 想做 | 怎么做 |
| --- | --- |
| 新建任务 | 工具栏「＋ 新建任务」 |
| 新建项目 | 工具栏「＋ 新建项目」 |
| 日记 / 捕捉 | 工具栏「＋ 新日记」/ 首页快速捕捉框 |
| 标记任务完成 | 点任务前的圆圈 |
| 编辑任务 | 点任务文字 / 右键 → 编辑 |
| 任务延后一天 | 右键 → 延后一天 |
| 重复任务推进 | 点圆圈（自动推进到下次提醒）|
| 调整首页布局 | 长按卡片进入编辑态 |
| 切换深/浅色 | 顶部 ☾ 按钮 |
| 修改插件标题 | 设置 → 插件标题 |

### 💡 常见问题

**我的数据存哪？**
全部存为 Vault 中的 Markdown 文件（frontmatter），不存数据库，不外传。

**支持移动端吗？**
暂时只支持桌面端。

**能改「灵感收集」的名字吗？**
能。设置 → 看板 → 看板名称，可改成任意名字（机会点 / 管道 / Ideas…）。

**能同时跟踪几个倒计时？**
最多 5 个。

**会联网吗？会收集数据吗？**
不会。零网络请求、零遥测，数据 100% 本地。

### 📄 说明

- **桌面端专用**：移动端不可用。
- 插件 ID：`xove-dashboard` · 版本：0.3.0 · 最低 Obsidian 版本：1.8.0。