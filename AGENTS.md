# Dashboard - Development Guidelines

## Project Overview

This is a TypeScript-based Obsidian community plugin project, not an Obsidian Vault.

- **Plugin ID**: `agent-dashboard`
- **Display Name**: `Dashboard`
- **Version**: `0.2.6` (source of truth: `manifest.json`)
- **Min Obsidian Version**: `1.8.0`
- **Runtime dependencies**: none (plain TypeScript + Obsidian API + native CSS)

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

## Obsidian Plugin Directory

The final plugin directory (e.g., `.obsidian/plugins/agent-dashboard/`) requires only:
- `main.js`
- `manifest.json`
- `styles.css`

Obsidian does not hot-reload plugin JS/CSS. After copying the three files, run
**Reload app without saving** from the command palette.

## Source Layout

```
src/
├── main.ts                  # plugin lifecycle: view / ribbon / command / settings tab
├── settings.ts              # settings interface, defaults, settings UI
├── icons.ts                 # inline SVG icon constants (currentColor, theme-adaptive)
├── data/
│   ├── taskParser.ts        # task & project frontmatter parsing, daily-node read/write
│   ├── opportunityParser.ts # opportunity data layer (frontmatter array + body projection)
│   └── mockData.ts          # shared types + placeholder data for the UI skeleton
└── views/
    ├── DashboardView.ts     # the single ItemView: home / project overview / opportunity
    ├── TaskModal.ts, TaskEditModal.ts, ProjectModal.ts,
    └── OpportunityModal.ts, BannerModal.ts
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
- Branches: `master` = release line (generic features only), `personal` = personal line
  (master + personal-only features + dev tooling). Personal features never merge back.
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
