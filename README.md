# Nulltrace

<img width="645" height="196" alt="image" src="https://github.com/user-attachments/assets/edc9f320-83cb-426d-ad1c-8b036abce22c" />

NullTrace is an AI-assisted penetration testing terminal UI built with Bun, React 19, and OpenTUI.

It is a research-driven prototype created as part of a thesis project on how large language models can support web application penetration testing. The current codebase focuses on a terminal-first workflow: guided target entry, a dashboard for reconnaissance context, and a reusable tool shell for running security tooling from one place.

<img width="1470" height="905" alt="image" src="https://github.com/user-attachments/assets/9c77faf7-1e76-46ac-8ba7-f2f6d6c8544a" />

## Current State

This repository is an active prototype and should be read as an in-progress research project, not a finished security product.

Today the app includes:

- a landing screen for starting an assessment against a target URL
- a dashboard layout with sitemap, chat, vulnerability summary, and tool catalog panels
- a reusable tool system with workspace state, command editing, output logging, and keyboard navigation
- an implemented `nmap` workflow with guided scan options and generated commands
- placeholder catalog entries for future tools such as `nuclei`, `ffuf`, `sqlmap`, `zap`, and `nikto`

Some views are still powered by mock data, several tools are not implemented yet, and the command orchestration model is still evolving.

This repository is shared primarily for research visibility and project documentation.

## What Works Today

- target URL entry flow with lightweight session-oriented navigation
- a dashboard that combines chat, sitemap, vulnerability summary, and tool discovery panels
- a shared tool workspace shell with command editing and output logging
- keyboard-driven navigation patterns across the TUI
- an `nmap` tool flow that generates and runs commands from guided form inputs

<img width="1470" height="912" alt="image" src="https://github.com/user-attachments/assets/de63473c-99ff-4146-9188-517b8b24c66a" />

## Tech Stack

- Bun
- TypeScript
- React 19
- OpenTUI (`@opentui/react`, `@opentui/core`)
- Zustand

## Run Locally

### Prerequisites

- [Bun](https://bun.sh/)
- A terminal supported by OpenTUI

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
- The current command execution boundary lives in the shared tool shell and executes shell commands through `zsh -lc`.

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
- Replace mock data with persisted scan/session data
- Add safer command execution controls and validation
- Introduce authenticated testing workflows with secure secret handling
- Improve reporting and result correlation across tools
