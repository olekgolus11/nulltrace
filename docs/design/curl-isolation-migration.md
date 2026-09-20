# cURL isolation migration and first vertical-slice proof

Status: draft for operator review. This is an implementation handoff, not an implemented or qualified security boundary.

Decision: [Specify the cURL isolation migration and first vertical-slice proof](https://github.com/olekgolus11/nulltrace/issues/146). Follow [ADR 0008](../adr/0008-use-a-broker-and-per-run-http-network-isolation.md), the [execution contract](isolated-execution-contract.md), and the [credential policy](container-credential-policy.md).

## Existing behavior to preserve

Inspected application baseline: f6ef6e0b210f45a151db6e5ca0bb39a06913675d. Relevant code is under src/features/tool/curl/, the shared tool registry/runner, authentication Auth Check, and session.repository.ts.

- Keep the existing form, command editing, operator start, authentication toggle, keyboard interaction and history. Support GET, HEAD, POST, PUT, PATCH, DELETE and OPTIONS, inline headers, text and JSON bodies, and paths on the session's exact normalized HTTP(S) origin.
- Keep the existing restricted cURL command language. It already rejects shell control/expansion, arbitrary options, local-file input, manual authentication, custom proxy/resolver options, insecure TLS and automatic redirect options. Isolation neither adds a general shell nor removes currently supported command editing.
- Preserve a 30-second execution budget across the redirect chain, up to five redirects, 256 KiB request body and 2 MiB response body. Continue verifying TLS. Distinguish HTTP status from process failure: do not silently introduce curl --fail semantics.
- Preserve manual redirect handling: check every next origin before sending; 301/302/303 switch non-GET/HEAD to GET and remove the request body; 307/308 preserve method/body. HEAD does not display a response body. Same-origin redirects remain usable with authentication.
- Preserve accepted Auth Check eligibility, persisted-session requirement for authenticated runs and exact-origin context matching. Use the accepted version/revocation policy at preparation and start.
- Keep redacted response headers/body, HTTP status/timing and safe URL output. cURL has no registry collectArtifacts hook or Findings parser. Preserve the existing run log and repository-generated output_summary; do not create a new raw response artifact, scanner Finding or evidence-preservation feature.

Existing implementation details are not compatibility promises: host run-secrets paths, shell wrapping, inherited environment, unbounded header reads, ambiguous edited options and premature cancellation acknowledgement must not survive merely because they exist today.

## Threat boundary and plan

Protect host files, application database, credential stores, provider material, other runs, control endpoints, authorized network scope and host resources. Treat edited commands, request data, DNS answers, redirects, server responses and worker output as untrusted. A compromised worker is part of the test model; command validation cannot be the only reason a forbidden packet is absent.

The registry's cURL adapter builds an immutable, bounded structured request after validation. Include method, normalized target, ordered supported header/body operations, exact origin, authentication context identity/version, profile version and limits. Keep raw request data out of broker diagnostics and journals. Do not forward the original token array as opaque authority to change cURL behavior or infrastructure. Preserve supported repeated-header/body semantics with regression fixtures; reject ambiguous multiple-target inputs rather than allowing validation and execution to choose different URLs.

The broker independently validates the structured schema and authorization association. It selects fixed images, entrypoint, input paths, proxy address, filesystem/security settings and network policy. The application cannot supply Docker options, arbitrary paths, firewall fragments, capabilities or an executable path. Plan validation occurs before any target traffic.

Run the existing redirect algorithm, refactored behind testable contracts, as a fixed Bun worker inside the disposable cURL environment. Spawn cURL with argv there. Remove the shared zsh -lc layer for this profile; do not move shell construction into the broker. The application process does not launch either Bun worker or cURL locally.

Transfer URL, headers and body through bounded private input slots; materialize a trusted generated cURL configuration/body representation with owner-only permissions. Include URL/query and inline operator data in this treatment because they can contain secrets even in a nominally public request. cURL argv contains only fixed controls and sandbox paths, not request values. Disable default curl configuration loading and URL glob expansion. Use an explicit minimal environment; do not inherit HOME, proxy bypass variables, credentials, loader options or host paths. Handle config escaping and body byte semantics with tests, not interpolation of user text into config directives.

Deliver only selected target cookies/headers to authenticated runs, never browser storage or provider credentials. Keep authentication file contents separate from ordinary diagnostic plan fields. Use private per-run tmpfs, directory mode 0700 and file mode 0600, trusted creation, no core dumps and the accepted swap/VM limitations. All response scratch files remain private and are destroyed, not exported as artifacts.

## Independent pre-send network enforcement

Each run receives a worker namespace, its own Squid instance and separately verified worker/proxy nftables policies. Only the short-lived initializer has NET_ADMIN; worker and proxy are non-root, drop all capabilities, use no-new-privileges, seccomp, read-only roots and finite resources. Apply an available enforcing LSM and report its absence honestly. No host home, database, credential store, companion identity or Docker socket is mounted.

Worker output is default-drop for IPv4 and IPv6, allowing only its assigned proxy listener and narrowly required infrastructure traffic. Deny direct destinations, loopback bypasses, arbitrary DNS including Docker's resolver, UDP/QUIC and alternative proxies. The worker cannot modify the policy. Squid accepts only the approved authority/port and HTTP or CONNECT mode; its namespace separately allows only validated destination address/port tuples. Install and verify enforcement before worker or target-facing proxy activity. Failure tears down the preparation without starting the request.

Trusted infrastructure resolves approved names, checks every address and pins the per-run mapping. Do not authorize a private, loopback, link-local, metadata or control endpoint merely because DNS returned it. Explicitly approved Mac/LAN/VPN mappings remain narrow and preserve origin, Host, SNI and certificate verification. The helper/broker endpoints remain reserved even when a target could otherwise match them. No worker-controlled DNS refresh, address expansion, automatic retry with weaker policy or TLS MITM is allowed. Address changes require a newly validated execution.

Squid and firewall enforce endpoint reachability, not encrypted HTTP paths. Retain application redirect/authentication checks. HTTPS on an approved endpoint can conceal other application behavior; this policy does not stop an approved server relaying requests or a compromised worker disclosing its deliberately provided secret to that endpoint. Test claims must distinguish that residual trust from forbidden endpoint reachability.

## Limits, results and cleanup

Keep existing product limits above. Add independently enforced CPU, memory, process count, temporary storage, per-file and output limits to both worker and proxy. Input/header/output caps must apply while streaming, before full allocation; a response-body option or 2,000-line log cap alone is insufficient. Bound header files, stderr, status output, malformed lines, configuration input and all redirect scratch data. Expiration prevents another redirect from starting; no minimum per-hop timeout may extend the total deadline.

Select finite release values for additional budgets by measuring the pinned Bun/cURL/Squid images on both runtimes during implementation. Record effective values and headroom in the acceptance report. The diagnostic prototype's 128 MiB/48-PID settings are not release defaults. An implementation cannot be accepted with unset budgets, unmeasured values presented as verified, or unlimited setup/finalization/retention. Installation configuration can tune budgets within validated constraints; requests cannot raise them.

Use the shared ownership lease, durable execution identity, sequenced event transport, bounded output retention, replay deduplication and separate exit/cleanup acknowledgements. Cancel, timeout, context revocation and owner loss first revoke egress, then terminate the full environment, sanitize bounded retained output and destroy secret/scratch storage. Confirm cleanup independently of UI connectivity. Uncertain cleanup blocks subsequent backend starts and remains visible.

Sanitize terminal control sequences and redact before display, persistence or broker result retention. Include canaries from operator data as well as saved credentials in tests; sanitize invalid-command and preparation errors too. Proxy logs contain fixed decision metadata, never request URLs, headers, query values or bodies. Runtime logging must not persist raw worker stdout/stderr as an unnoticed second log channel. Withhold content on sanitizer failure. Preserve existing output_summary and cancelled-run behavior; do not create Findings or expose response scratch files. Known-value redaction is not proof against maliciously transformed secrets.

## Delivery sequence and the Auth Check dependency

1. Implement the minimum shared broker/profile, network initialization, bounded transport and lifecycle foundation. Provisioning uses fixed installed policy, with no user-controlled runtime operations.
2. Implement this cURL migration as its own task, with public and authenticated paths in the same compatibility scope. Prove a public request through the real TUI/application runner, broker and persistence first, then complete credential delivery and authenticated cases. A public-only demonstration is intermediate evidence, not completion of cURL migration.
3. The companion/secret-slot foundation is a prerequisite for the authenticated acceptance gate. Auth Check currently calls globalThis.fetch in the application; do not hide that bypass by preloading an accepted flag in end-to-end tests. Its isolated transport belongs to [Specify isolation of Auth Check and sitemap network requests](https://github.com/olekgolus11/nulltrace/issues/153), and must be available before claiming the complete authenticated workflow is isolated. Preserve its current operator behavior. That planning decision can proceed independently; this does not create a circular decision dependency.
4. Final cURL acceptance uses an actual accepted Auth Check on the same context version, then exercises the cURL run and durable result. Migrate other scanners, inspection and OpenCode in their own tasks. Do not advertise a fully isolated distribution while remaining paths execute on the host or unrestricted application network.

## Acceptance evidence

Use controlled approved target A and forbidden target B, with independent server-side HTTP counters and TCP/UDP capture. Reset counters after positive reachability controls and before each assertion. Probe B without enforcement in an isolated test setup to establish observability; never enable a production bypass mode. Use synthetic secrets and databases only. Test-only hostile workers must not become a public broker option for arbitrary images/entrypoints.

| Test | Required observation |
| --- | --- |
| Public success | Real NullTrace start reaches A for HTTP and certificate-verified HTTPS; expected response/status/timing appears in bounded logs; persisted history and output_summary match existing semantics. |
| Compatibility | All methods, HEAD, JSON/text, repeated headers/body options, edited quoting, explicit default ports, same-origin paths and every supported redirect status behave as specified. Malformed/ambiguous commands fail before traffic. |
| Redirect out of scope | A redirects to B by alternate hostname, scheme and port, with public and authenticated runs. B's request counter stays zero. Also verify same-origin redirects succeed and the sixth redirect is not followed. |
| Direct/proxy bypass | A hostile test worker under the same installed isolation profile attempts B directly, ignores/clears proxy settings, tries IP literals, alternate proxies and disallowed CONNECT destinations. B sees zero target packets/requests over IPv4 and IPv6. An application-level validation error alone is insufficient. |
| DNS and alternate routes | Direct UDP/TCP DNS, Docker resolver access, DoH to an unapproved endpoint, UDP/QUIC and unauthorized loopback/link-local/metadata destinations fail before reaching controlled receivers. Rebinding/mixed-address fixtures cannot expand policy; approved A remains reachable. Do not probe real cloud metadata services. |
| Startup and cross-run isolation | Attempts before policy readiness cannot send; failed initializer/readback prevents launch. Worker/proxy cannot reach another run, application, broker or companion. Forged ownership/policy references are rejected. |
| Host and store confidentiality | Place canaries in synthetic host-home, application database and credential-store locations outside declared inputs. A hostile worker cannot read them through mounts, traversal, links, namespaces, process environments or control interfaces; its own required input remains usable. |
| Authentication | Real Auth Check and context selection lead to expected credentials at A only. Public runs receive no credential slot. Replacement/clear during prepare/start/run revokes old-version use without restart; failed load does not turn into a public request. |
| Secret exposure | Canaries do not appear in process argv/environment, inspect metadata, runtime logs, UI/log persistence, output_summary, result replay or proxy logs. Verify file modes and recipient minimization. Exercise chunk-split, echoed response, invalid-input and error cases. |
| Resource exhaustion | Stalled/chained requests meet deadline; hostile allocation/process/fork/output/header/file growth reaches effective memory/PID/storage/output controls; CPU throttling is observed. Record configured values and runtime counters, not only CLI flags. |
| Termination | Cancel during preparation, input delivery, start, active request and finalization; force timeout, owner crash/lease expiry, broker restart and engine loss. Verify descendants, namespaces, containers and secret/scratch storage are removed or recovery is explicitly pending/locked. B remains untouched throughout. |
| Failure and replay | Setup failure has no host fallback; duplicate/lost start acknowledgements do not duplicate A requests; result replay does not duplicate history artifacts. Scanner outcome and cleanup uncertainty remain distinct. |
| Platform routing | Run the applicable suite on Docker Desktop and OrbStack for controlled public, Mac-local, LAN and VPN targets. Report unsupported/unavailable combinations as qualification gaps, not passes. |

Run focused unit/contract tests, integration tests, bun test, bunx tsc --noEmit and manual allowed/blocked runs. Unit tests may inject dependencies; the decisive network and secret-cleanup checks must use real runtime enforcement and real receiver observations. Store sanitized evidence including image digests, runtime versions, effective policy/resource snapshots, counters and cleanup inventory. Existing OrbStack prototype evidence is useful preparation but does not satisfy this application vertical slice.

## Implementation ownership and completion

Extend the cURL registry adapter, command preparation and authenticated preparation; refactor the fixed execution runner into testable worker behavior. Put public contracts in concept-scoped types files and pure parsing/mapping in helpers per CODING_STANDARDS.md. Keep ToolRunnerService and session persistence responsible for existing logs/history. Shared backend changes belong to the shared foundation, not duplicated cURL-specific infrastructure. Keep TUI changes limited to accurate lifecycle/error messages.

The migration is complete only with public and authenticated compatibility, independent pre-send endpoint enforcement, bounded resources/output, all-path cleanup, no host fallback and persisted results, with the requested runtime matrix qualified. Planning approval does not satisfy these gates. No production code or acceptance tests were run for this draft.
