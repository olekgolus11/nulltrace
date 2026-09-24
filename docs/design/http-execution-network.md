# HTTP execution network runtime

This module implements the shared F2 network layer for issue #160. It provisions and removes disposable worker and Squid environments. No existing tool calls it yet; the first consumer will be the cURL migration. If this layer is unavailable or cannot verify its firewall, execution fails before an untrusted command starts.

## Runtime flow

`HttpExecutionResolverService` accepts only normalized origins such as `https://example.test` or `http://example.test:8080`. It resolves approved names in the trusted broker process, validates all addresses and returns a pinned `HttpExecutionNetworkPolicy`. `HttpExecutionNetworkService` revalidates that policy before using it.

For every run the service creates an internal dual-stack worker network and a separate dual-stack proxy back network. Worker and proxy containers use immutable local image IDs supplied by trusted configuration. The service creates no bind mounts. Both roots are read-only and the only writable paths are bounded `tmpfs` mounts at `/work` and `/tmp`.

The initializer uses the target container's network namespace, installs nftables from stdin and reads back `nft -j list ruleset`. The service requires default-drop input, forwarding and output chains plus the expected address, port and allow-rule evidence. Squid starts only after both namespace checks pass. The command receives fixed proxy variables; direct traffic, worker DNS and unauthorized IPv4/IPv6 traffic still meet the worker's default-drop output chain.

Squid receives a mode-0600 configuration and hosts file through stdin. Its access format contains timestamp, source address, decision/status, method and destination address. It omits the URL, query, headers and credentials. The result exposes a bounded tail of those decisions, command status and bounded stdout/stderr, rule hashes and cleanup confirmation.

## Trusted configuration

The caller cannot choose images, container/network names, subnets, mounts, users, capabilities or Docker security options. `trustedNonPublicMappings` is infrastructure configuration for exact Mac, LAN and VPN routes; it is not execution input. The mapping key must match the approved hostname and the resolved address exactly. Cloud metadata, proxy-local loopback, unspecified, multicast and IPv4-mapped IPv6 destinations remain forbidden even if configured.

The image IDs must use the local immutable `sha256:` form produced by the pinned image build. Runtime limits are taken from the admitted execution plan and applied externally by Docker. A fixed ceiling also bounds Docker command output and setup, command, resolver and cleanup durations.

## Qualification

Build and verify the pinned images first, then run:

```sh
bun run infrastructure/isolation/qualify-http-network.ts linux/arm64
```

Use `linux/amd64` only after building that architecture. The qualification starts two controlled host receivers. It proves that the approved request arrives, a redirect to the forbidden receiver produces zero receiver requests, a `--noproxy` direct attempt produces zero receiver requests, and direct DNS plus unauthorized IPv6 fail. It reads the worker's applied memory, PID, CPU and file-size limits, and actively exercises memory, process-count and individual-file caps. Timeout, cancellation and normal runs must confirm cleanup. The generated local evidence is ignored; sanitized reviewed evidence is stored under `infrastructure/isolation/evidence/`.

OrbStack 2026-09-24 on Linux ARM64 is qualified in this change. Docker Desktop, Linux AMD64, public IPv6, LAN/VPN routes, active CPU throttling and enforcing AppArmor/SELinux profiles remain unqualified. The engine default seccomp profile was active through Docker's default behavior; this change does not ship a custom seccomp profile. No TLS interception is used. See the sanitized results in `infrastructure/isolation/evidence/orbstack-http-resource-limits-arm64.json`.

## Remaining stages

The runtime still needs production broker-daemon installation and restart reconciliation, bounded artifact transfer and per-tool adapters. cURL is the first vertical slice; its current OrbStack checks cover cancellation and timeout cleanup. Playwright must additionally cover redirects, subresources, `fetch`, frames, popups, WebSockets, service workers and downloads. Nmap requires its own non-proxy profile. Nuclei credentials must retain ephemeral secret-file delivery and exact-origin semantics.
