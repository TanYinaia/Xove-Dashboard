# Dashboard - Development Guidelines

## Project Overview

This is a TypeScript-based Obsidian community plugin project, not an Obsidian Vault.

- **Plugin ID**: `dashboard`
- **Display Name**: `Xove Dashboard`
- **Version**: `0.3.0` (source of truth: `manifest.json`; `package.json` may lag behind — keep
  manifest / versions / package.json all in sync on release)
- **Min Obsidian Version**: `1.8.0`
- **Runtime dependencies**: none (plain TypeScript + Obsidian API + native CSS)
- **Single edition**: `src/` is the one and only source of truth (on the `personal` branch).
  There is no separate "generic" edition.
- **i18n**: bilingual — `zh` (default, mixed CN/EN) / `en` (pure English). Dictionary lives in
  `src/i18n/` (`index.ts` + `zh.ts` / `en.ts`); UI strings go through `t()`, string arrays
  through `tArr()`, current-lang fallback is `zh`.

For the full feature list, data model, and version history, read `PROJECT_CONTEXT.md`.

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

> **Build environment**: canonical bundle step is `npm run build:js` (rollup 3 + inline TS
> transpile, pure JS — no native binaries, works everywhere node runs). If `npm` is broken on
> the machine, invoke the node binary directly:
> `node node_modules/rollup/dist/bin/rollup -c rollup.config.mjs` and
> `node node_modules/typescript/bin/tsc -noEmit -skipLibCheck`.
> ⚠️ On restricted kernels (e.g. HarmonyOS OHOS) node 24 may crash at startup when JIT is on
> (V8 `Check failed: 12 == (*__errno_location())`) — run with `--jitless` there. Note
> `--jitless` disables WebAssembly, so Node's TS type-stripping can't load `.ts` test files
> (unit tests can't run in that mode).

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
├── main.ts                  # plugin lifecycle: view / ribbon / command / settings tab / theme + language wiring
├── settings.ts              # settings interface, defaults, settings UI (language, board stages, countdown, home layout)
├── constants.ts             # shared UI copy constants (UI_TEXT / MODAL_TEXT, zh side)
├── icons.ts                 # inline SVG icon constants (currentColor, theme-adaptive)
├── i18n/                    # minimal i18n: index.ts (t/tArr/getLang/setLang) + zh.ts / en.ts dictionaries
├── data/
│   ├── taskParser.ts        # task & project frontmatter parsing, daily-node read/write
│   ├── opportunityParser.ts # board data layer (frontmatter array + body projection, BoardStage)
│   ├── taskParseCore.ts     # parsing primitives
│   ├── taskLogic.ts         # task/project derivation & calculations
│   ├── taskStore.ts         # in-memory store + debounced vault sync
│   ├── dashboardStore.ts    # dashboard-wide state
│   ├── frontmatterWriter.ts # unified frontmatter writer (yamlScalar escaping, CRLF-safe)
│   ├── parserDiagnostics.ts # parse-failure collector ("N files failed to parse" banner)
│   ├── virtualList.ts       # long-list virtualization
│   └── mockData.ts          # shared types + placeholder data for the UI skeleton
└── views/
    ├── DashboardView.ts     # home page (the single ItemView; countdown multi-instance cards)
    ├── ProjectBoard.ts      # project overview (4 sub-views)
    ├── OpportunityBoard.ts  # board (灵感收集) renderer: kanban / list / single-stage inline edit
    ├── TaskModal.ts, TaskEditModal.ts, ProjectModal.ts,
    ├── OpportunityModal.ts, BannerModal.ts,
    └── CountdownModal.ts    # countdown event manager (≤5 instances; single-card edit mode)
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
- User-facing strings go through the i18n layer: `t()` for strings, `tArr()` for arrays
  (weekday/month lists etc.); keep `zh.ts` / `en.ts` in sync; brand anchors
  (SECOND BRAIN / XOVE DASHBOARD) stay constant English outside the dictionary

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
