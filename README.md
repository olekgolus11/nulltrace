# NullTrace

<!-- Screenshot: upload temp-photos/entry-screen.jpg to GitHub and replace the URL below. -->
![NullTrace entry screen](UPLOAD_ENTRY_SCREEN_URL_HERE)

NullTrace is an AI-assisted penetration testing terminal UI built with Bun, React 19, and OpenTUI.

It is a research prototype exploring how large language models can support an operator during web application penetration testing. NullTrace brings target and session management, reconnaissance, scanner workflows, findings, and reporting into one keyboard-driven workspace while keeping consequential actions under operator control.

## Current State

NullTrace is under active development. It is useful as a research and lab environment, but it is not a hardened production security product or an autonomous pentesting platform.

The current application includes:

- persisted targets, testing sessions, conversations, scanner runs, artifacts, findings, and report drafts
- an automatic public sitemap crawl for new targets, with pause, resume, restart, depth, and provenance controls
- optional authenticated crawling and page inspection with explicit permission boundaries
- an isolated OpenCode-powered assistant with session-aware, read-only context tools
- operator-approved action drafts that can preconfigure supported scanner workspaces
- guided and editable workflows for Nmap, Nuclei, ffuf, Nikto, and targeted sqlmap verification
- normalized scanner findings, evidence links, severity summaries, and separate operator review states
- deterministic Markdown report export and LLM-assisted editable report drafts

Some prototype UI data and workflows are still evolving.

## Application Tour

### Session dashboard

The dashboard combines the Route Ledger, findings, AI conversation, scanner catalog, and proposed action drafts. Layouts adapt to the terminal size, and the primary workflows are available from the keyboard.

<!-- Screenshot: upload temp-photos/dashboard.jpg to GitHub and replace the URL below. -->
![NullTrace session dashboard](UPLOAD_DASHBOARD_SCREEN_URL_HERE)

### Guided scanner workspaces

Each implemented scanner uses the shared tool shell: guided controls, an editable generated command, bounded output, persisted run history, artifacts, and run confirmation. Scanner output feeds the session's findings and reconnaissance context where supported.

<!-- Screenshot: upload temp-photos/sqlmap-workspace.jpg to GitHub and replace the URL below. -->
![NullTrace targeted sqlmap workspace](UPLOAD_SQLMAP_WORKSPACE_URL_HERE)

## What Works Today

### Reconnaissance and session context

- create a target, start multiple sessions, browse history, and reopen prior work
- automatically crawl the public, exact-origin surface of a new target
- inspect route status, method, depth, and public/authenticated provenance in the Route Ledger
- enrich the sitemap with ffuf content-discovery results
- pause, resume, or restart crawl work without losing its checkpoint
- inspect public or authenticated pages only after selecting an explicit permission mode

### AI assistance

- keep multiple OpenCode conversations attached to a testing session
- ask the assistant about session context, findings, artifacts, scanner runs, the sitemap, and available tools
- surface page-inspection and other tool activity inside the conversation
- let the assistant propose scanner action drafts without automatically executing them
- review and apply a draft in the corresponding scanner workspace before running it

The embedded OpenCode runtime is deliberately isolated: file editing, shell access, sharing, and unrelated tools are disabled. NullTrace exposes a narrow set of application context tools instead.

### Scanner workflows

- **Nmap:** guided network scan profiles and manual command control
- **Nuclei:** template-based scanning, structured finding extraction, and authenticated runs
- **ffuf:** content discovery, parameter discovery, and value fuzzing with anomaly-derived findings
- **Nikto:** standard scans and constrained custom tuning, including authenticated runs
- **sqlmap:** targeted verification of one endpoint and parameter with conservative risk defaults and optional authenticated request reconstruction

Commands remain editable and require operator confirmation before execution. Runs, output logs, and generated artifacts are saved per session; long-running commands can be cancelled.

### Findings and reports

- normalize findings from Nmap, Nuclei, ffuf, Nikto, and sqlmap
- deduplicate scanner observations using stable fingerprints
- inspect evidence and source artifacts from the dashboard
- review findings as `needs_review`, `confirmed`, or `dismissed` without overwriting scanner data
- export selected findings and run context as Markdown
- generate, edit, save, and export an LLM-assisted report draft

## Tech Stack

- [Bun](https://bun.sh/) and strict TypeScript
- React 19
- OpenTUI (`@opentui/react` and `@opentui/core`)
- Zustand
- Bun SQLite (`bun:sqlite`)
- OpenCode SDK and plugin runtime
- Playwright for permission-gated page inspection

## Run Locally

### Prerequisites

- [Bun](https://bun.sh/)
- a terminal supported by OpenTUI
- [OpenCode](https://opencode.ai/) for the AI assistant and LLM-assisted report drafts
- the external scanner binaries for the workflows you want to use: `nmap`, `nuclei`, `ffuf`, `nikto`, and/or `sqlmap`
- a Playwright Chromium installation if you want to use page inspection

### Install

```sh
bun install
```

Install Chromium for page inspection when needed:

```sh
bunx playwright install chromium
```

### Configure the AI runtime

Authenticate the isolated OpenCode runtime and select a model:

```sh
bun run chat:auth
bun run chat:model
```

These commands configure the same isolated runtime used by NullTrace rather than relying on an unrelated global OpenCode session.

### Start

```sh
bun run start
```

For development with automatic restart:

```sh
bun run dev
```

### Verify

```sh
bunx tsc --noEmit
bun test
```

## Keyboard-First Workflow

Shortcut hints are shown in the status bar for the active screen and panel. Common shortcuts include:

- `Tab` / `Shift+Tab` to move between panels
- `Ctrl+1` through the displayed panel number to jump directly to a panel
- `Enter` to open or apply the selected item
- `Esc` to close a modal or return to the previous screen
- `Ctrl+A` to manage the authenticated request context
- `Ctrl+P` to configure page-inspection permission
- `Ctrl+E` to export a session report
- `Ctrl+Q` to quit

Tool workspaces provide their own contextual shortcuts for running, editing, viewing help, switching runs, and cancelling a process.

## Architecture Overview

- Screen routing is local state switching between entry, dashboard, and tool screens.
- Dashboard and entry interactions use local React state and reducers.
- Shared tool workspace state is managed with Zustand.
- The scanner catalog and tool registry connect tool metadata, guided forms, command generation, execution hooks, artifacts, and finding pipelines.
- The command runner is the common shell execution boundary and launches commands through `zsh -lc`.
- SQLite repositories persist the operator's session context locally.
- Scanner-derived findings and operator-authored review decisions are stored separately.
- OpenCode runs in a dedicated per-application environment with per-session workspaces and a restricted tool policy.
- Authentication secrets use the platform credential store when available, with a memory-only fallback; persisted metadata never contains the secret itself.

The feature-oriented source tree lives under `src/features/`, with shared top-level TUI elements under `src/shared/ui/` and architecture decisions documented in `docs/adr/`.

## Local Data and Security Boundaries

NullTrace stores application data under the platform application-data directory:

- macOS: `~/Library/Application Support/nulltrace/`
- Linux and other Unix-like systems: `$XDG_DATA_HOME/nulltrace/` or `~/.local/share/nulltrace/`
- Windows: `%APPDATA%/nulltrace/`

The directory contains `nulltrace.sqlite` and isolated OpenCode runtime data. SQLite records include targets, sessions, conversation attachments, sitemap state and checkpoints, scanner runs and logs, artifacts, findings and reviews, authentication metadata, action drafts, and report drafts.

Authentication material is scoped to the exact target origin. NullTrace stores secrets in macOS Keychain, Linux Secret Service, or Windows Credential Manager when available; otherwise the context remains in memory for the current process. Authenticated scanner output is redacted before persistence, and preserving authenticated evidence requires an explicit operator opt-in.

## Safety and Authorized Use

NullTrace is intended only for authorized security research, defensive testing, lab environments, and education.

- Only test systems you own or are explicitly permitted to assess.
- Review generated commands and their scope before every run.
- Treat imported authentication material and exported reports as sensitive.
- Do not present this prototype as hardened or production-ready security software.
- The assistant proposes and explains actions; the operator remains responsible for authorization, scope, and execution.

## Research Goals

The project explores whether a context-aware language model can help a pentester:

- accelerate reconnaissance and select appropriate scanner workflows
- interpret tool output while preserving its underlying evidence
- correlate routes, runs, artifacts, and findings across a session
- move from conversational analysis to bounded, operator-approved actions
- produce a useful first report draft without replacing human judgment
