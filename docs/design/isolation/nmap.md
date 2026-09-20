# Nmap migration with a dedicated packet profile

Status: selected architecture under delegated planning; packet containment and desktop scan fidelity require their own experiment before implementation acceptance. [Decision](https://github.com/olekgolus11/nulltrace/issues/152).

## Existing behavior

nmap-command.service.ts currently strips output flags and appends -oX; it does not validate argv or authorize scope. Preserve target/ports/timing, -sV, -O, -sC, -A and extra-argument editing, XML scanner/host/port/OS/script mapping and no Findings on cancellation. The form defaults to service detection and T3. Do not silently replace all requests with TCP connect or drop OS/NSE/aggressive features.

Nmap's proxy option does not cover discovery, normal port scanning or OS detection. [Nmap documentation](https://nmap.org/book/man-bypass-firewalls-ids.html). Do not place this tool behind the HTTP proxy and claim containment.

## Approved plan and capabilities

A trusted compiler resolves the approved target hostname or explicit address/range to a bounded pinned address set, expands selected/default ports from the pinned Nmap data, classifies protocols/modes and records the effective scope in the existing run approval. CIDRs/ranges remain possible within finite installation limits. Changing target/ports/extra arguments creates a new immutable plan. No ambient DNS or reverse-DNS traffic from the worker; supply fixed mappings or use no-DNS operation while retaining original hostname metadata for scripts that need it.

Use an unprivileged connect profile for explicit compatible -sT scans. Raw discovery/SYN/UDP/OS modes use a separately qualified profile with only the capabilities the pinned mode demonstrably requires, starting with NET_RAW. Nmap's own privilege detection must be configured correctly; a flag claiming privilege is not a capability grant. Never add NET_ADMIN/SYS_ADMIN or root to the application/worker to make a mode work. If another capability proves necessary, review the narrowly scoped profile and evidence before enabling it; no broad default grant.

Port scans, discovery, OS detection and traceroute have different packet envelopes. Show and authorize needed ICMP types, discovery probe ports/protocols and any traceroute requirements; never infer authorization for all ports from -A. Target-scoped raw probes must not be automatically rewritten into different tests. Strict off-port enforcement may make OS fingerprinting incomplete unless its probe envelope is included. Report that limitation and require an explicit compatible scope. Router-directed traceroute/decoy/idle/bounce/broadcast behavior may need additional destinations beyond the target; keep it unavailable when not authorized, rather than granting a hidden network-wide exception.

Simple commands use typed argv. For existing shell-composed editing that cannot be safely reduced to one Nmap argv, retain an explicit disposable shell profile with the same independent approved scope and artifact slots; no host shell. Parsed command text is not the scope authority. It cannot select infrastructure arguments or host filenames. Native output flags map only to private slots; hostile shell attempts to replace artifacts are rejected by the collector.

## Enforcement outside the raw worker

NET_RAW permits raw/packet socket behavior, so a firewall only in the scanner's own IP output path is not sufficient evidence. Use a private point-to-point worker attachment to a trusted per-run gateway/enforcement namespace with no alternate egress, shared target LAN bridge, host networking or runtime control route. Enforce allowed IP/protocol/port tuples on the trusted ingress/forward path before traffic reaches any shared network. Filter L2 and IPv6 extension/fragment cases; constrain ARP/NDP to the fixed gateway mapping. The worker cannot reconfigure this namespace or attach another interface.

The minimal infrastructure layer, not NullTrace, provisions the gateway rules and routing. Verify policy before launch. Capability removal from workers is still required, but raw workers can craft hostile packets; tests must cover AF_PACKET/send-eth, spoofed source/destination MAC/IP, VLAN tags, fragments, noninitial fragments, IPv4-mapped forms, IPv6 extension headers and alternate gateways. Do not open a blanket related/established exception that lets malicious traffic expand scope. Specify explicit return-traffic behavior for each scan mode.

This topology is an architecture candidate needing real proof on both runtimes. If the runtime cannot provide a trustworthy sole path, raw mode stays unavailable and the full distribution does not claim Nmap parity. A separately managed Linux execution appliance is a fallback architectural proposal for operator review, not an automatic unisolated fallback.

## Artifacts and acceptance

Declare bounded private nmap.xml; reject external entities, pathological nesting/size, malformed records, symlinks/devices/hardlinks and hostile scanner args echoes. Parse outside broker privilege and import the existing nmap_scan shape with safe source metadata. No authentication context or provider secret is needed by ordinary Nmap; script input secrets, if supported later, require their own declared per-run slots.

Qualify allowed TCP connect, SYN, UDP, discovery, service/version, OS/default NSE/aggressive modes against owned fixtures. A receives the approved probes; forbidden host B receives zero packets, and a forbidden port on A receives zero probes, measured at receivers. An intentionally malicious raw sender must fail identically. Inspect effective capabilities, seccomp, UID, CPU/memory/PID/storage/time controls and cleanup of gateway plus worker after cancel/timeout/controller failure.

Separate containment results from scan fidelity: Desktop/OrbStack VM NAT, Mac-local and VPN routing may alter discovery, traceroute or OS fingerprints even when containment passes. Compare to a controlled Linux reference where possible. Record unsupported modes per runtime; do not fake parity by changing the selected scan. Release requires that matrix, not merely a successful -sT example.
