# Isolated execution and result lifecycle contract

Status: draft for operator review. Application ownership/disconnect behavior and operator-configurable installation limits have been accepted; this document proposes the remaining contract. No application implementation is included.

Decision ticket: [Define the isolated execution and result lifecycle contract](https://github.com/olekgolus11/nulltrace/issues/144). Architecture: [ADR 0008](../adr/0008-use-a-broker-and-per-run-http-network-isolation.md).

## Ownership and existing integration

Keep the registry as the per-tool adapter and ToolRunnerService as the application orchestrator. The adapter validates existing command semantics and builds a structured plan; it no longer creates host process commands or host run-secret paths for the execution backend. Existing generation, editing and operator confirmation remain in the TUI. Preparation captures an immutable snapshot of the approved command, target, tool mode, authentication selection and evidence-preservation choice. Editing that snapshot requires a new approved start; do not introduce another confirmation for the unchanged snapshot.

The backend owns provisioning, process-tree lifecycle, enforced limits and teardown. NullTrace alone owns its database, history, artifact persistence, Findings and Finding Reviews. The broker does not receive the database or expose arbitrary filesystem, shell or Docker API operations. Existing prepare/cleanup/redact callbacks stay local application implementation details; the remote protocol accepts data and versioned policy identifiers, not callbacks or executable policy.

Maintain the current interactive execution workflow; this contract does not add background jobs or parallel-run UI. An active run must not be silently replaced when another start is requested. Reject a conflicting start while the previous run is still active or its termination is uncertain.

## Plan and authority separation

| Plan field | Meaning and constraints |
| --- | --- |
| Protocol version and request identity | Validated version, application instance identity, opaque execution request ID and optional persisted tool-run association. A run without a persisted session still needs an execution identity; authenticated runs retain their existing persisted-context requirements. |
| Tool/mode/profile reference | Allowlisted tool and mode plus a trusted installed profile version. The broker resolves fixed images, entrypoints, filesystem layout, capabilities, seccomp and network setup. No operator-supplied runtime flags, mounts, images or host paths. |
| Invocation | Prefer executable ID plus argv. Preserve an existing tool's accepted shell semantics only through an explicitly selected isolated-shell profile. Shell text and argv remain untrusted tool inputs. Never interpolate them into host commands, firewall configuration or Docker options. |
| Approved scope | Structured normalized origins or the tool-specific approved IP/port/protocol scope, independently validated against the immutable authorization snapshot. Resolution and proxy configuration cannot enlarge it. |
| Inputs | Named, bounded input slots owned by the profile. The backend chooses sandbox paths. Bundled SecLists/template selections use catalog IDs and pinned dataset revisions, not arbitrary host filenames. |
| Secret references | Opaque per-run references delivered separately from the ordinary plan. No secret values in plan diagnostics, argv, environment, labels or journal. Transport, persistence and authentication-specific sanitization are refined in the separate credential decision. |
| Effective limits | Finite duration, CPU, memory, PID, writable-storage/file, input, output and artifact budgets derived from installed policy and existing tool settings. |
| Output declarations | Profile-owned artifact slots with allowed formats/counts/sizes and the existing evidence-preservation setting. A worker cannot request export of arbitrary paths. |

Operator-managed installation configuration may raise or lower per-profile resource budgets. Scanner commands, model proposals and target content cannot edit them. Validate units/ranges, reject impossible settings, and reject rather than silently clamp a request that exceeds the configured envelope. Existing tool limits remain effective. Concrete defaults and ceilings are measured and set in each tool migration; they are not copied from the diagnostic experiment. Setup, execution, termination and result handling have separate finite budgets so image/runtime failure cannot consume an unlimited preparation interval. Configuration changes affect new runs, not active ones.

## Narrow backend operations

Use a versioned, bounded protocol on a dedicated control socket accessible only to the application and broker. The socket is not Docker's socket and is unavailable to workers, proxies and target-facing services. Protocol handlers authenticate the application installation/instance and bind all operations to its execution ownership. Exact transport authentication is part of the shared infrastructure implementation, not a reason to expose a general TCP API.

- `prepareExecution`: validate the plan, reserve its opaque identity, snapshot effective policy and allocate declared input slots. It cannot start the tool or let target-facing processes run before enforcement is verified.
- `putInput`: accept a bounded stream for a declared slot only. Secret input is explicitly distinguished, permission-restricted and excluded from request logging. Unused/failed preparations expire and are destroyed.
- `startExecution`: atomically consume the prepared start authorization after all inputs and policy checks succeed. At most one launch is allowed for an execution identity.
- `getExecution` and `readEvents(afterSequence)`: return a bounded state snapshot and sequenced, sanitized events. Stream closure alone is never proof of process exit or cleanup.
- `renewOwnership`: maintain the short application ownership lease. Renewal cannot extend the tool's absolute deadline or revive a stopping/finished run.
- `cancelExecution`: idempotently request cancellation; its acknowledgement is not confirmation that processes and temporary data are gone.
- `readArtifact` and `acknowledgeResults`: transfer only declared, sanitized artifact slots and acknowledge application persistence. No generic file-read or archive-extraction API.

A retry with the same execution identity returns the existing state; it must not launch a second scan. A conflicting payload for that identity is rejected. Keep a nonsecret durable receipt/tombstone long enough to reject replay across broker restarts; refuse an unknown/expired start token instead of treating it as a fresh run. Never persist raw invocation/input data just to implement deduplication. A lost start acknowledgement is resolved by querying the existing identity, never by automatically creating a replacement scan.

## Lifecycle and termination

Internal phases are `preparing`, `ready`, `running`, `stopping`, `collecting`, `cleaning` and `finished`. A separate cleanup condition can be `pending`, `confirmed` or `failed`; uncertain runtime reachability is not converted into a false terminal success. Early failure or cancellation still passes through cleanup. Terminal causes include normal exit, nonzero exit, cancellation, timeout, resource-limit failure, preparation failure and infrastructure interruption.

Normal application shutdown requests cancellation. After an application crash or disconnection, a short ownership lease expires and the broker stops its runs. Reconnection before expiry may retrieve existing state; reopening the app cannot renew ownership of an abandoned execution or automatically resume/restart scanning. Lease/heartbeat/grace durations are bounded installation policy, with defaults tested for local desktop scheduling and sleep/resume behavior.

On cancellation, lease expiry or timeout: revoke target egress first, request orderly process termination for a short bounded grace period, then force termination of the entire worker environment. Confirm no tool descendants remain. Only then collect any eligible outputs, destroy secret/input material and remove worker/proxy/namespace resources. Tool output cannot influence those operations. Retain the material needed for sanitization only within the trusted bounded finalization path, then destroy it as well.

Normal process exit also ends target access and terminates leftover descendants before result collection. The broker's lifecycle supervisor owns deadlines independently of TUI callbacks. Broker/API failure triggers infrastructure supervision and reconciliation before accepting new starts. Durable ownership metadata identifies only this installation's resources; recovery must never broadly prune the user's Docker engine. Orphaned workers are terminated and cleaned, not resumed. If the engine is unavailable, termination/cleanup remains unconfirmed and new execution is blocked until reconciliation succeeds. Do not promise immediate cleanup while the engine is unreachable.

Cleanup failure is recorded separately from scanner exit and blocks new starts through the affected backend until containment and cleanup are confirmed. It is surfaced to the operator and never reported as a fully completed successful run. Cleanup retries are permitted; scan retries require a fresh operator start.

## Logs, artifacts and persistence

Preserve the existing 2,000-line visible output cap, adding byte, frame, line-buffer, control-sequence and queue limits before buffering and sanitization. Continue draining/discarding excess tool output with bounded memory so truncation neither deadlocks the worker nor creates unbounded Docker log storage. Reserve a separate bounded lane for trusted terminal/cleanup/truncation events. Ordinary log truncation does not itself stop a scan; its execution/resource limits still apply.

Untrusted stdout/stderr cannot forge broker control events. Events carry broker-assigned sequence numbers, stream identity and execution identity. Sanitize terminal control sequences and redact before TUI display, database persistence, broker result retention or replay. A sanitization failure withholds the affected content. Do not persist a raw-output fallback. The credential decision must define the stronger guarantees and limits for authenticated output; matching known secret strings alone cannot prove confidentiality against a malicious worker.

After process termination, inspect only declared output slots as hostile filesystem data. Enforce aggregate and per-file bounds while reading, reject absolute/traversing names, symlinks, hard links, devices, sockets and unexpected file types, and avoid path-check/read races. Do not unpack worker archives into host directories. Parse bounded content with format/depth/record/time limits in a separate restricted collector/parser boundary, not in the privileged broker. Validate and sanitize its result again before application persistence. A container-relative path is not a host path or a clickable local artifact path.

Sanitized results may be staged in bounded broker-owned storage until NullTrace durably persists and acknowledges them. Set a finite retention interval and report expiration or sequence gaps; never re-run the scanner to replace missing output. Destroy the execution environment and secrets independently of a slow/offline result consumer. The broker journal stores only ownership, resource IDs, policy versions, deadlines, sequence/ack metadata and sanitized outcome data. No raw commands, secrets or request/response transcripts belong there.

Use the existing artifact pipeline for saved artifacts, tool-specific enrichment and Findings. Deduplicate replayed event/artifact imports by execution identity and sequence/slot identity. Replaying a result must not overwrite Finding Review decisions. Preserve existing cancellation behavior: retained safe logs remain, but ordinary cancelled runs do not produce new scanner Findings. Current authenticated cleanup/redaction still runs on cancellation. Error/timeout outputs follow existing per-tool artifact eligibility rather than a new universal partial-results feature. cURL has no registry collector; preserve its history/logs and existing output-summary behavior without inventing scanner artifacts.

Malformed/oversized artifacts are rejected with a bounded system diagnostic. A parser/import failure is distinguishable from the scanner exit code and does not fabricate a clean scan. Preserve current scan-status semantics for ordinary artifact parsing errors; unsafe output and failed cleanup are separately visible. Raw authenticated evidence remains governed by ADR 0005 and its per-run opt-in/encrypted path; it cannot enter the normal log/artifact/replay channel. Do not weaken that workflow during migration.

## Existing TUI status mapping

| Internal outcome | Existing UI/history representation |
| --- | --- |
| Preparation, running and bounded finalization | `running`, with concise system lines for relevant transitions. |
| Exit 0 with confirmed cleanup | `success`; artifact parsing warnings remain explicit. |
| Nonzero exit, timeout, resource/setup failure or interrupted ownership | `error` with a specific bounded reason and exit code when known. |
| Operator cancellation, termination and cleanup confirmed | `cancelled`; pending cancellation is shown immediately as a message, not premature final confirmation. |
| Uncertain termination or failed cleanup | Explicit error/pending diagnostic and backend start lock; never silently claim completion. |

Persist the invocation outcome and cleanup condition independently so recovery cannot mistake an error label for proof of containment. Do not leave stale `running` records after reconciliation. Keep the existing TUI layout; no new job-management screen is required.

## Shared foundation and migration handoff

The minimal shared implementation consists of the structured plan/profile validator, broker client and lifecycle protocol, fixed per-run provisioning/supervision, bounded event/result transport, hostile-artifact collection, persistence/reconciliation and cleanup. Replace direct shared process spawning through the backend adapter; each tool migrates its own preparation and artifact adapter in its own task. Migrated tools fail closed if isolation is unavailable. Packaging/release must not silently present still-unmigrated host execution as isolated execution.

Required contract tests cover duplicate/lost start acknowledgements, cross-owner requests, cancellation during every phase, deadline races, heartbeat expiry, replay after restart, failed cleanup and unavailable engines; output splits across secret/control-sequence boundaries; oversized frames/files and malicious paths; duplicate imports; and preservation of existing per-tool history/artifact semantics. Real runtime tests additionally prove pre-send enforcement, resource limits, whole-process-tree termination, secret destruction and orphan cleanup. Existing unit tests and the HTTP prototype do not establish these new guarantees.

Credential transport/storage policy belongs to its separate decision. Tool-specific values, supported command modes and output formats belong to each migration decision. This contract does not enable OpenCode web access, expand target scope or change session-wide Playwright consent.
