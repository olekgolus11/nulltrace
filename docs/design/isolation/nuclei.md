# Nuclei migration and template coverage decision

Status: implementation analysis complete; auxiliary-service authorization remains an explicit final operator decision. [Decision](https://github.com/olekgolus11/nulltrace/issues/149) must not be closed as full compatibility resolved until that choice is made.

## Baseline and compatibility

nuclei-command.service.ts accepts public extraArgs and template paths with little execution validation and otherwise mainly controls color/output. Authenticated preparation has a different contract: one target, no manual authorization or dangerous output/template/workflow overrides, forced omit-raw, disabled redirects, signed templates and HTTP-only type. Keep these as distinct profiles. Preserve severity/tags, command editing, JSONL source metadata, findings parsing/error counts and Finding Reviews. Cancelled runs produce no new Findings; sanitized output handling still runs.

Use only official templates bundled in the release image, selected at build time and recorded by immutable commit/hash. A signed/official template is still executable untrusted input. Do not mount host templates, allow remote template URLs or auto-update during execution. Public template selections map to catalog IDs within this bundle; do not silently reinterpret an unavailable path. Keep authenticated restrictions even where public catalog selection exists.

## Profile selection

Build a manifest from the exact official bundle and binary. Classify every selected template/workflow and transitive dependency: HTTP, TLS/TCP, DNS, headless, JavaScript/code, file, OAST and fixed external services. Record template ID/hash, dependency graph, required network tuples or unresolved dynamic scope, input files, privilege needs and unsupported reasons. Static classification is a preflight aid; external enforcement must still constrain runtime-derived destinations.

- Authenticated HTTP: existing strict restrictions, Secret File -sf through a private owner-only slot, exact origin and no redirects, ordinary output omits raw material. Worker gets only selected cookies/headers, not provider/browser-storage credentials. No code/headless/direct raw profile silently inherits secrets.
- Public HTTP: per-run Squid/firewall, approved target origin. Existing redirect behavior may operate only inside authorized scope; an external redirect stays blocked. Report affected template coverage, not a clean result.
- Public TCP/TLS and DNS: separate named protocol profiles with trusted compiled target IP/port/protocol scope, using independent egress enforcement. DNS testing a target is different from infrastructure name resolution: authorize the actual resolver/server under test and the intended DNS test mode; no arbitrary worker resolver to the Internet. Do not claim the HTTP proxy carries these protocols.
- Headless: use a hardened browser profile with the same namespace/resource requirements as Playwright. The inspect_page auxiliary grants do not apply. JS/code executes only in a disposable worker with no host/app/store access. File templates can see only declared bundled/run inputs, never the user's filesystem.
- Mixed workflow: determine the union of explicitly authorized protocol requirements before start, or split only if equivalent workflow semantics can be proved. Do not silently split stateful workflows or broaden HTTP workers to unrestricted direct traffic. If requirements cannot be compiled, report that selected workflow unavailable until its profile is implemented/qualified.

Unknown options or arbitrary shell behavior cannot be relied on to describe scope. Preserve accepted public command-editing capability through an explicitly isolated-shell profile only where needed, with independent scope from the operator's approved target/policy snapshot. Shell text cannot change images, mounts or firewall. A command may fail inside its sandbox rather than have forbidden capabilities recreated on the host. Authenticated runs retain their narrower simple-command validator. Publish an option/profile compatibility table; do not call arbitrary host-equivalent shell behavior supported.

No runtime update, cloud upload, remote template retrieval or telemetry egress is implicit. HTTP proxy and internal-proxy flags are fixed by the trusted profile; unknown bypass flags still cannot open network paths. Nuclei/config/cache are private bounded storage; templates are read-only.

## OAST conflict left for the operator

OAST requires communication with an interaction service besides the target. Upstream exposes an Interactsh server setting; disabling Interactsh excludes OAST-based templates. Therefore a strict target-only network rule and full OAST compatibility cannot both be promised. [Nuclei running documentation](https://docs.projectdiscovery.io/opensource/nuclei/running).

Recommendation: allow an explicitly configured, operator-approved auxiliary Interactsh service for Nuclei only, ideally operator-controlled, with its own pinned control endpoint and bounded polling/registration profile. Keep its credentials separate from target credentials and out of argv/env. Record the approved service in run policy/provenance; no random provider fallback. Target-originated DNS/HTTP callbacks occur outside NullTrace's namespace and cannot be contained by its firewall.

This recommendation is not adopted as blanket Internet permission. Until the operator chooses whether such an exception is acceptable, OAST-dependent runs are explicitly unavailable/incomplete; do not silently append no-interactsh and call the scan equivalent. Non-OAST implementation can proceed without resolving this final policy choice, but full Nuclei compatibility/release acceptance cannot. Other auxiliary/cloud service dependencies need the same explicit scope treatment, not automatic allowlisting from template text.

## Secrets, output and lifecycle

Preserve ADR 0004 Secret Files and ADR 0007 exact-origin behavior. Generate authority constraints in the Secret File plus separate scheme/redirect policy; the file's regex alone does not enforce origin. Paths are broker-owned. Validate secret updates/revocation at start, disable debug/raw output in authenticated mode, and sanitize bounded JSONL before any durable storage or replay. Raw opt-in evidence remains a separate encrypted-only contract, not a migration shortcut.

One declared JSONL slot with byte/line/record/depth limits; raw request/response fields and output paths are hostile. Preserve existing parse-error counts and scanner outcome without fabricating no-findings success. Whole execution, polling cooldown, parser/finalization and cleanup have finite budgets. No infinite template execution or provider polling after owner loss. Additional resource defaults must be measured for the selected corpus, not copied from cURL.

## Acceptance

Build a reproducible template coverage manifest for every release. Exercise at least one representative fixture per selected protocol and mixed workflow, plus intentionally hostile template/code/redirect behavior. For every in-scope case preserve expected findings and source metadata; for unavailable profiles report exact affected template IDs/reasons. Test HTTP allowed/redirect B-zero, direct TCP/TLS allowed tuple and forbidden ports, DNS target-only policy, headless background paths and OAST separately after authorization.

Verify no unapproved template fetch/update/cloud/control traffic, no host/app/store reads, credentials only at exact target, no transformed request logs accidentally retained, bounded malformed JSONL, cancellation/revocation/timeout/crash and all secret/scratch cleanup. Existing public/authenticated unit tests and the generic HTTP experiment are insufficient evidence for all official templates.
