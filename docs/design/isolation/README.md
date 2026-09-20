# Remaining isolation migration plan

Planning baseline: application commit f6ef6e0b210f45a151db6e5ca0bb39a06913675d; architecture and credential/cURL decisions are carried on this branch. This is a plan, not production isolation. On 2026-09-20 the operator delegated completion of all remaining analysis without further questions, overriding the map's one-HITL-decision-per-session workflow. Decisions below are agent-selected under that delegation, not individually confirmed by the operator.

The operator explicitly changed Playwright policy: block destinations outside the exact target origin before contact, return partial results and blocked-destination information, and consider operator-selected additions with assistant explanations. That instruction supersedes the earlier requirement to preserve unrestricted external assets. It does not authorize other tools to inherit those additions.

Read [execution](../isolated-execution-contract.md), [credentials](../container-credential-policy.md), [cURL](../curl-isolation-migration.md), and [ADR 0008](../../adr/0008-use-a-broker-and-per-run-http-network-isolation.md) first.

| Handoff | Decision and scope |
| --- | --- |
| [Playwright](playwright.md) | Exact-origin browser, bounded partial snapshots, separate optional resource approval workflow. |
| [ffuf](ffuf.md) | All three existing modes, pinned SecLists, request files and JSON results. |
| [Nuclei](nuclei.md) | Distinct authenticated/public profiles; template classification; explicit unresolved auxiliary-service policy. |
| [Nikto](nikto.md) | Standard/Custom, disruptive confirmation, controlled config and JSON. |
| [sqlmap](sqlmap.md) | Existing targeted detection-only request semantics and log-derived results. |
| [Nmap](nmap.md) | Connect and raw profiles with independent external packet enforcement. |
| [Auth Check and crawling](http-operations.md) | Three separate migrations; preserve public automatic crawl and existing checkpoints. |
| [OpenCode](opencode.md) | Session runtime isolation, provider egress, narrow session API and reports. |
| [Delivery and evidence](delivery.md) | Shared foundation, ordered separate implementations, release gates and remaining questions. |
| [Boundary inventory](inventory.md) | Process/network paths and trust model. |

No tool migration is complete until its real acceptance tests pass. The existing OrbStack experiment proves only the paths listed in its report. Docker Desktop, raw packets, browser mediation, companion transport and full application flows remain qualification work. A blocked/incomplete scan must not be reported as a clean result.
