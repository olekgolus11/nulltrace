# Nulltrace

<img width="645" height="196" alt="image" src="https://github.com/user-attachments/assets/edc9f320-83cb-426d-ad1c-8b036abce22c" />

NullTrace is an AI-assisted penetration testing terminal UI built with Bun, React 19, and OpenTUI.

It is a research-driven prototype created as part of a thesis project on how large language models can support web application penetration testing. The current codebase focuses on a terminal-first workflow: guided target entry, a dashboard for reconnaissance context, and a reusable tool shell for running security tooling from one place.

<img width="1470" height="905" alt="image" src="https://github.com/user-attachments/assets/9c77faf7-1e76-46ac-8ba7-f2f6d6c8544a" />

## Current State

This repository is an active prototype and should be read as an in-progress research project, not a finished security product.

Today the app includes:

- a landing screen for starting an assessment against a target URL
- persisted target and session records backed by local SQLite storage
- a dashboard layout with sitemap, chat, findings summary, and tool catalog panels
- a reusable tool system with workspace state, command editing, persisted output logs, and keyboard navigation
- implemented `nmap`, `nuclei`, `ffuf`, `nikto`, and targeted `sqlmap` workflows
- a catalog-only placeholder for `zap`

Some views are still powered by mock data, several tools are not implemented yet, and the command orchestration model is still evolving. Local persistence exists for sessions, tool runs, output logs, and finding snapshots, but dashboard panels do not yet consume that stored data end to end.

This repository is shared primarily for research visibility and project documentation.

## What Works Today

- target URL entry flow with lightweight session-oriented navigation
- saved target/session browsing, reopening, and `Ctrl+N` session creation from the selected sidebar target
- a dashboard that combines chat, sitemap, findings summary, and tool discovery panels
- a shared tool workspace shell with command editing, persisted run records, and output logging
- keyboard-driven navigation patterns across the TUI
- guided scanner flows that generate editable commands, including targeted `sqlmap` verification

<img width="1470" height="912" alt="image" src="https://github.com/user-attachments/assets/de63473c-99ff-4146-9188-517b8b24c66a" />

## Tech Stack

- Bun
- TypeScript
- React 19
- OpenTUI (`@opentui/react`, `@opentui/core`)
- Zustand
- Bun SQLite (`bun:sqlite`)

## Run Locally

### Prerequisites

- [Bun](https://bun.sh/)
- A terminal supported by OpenTUI
- External scanner binaries for the tool workflows you intend to run, including `sqlmap`

### Install

```sh
bun install
```

### Start

```sh
bun run start
```

### Development

```sh
bun run dev
```

### Type Check

```sh
bunx tsc --noEmit
```

### Test

```sh
bun test
```

## Architecture Overview

- This is a terminal UI, not a browser DOM app.
- Screen routing is local state based.
- Dashboard and entry flows use local React state and reducers.
- Shared tool workspaces are managed with Zustand stores.
- The tool shell is designed to host multiple security tools through a common workspace model.
- Session data is stored locally in a SQLite database using `bun:sqlite`.
- The current command execution boundary lives in the shared tool shell and executes shell commands through `zsh -lc`.
- Command output is recorded to persisted tool-run logs; restoring prior workspace context from those logs is still in progress.
- Long-running commands have a basic process stop path, but operator-facing cancel controls and state polish are still in progress.

## Local Storage

NullTrace creates a local `nulltrace.sqlite` database for prototype state.

- macOS: `~/Library/Application Support/nulltrace/nulltrace.sqlite`
- Linux and other Unix-like systems: `$XDG_DATA_HOME/nulltrace/nulltrace.sqlite` or `~/.local/share/nulltrace/nulltrace.sqlite`
- Windows: `%APPDATA%/nulltrace/nulltrace.sqlite`

The database currently stores targets, sessions, tool runs, output log lines, and finding snapshots.

## Safety And Authorized Use

NullTrace is intended for authorized security research, defensive testing, lab environments, and educational work.

- Only use it against systems you own or are explicitly permitted to test.
- The repository may include command examples for common security tools, but it does not grant permission to use them unlawfully.
- This repository should not be presented as hardened or production-ready security software.
- The current prototype is operator-driven and experimental, not an autonomous pentesting platform.
- Future credential-handling and authenticated testing features require deliberate security design before they should be considered production-safe.

## Project Context

The broader project goal is to explore whether large language models can meaningfully assist pentesters by:

- accelerating reconnaissance and initial tool orchestration
- helping interpret tool output and findings
- supporting a conversational, context-aware testing workflow

## Roadmap

- Expand the tool registry beyond `nmap`
- Wire dashboard views to persisted scan/session data
- Add safer command execution controls, validation, and clearer cancellation UX
- Introduce authenticated testing workflows with secure secret handling
- Improve reporting and result correlation across tools
