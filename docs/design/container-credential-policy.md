# Container credential delivery and persistence

Status: accepted implementation contract. The operator accepted this credential policy, including a native macOS Keychain companion and revocation of executions using removed/replaced target credentials. Implementation and security qualification remain pending.

Decision: [Define credential delivery and persistence in the container distribution](https://github.com/olekgolus11/nulltrace/issues/145). Prerequisites: [ADR 0008](../adr/0008-use-a-broker-and-per-run-http-network-isolation.md) and the accepted [execution contract](isolated-execution-contract.md). Preserve ADRs 0002, 0004, 0005, 0006 and 0007.

## Verified baseline

Target authentication context uses PlatformSecretStore. macOS calls the security CLI, Linux calls secret-tool, Windows uses Credential Manager. Failed/unavailable persistence falls back to process memory; the existing modal displays memory-only storage. The current macOS save path places the secret in security's argv, and clear suppresses adapter errors. Neither behavior should carry into the container companion contract.

Authenticated tool preparations create restricted per-run directories/files and cleanup callbacks. Nuclei uses an ephemeral -sf file. Its file matches authority; separate application restrictions enforce the scheme and redirect rules. Replacing the source context does not itself revoke an already delivered file; the accepted policy adds explicit version-bound run invalidation.

Provider login is delegated by scripts/chat-auth.ts to OpenCode auth login in the application-owned runtime. It does not pass through the target-context secret store. OpenCode documents auth.json persistence; upstream auth code also reads and writes that file with mode 0600. This is upstream evidence, not an inspection of the operator's credentials or proof for a pinned release. [Provider documentation](https://opencode.ai/docs/providers/#credentials), [upstream auth implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/auth/index.ts). Verify the exact bundled version before implementing its adapter; do not use environment-based credential injection.

ADR 0005 requires explicit opt-in and encrypted raw authenticated evidence, but a complete preservation workflow was not found in the inspected src/scripts baseline. Do not claim that workflow already exists or introduce a new evidence feature as incidental isolation work. Default output remains sanitized; any future raw-evidence path must satisfy ADR 0005/0006 before activation.

## Secret classes and recipients

| Class | Persistent authority | Allowed plaintext recipients |
| --- | --- | --- |
| Target context (cookies, headers, browser storage) | Companion-managed Keychain records, scoped to installation/session/context version | Trusted application credential preparation; only the fields required by the authorized exact-origin operation; trusted bounded sanitization where needed. |
| Provider login material (API/OAuth credentials) | Separate companion-managed provider records | Controlled login adapter and the dedicated OpenCode runtime needing that provider; never target scanners or browser inspection. |
| Raw-evidence encryption keys | Separate Keychain records if/when preservation is implemented | The dedicated encryption/decryption path after operator opt-in; never ordinary logs, chat or scanner artifacts. |
| Companion connection identity | Host-protected enrollment identity and ephemeral application-side session credentials | Authorized application control plane only; never workers, proxy, model runtime or datasets. |

The application control plane and the native companion are trusted credential recipients. The execution broker's runtime authority is already high-impact; this design does not claim secrets are protected from a compromised engine administrator. Worker isolation protects other contexts and stores, not a secret deliberately delivered to that worker.

## Native companion boundary

Ship a small user-level macOS companion alongside Compose; it requires no routine sudo and no Docker socket. Use the native Keychain API, not security add-generic-password with a secret in argv. Secret values never enter helper arguments, environment, URLs, command history or diagnostics. Installation/signing, Keychain access-control behavior and release packaging require their own implementation/qualification work.

Expose only typed operations over known record kinds, opaque IDs and expected record versions. Derive the Keychain service/account namespace on the helper side. Reject arbitrary Keychain paths, query dictionaries, service names, filesystem paths, code, shell commands and listing unrelated items. Enforce payload bounds, schema validation and compare-and-swap updates. An installation cannot request another installation's records; provider and target namespaces are distinct. Model-facing context tools receive sanitized metadata, never this API.

Proposed transport: an authenticated, encrypted application-control connection to a companion listener bound to Mac loopback, using a narrowly routed host-service mapping. Use mutual authentication and pinned identities established by trusted local enrollment; do not trust localhost, a Docker subnet or a claimed installation ID as authentication. Do not publish the helper on the LAN. Only the application control plane receives its connection identity. Infrastructure profiles reserve the companion endpoint and block worker/proxy access even when an operator target address would otherwise match the Mac. Certificates protect only this control link; they are not installed as target TLS interception authorities.

The launcher starts/connects the companion and enrolls the local installation without exposing bootstrap secrets in argv/environment or Docker metadata. Session private material is transferred through a restricted input channel and retained only in application tmpfs/memory. Restart requires a fresh authenticated bootstrap; do not store an unencrypted long-lived helper bearer token next to the database. Revoking enrollment invalidates access from the associated application. The exact loopback mapping and bootstrap sequence must be prototyped on both desktop runtimes; never replace authentication with a network-location check to make pairing work.

## Availability, save and delete semantics

Preserve visible memory-only fallback from ADR 0006 for newly supplied context when secure storage is unavailable. The existing storage indication must show the actual mode; no successful persistent-save acknowledgement is emitted until Keychain confirms the write. Do not copy secrets or a locally stored encryption key into a durable Docker volume as a fallback. A failed load is not proof that the record does not exist: distinguish locked/unavailable, denied, not-found and corrupt data without including secret details.

If a requested saved credential cannot be loaded, block that authenticated operation and explain the unavailable context; never silently run the request unauthenticated. Unrelated public workflows remain available. A temporary helper outage does not by itself revoke already authorized per-run copies; their existing deadline, ownership lease and explicit revocation rules still apply. Do not implicitly promote memory-only data into persistent storage when the helper becomes available; retain the recorded storage choice until an explicit save.

Delete is two operations: immediately revoke local use and confirm persistent deletion separately. Persist only a nonsecret pending-deletion/revocation tombstone when the helper is unavailable, prevent reload/start with that record, and retry the deletion after reconnection. Do not report the Keychain record removed until deletion is confirmed. Recovery must not resurrect an older persistent version after a memory-only replacement or failed delete. Use durable nonsecret context generations/tombstones plus reconciliation; process-local counters alone are insufficient across restarts.

## Context versions and per-run delivery

Bind preparation, Auth Check eligibility, approved plan and secret slots to the same immutable context version and exact normalized origin. On clear/replace, revoke prepared starts and active authenticated operations using the old version, revoke egress and terminate through the execution lifecycle; do not automatically restart. Compare versions again at the commit-to-start boundary to close the preparation race. Apply the same rule to inspection, Auth Check and authenticated crawl when those paths migrate, without changing their existing consent models. Unrelated sessions and public operations continue. Already sent traffic cannot be recalled, and local deletion does not revoke a token at the tested application.

Deliver only the fields required by the tool: HTTP tools do not receive browser storage or provider credentials merely because those exist in the session. Transfer secret bytes through the bounded authenticated control channel into a dedicated per-run tmpfs slot with a private directory and owner-only file permissions. Use a trusted writer; disable secret payload logging, shell interpolation and inherited environments. Do not inject secrets into image layers, committed container filesystems, Docker labels, run command strings or general-purpose artifact volumes. Paths may appear in argv where the tool requires them; values may not.

The worker receives access to only its run-specific slot. Do not mount the application's run-secrets root, full credential store or host Keychain. A separate mount/PID namespace and no worker access to the helper/broker remain mandatory. Preserve Nuclei -sf owner-restricted ephemeral Secret Files and the separate exact-origin command restrictions; do not substitute -H flags or environment variables for the Secret File.

Use tmpfs and verified no-extra-swap resource policy for ephemeral material, but do not promise physical erasure or absence from desktop VM swap/snapshots. Disable worker core dumps and audit runtime debug/log paths. On completion/revocation/cancel/timeout/setup error, confirm tool descendants are stopped, finish bounded sanitization, remove secret storage and record cleanup acknowledgement. If cleanup is uncertain, retain the failure state and block new starts through the affected backend. Destruction must not wait indefinitely for the TUI to acknowledge results.

## Provider runtime integration

Preserve the operator's existing provider-login/model-selection workflows through a controlled adapter. Persist provider credentials in their separate protected namespace; materialize only the required runtime auth file in a private temporary filesystem while OpenCode runs. Conversation/workspace persistence must not accidentally persist auth.json, token refresh copies, logs or temporary files. Clear inherited provider environment variables and do not import credentials from an unrelated global OpenCode installation.

OAuth refresh and login changes need a bounded, schema-validated synchronization path to the protected store with conflict handling and confirmed persistence. A file watcher alone is not a durability guarantee. If refresh persistence fails, report the storage condition rather than claim the next restart is authenticated. Treat logout/removal as explicit revocation, never as a transient missing-file event. Validate the pinned OpenCode API/file behavior in its migration decision before selecting adapter mechanics. The OpenCode runtime must not acquire a generic target-secret/Keychain capability.

## Output and assurance limits

Run-scoped sanitizers operate before UI display, broker result retention, database writes and artifact import. Bound input and handle values spanning stream chunks; audit encoding variants, exception messages, temp paths, subprocess/debug logs and Docker logging. Known-value redaction is defense in depth, not a proof against arbitrary transformed secret exfiltration. Ordinary output channels must withhold data that cannot be safely sanitized under the selected tool policy.

Proxy policy logs contain controlled decision metadata only, not URLs, queries, headers, bodies or arbitrary user-supplied hostname text. CONNECT controls the network endpoint without seeing encrypted HTTP semantics. Preserve application exact-origin injection/redirect controls and test them independently of the firewall. An approved malicious target can receive a secret intended for it; a compromised worker can expose a secret it possesses to an allowed endpoint or encode it in output. This design does not claim to eliminate that residual risk or silently introduce TLS MITM. Stronger mediation would be a separate architectural decision.

Raw evidence is never a fallback artifact. If a future preservation workflow is activated, retain only ciphertext in a separate application-owned store with keys protected independently, explicit per-run opt-in, and no ordinary chat/source-context access. A missing protected key store must not produce plaintext persistence or falsely claim durable evidence retention.

## Validation and staged handoff

Required evidence includes: companion identity/pairing and cross-installation rejection; worker/proxy/OpenCode inability to reach/read helper secrets; locked/unavailable Keychain behavior; confirmed versus pending deletion; replacement during preparation/start/running and recovery after restart; secret canaries absent from argv/environment/labels/logs/artifacts/proxy output; per-run file modes, recipient minimization and all-path cleanup; provider API-key/OAuth refresh/logout persistence without durable plaintext runtime copies; unchanged exact-origin and consent behavior; and both Docker Desktop and OrbStack transport tests.

First implement/qualify the narrowly scoped companion and control-plane adapter, then connect it to the shared secret-slot lifecycle, and migrate target tools individually. Provider integration stays with the OpenCode boundary task. Do not add raw-evidence functionality solely to finish isolation planning. Linux-native/Windows-native existing adapters remain outside this macOS distribution choice and keep ADR 0006 behavior.

No secret-bearing user files, login records or real Keychain items were read for this decision. No credential prototype or acceptance test has yet been run. This policy is an accepted implementation contract, not a security claim for today's application.
