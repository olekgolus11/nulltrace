# Auth Check and sitemap HTTP operations

Status: selected under delegated planning. [Decision](https://github.com/olekgolus11/nulltrace/issues/153). Implement Auth Check, public crawl and authenticated crawl in separate tasks.

## Shared operation boundary

These are target-network paths even though they do not use ToolRunnerService. Move their network and hostile HTML/XML processing into disposable workers under the same broker-owned HTTP egress policy. Do not route them through OpenCode. Application services retain permission, context-version, lifecycle and repository ownership. Workers return bounded typed observations/checkpoints, never arbitrary SQL, app paths or callbacks. The app validates target/session association and scope again before persistence.

Use an operation envelope with opaque identity, operation kind, target origin, approved mode, context version if applicable, bounded limits/input slots and output schema. The shared broker owns process-tree cancellation, timeout, lease and cleanup; request timeouts are additional controls, not the whole operation deadline. Only the target origin is permitted; inspect_page auxiliary grants never apply. Fixed proxy settings without firewall enforcement are insufficient.

## Auth Check task

Preserve the unauthenticated/authenticated comparison, verified/failed/inconclusive outcomes, existing operator acknowledgement of inconclusive results, metadata and re-verification used by authenticated crawl. Current per-request timeout is 10 seconds, response cap 128,000 bytes and redirect count five. Preserve manual exact-origin redirects and the existing cross-origin signal without following it. Bound the total comparison/redirect body-processing lifetime independently.

Execute both legs under one immutable target/context version with separate cookie state; no leakage from authenticated to public leg. Supply only cookies/headers through private slots. Return schema-validated non-secret comparison signals, not raw body/header transcripts. Keep interpretation and stored eligibility associated with the same version in the app. A cancelled/revoked/stale result cannot set isProceedAllowed. A transport/cleanup failure must not be converted into accepted authentication or silently bypassed by automatic acknowledgement.

## Public crawl task

Preserve ADR 0003 automatic first-target crawl and shared target-level deduplication across sessions. Keep the coordinator's fresh/resume/restart/pause behavior and existing persisted sitemap semantics. Default depth 3, 50 pages, request timeout 10 seconds and response cap 1,000,000 bytes; preserve robots/sitemap/link discovery and exact-origin filtering. Retain the existing redirect bound while preventing direct off-origin traffic independently.

Parsing runs inside the bounded worker/result boundary; enforce HTML/XML, queue/frontier, URL and aggregate result limits before large allocations. Return incremental validated entries and a non-secret checkpoint. The application owns commits/deduplication. A worker cannot upsert another target or request arbitrary URLs through forged checkpoint state. HTTP/body timeouts cover body consumption, including chunked/stalled data after headers.

## Authenticated crawl task

Preserve session-scoped provenance, temporary cookie jar updates, Auth Check verification on authentication signals, and public/authenticated separation. Deliver context only for the approved exact origin. Validate every redirect and updated cookie scope; no persistent browser/cookie jar is exported. Clear the jar and secret slots after every terminal path. Re-verification must call the isolated Auth Check operation, not the old globalThis.fetch helper in the app.

Preserve existing pause/checkpoint/resume semantics with version binding: after a pause the environment and jar are gone; resume creates a new operation, reloads the still-valid context and revalidates the bounded checkpoint. Changed/revoked credentials invalidate authenticated execution eligibility and cannot revive an old jar or accepted Auth Check.

## Lifecycle reconciliation

The prior execution contract rejected background continuation of tool runs; crawling already has domain checkpoints. Preserve explicit pause/resume and the documented coordinator recovery behavior while never keeping an orphan worker alive. On owner loss revoke/terminate the old environment. Re-entry may create a new public crawl from its existing checkpoint under ADR 0003; it does not resume the old process or an arbitrary scanner run. Authenticated recovery requires a valid current context and its existing coordinator conditions. Document this domain-specific distinction rather than silently deleting crawl functionality.

Pause records a consistent checkpoint at a bounded safe point, stops new requests and tears down the environment; hard deadline/cancel can abort immediately with an explicitly incomplete checkpoint. Restart cannot overlap the previous run's uncertain teardown. App crash recovery reconciles execution identity before admitting replacements. No new scanner-style approval prompt is added to automatic public crawling.

## Acceptance

Test public auto-start once across concurrent sessions, completed/failed/paused handling, checkpoint resume/restart and entry provenance. Auth Check tests must exercise real isolated public/authenticated legs, result races and redirected exact-origin credentials. Authenticated crawl tests cover updated cookies, expiry/401/403 signals, re-verification, pause and context replacement.

For all three, A receives only authorized requests and redirect B's counter stays zero; direct IPv4/IPv6/DNS bypass from the same worker profile also fails. Test oversized HTML/XML, entity/recursion attacks, infinite/chunked bodies, queue explosion and forged cross-target checkpoints. Secrets are absent from args/env/logs/checkpoints/artifacts. Verify all-path cleanup and ordinary sitemap results. Run each on both runtimes and target route classes before claiming distribution coverage.
