# Delivery sequence, release evidence and remaining decisions

Status: implementation backlog design completed under delegated planning. Production implementation and runtime qualification are not complete. [Decision](https://github.com/olekgolus11/nulltrace/issues/155).

Implementation tracking: [Implement the isolated Docker distribution in staged migrations](https://github.com/olekgolus11/nulltrace/issues/157). These tasks have not been dispatched.

## Ordered implementation cuts

Each row is a separate reviewable implementation task. Tools are migrated one at a time; shared infrastructure is not bundled into a single 'isolate everything' task. API/network/config/secret boundaries are fixed by the accepted contracts, not rediscovered differently in each scanner.

| Order | Task | Depends on / exit condition |
| --- | --- | --- |
| [F0](https://github.com/olekgolus11/nulltrace/issues/158) | Build pinned runtime images and dataset catalogs | Fixed binaries, immutable SecLists/templates, provenance and read-only catalogs. |
| [F1](https://github.com/olekgolus11/nulltrace/issues/159) | Structured execution plans and broker authorization protocol | Existing execution contract; typed versioned plans, fixed profile IDs, ownership, at-most-once start, no generic runtime forwarding. |
| [F2](https://github.com/olekgolus11/nulltrace/issues/160) | Per-run HTTP provisioning and egress enforcement | F1; worker/proxy default-drop and trusted resolver/mappings; verified policy before start. Existing infrastructure qualification remains open. |
| [F3](https://github.com/olekgolus11/nulltrace/issues/161) | Supervision, budgets, safe results and reconciliation | F1/F2; cancellation/lease/timeout/crash cleanup, bounded streams/artifacts, replay-safe app persistence and failure lock. |
| [F4](https://github.com/olekgolus11/nulltrace/issues/162) | Native macOS credential companion and secret slots | F1/F3; authenticated bootstrap on both runtimes, Keychain semantics, version/tombstone/revocation and synthetic-secret tests. |
| [H1](https://github.com/olekgolus11/nulltrace/issues/163) | Isolate Auth Check | F2/F3/F4; real comparison and version eligibility through the worker, no app fetch. |
| [T1](https://github.com/olekgolus11/nulltrace/issues/164) | Migrate cURL | H1 plus shared foundation; first full public/authenticated app-to-result vertical slice. A public proof may run earlier but is not task completion. |
| [H2](https://github.com/olekgolus11/nulltrace/issues/165) | Isolate public sitemap crawl | T1; preserve automatic target deduplication and bounded checkpoints. |
| [H3](https://github.com/olekgolus11/nulltrace/issues/166) | Isolate authenticated sitemap crawl | H1/H2/F4; temporary cookie jar, isolated verification, version-bound pause/resume. |
| [T2](https://github.com/olekgolus11/nulltrace/issues/167) | Migrate Playwright with exact-origin blocking | T1/H1/F4; browser sandbox qualification, partial snapshots and blocked-origin reporting. |
| [P1](https://github.com/olekgolus11/nulltrace/issues/168) | Add operator-selected auxiliary inspection resources | T2; separate grant UI/credential-free resource delivery, no automatic grants or main-page scope expansion. |
| [T3](https://github.com/olekgolus11/nulltrace/issues/169) | Migrate ffuf | T2 and pinned SecLists; three modes, JSON/sitemap/Findings parity. |
| [Q2](https://github.com/olekgolus11/nulltrace/issues/170) | Implement and qualify non-HTTP target protocol enforcement | F3; target TCP/TLS/DNS profiles and mixed-workflow scope, without weakening HTTP egress. |
| [T4](https://github.com/olekgolus11/nulltrace/issues/171) | Migrate Nuclei | T3 plus template/protocol inventory and required protocol infrastructure; OAST policy choice gates dependent coverage. |
| [T5](https://github.com/olekgolus11/nulltrace/issues/172) | Migrate Nikto | T4; profiles and disruptive confirmation preserved. |
| [T6](https://github.com/olekgolus11/nulltrace/issues/173) | Migrate sqlmap | T5; existing targeted verification and artifacts preserved. |
| [Q1](https://github.com/olekgolus11/nulltrace/issues/174) | Qualify Nmap raw packet enforcement and scan fidelity | F1/F3; prototype external gateway enforcement on both runtimes. May run before tool migration sequence reaches Nmap. |
| [T7](https://github.com/olekgolus11/nulltrace/issues/175) | Migrate Nmap | T6/Q1; explicit approved IP/port/protocol plans and connect/raw fidelity matrix. |
| [C1](https://github.com/olekgolus11/nulltrace/issues/176) | Isolate OpenCode and replace direct session imports | F1/F3/F4/T2; provider/control network separation, context bridge, provider login and reports. Run after scanner sequence for sequential delivery. |
| [D1](https://github.com/olekgolus11/nulltrace/issues/177) | Package the macOS Docker distribution and qualify release | All migrations plus P1 if advertised, infrastructure/credential/browser/Nmap qualification and no remaining direct-network paths. |

Protocol/gateway support needed by public non-HTTP Nuclei is shared infrastructure and must be factored as its own implementation task before T4; it must not be hidden in the Nmap task or enable direct egress for ordinary HTTP workers. Catalog construction and image maintenance are a separate packaging foundation deliverable. See the GitHub backlog for concrete issues/dependencies.

No implementation task is dispatched by this plan. Native issue dependencies track readiness; a red gate remains red even if a planning document is accepted.

## Resource calibration contract

Retain product limits in individual handoffs. Each profile additionally needs measured finite CPU, memory, PID, tmpfs/shared-memory, file-size, total output, input, parser and phase-deadline values. Measure pinned images on arm64 and every advertised architecture on both runtimes. A 128 MiB diagnostic setting or a CLI --timeout flag is not evidence of an effective release limit.

Calibration runs cover healthy worst-case supported fixtures and intentional exhaustion, record effective cgroup/ulimit/tmpfs values and counters, and choose finite defaults with documented headroom. Nmap/Nuclei currently lack a shared finite outer deadline: introduce an installation-configurable finite default, show its effective value in the approved run and test that exhaustion is explicit. No unbounded mode. The implementation owner selects measured defaults; there is no need to ask the operator to guess RAM/process counts during planning.

Separate preparation/start/input/upload/execution/termination/collection/result-retention deadlines. Apply a bounded installation-wide concurrency/resource budget too, so multiple per-run limits cannot exhaust the VM. Preserve existing UI workflow; do not add parallel-job management as incidental work. Reject impossible settings rather than hiding clamps in infrastructure. Keep tool-specific normalization where it is already product behavior.

## Packaging and operating model

Use Docker Compose for the app/control plane, with broker-managed ephemeral workers. Trusted fixed profiles own image digests, seccomp/LSM policy, namespaces, mounts and network rules. The broker alone has the accepted high-impact engine authority; document that socket access remains powerful even when the socket file is mounted read-only. App/scanners have no engine socket or NET_ADMIN. No daemon-side arbitrary host bind paths from requests.

Pin Bun, OpenCode, Playwright/Chromium, scanners, proxy/base images and official dataset revisions in a release manifest. Build-time downloads and updates run separately from execution; select current official SecLists/templates when cutting the release and lock hashes. Read-only catalog mounts are infrastructure-owned. Include provenance/licenses and a reproducible inventory; run no scanner self-update in a target session.

Launcher checks runtime identity/health, required engine primitives, authenticated companion enrollment and installed profile compatibility before offering execution. Use stable installation IDs and versioned protocol compatibility; an old client cannot silently downgrade policy. Minimal user-level native companion installation/signing and secure bootstrap are a dedicated delivery dependency. Never ask the user to run NullTrace routinely via sudo.

Application database and sanitized artifacts live in app-owned volumes; no worker sees them. Preserve backups and migration rollback, excluding plaintext auth material and temporary secrets. Explicit app-data migration preserves sessions, conversations, history and Findings/Reviews. Do not change ownership of arbitrary host directories or mount home to import old data. Provide controlled migration input and backup verification, with user-visible failure. Destructive volume reset is never automatic cleanup.

Engine restart/upgrade recovery reconciles only broker-owned labeled resources against the journal, never deletes unrelated containers. Leases expire old environments; incomplete cleanup blocks affected starts. A maintenance action can retry cleanup without deleting app history. Image updates affect new executions only and run the qualification suite before release. Support logs contain versions/counters/sanitized IDs, not request transcripts, secrets or full inspect dumps.

## Acceptance ledger

| Required property | Evidence required |
| --- | --- |
| Allowed request and preserved result | Controlled A sees expected request; real app saves existing logs/artifacts and expected Findings where applicable. |
| Redirect before-server block | Controlled B receives zero requests; reset after reachability control; include alternate hostname/scheme/port. |
| Independent network enforcement | Malicious worker and proxy-ACL-bypass fixtures cannot reach B; packet observation corroborates IPv4/IPv6/direct/DNS/UDP/alternate-proxy denial. |
| Resolver policy | CNAME/mixed A+AAAA/rebinding, mapped IPv6, private/link-local/metadata/control exceptions tested; no implicit scope expansion. |
| Host/app/store secrecy | Synthetic home/DB/store canaries unreadable; only declared per-run inputs readable; no broad mount/socket/env inheritance. |
| Effective resources | Real memory/PID/file/output/CPU exhaustion and deadline tests with counters; aggregate concurrency budget. |
| Lifecycle | Success/error/cancel/timeout/context revoke/owner crash/engine loss/start races/replay; verify actual descendants, namespaces, containers and tmpfs cleanup. |
| Credentials | A sees intended credentials, B sees none and no contact; argv/env/runtime/proxy/UI/log/artifact canary checks; per-run modes/recipient minimization and destruction. |
| Nmap | Approved tuple receives expected probes; forbidden host and forbidden port on allowed host receive zero packets, including malicious raw/L2 sender. |
| OpenCode | Provider works, direct target/foreign-session/control access fails; no inherited tools/plugins/instructions or global credentials. |
| Application parity | TUI approvals/session consent, target crawl lifecycle, history/source metadata, artifacts and Finding Review integrity preserved. |
| Runtime/route matrix | Docker Desktop and OrbStack separately, public/Mac-local/LAN/VPN targets, architecture/image/runtime versions and effective LSM/seccomp/cgroup evidence. |

Every implementation runs appropriate focused unit/integration tests, bun test, bunx tsc --noEmit and manual allowed/blocked app runs when the environment permits. Keep reproducible sanitized fixture commands, receiver counters, image digests, policy snapshots and cleanup inventory. Mocks do not establish containment; an unavailable runtime/VPN case stays pending. Running the app's existing tests does not qualify the new infrastructure.

## Current evidence and remaining work

The existing OrbStack report contains passing controlled HTTP infrastructure experiments, including a Mac-loopback variant; it is not a full app migration. Docker Desktop and the remaining cases in [desktop network qualification](https://github.com/olekgolus11/nulltrace/issues/156) are still pending. Browser sandbox/auxiliary mediation, native companion transport and Nmap raw profile need separate real qualification. No production tool has been migrated by these planning documents.

The application baseline was checked during this planning pass: bun test passed 596 tests across 93 files (2,030 assertions), and bunx tsc --noEmit exited 0. These checks do not cover the proposed broker, firewall or container migrations. Documentation link/structure/diff checks are recorded with the planning commit.

## Decisions left for the operator, after all independent analysis

1. **Nuclei external interaction services:** may Nuclei contact an explicitly configured auxiliary OAST service? Recommendation: yes, only a named operator-approved service/profile, never arbitrary third-party fallback. Without this exception, affected tests are unavailable and full existing coverage cannot be claimed. This is the only current decision preventing completion of the Nuclei compatibility policy.
2. **Optional future inspection navigation:** the selected plan uses checkboxes for auxiliary resources only. Opening additional origins as standalone pages or SSO would be a later expansion, not a blocker for the exact-origin migration or proposed resource workflow. No answer is needed to proceed with the selected limited design.

Unmeasured platform behavior is not a question for the operator to guess. Test it in the named qualification tasks. If raw scan fidelity or secure companion transport cannot be achieved on a requested runtime, bring back evidence and an explicit alternative rather than silently reducing capability or disabling isolation.
