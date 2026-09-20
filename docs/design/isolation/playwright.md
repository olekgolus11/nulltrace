# Playwright migration

Status: selected under delegated planning, with the operator's explicit exact-origin correction. [Decision](https://github.com/olekgolus11/nulltrace/issues/147). [ADR 0009](../../adr/0009-block-unapproved-page-inspection-origins.md) governs the deliberate behavior change.

## Existing contract

PageInspectionService checks session consent, exact-origin URL, a 2,048-character URL limit and protected paths. Public/authenticated modes remain session-scoped. Authenticated inspection requires an accepted Auth Check and secure storage; do not weaken that existing secure-store requirement just because other tools permit memory-only context. Retain 401/403/login-redirect distinctions and localStorage/sessionStorage support.

Playwright launches a fresh Chromium and context per inspect call. Preserve GET/HEAD-only behavior, same-origin main navigation, blocked child documents, service workers, downloads, popups and WebSockets. Keep navigation timeout 10 seconds, render-wait 2 seconds, 12,000 visible-text characters, 25 forms/20 fields, 50 links, 30 scripts, 80 outline nodes, 30 metadata items and 30,000 serialized characters. Add byte/depth, DOM-evaluation, whole-execution and IPC limits before allocation. Do not mistake a networkidle timeout for a failed page: keep labeled partial snapshots.

The chat adapter currently persists a selected safe snapshot as page_inspection_snapshot and returns source.toolRunId/artifactId for evidence-backed create_finding. It does not persist all returned fields. Update both mappings for blocked destinations. No HTML, screenshot, browser profile, HAR, trace, hidden input values or raw cookies/storage becomes an artifact.

## Base isolated execution

Use a fixed Bun inspection worker and pinned Chromium/Playwright build inside a disposable environment; the app sends bounded URL/mode/context-version inputs through the broker. No externally reachable CDP, Playwright server or debug port. Return a schema-validated snapshot only. Browser filesystem/profile/cache, shared memory and downloaded scratch are private, bounded and discarded. Require non-root, no capabilities, no-new-privileges, restrictive seccomp and Chromium's own sandbox. Explicitly enable/verify that sandbox; do not accept Playwright launch defaults as proof. Do not use --no-sandbox, SYS_ADMIN, privileged mode or host IPC to make startup pass. Qualify the namespace/seccomp combination on each runtime. [Playwright Docker guidance](https://playwright.dev/docs/docker) is upstream context, not a secure ready-made deployment.

Browser egress is restricted to its own proxy; proxy egress pins only the approved target address/port mapping. Cover IPv4/IPv6, DNS, QUIC, WebRTC/STUN, preconnect/prefetch and loopback bypass. Disable unnecessary background browser traffic, but rely on external enforcement for containment. Keep all existing route controls and install them before any page can navigate. A popup-close callback alone is not evidence its first request was prevented.

Move availability detection from host chromium.executablePath to broker profile readiness. The distribution bundles Chromium; missing/mismatched image or failed sandbox initialization produces an isolation error, not instructions to install a host browser. No host fallback. Authenticated execution binds the same immutable context version at load, prepare and start; revocation/owner loss cancels the entire environment and clears all per-run secrets.

## Block reporting

Extend the bounded result with blockedRequests aggregated by normalized origin, request category and fixed reason; include count, policy version and a truncated count. Candidate origin IDs bind to the execution, session and policy version. Bound collection during browsing, not after building an unlimited array. Suggested implementation starting budgets: 50 unique destinations, 200 total diagnostic records, inside the existing total-result envelope; report omitted counts. Final tuning is measured, not a security claim here.

Do not return raw query/fragment/userinfo or arbitrary hostname text without validation/redaction. Paths may contain secrets too: default to origin plus resource type; include only a safely redacted bounded example path when useful. Unsafe/non-HTTP schemes are fixed reason categories, not selectable origins. Resource type reported by the worker is diagnostic evidence, not authority to widen a firewall. Infrastructure denies may have only endpoint metadata; do not invent URL details or merge them as confirmed browser observations.

Blocked subresources yield isPartial plus a new network-policy reason, retaining whatever safe snapshot can be extracted. If navigation is blocked before a usable document exists, return a structured blocked-navigation outcome with diagnostics and no fabricated successful snapshot. Keep run status/provenance honest; existing successful snapshots still support Findings. Update snapshot bounds helpers so they do not reset policy partiality when no text section was truncated. Persist safe diagnostics for later review.

## Separate auxiliary-resource approval task

Default: no extra origin. The assistant may propose a subset of observed candidates with evidence, likely purpose, confidence and uncertainty. It must not fetch a blocked URL to assess it, call it safe based on a domain name, or treat target-provided instructions as policy. Distinguish likely application dependencies from cosmetics, analytics and unknown/suspicious endpoints. Unexpected identity/credential endpoints require explanation, not automatic approval.

Provide unchecked, grouped origin checkboxes with scheme/hostname/port and reason. Approval comes from the TUI operator action and stores a session-owned versioned resource grant. The model cannot invoke approval, inject extra candidates into the accepted selection or change the policy during a run. Normalize IDNs and show unambiguous ASCII authority alongside any friendly label. Reject wildcards, implicit subdomains, hidden ports, forbidden control/metadata destinations and stale/cross-session candidate IDs. Known denied candidates remain unchecked; approvals do not resurrect after revocation.

Choose session-scoped auxiliary GET/HEAD script/style/font/image access only. It does not authorize cross-origin fetch/XHR, main-page inspection, redirects to a new main origin, SSO, forms, frames, popups, downloads or sockets. Keep session consent separate. Subsequent inspect_page calls may use the grant without another base-consent prompt, but no queued blocked requests are silently replayed: new calls create new execution IDs and policy snapshots. Revocation cancels affected active runs. Main-page cross-origin support is left for a later product decision.

For authenticated inspection, do not simply add auxiliary origins to the credential-bearing browser's proxy. Browser cookies are not an exact-port credential boundary, and route.continue cannot reliably override Cookie; its header overrides also have redirect behavior to consider. [Route documentation](https://playwright.dev/docs/api/class-route#route-continue).

Selected implementation direction: the browser keeps target-only network egress; intercepted approved auxiliary requests are served by a separate bounded credential-free fetch worker and fulfilled into the page. This worker has its own proxy/firewall grant, no target cookies/storage, no target secret slot and no shared browser profile. It accepts only typed resource requests bound to the grant, rejects unauthorized redirects at each hop, and does not forward original Authorization/Cookie/Referer headers or Set-Cookie back into the browser. Preserve necessary MIME/CORS/CSP behavior with real fixtures; fail the feature closed if this cannot be made compatible. Do not open a generic Internet fetch API. This mediation is not TLS interception: it makes its own certificate-verified request to the explicitly approved origin.

Third-party scripts still execute in the target page and may read page-accessible data. A hostile page can encode data into an approved resource request. Operator approval therefore extends the set of trusted network recipients; this design cannot promise confidentiality from approved malicious scripts/endpoints or a compromised worker. No initial credential injection is allowed outside the target exact origin, and ordinary cookie leakage must be prevented, but arbitrary exfiltration to an approved destination is a documented residual risk.

## Acceptance and sequencing

Implement strict-origin inspection first, auxiliary approval/mediation second as a separate task. The base slice needs isolated Auth Check and secure-store integration for authenticated acceptance. Tests cover rendered same-origin JavaScript and GET fetch, all original snapshot sections and provenance, public protected-path rules, cookies/header/storage use, and 401/403/login outcomes.

Controlled external receivers must observe zero requests for blocked scripts/styles/images/fonts, redirects, fetch, child frames, popups, WebSockets, workers, service workers, downloads, WebRTC and browser background paths. Include an external redirect receiver with its own zero counter. Separate semantic route-block tests from malicious-worker endpoint-bypass tests. No GET/HEAD/read-only claim implies that the tested server cannot mutate state.

Auxiliary tests additionally prove no request before operator selection, no model/cross-session authorization, only selected grants reachable, stale grants rejected, no native-cookie leaks to same-host alternate ports/schemes, no header forwarding across redirect chains, correct CORS/CSP/MIME behavior, and safe partiality when an asset is missing. Test original target remains allowed while the browser cannot directly reach the resource worker's destinations.

Qualify browser sandbox, CPU/memory/PID/shared-memory/output limits, hung evaluation, crash/cancel/revocation and profile/secret destruction on both runtimes. Record effective config and server observations. Existing mocked-browser tests do not prove these properties.
