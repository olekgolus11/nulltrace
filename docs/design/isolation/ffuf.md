# ffuf migration

Status: selected under delegated planning. [Decision](https://github.com/olekgolus11/nulltrace/issues/148). Inherits the shared execution, credential and HTTP network contracts.

## Preserve

Inspect ffuf-command.helpers.ts, ffuf-authenticated-request.helpers.ts, ffuf-authenticated-run.service.ts, ffuf-artifact.helpers.ts and their tests. Preserve content discovery (extensions/recursion/depth), parameter discovery (query/body/header) and value fuzzing (same three locations, selected parameter and URL encoding). Keep command editing, selected-mode checks, exact-origin target and current restrictions on manual sensitive headers/credentials. Existing rate normalization defaults to 25 requests/s with maximum 100; duration defaults to 10 seconds with maximum 60. Preserve those visible values and bound the worker externally as well, including non-persisted runs that currently bypass some preparation controls.

Use only image-bundled SecLists, as the operator already chose. A catalog maps approved relative selections to immutable revision/hash and sandbox paths; a text field may still select catalog entries, but never a host file. Reject traversal, symlinks outside the dataset and runtime updates/imports. Select latest available upstream revision at release build time, not at run time; record it and test the exact bundle.

## Adapter and policy

Compile existing accepted simple commands to argv; current regex checks are not a complete option allowlist. Inventory the pinned ffuf flags and classify parser inputs, external input commands, request/config files, replay proxies, output destinations, concurrency and recursive behavior. Tool options may affect behavior inside the sandbox but cannot widen network policy, mounts or data access. Do not invent a new unrestricted shell mode for ffuf. Unsupported infrastructure-affecting options fail explicitly; preserve the tested mode/parameter semantics rather than silently editing the command into a different scan.

Build private raw request/config inputs for secret-bearing fields and preserve fuzz markers and explicit request protocol. Authenticated runs keep accepted Auth Check, exact-origin context/version checks and the existing no-follow-redirect rule. Retain private intermediate JSON, redaction before import and cleanup on every path. No secret values in argv/env. Public redirects remain bounded by the exact-origin external policy; block external redirect destinations independently of ffuf's behavior. Inject fixed HTTP proxy settings, clear default ffuf config/environment and apply worker/proxy egress restrictions regardless of flags.

Declare one bounded JSON output slot. Parse outside the privileged broker, validate result URLs against the approved scope, redact request/config echoes and import existing ffuf artifact/sitemap/Finding mappings. Preserve no new Findings on cancellation and deduplicate replay. Runtime scratch and external-command descendants have the same PID/resource/cleanup policy.

## Acceptance

Exercise every mode/location, FUZZ encoding, recursion, extensions, match/filter status and rate/time behavior against a controlled target. Golden-test generated and edited commands against current tests, including non-persisted runs. Validate SecLists catalog identity/read-only behavior and reject host paths. Authenticated A must see expected cookies/headers; B must receive zero on redirect or direct/replay-proxy attempts. Use a hostile worker to test DNS/IPv4/IPv6 bypass rather than relying on command rejection.

Test rate/total deadline enforcement under recursion, output flooding, malformed/oversized JSON and malicious output names. Verify same history, ffuf artifacts, sitemap observations and Findings; Finding Reviews survive re-import. No secret in args/env/runtime/proxy/logs/JSON, and no worker or secret after cancel/timeout/context replacement. Numeric extra resource budgets come from the shared calibration task and must be recorded before acceptance.
