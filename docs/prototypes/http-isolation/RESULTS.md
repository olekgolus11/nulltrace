# HTTP containment experiment: OrbStack

Question tracked by [Validate per-run HTTP network enforcement on desktop runtimes](https://github.com/olekgolus11/nulltrace/issues/156), supporting [Choose the execution trust boundary and desktop network topology](https://github.com/olekgolus11/nulltrace/issues/143).

## Finding

The tested namespace-initializer mechanism enforced destination restrictions **before forbidden HTTP/DNS traffic reached the controlled server** on OrbStack 2.2.3 (20963), Docker Engine 29.4.0, Linux 7.0.14-orbstack, arm64. The isolated-fixture run passed 26 checks; the subsequent Mac-loopback variant passed 28 checks. This supports the HTTP architecture candidate on this runtime; it does not complete the architecture decision, qualify Docker Desktop or implement NullTrace isolation.

Before installing rules, the controlled forbidden server was reachable over IPv4 and IPv6, and both direct and Docker-embedded DNS reached its DNS listener. After installation, the forbidden server independently recorded **zero HTTP requests, zero DNS queries and zero input TCP/UDP packets** across the test attempts. Approved HTTP and HTTPS requests reached the approved server over both upstream address families. HTTPS certificate verification stayed enabled against the synthetic fixture certificate; no TLS interception was used.

## Mechanism tested

- A host-side Bun driver stands in for the future trusted broker. It creates independent worker and proxy namespace holders. It is not a production broker or its protocol.
- A short-lived initializer joins each namespace with only NET_ADMIN added. It installs nftables input/output/forward default-drop policy and exits. Rule presence is read back after its exit, before worker startup.
- Worker and Squid use separate filesystem and PID namespaces, UID/GID 65532, zero effective/permitted/bounding capabilities, no-new-privileges and default seccomp. They have read-only root filesystems and bounded tmpfs. No host/app/Docker-socket mounts are supplied.
- The worker can open TCP only to its assigned proxy IP/port. No blanket loopback exception exists; embedded DNS is blocked.
- Proxy egress permits only the approved fixture's pinned IPv4/IPv6 addresses and ports. Narrow IPv6 neighbor discovery exceptions permit reaching that fixture. Proxy input admits only its worker. Squid adds hostname/port/CONNECT checks and a fixed hosts mapping.
- The default experiment uses private fixture bridges, with an internal worker network and internal upstream network. The Mac-loopback variant gives the proxy's upstream bridge ordinary routing and adds only the resolved Mac address and two synthetic fixture ports to its firewall. The forbidden fixture is deliberately attached to both bridges, so direct same-network bypass attempts are meaningful without relying on missing routes between bridges.

## Results

| Check | Observed evidence |
| --- | --- |
| Allowed HTTP/HTTPS, upstream IPv4/IPv6 | Approved server records all four requests; cURL succeeds. |
| Redirect from approved server to forbidden server | Approved server records redirect request; cURL follows and receives proxy denial; forbidden server counter remains zero. |
| Direct IPv4/IPv6, NO_PROXY, direct DoH, gateway, metadata and alternate proxy port | Client fails; worker firewall counters rise. The metadata route check alone does not establish which layer rejected it. |
| Forbidden proxy host/CONNECT and approved-host wrong ports | Requests denied. |
| Direct DNS UDP/TCP and embedded DNS | Requests fail; forbidden DNS listener and TCP/UDP packet counter remain zero. |
| IPv4/IPv6 UDP attempts | Attempts denied; forbidden fixture packet counter remains zero. |
| Proxy-side firewall independent of Squid ACL | Direct clients inside the proxy namespace cannot reach forbidden IPv4/IPv6 destinations or an unapproved port on the approved IP. |
| Worker/proxy firewall mutation | Both fail to flush nftables rules without NET_ADMIN. |
| PID limit 48 | Forking stops after 46 child processes with EAGAIN. |
| Memory limit 128 MiB, no extra swap allowance | A 256 MiB allocation exits 137; cgroup reports one OOM kill. |
| CPU quota 0.5 CPU | A busy loop increases nr_throttled from 0 to 21. |
| Stopped proxy | Proxied request fails; direct fallback remains blocked. |
| Normal/error cleanup | Final and intermediate failed runs leave no experiment containers or networks. |
| Mac-loopback variant | HTTP and HTTPS fixtures bound only to 127.0.0.1 receive proxied requests with Host localhost and the original port; TLS verification for localhost succeeds. Direct worker access to the same approved host service fails and does not increment its counter. |

The engine reports cgroup v2 and default seccomp. It does not advertise AppArmor or SELinux in SecurityOptions. No LSM confinement claim is made.

## Failures that changed the experiment

The first run was **not contained**. The Bun stdin writer incorrectly used `stdin.end(text)`, which did not write the rule text. The forbidden server counters caught actual traffic. The corrected writer uses `stdin.write(text)` followed by `stdin.end()`, and the driver refuses worker startup without reading back the containment tables. The minimized stdin reproduction changed from empty output to the expected payload. This is a harness bug, not evidence of an OrbStack firewall bypass; it demonstrates why a successful setup-process exit alone is insufficient.

A subsequent correctly filtered run exposed Squid's auxiliary pinger IPC dependency. Disabling the pinger allowed startup without granting broad loopback traffic. Approved IPv6 required narrowly scoped neighbor-discovery exceptions. These are test-image configuration findings, not complete production profiles. [Squid pinger documentation](https://www.squid-cache.org/Doc/config/pinger_enable/).

Two complete runs of the corrected topology passed all 26 checks; the final one additionally verified forbidden IPv6 fixture reachability before installing rules.

## Limits and remaining gates

- Docker Desktop is not installed at the standard application path and has no registered context here. It was not tested. OrbStack results cannot be copied into its support column.
- Public, LAN and VPN target routing, IPv6 Mac-loopback/next-hop policies, and IP-literal host mappings remain untested. The Mac IPv4 loopback variant verifies URL/Host and certificate identity; it does not separately capture the TLS ClientHello SNI field.
- Concurrent per-run isolation, policy compilation/rebinding/CNAME cases, startup races, initializer failure injection, controller crash/restart and deadline/cancellation recovery remain untested.
- No real application database, credential store or credentials were used. Canary filesystem tests, credential delivery/redaction, artifact safety and aggregate scratch/file bounds remain pending. Requested bounds are not all equivalent to proven bounds.
- No Nmap/raw-packet containment, Playwright request semantics, Nuclei auxiliary services, OpenCode isolation or application integration is established.
- CONNECT permits an encrypted tunnel to an approved host/port; it cannot enforce its HTTP paths, headers, WebSocket semantics or prevent an approved endpoint relaying traffic.
- Output capture and lifecycle logic are a throwaway local test driver, not a hardened broker. The image includes diagnostic tools and a synthetic TLS private key; do not distribute it as a production runtime.

## Reproduction and evidence

Run `bun docs/prototypes/http-isolation/http-isolation.experiment.ts` from this worktree. It builds the test image and prints a temporary evidence directory. Its containers and networks are removed afterward; the local image remains. No shared VM firewall rules are changed.

Run the same command with `--host-fixture` for the Mac-loopback variant. Its [28 results](evidence/orbstack-mac-loopback/results.json), [host events](evidence/orbstack-mac-loopback/mac-server-events.json), independent forbidden-server counter, runtime identity and cleanup record are retained separately. Its image adds localhost to the synthetic certificate SAN and has a separately recorded image ID.

[Selected evidence](evidence/orbstack/results.json) includes the independent [server packet counter](evidence/orbstack/denied-server-packet-counter.txt), empty server event log, [approved requests](evidence/orbstack/allowed-server-events.jsonl), installed rule snapshots, [resource evidence](evidence/orbstack/resource-evidence.json), [runtime identity](evidence/orbstack/runtime.json) and [cleanup check](evidence/orbstack/cleanup.json). Full local Docker inspection records are intentionally not published.

Repository verification: `bun test` passed 596 tests across 93 files (2,030 assertions); `bunx tsc --noEmit` passed. These existing tests do not establish containment; the container experiment supplies the network evidence. No production application code was changed.
