# HTTP execution network runtime

This module implements the shared F2 network layer for issue #160. It provisions and removes disposable worker and Squid environments. No existing tool calls it yet; the first consumer will be the cURL migration. If this layer is unavailable or cannot verify its firewall, execution fails before an untrusted command starts.

## Runtime flow

`HttpExecutionResolverService` accepts only normalized origins such as `https://example.test` or `http://example.test:8080`. It resolves approved names in the trusted broker process, validates all addresses and returns a pinned `HttpExecutionNetworkPolicy`. `HttpExecutionNetworkService` revalidates that policy before using it.

For every run the service creates an internal dual-stack worker network and a separate dual-stack proxy back network. Worker and proxy containers use immutable local image IDs supplied by trusted configuration. The service creates no bind mounts. Both roots are read-only and the only writable paths are bounded `tmpfs` mounts at `/work` and `/tmp`.

The initializer uses the target container's network namespace, installs nftables from stdin and reads back `nft -j list ruleset`. The service requires default-drop input, forwarding and output chains plus the expected address, port and allow-rule evidence. Squid starts only after both namespace checks pass. The command receives fixed proxy variables; direct traffic, worker DNS and unauthorized IPv4/IPv6 traffic still meet the worker's default-drop output chain.

Declared input slots are copied into bounded supervisor memory and expire after five minutes if a run is not started. The normalized plan pins each slot ID, kind and byte ceiling; all slot ceilings together cannot exceed 8 MiB. After firewall verification and proxy startup, each slot's bytes travel through Docker stdin into `/work/input-<slot-id>` on the worker's private tmpfs, with mode `0600`. The host buffer is zeroed as soon as that stdin transfer settles, including failure. The untrusted command starts only after materialization succeeds. Data and secret slot bytes never enter Docker arguments, environment variables or host files. Secret-bearing runs suppress captured worker output events; the disposable container removal deletes their files. Startup without all sealed slots, expired input, failed materialization or unconfirmed cleanup fails closed.

Squid's access log records timestamp, client address, result, method and pinned destination address; its format deliberately omits the request URL and headers so query strings and authentication values are not written there. Secret-bearing runs also suppress worker output events.

Squid receives a mode-0600 configuration and hosts file through stdin. Its access format contains timestamp, source address, decision/status, method and destination address. It omits the URL, query, headers and credentials. The result exposes a bounded tail of those decisions, command status and bounded stdout/stderr, rule hashes and cleanup confirmation.

## Trusted configuration

The caller cannot choose images, container/network names, subnets, mounts, users, capabilities or Docker security options. `trustedNonPublicMappings` is infrastructure configuration for exact Mac, LAN and VPN routes; it is not execution input. The mapping key must match the approved hostname and the resolved address exactly. Cloud metadata, proxy-local loopback, unspecified, multicast and IPv4-mapped IPv6 destinations remain forbidden even if configured.

The image IDs must use the local immutable `sha256:` form produced by the pinned image build. Runtime limits are taken from the admitted execution plan and applied externally by Docker. A fixed ceiling also bounds Docker command output and setup, command, resolver and cleanup durations.

## Public cURL worker profile

The release-owned tools image includes a fixed cURL worker entrypoint and the broker exposes it as `public-curl-worker-v1`. Its invocation is exactly Bun plus the installed worker path; URL, method, inline headers and ordered body operations arrive in one bounded `data` slot and are materialized on the worker's private `/work` tmpfs. The worker rejects extra schema fields, credentials, secret or transport headers, file-based body inputs, unsupported methods, and URLs whose origin differs from the origin stated in the input. The network policy remains independently bound to the single origin in the admitted execution plan, so changing the input alone cannot expand broker-approved destinations.

The grant binds the plan and origin, not the input bytes. Until approval issuance is wired to the trusted application boundary, only that trusted administrative application may construct and seal a per-run request configuration after operator approval. The worker is not exposed by the current TUI command runner and authenticated cURL is not part of this profile. It writes a private temporary libcurl config/body representation to tmpfs; libcurl receives only fixed safety/resource controls and those sandbox file paths in argv. `.curlrc`, URL globbing, automatic redirects and cURL's default proxy bypasses are disabled or replaced by the broker's manual exact-origin redirect loop. Request values are redacted from worker output when they are echoed by the target.

Response files are watched during transfer and checked before reading. The 20 ms file-size monitor may observe a short overshoot; Docker's independent per-file ulimit and tmpfs ceiling bound it. Status and diagnostic pipes are read with fixed byte limits and terminate cURL on overflow. The qualification exercises GET, POST with ordered inline body operations and headers, same-origin redirects, forbidden redirects, and a forged input origin against the broker-scoped network.

The worker's response-file ceiling is 2 MiB, while the current broker event buffer retains at most 1 MiB. Larger responses are safely truncated in the event stream and do not yet have an artifact-transfer path. The 2 MiB ceiling preserves the request-side tool bound; full response compatibility for outputs above 1 MiB requires the separately planned bounded artifact import.

## Qualification

Build and verify the pinned images first, then run:

```sh
TMPDIR=/tmp bun run infrastructure/isolation/qualify-http-network.ts linux/arm64
```

Use `linux/amd64` only after building that architecture. The qualification starts two controlled host receivers. It proves that the approved request arrives, a redirect to the forbidden receiver produces zero receiver requests, a `--noproxy` direct attempt produces zero receiver requests, and direct DNS plus unauthorized IPv6 fail. It reads the worker's applied memory, PID, CPU and file-size limits, and actively exercises memory, process-count and individual-file caps. Timeout, cancellation and normal runs must confirm cleanup. The generated local evidence is ignored; sanitized reviewed evidence is stored under `infrastructure/isolation/evidence/`.

OrbStack 2026-09-24 on Linux ARM64 is qualified in this change. Docker Desktop, Linux AMD64, public IPv6, LAN/VPN routes, active CPU throttling and enforcing AppArmor/SELinux profiles remain unqualified. The engine default seccomp profile was active through Docker's default behavior; this change does not ship a custom seccomp profile. No TLS interception is used. See the sanitized results in `infrastructure/isolation/evidence/orbstack-http-resource-limits-arm64.json`.

## Remaining stages

The public cURL worker/profile is implemented as a release-owned prerequisite, while TUI approval wiring and routing remain pending; authenticated cURL is separate. Production broker-daemon installation, bounded artifact transfer and result import also remain. Playwright must additionally cover redirects, subresources, `fetch`, frames, popups, WebSockets, service workers and downloads. Nmap requires its own non-proxy profile. Nuclei credentials must retain ephemeral secret-file delivery and exact-origin semantics.
