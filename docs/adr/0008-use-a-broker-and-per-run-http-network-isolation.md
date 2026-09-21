# Use a broker and per-run HTTP network isolation

Status: accepted; the shared HTTP network runtime is implemented and qualified on OrbStack ARM64. Tool migrations and Docker Desktop qualification remain pending.

## Context

Scanner commands, inspected pages, target responses and model proposals are untrusted. Application validation and operator approval control intent, but they do not prevent a compromised tool from reading host data or opening an out-of-scope connection. Giving the NullTrace process a Docker socket or `NET_ADMIN` would also turn a compromise of the TUI into control over the container engine or host networking.

The protected assets are the user's files, NullTrace database and credential store, other executions, the engine control plane, authentication material and systems outside the approved test scope. Relevant bypasses include direct connections that ignore proxy variables, alternate DNS, IPv4/IPv6 differences, redirects, loopback or metadata endpoints, mutable DNS answers, forged Docker options and cleanup failures.

## Decision

NullTrace uses a narrow execution broker backed by the existing desktop container engine. The application submits a validated execution plan; it cannot submit Docker flags, image names, mounts, capabilities, host paths or firewall rules. Trusted release configuration owns those values. Operator-edited commands remain execution input inside the sandbox and never become infrastructure arguments.

Each HTTP run receives two disposable network namespaces:

1. A non-root worker is attached only to an internal front network.
2. A non-root Squid proxy joins the front network and a separate back network.
3. A short-lived initializer joins each container's network namespace, installs nftables rules with `NET_ADMIN`, verifies the effective ruleset and exits.
4. Only after both rulesets verify does the broker start Squid and then the untrusted command.

The worker firewall defaults input, forwarding and output to drop and permits only established traffic, narrowly required IPv6 neighbor discovery and TCP to its assigned proxy on port 3128. The proxy firewall also defaults all chains to drop and permits egress only to pinned destination address and port pairs. Squid independently restricts the hostname, port and HTTP or CONNECT method. Proxy environment variables aid compatibility; nftables supplies the boundary that prevents bypass.

A trusted host-side resolver validates normalized HTTP or HTTPS origins, resolves each hostname once, bounds the answer count and duration, validates every A and AAAA result and pins the resulting addresses into both `/etc/hosts`-style proxy data and firewall rules. Private Mac, LAN or VPN targets require a release-owned exact hostname-to-address mapping. Such mappings cannot authorize cloud metadata, container-local loopback, unspecified, multicast or IPv4-mapped IPv6 addresses. Changes to addresses require a new policy and environment.

Workers and proxies run as UID/GID 65532, with all capabilities removed, `no-new-privileges`, the engine's seccomp policy, read-only roots, bounded private tmpfs, memory/swap, CPU, PID and file-size limits. They receive no host home, NullTrace database, credential store or Docker socket. The initializer is root with only `NET_ADMIN`; it has no application data, target secrets or control socket and is removed before untrusted execution starts. Environment removal is attempted and checked after success and failure. There is no unisolated fallback.

Squid controls an HTTPS CONNECT destination but does not inspect TLS paths or content. This decision does not introduce TLS interception. The original Host header, SNI and certificate validation remain end-to-end concerns of the tool.

Nmap does not use this profile because an HTTP proxy cannot contain raw scans. It requires a separate IP, protocol and port policy, with `NET_RAW` granted only to modes that need it. Playwright will use the same external HTTP boundary plus its existing browser-level controls. OpenCode remains a separate runtime and network policy; scanner access is not general model Internet access.

## Consequences

The container engine and broker are trusted, high-impact components. The broker narrows client authority but cannot make a compromised engine safe. Docker Desktop and OrbStack route host/LAN/VPN traffic differently, so each supported platform and architecture requires recorded qualification. AppArmor or SELinux is used only where the engine exposes an enforcing profile; its absence must be recorded rather than inferred.

ADR 0004 and ADR 0007 continue to apply. Secrets must enter only declared per-run files, never argv, environment variables, proxy logs or exported artifacts, and exact-origin authentication must survive redirects. Credential delivery is implemented by each tool migration; the shared public HTTP network layer does not yet handle secrets.

OrbStack ARM64 qualification demonstrates pre-send prevention for the tested cases: a controlled forbidden receiver observed zero requests for a cross-origin redirect and direct bypass attempts, and direct DNS and unauthorized IPv6 attempts failed. This does not qualify Docker Desktop, public IPv6 reachability, crash recovery, browser subresources, credentials or Nmap.

