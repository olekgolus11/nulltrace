# AGENTS.md — NullTrace

NullTrace is an AI-assisted penetration testing TUI built with Bun, React 19, and OpenTUI.
This file is for coding agents working in this repository.

## Purpose

- Preserve the existing TUI architecture and coding style.
- Prefer small, targeted edits over broad refactors.
- Follow Bun-first workflows; do not switch the repo to Node-specific tooling.
- Keep changes compatible with strict TypeScript.
- Before changing code, read and follow `CODING_STANDARDS.md`. Its module organization, type placement, export, and naming rules are mandatory for new code.

## Guidance Precedence

When guidance conflicts, follow it in this order:

1. Explicit user instructions.
2. Architecture decisions in `docs/adr/`.
3. Domain vocabulary and definitions in `CONTEXT.md`.
4. Code organization rules in `CODING_STANDARDS.md`.
5. This file's workflow and project guidance.

## Project Snapshot

- Runtime: Bun with `type: module`.
- UI stack: React 19, `@opentui/react`, and `@opentui/core`.
- State patterns: local React hooks plus Zustand stores for tool workspaces.
- Testing: Bun test runner.
- Lint/format: no linter or formatter is configured.

## Repository Guidance Files

- Primary guidance file: `AGENTS.md`.
- `.cursor/rules/`: directory exists but contains no rule files.
- `.cursorrules`: not present.
- `.github/copilot-instructions.md`: not present.
- Because no Cursor/Copilot rule files exist, this document is the effective agent guidance for the repo.

## Planning Source

- Product planning lives in [GitHub Issues](https://github.com/olekgolus11/nulltrace/issues) and [GitHub Milestones](https://github.com/olekgolus11/nulltrace/milestones). Consult them for the current scope; do not treat this file as a live planning record.
- The milestone description is the PRD when an issue belongs to a milestone.
- Must write GitHub issues and pull requests in English.

## Build, Run, and Test Commands

```sh
# Install dependencies
bun install

# Run the app
bun run start
# equivalent: bun run src/main/index.tsx

# Dev mode with auto-restart
bun run dev
# equivalent: bun --watch run src/main/index.tsx

# Type-check
bunx tsc --noEmit

# Run all tests
bun test

# Run a single test file
bun test src/features/action-draft/services/__tests__/action-draft-workspace.mapper.test.ts

# Run tests by name
bun test --filter "command state"
```

## Tooling Rules

- Use Bun instead of `node`, `npm`, `pnpm`, or `yarn`.
- Prefer `bun run <script>` for scripts and `bun test` for tests.
- Do not add alternate toolchains unless the user explicitly asks.
- There is no ESLint, Prettier, or CI config to rely on.

## Authenticated Nuclei Troubleshooting

- An authenticated Nuclei scan has been observed to start working when NullTrace was launched with `sudo`. Treat this as a diagnostic sign of a filesystem ownership or permission problem involving Nuclei configuration, cache, templates, or NullTrace application data—not as the normal way to run NullTrace.
- Do not routinely run NullTrace with `sudo`. It can create root-owned application data and later cause failures such as `SQLITE_READONLY` when NullTrace runs as the normal user.
- If `sudo` changes the behavior, compare ownership and permissions for the Nuclei configuration/cache/template directories and the NullTrace application-data directory, restore normal-user access, then retry without `sudo`.

## Project Structure

```text
src/
  app/                 # Theme and app-wide constants
  main/                # Entry point, app shell, route state
  features/
    chat/              # Chat UI
    authentication/    # Session authentication context and secret handling
    action-draft/      # AI-proposed scanner actions
    dashboard/         # Main analysis workspace
    entry/             # Landing / target input flow
    session/           # Session list UI
    sitemap/           # Sitemap tree rendering and utilities
    tool/              # Tool workspace, nmap/nuclei support, shared tool state
    finding/           # Finding model, services, badges, lists, summary
  shared/ui/           # Shared top-level TUI components
```

Common feature subfolders:

```text
components/
data/
hooks/
model/ or types/
screen/
services/
store/
config/
```

## Architecture Notes

- The app is a terminal UI, not a DOM app.
- JSX primitives such as `<box>`, `<text>`, `<scrollbox>`, `<input>`, and `<span>` come from OpenTUI.
- Screen routing is simple state switching in `src/main/App.tsx`.
- Dashboard and entry flows use `useReducer`-based local state hooks.
- Tool workspaces use Zustand stores under `src/features/tool/shared/store/`.
- Findings are scanner-derived session observations persisted in SQLite.
- Finding reviews are operator-derived judgment stored separately from session findings.
- Current behavior still includes mock-heavy UI areas; avoid introducing backend assumptions unless the task requires it.

## Tool System Layout

- `src/features/tool/shared/` holds the reusable tool shell: workspace store, keyboard navigation, registry, shared components, and command execution.
- `src/features/tool/nmap/` and `src/features/tool/nuclei/` are the implemented scanner tools today.
- Each tool folder follows the same shape when it exists: `components/`, `config/`, `data/`, `services/`, `store/`, `types/`.
- `tool-registry.ts` is the switchboard for tool metadata, workspace creation, command generation, and tool-specific key handling.
- `command-runner.service.ts` is the execution boundary. Keep shell behavior changes here deliberate because it affects every tool workspace.
- Prefer extending the existing tool shell and registry before adding new one-off tool logic elsewhere.

## Finding Review Domain Rules

- Use Finding as the operator-facing term; do not reintroduce Vulnerability or Vuln labels unless historical data requires it.
- Keep `session_findings` as the scanner-derived observation layer.
- Keep finding review state separate from scanner upserts so operator judgment is not overwritten.
- Review statuses are `needs_review`, `confirmed`, and `dismissed`.
- A finding without an explicit review record is effectively `needs_review`.
- Dismissed findings remain visible in normal findings lists.
- Severity counts stay based on all session findings and must not be adjusted by review status.

## Code Style

### TypeScript

- Keep `tsconfig.json` strict; do not weaken `strict` mode.
- Prefer explicit type annotations for exported props, state shapes, and service contracts.
- Use `interface` for object shapes.
- Use `type` aliases for unions and action variants.
- Do not introduce `enum`; use string literal unions instead.
- Use `as const` for immutable config objects and literal catalogs.
- Use `Record<K, V>` for lookup maps with known keys.
- Avoid broad casts; if you must cast, keep it narrow and local.

### Imports and Exports

- Put external imports before internal imports.
- Keep imports compact; most files do not separate groups with blank lines.
- Use named exports and named imports only.
- Do not introduce `export default`.
- Use relative imports throughout; do not add path aliases.
- Most local imports omit file extensions, but a few files use `.js` suffixes; preserve the touched file's local convention.
- Existing code usually avoids `import type`; follow the surrounding file.

### Naming

- Components: `PascalCase` function declarations in `PascalCase.tsx` files.
- Hooks: `camelCase` names starting with `use`, usually in `use-kebab-case.ts` files.
- Props interfaces: `SomethingProps`.
- State interfaces: descriptive `PascalCase` names such as `DashboardState`.
- Union/action strings: `SCREAMING_SNAKE_CASE` literals such as `"CYCLE_PANEL"`.
- Module constants: usually `camelCase`; keep existing `UPPER_SNAKE_CASE` constants when already established.
- Booleans: prefix with `is`, `has`, or `show`.
- Zustand hooks: `useSomethingStore`.

### Functions and Components

- Prefer function declarations for exported components, hooks, and helpers.
- Use inline arrow callbacks for short handlers and array callbacks.
- Destructure props in function signatures when it improves readability.
- Let React component return types be inferred.

### State Management

- Prefer `useReducer` for view-local keyboard and navigation state.
- Prefer Zustand only where shared tool workspace state already exists.
- Reducers should use discriminated union actions.
- Reducer `default` branches should return the existing state unchanged.
- Keep state update helpers close to the feature they belong to.

### Error Handling

- Prefer guard clauses and early returns.
- Use optional chaining and nullish/default fallbacks for absent data.
- Reserve `try/catch` for real runtime boundaries such as command execution.
- In async command flows, convert unknown errors into readable messages.
- Use non-null assertions only after bounds or existence checks.

### Formatting and Comments

- Use 2-space indentation.
- Keep semicolons.
- Use trailing commas in multi-line arrays, objects, params, and unions.
- Favor readable multi-line object literals over dense one-liners.
- Keep comments minimal and practical.
- Use single-line comments only for non-obvious logic or section markers.

### Styling and UI

- Do not add CSS files; styling is done inline through OpenTUI props.
- Always pull colors from `theme` in `src/app/theme/theme.ts`.
- Do not hardcode color values in feature components.
- Preserve the existing cyber/teal visual language unless the user requests a redesign.
- Remember the rendering target is a terminal, so layouts should fit text UI constraints.

## Testing Guidance

- Must place test files inside a `__tests__/` directory near the code they cover. Never put `*.test.ts` or `*.test.tsx` files directly beside production files.
- Must add focused Bun tests when adding or changing parsing, mapping, persistence, fingerprints, severity normalization, or extracted pure read-model logic.
- TUI component unit tests are optional unless a change extracts pure read-model logic that is useful to test.
- Should verify impacted code with `bunx tsc --noEmit` and manual app checks when practical.
- Should run existing tests when they cover the changed path and are genuinely useful.
- Example: `bun test src/features/action-draft/services/__tests__/action-draft-workspace.mapper.test.ts`

## Agent Workflow

- Must read nearby feature files before editing to match local patterns.
- Must check whether a feature already has a hook, store, service, config, or registry entry before adding a new one.
- Should extend existing mock/config data and the current tool shell instead of inventing parallel structures.
- Should use GitHub Issues as the task-tracking system when work needs to be recorded or planned.
- Should report a bug found during implementation, review, or verification. Create or update a GitHub issue, with an appropriate bug label when available, only when the task authorizes that external change.
- Must state clearly in the handoff when verification could not be run.
