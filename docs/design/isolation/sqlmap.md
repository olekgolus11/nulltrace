# sqlmap migration

Status: selected under delegated planning. [Decision](https://github.com/olekgolus11/nulltrace/issues/151).

## Preserve

Baseline: sqlmap-command.helpers.ts validates one URL and one parameter, GET/POST, parameter presence in query/form/JSON, no duplicate options/composed shell, level 1..3, risk 1, B/E/U techniques, request timeout 1..30 seconds, retries 0..2 and threads 1..2. Keep the existing supported matching options and request shape, including unrelated fields and submitted controls. Do not replace explicit targeted verification with --smart; preserve it only when already explicitly selected. No dump/enumeration/OS-shell/takeover features are added.

The service supplies batch/non-coloring/ignore-stdin and a default BEU technique, total duration 300 seconds bounded 30..900, temporary output directory and public/authenticated redactors. Preserve current result collection from bounded logs and existing artifact/Finding mapping, rather than exporting sqlmap's session/cache database.

## Adapter and policy

Compile the existing parser result to argv and private request/config slots. Do not put URL queries, body, credentials or secret-bearing match strings in argv/env. Preserve form/JSON encoding and parameter selection. Extend public preparation with an independently validated target-scope association; a syntactically valid URL alone is not authorization. Keep Auth Check/context-version checks and per-run request files for authentication.

Use the standard HTTP worker/proxy/firewall. Pin all redirects to permitted destinations; preserve existing authenticated redirect restrictions. Clear ambient sqlmap/proxy config; no Tor, direct connections, custom proxy lists or DNS lookups can escape containment even if the process is compromised. No broad provider/Internet access. Never interpret blocked network prerequisites or scanner failure as no injection found.

Use fresh bounded private scratch for sqlmap session state and output; no cross-run cached session import. Collect sanitized bounded logs needed by the existing parser, then delete scratch. Enforce byte/frame/line limits while draining streams and show truncation. Parsers operate in the restricted result boundary, never inside the privileged broker. Retain replay identity and Finding Review separation.

## Acceptance

Verify GET and POST form/JSON requests with required unrelated fields, explicit single parameter, B/E/U and each existing response-matching option. Test malformed/duplicate/nonnumeric limits, forbidden options, target mismatch, authentication injection and exact-origin redirects. Test allowed A, B zero requests on redirect, malicious-worker direct IPv4/IPv6/DNS/proxy bypass, long-running target behavior and process descendants.

Verify canaries absent from argv/env, exception text, logs, sqlmap diagnostic echoes and persisted artifacts; scratch/output DB never exported. Test bounded parser results for positive/negative/error/truncated runs, cancellation no new Findings, context revocation, cleanup and replay. Keep existing 30..900-second operation limits while measuring memory/PID/CPU/storage envelopes on both runtimes.
