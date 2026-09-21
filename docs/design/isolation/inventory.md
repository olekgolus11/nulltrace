# Boundary inventory and threat model

Source audit: src/ and scripts/, excluding __tests__, at f6ef6e0. Searches cover Bun.spawn, child_process spawn, fetch, Chromium launch, WebSocket and server/socket constructors, with follow-up searches for synchronous spawn/exec and alternate HTTP/socket APIs. SQL database.exec and RegExp.exec matches are not process execution. Libraries and spawned tools can open their own sockets; this inventory identifies application entry points, not a claim that text search proves all transitive behavior.

| Entry point | Current authority | Planned boundary |
| --- | --- | --- |
| tool/shared/services/command-runner.service.ts | zsh -lc, inherited environment, immediate-child signals | Broker client; per-profile isolated argv or explicitly isolated shell. |
| tool/curl/services/curl-execution-runner.ts | Nested Bun.spawn curl, host response/input files | Fixed cURL worker and private slots. |
| page-inspection/services/playwright-page-inspection-browser.service.ts | Direct Chromium, page JavaScript, cookies/storage | Disposable browser profile with proxy/firewall and own Chromium sandbox. |
| authentication/services/auth-check.service.ts | Direct fetch, public/authenticated comparison and verification | Dedicated bounded HTTP operation. |
| sitemap/services/public-sitemap-crawler.service.ts | Direct fetch plus HTML/XML parsing, target persistence | Isolated crawler worker, application-owned persistence. |
| sitemap/services/authenticated-sitemap-crawler.service.ts | Direct fetch, mutable temporary cookie jar and verifier | Authenticated worker plus isolated verifier interface. |
| authentication/services/platform-secret-store.ts | Platform utilities; Mac write secret in argv | Native user-level Keychain companion for macOS container distribution; existing other-platform adapters outside this scope. |
| chat/services/opencode-server.service.ts | Shared local OpenCode server, SDK/control HTTP and loopback port-reservation listener | Per-session restricted runtime and bounded control plane. |
| scripts/chat-auth.ts | OpenCode auth CLI with runtime environment | Controlled login adapter and provider secret synchronization. |
| chat/services/opencode-runtime.config.ts | Most inherited env; app data and source import paths | Fixed image/config; thin authenticated session bridge stubs. |
| chat/services/chat-context-tools.service.ts and related registries | Tools import application services directly | App-side handlers authorize attachment and object ownership per call. |
| report/services/opencode-session-report-draft-provider.service.ts | Provider requests through OpenCode, temporary conversation | Same isolated provider path; no report tool activation. |
| scripts/chat-model.ts and scripts/smoke-chat-runtime.ts | Runtime/SDK lifecycle through imported services | Distribution launcher/control API; no independent direct-network fallback. |
| Runtime scanner dependencies | Tool-internal DNS, updates, telemetry, scripts, template callbacks | Fixed images/datasets and profile-owned network scope; inventory each pinned binary. |

Protected assets: host home/files, NullTrace DB and protected stores, provider credentials, other sessions/runs, operator authorization, infrastructure policy, resource availability and integrity of imported results. Untrusted inputs: model text/tool arguments, operator-edited commands as code/data, response HTML/JS/XML/JSON, DNS/CNAME results, redirects, wordlist/template contents, artifact filenames and scanner output.

Trusted control plane: app policy/approval and persistence, broker, engine/desktop VM, native companion, fixed initializers, resolver/policy compiler and bounded sanitizers. Minimize but do not pretend to remove their authority. Broker/engine compromise may access engine resources and host shares. Companion compromise has the user's Keychain-related authority. Containers are one layer; a VM/kernel escape is not disproved by ordinary network tests.

Independent enforcement separates workers from host/app files, other run namespaces, policy/control sockets and destinations. Prevent direct proxy bypass, DNS rebinding, IPv6/link-local/host-gateway routes, raw Ethernet bypass, process descendants surviving cancellation, data left after cleanup, output/memory exhaustion and artifact traversal/link tricks. Treat terminal controls and model-facing target text as untrusted even after containment.

Known semantic limits: endpoint allowlists do not prove encrypted HTTP method/path/origin semantics inside CONNECT, stop an approved server relaying traffic, or prevent an allowed script from reading page-accessible secrets and contacting allowed endpoints. Credential recipients remain trusted for deliberate secret use; known-string redaction cannot prove noninterference against a compromised worker. Keep those limits explicit in every release claim.

Control plane final state: app has no general target/Internet route. It reaches only broker, scoped chat/control interfaces and authenticated companion transport. Build/image update access is a separate trusted installation operation. No scanner, browser or model runtime receives Docker's socket. No routine sudo or NET_ADMIN on NullTrace.
