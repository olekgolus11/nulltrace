# OpenCode isolation and controlled session interface

Status: selected under delegated planning. [Decision](https://github.com/olekgolus11/nulltrace/issues/154). Inherits ADR 0002 and the accepted provider credential policy.

## Baseline to preserve

opencode-server.service.ts starts one local server with --pure, serving session workspaces selected through SDK calls. opencode-runtime.config.ts disables many tools but inherits most process.env and passes app-data/source/plugin import paths. Generated context tools dynamically import application services. These are application restrictions, not a filesystem or network boundary.

Preserve conversation attachment/history/title/archive behavior, provider login and model selection, session context tools and temporary report conversations. Chat and report prompt selection currently disable webfetch/websearch; keep them disabled and align immutable server policy with that selection. Do not add Internet research as part of isolation. Update scripts/smoke-chat-runtime.ts, which currently asserts webfetch permission is enabled, to check the selected disabled web-tool contract rather than preserving that obsolete assertion. Reports currently use a 45-second timeout and tools disabled; preserve cancellation/deletion of the temporary report conversation.

The current registry is not entirely read-only: create_action_draft persists proposals, create_finding and update_finding mutate eligible assistant-derived Findings, and inspect_page causes approved target access. Preserve actual permission rules rather than trusting the older description that only action drafts mutate. Finding Review state remains operator-owned and scanner-created Finding updates remain restricted.

## System boundary

Use a separately restricted runtime per testing session, with one mounted conversation/workspace scope, private bounded cache/tmpfs and a read-only executable/config/tool-stub image. No app database, artifact root, repository, home, Keychain, Docker socket, broker socket or other session volume. Only dedicated conversation data persists; generated tool stubs and policy must be immutable and outside writable conversation paths. Mount placement and restart must not allow a prior runtime to plant instructions/plugins that load later.

The process necessarily reads its own executable/config and writes its own conversations; 'no local files' means no ambient host/application files and no model-facing file tools, not a false claim that a runtime cannot read any file. Disable shell/filesystem/task/code/plugin-loading tools and ambient configuration discovery in the pinned version. Independently constrain UID, namespaces, no-new-privileges, capabilities, seccomp, LSM where available and cgroup/storage/output budgets. If the runtime itself is compromised it can access its deliberately supplied session/provider data; isolation prevents access to unrelated stores, not that intrinsic exposure.

Use a minimal explicit environment and fixed executable. No inherited provider keys, PATH injection, host OPENCODE_BIN override, app paths or browser installations. Bundle only trusted thin tool stubs; no runtime package installation, arbitrary plugin import or update traffic. Verify --pure behavior for the pinned binary; the flag alone is not a security proof.

## Session API instead of direct imports

Keep handlers in the application control plane. Stubs call a narrow authenticated, bounded data protocol to a session API service. Derive session/installation identity from connection credentials issued for this runtime, then bind conversation attachments and every requested run/artifact/finding ID to that identity. A caller-supplied conversation ID is never authorization. Enforce schema, byte/record/page/time limits, replay policy, cancellation and rate budgets before repository work.

Read operations return only existing sanitized projections. Authentication context exposes posture, never secret values. Mutations preserve current explicit handler rules: drafts cannot execute a scanner; Findings need valid session evidence and cannot overwrite operator reviews. Record mutation request identity to prevent duplicate writes on transport retry. A report-only conversation gets no context mutation or inspection authority merely because it shares a provider connection.

inspect_page dispatches to the app's PageInspectionService and broker after the existing session consent/version checks. The model runtime itself never receives browser cookies, target storage or general broker execution rights. The optional blocked-origin proposal interface carries suggestions only; its approval endpoint is unavailable to OpenCode. Only operator UI actions can mint grants. The session API is not a generic fetch, SQL, path-read or filesystem endpoint.

## Separate network policies

OpenCode has a provider-only egress profile, separate from scanner/inspection traffic. Use a dedicated controlled proxy plus independent default-drop worker/upstream policy. Trusted installation/provider configuration identifies API/model-list/login/token-refresh endpoints and pinned address resolution. Model messages cannot add destinations. Custom/local providers require an explicit narrow configured endpoint mapping; never grant all Mac/LAN/VPN addresses to preserve a localhost model provider.

No target-network exception in the model runtime. Target requests are dispatched as application-authorized operations in isolated target workers. If research access is later enabled, it gets a separate credential-free network service/policy; target webfetch requires the already-decided per-invocation approval. Do not infer permission from a model request or broaden provider egress to generic Internet. An approved provider can receive model context intentionally supplied to it; provider traffic is not proof of target secrecy.

Control connection reachability is distinct from provider egress: use a dedicated authenticated application/runtime link unavailable to targets/scanners. Reserve control endpoints even if target scope contains a matching host. Do not publish OpenCode's full administrative server to the LAN or expose it through the target proxy.

## Provider lifecycle

Use the native Keychain companion namespace for provider credentials and ephemeral runtime auth files as specified in the credential policy. Preserve controlled login, selected model and OAuth refresh persistence; source credentials are not imported from a global OpenCode installation. Synchronize only validated changes to known record kinds with expected versions and confirmed durability. Do not persist auth.json in conversation backups or redirect tokens into environment variables to simplify launch.

Each runtime uses only the provider material needed by its selected operation. Use bounded startup/control diagnostics with redaction before any Docker/app log retention. Shutdown/crash/idle eviction destroys runtime secrets, while conversation data survives within its own quota. Active-operation leases and finite provider-request deadlines prevent orphan work; idle session lifetime differs from a one-shot scanner deadline. Existing once-after-crash retry behavior may recreate a provider/report operation only within its established contract; it cannot repeat scanner execution or duplicate session mutations.

## Acceptance

Malicious prompts/tool arguments cannot read host/app/other-session files, inherit instructions/plugins, execute shell tools, forge conversation attachment, access foreign artifact IDs, approve an origin or start a scanner. Test these at the real API/filesystem boundaries, not only by inspecting a prompt. Inject a hostile runtime fixture to attempt forbidden network/control connections under the same policy.

Verify provider login/API-key/OAuth refresh/logout and model selection, unavailable helper behavior, no durable plaintext auth copies, conversation restart/archive, report cancellation/timeout and temporary-conversation cleanup. Exercise cross-session reads/mutations/replay, quotas, output flooding and forged result bodies. Confirm webfetch/websearch stay disabled and no direct target packets leave OpenCode; approved provider requests still succeed. A later research service needs its own acceptance matrix before activation.
