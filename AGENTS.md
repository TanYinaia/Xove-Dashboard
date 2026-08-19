# Dashboard - Development Guidelines

## Project Overview

This is a TypeScript-based Obsidian community plugin project, not an Obsidian Vault.

- **Plugin ID**: `dashboard`
- **Display Name**: `Dashboard`
- **Version**: `0.2.7` (source of truth: `manifest.json`)
- **Min Obsidian Version**: `1.8.0`
- **Runtime dependencies**: none (plain TypeScript + Obsidian API + native CSS)
- **Single edition**: `src/` is the one and only source of truth (on the `personal` branch).
  There is no separate "generic" edition.

For the full feature list, data model, and version history, read `PROJECT_CONTEXT.md`.
For the file inventory and the list of obsolete files, read `项目整理报告.md`.

## Common Commands

```bash
npm install          # Install dependencies
npm run check        # One-shot gate: typecheck + lint + build:js + tests
npm run build:js     # rollup bundle (pure JS, canonical bundle step)
npm run build        # tsc type-check + esbuild production build
npm run dev          # esbuild watch mode
npm run lint         # Run ESLint (with eslint-plugin-obsidianmd rules)
npm run typecheck    # TypeScript type-check only
npm run test         # Unit tests (node --test, data layer)
```

> **Build environment**: the bundled Node.js (v24.13.0, updated 2026-08-11 16:35) crashes at
> startup on this HarmonyOS kernel when JIT is enabled (V8 `Check failed: 12 ==
> (*__errno_location())`). **Workaround — local build, no Windows needed:** run node with
> `--jitless`. `node --jitless node_modules/rollup/dist/bin/rollup -c rollup.config.mjs`
> builds `main.js`; `node --jitless node_modules/typescript/bin/tsc -noEmit -skipLibCheck`
> type-checks. `npm` is broken (missing npm-cli.js), so invoke the node binary directly.
> Caveat: `--jitless` disables WebAssembly, so Node's TS type-stripping can't load `.ts`
> test files — unit tests currently can't run.

## Obsidian Plugin Directory

The final plugin directory (e.g., `.obsidian/plugins/dashboard/`) requires only:
- `main.js`
- `manifest.json`
- `styles.css`

Obsidian does not hot-reload plugin JS/CSS. After copying the three files, run
**Reload app without saving** from the command palette.

## Source Layout

```
src/                                   # the single source of truth
├── main.ts                  # plugin lifecycle: view / ribbon / command / settings tab
├── settings.ts              # settings interface, defaults, settings UI
├── constants.ts             # shared constants (status, priority, NPDP phases, …)
├── icons.ts                 # inline SVG icon constants (currentColor, theme-adaptive)
├── data/
│   ├── taskParser.ts        # task & project frontmatter parsing, daily-node read/write
│   ├── opportunityParser.ts # opportunity data layer
│   ├── taskParseCore.ts     # parsing primitives
│   ├── taskLogic.ts         # task/project derivation & calculations
│   ├── taskStore.ts         # in-memory store + debounced vault sync
│   ├── dashboardStore.ts    # dashboard-wide state
│   ├── virtualList.ts       # long-list virtualization
│   └── mockData.ts          # shared types + placeholder data for the UI skeleton
└── views/
    ├── DashboardView.ts     # home page (the single ItemView)
    ├── ProjectBoard.ts      # project overview (4 sub-views)
    ├── OpportunityBoard.ts  # opportunity board/list
    ├── TaskModal.ts, TaskEditModal.ts, ProjectModal.ts,
    └── OpportunityModal.ts, BannerModal.ts
scripts/
└── verify.mjs              # one-shot local check: typecheck + lint + build + tests
```

## Development Guidelines

### API Usage

- Prioritize Obsidian's official public APIs
- Do not depend on undocumented internal APIs
  (the one deliberate exception is `vault.setConfig('theme', …)` in `main.ts`, which is
  guarded by try/catch and has a body-class fallback)

### Implementation Approach

- Keep changes minimal, testable, and iterative
- Do not add production dependencies unnecessarily
- All user-facing strings and settings are in Chinese

### ItemView Pitfalls (learned the hard way)

- **Never declare a class field on an `ItemView` subclass whose name collides with a
  built-in Obsidian property** (`titleEl`, `headerEl`, `iconEl`, `contentEl`, `containerEl`,
  `leaf`, …). Class-field initialization runs after `super()` and silently overwrites the
  parent property → blank view, with the stack trace pointing at Obsidian's own `app.js`.
  Prefix custom fields with `ad`.
- In `onOpen`, call `this.containerEl.empty()` before creating the root element; do not
  rely on `containerEl.children[1]`.
- Full-bleed overlays (e.g. the noise canvas) must use `inset: 0`, not `width/height: 100%`
  — percentage heights collapse inside a `flex: 1` parent and the canvas falls back to its
  intrinsic size.

### UI Development

- Dashboard UI tasks should reference the `frontend-design` skill
- CSS class prefixes: `ad-` (home), `po-` (project overview), `op-` (opportunity)
- Colors must go through the `--ad-*` design tokens; light-mode overrides use the
  `:is(body.theme-light …:not([data-theme="dark"]), body.theme-dark …[data-theme="light"])`
  selector form

### Obsidian Development

- Obsidian API, lifecycle, manifest, security, accessibility, and plugin review rules should reference the `obsidian-plugin-skill` skill

### Safety & Confirmation

Before performing the following actions, you must explain and wait for confirmation:
- Network requests
- Telemetry
- Cloud sync
- File deletion
- Modifications to real Vault data

### Security

- Do not commit API keys, tokens, local Vault paths, or private data

### Git & Repository

- **Local git only** — do not create remotes, do not push, do not publish
- Do not bump the version or run any git command without an explicit instruction
- "发布版本 X.Y.Z" from the user authorizes both the version bump and a local commit;
  stage the release files explicitly (`main.js` is gitignored, exclude `.workbuddy/` and
  dev tools)
- Branches: a single `personal` branch is the only git branch. There is no `master`/`generic`
  branch and no separate edition — `src/` is the only source of truth.
- Never run `git checkout .` or `git stash` on the whole tree — the working tree usually
  carries a large amount of uncommitted work

### Code Changes

Before making large-scale changes:
1. Explain the goal
2. List affected files
3. Present the minimal implementation plan

After modifying code:
1. Run `npm run check` (typecheck + lint + build:js + tests)
2. Fix any failure before finishing
3. Summarize the changes and verification method
