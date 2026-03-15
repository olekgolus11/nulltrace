# AGENTS.md — pentest-ai (NullTrace)

AI-powered penetration testing TUI built with React 19, OpenTUI, and Bun.

## Build / Run / Test Commands

```sh
# Install dependencies
bun install

# Run the app
bun run start              # or: bun run src/main/index.tsx

# Dev mode (auto-restart on changes)
bun run dev                # or: bun --watch run src/main/index.tsx

# Type-check (no emit)
bunx tsc --noEmit

# Run all tests
bun test

# Run a single test file
bun test src/features/chat/chat.test.ts

# Run tests matching a name pattern
bun test --filter "chat"
```

There is no linter or formatter configured. No CI pipeline exists yet.

## Runtime & Tooling — Use Bun, Not Node

Always use Bun instead of Node.js, npm, pnpm, yarn, or vite.

| Instead of                      | Use                            |
| ------------------------------- | ------------------------------ |
| `node file.ts` / `ts-node`      | `bun file.ts`                  |
| `npm install` / `yarn` / `pnpm` | `bun install`                  |
| `npm run <script>`              | `bun run <script>`             |
| `jest` / `vitest`               | `bun test`                     |
| `webpack` / `esbuild` / `vite`  | `bun build`                    |
| `dotenv`                        | Bun loads `.env` automatically |

Prefer Bun built-in APIs:

- `Bun.serve()` — HTTP server with WebSocket/HTTPS/routes (not `express`)
- `bun:sqlite` — SQLite (not `better-sqlite3`)
- `Bun.file()` — file I/O (not `node:fs` readFile/writeFile)
- `Bun.$\`cmd\``— shell commands (not`execa`)
- `WebSocket` built-in (not `ws`)

## Project Structure

```
src/
  main/              # Entry point, root App component, route types
  app/               # App-wide config (theme, colors)
  features/          # Feature modules (Feature-Sliced Design)
    chat/            # AI chat assistant
    dashboard/       # Main pentest workspace (4-panel layout)
    entry/           # Landing screen with URL input
    session/         # Previous session list
    sitemap/         # Hierarchical site map tree
    vulnerability/   # Vulnerability display & badges
  shared/            # Cross-feature reusable UI (Header, StatusBar)
```

Each feature follows this internal layout:

```
feature-name/
  components/        # React components (.tsx)
  data/              # Constants, mock data, catalogs (.ts)
  hooks/             # Custom React hooks (.ts)
  model/             # Types, interfaces, state definitions (.ts)
  screen/            # Screen-level components (.tsx)
```

## Code Style

### TypeScript & Strictness

- `tsconfig.json` has `"strict": true`. Do not weaken it.
- JSX uses `@opentui/react` as the import source — elements like `<box>`, `<text>`,
  `<scrollbox>`, `<input>`, `<span>` are OpenTUI primitives, not DOM.
- Target is `ESNext` with `"moduleResolution": "bundler"`.

### Imports

- External/library imports first, then internal imports. No blank line between groups.
- Use standard `import { Foo } from "..."` — do **not** use `import type`.
- All paths are relative (`../`). No path aliases (`@/`).
- Omit file extensions on imports.

### Naming Conventions

| Item                      | Convention                               | Example                                |
| ------------------------- | ---------------------------------------- | -------------------------------------- |
| Component files           | `PascalCase.tsx`                         | `ChatMessage.tsx`                      |
| Hook files                | `use-kebab-case.ts`                      | `use-dashboard-shortcuts.ts`           |
| Model/type files          | `feature.category.ts` (kebab-case)       | `dashboard.types.ts`, `entry.state.ts` |
| Data/mock files           | `feature.category.ts` or `kebab-case.ts` | `dashboard.mock.ts`, `tool-catalog.ts` |
| Components (code)         | `PascalCase` function declarations       | `export function ToolCard() {}`        |
| Hooks (code)              | `camelCase` with `use` prefix            | `useDashboardLayout`                   |
| Local variables/functions | `camelCase`                              | `sidebarWidth`, `handleBackToEntry`    |
| Boolean variables         | `is`/`has`/`show` prefix                 | `isSelected`, `hasChildren`            |
| Interfaces                | `PascalCase`, no `I` prefix              | `DashboardState`, `SitemapNode`        |
| Props interfaces          | Suffix with `Props`                      | `ToolCardProps`, `ChatWindowProps`     |
| Type aliases (unions)     | `PascalCase`                             | `Severity`, `DashboardPanel`           |
| Action type strings       | `SCREAMING_SNAKE_CASE`                   | `"CYCLE_PANEL"`, `"SUBMIT_CHAT"`       |
| Initial state             | `initial` prefix                         | `initialDashboardState`                |
| Module-level constants    | `camelCase`                              | `theme`, `tools`, `severityConfig`     |

### Types

- **Interfaces** for object shapes (props, data models, state).
- **Type aliases** for unions and discriminated unions.
- **No enums** — use string literal union types exclusively.
- Use `as const` on object/array literals for immutability (e.g., `theme`, `boxChars`).
- Use `Record<K, V>` for lookup maps.
- Do not annotate component return types — let them be inferred.

### Exports

- **Named exports only.** Never use `export default`.
- Keep file-private helpers unexported.

### Functions

- Components: `export function ComponentName(props) {}` (function declarations).
- Hooks: `export function useHookName(props) {}`.
- Utilities/helpers: `function name()` declarations.
- Inline callbacks: arrow functions — `(key) => { ... }`.
- Destructure props in function signatures with default values where appropriate.

### Error Handling

- Guard clauses with early `return` (no try/catch, no Result types).
- Optional chaining for nullable access: `tools.find(...)?.name || fallback`.
- Reducer `default` case always returns unchanged state.
- Non-null assertion (`!`) used sparingly for array bounds after validation.

### State Management

- `useReducer` with factory-created reducers and discriminated union actions.
- No global state store — state is lifted to screen components, passed down via props.
- Custom hooks return an object: `{ state, ...actionDispatchers }`.

### Styling

- All colors come from the centralized `theme` object in `src/app/theme/theme.ts`.
- Styling is inline via component props — no CSS files or stylesheets.
- Always reference `theme.*` for colors; do not hardcode color values.

### Comments

- Minimal — use `//` single-line comments for section labels or non-obvious logic.
- No JSDoc. No block comments unless explaining complex algorithms.
- Use `{/* ... */}` for JSX section markers.

### Formatting

- 2-space indentation.
- Trailing commas in multi-line structures.
- No semicolons omitted — always use semicolons.

## Testing (bun:test)

Tests use Bun's built-in test runner. Place test files alongside source with `.test.ts`
or `.test.tsx` suffix.

```ts
import { test, expect } from "bun:test";

test("buildTree creates correct hierarchy", () => {
  const result = buildTree([{ path: "/admin", status: 200 }]);
  expect(result).toHaveLength(1);
});
```

## Key Libraries

- **@opentui/core + @opentui/react**: Terminal UI framework (React bindings).
  JSX elements are TUI primitives (`<box>`, `<text>`, `<scrollbox>`, etc.), not DOM.
  Use `useKeyboard` for input handling, `useTerminalDimensions` for layout.
- **React 19**: Function components only, hooks for state. No class components.
- **Bun**: Runtime, bundler, test runner, package manager.

For OpenTUI API reference, see `.agents/skills/opentui/` or `.opencode/skill/opentui/`.
