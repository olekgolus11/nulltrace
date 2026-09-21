# Execution broker admission foundation

Implementation of [F1 / #159](https://github.com/olekgolus11/nulltrace/issues/159), following the accepted [execution contract](https://github.com/olekgolus11/nulltrace/blob/fbab956/docs/design/isolated-execution-contract.md). Start reading code at `src/features/execution/services/execution-broker.service.ts`.

## Boundary and threat model

The caller, proposed command, HTTP request and uploaded bytes are untrusted. Protected resources include broker authority, execution ownership, approved scope and secret input content. Only trusted infrastructure supplies profiles, authorization lookup, journal, identity credentials and runtime adapter. An owner cannot prepare a replacement while its previous execution has unconfirmed cleanup. A request cannot choose Docker flags, mounts, images, capabilities, host paths or an authorization record. A bearer identity authenticates a caller; a separate server-side authorization must match the entire normalized plan and remain valid before sealing input and committing start.

Version 1 supports HTTP origins and an executable ID with an argument array. It deliberately has no host-shell execution, raw-network profile, arbitrary URL fetch endpoint or Docker forwarding endpoint. Tool migrations will supply reviewed profile catalogs and plan builders. Nmap/raw networking and edited-command profiles require their own subsequent contracts. Argument validation is structural, not shell sanitization. Do not put credentials in argv: tool-specific preparation must deliver them through declared secret slots. The broker cannot identify arbitrary secret strings embedded by a caller in ordinary arguments.

## Implemented protocol

`ExecutionBrokerHttpService.handle` and `ExecutionBrokerClient` implement authenticated POST requests:

| Path | Request | Result |
| --- | --- | --- |
| `/v1/prepare` | Versioned execution plan | Admission receipt |
| `/v1/input/{executionId}/{slotId}` | Bounded binary input | Admission receipt |
| `/v1/start` | Execution ID | Admission receipt |
| `/v1/get` | Execution ID | Admission receipt |

JSON requests are limited to 64 KiB, binary uploads to the declared slot ceiling and an absolute 8 MiB ceiling, with at most 16 concurrent requests and a five-second upload deadline. Responses contain only execution ID, admission status and cleanup status, or a static error code. The client bounds responses to 4 KiB and supplies a ten-second abort signal. Its injected transport must honor that signal, including while reading the response; production transport must use the private broker socket, without redirects or network fallback.

Plans require finite positive limits for time (`timeoutMs`), memory, CPU allocation (`cpuMilliCores`, where 1,000 means one core), processes, scratch storage, individual files and output. Memory, storage and output limits use bytes. A trusted profile supplies the ceilings; the approval may narrow them. IDs, origin normalization, exact keys, input kinds and argument byte/count bounds are validated. These are admission checks; resource limits are not enforced by this library.

Input is copied to an adapter-owned private slot. The adapter must copy/write the bytes before returning: the supplied buffer is zeroed afterward. Sealed slots cannot change; identical uploads are idempotent. Start requires all declared slots to be sealed. Revocation during upload marks the execution interrupted. JavaScript buffer zeroing is best effort, not a claim of erasing all runtime/GC copies.

The broker-owned SQLite journal stores HMAC fingerprints and admission receipts, not plans, argv or input bytes. Start is committed durably before invoking the adapter. Duplicate requests return the existing receipt. An uncertain adapter failure is never retried automatically. Restart marks every unconfirmed receipt interrupted and blocks new admission until trusted infrastructure confirms cleanup. Confirmation is not a client API. Consumed IDs are retained; reaching capacity fails closed instead of deleting tombstones. This provides at-most-once adapter invocation, not a guarantee that a committed execution actually started or completed.

## Infrastructure obligations before activation

This module is not wired into the TUI or legacy command runner. No real runtime adapter is supplied; missing adapters fail closed. Existing tool execution is unchanged and remains unisolated until its migration. The test adapter records calls only.

F2/F3 bootstrap must provide a single active broker per journal, a private writable broker directory, SQLite durability, a stable randomly generated 32-byte HMAC key protected separately from the journal, and provisioned 256-bit identity tokens. Do not reuse NullTrace's application database. Losing the journal removes deduplication evidence: restoration must fail closed, not create an empty replacement while executions may exist. Persistent receipt capacity/retention and key rotation need explicit recovery policy.

Mount the handler on a private Unix socket in a directory with mode 0700 and socket mode 0600; do not expose this plaintext bearer protocol on TCP. Bootstrap owns socket permissions, token provisioning, startup reconciliation and process exclusivity. Tests exercise an actual Unix socket with these permissions; this change does not supply a deployment daemon.

The runtime adapter is a trusted infrastructure contract, not a plug-in selected by an operator or model. It must implement pre-start network gating, fixed images/mounts, private secret files, external resource limits, supervision, revocation, cancellation and verified cleanup. Only after verified environment removal may infrastructure call `confirmCleanup`. It must not confirm cleanup while an upload/start is still in flight. These responsibilities belong to F2/F3, including bounded event/artifact delivery and integration with existing run history. `started` means the adapter accepted start; it is not an exit status. `cleanup: pending` is intentional until cleanup is proved.

## Verification and limits

Focused tests cover strict schema rejection, exact approval and ownership, revocation, sealed input identity, concurrent start deduplication, failure after start commitment, restart with a reopened SQLite file, tombstone capacity, secret/argv absence in the journal, bounded/aborted/timed-out uploads, sanitized errors and real Unix-socket client/server round trips.

This stage does **not** prevent target traffic outside scope: it launches no target process and installs no firewall. Receiver-side allow/deny checks, IPv4/IPv6/DNS containment, filesystem isolation, actual cgroup limits and container cleanup must be verified in the runtime and individual tool migrations. No container image/runtime qualification is claimed here. Protocol tests run on Bun 1.2.21 on macOS; Docker Desktop, OrbStack and Linux runtime qualification remain separate.

### Recorded checks

- Focused broker tests: 27 passed, including Unix socket transport and the five-second partial-upload deadline.
- `bunx tsc --noEmit`: passed.
- Full `bun test`: 621 passed, one timeout in the existing `consumes Nikto authentication selection when a run starts` test (622 tests at that check, before adding the active-owner regression case). That test invokes the legacy runner; its isolated baseline run inside the restricted sandbox passed. The full suite is therefore not reported as green.
- `git diff --check`: passed.
- No target scan/container/network-isolation acceptance test was run by this foundation. The Unix socket test uses an in-memory recording adapter, not a scanner.
