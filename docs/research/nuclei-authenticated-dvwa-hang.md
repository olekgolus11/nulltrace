# Nuclei authenticated DVWA scan hang research

Date: 2026-07-16

## Executive conclusion

The strongest explanation for the authenticated DVWA plateau is **PHP session-lock contention**, not NullTrace's Secret File construction and not one particular Nuclei template.

NullTrace supplies one accepted DVWA session to Nuclei. Nuclei applies that authentication to every matching request and normally executes many templates concurrently. DVWA starts the same PHP session for requests carrying that session ID. PHP's default file-backed session handler locks a session until the request ends or explicitly closes the session. Consequently, authenticated scan requests sharing one `PHPSESSID` are serialized behind one lock. If any intrusive or long-running probe holds that lock, all other workers using the same session wait behind it and Nuclei's request count appears frozen.

This conclusion is high confidence for the slowdown/plateau mechanism. It is not yet proven which request first holds the DVWA lock in the reported runs.

## Primary-source evidence

### 1. A Secret File intentionally applies one authentication context broadly

ProjectDiscovery documents that providing `-sf` automatically configures authentication or authorization for each request in executed templates. It also documents `domains` as the mechanism that scopes a static cookie or header secret to matching targets. Therefore, all requests to the exact matching DVWA origin receive the same saved session identity. [ProjectDiscovery authenticated-scan specification](https://docs.projectdiscovery.io/opensource/nuclei/authenticated-scans)

Changing the Secret File entry from `type: cookie` to a `Cookie` header does not change that identity. Both representations send the same session ID to DVWA, so neither avoids server-side locking.

### 2. Nuclei runs templates concurrently by default

Nuclei's documented CLI defaults include 25 concurrently executing templates (`-c`), a bulk size of 25 (`-bs`), payload concurrency of 25 (`-pc`), and JavaScript concurrency of 120 (`-jsc`). The same reference defines request timeout, retries, max-host-error handling, protocol filters, and tag filters. [ProjectDiscovery running/CLI reference](https://docs.projectdiscovery.io/opensource/nuclei/running)

With one host, `-bs` is not the principal multiplier; `-c`, per-template payload work, JavaScript work, and concurrent internal requests can still place multiple requests against the same authenticated session.

### 3. PHP serializes concurrent requests sharing a file-backed session

The PHP manual states that the default file-based session handler locks the session file once `session_start()` opens it. No other script can access that same session file until the first script terminates or calls `session_write_close()`. PHP explicitly calls out concurrent requests as the problematic case. [PHP session basic usage](https://www.php.net/manual/en/session.examples.basic.php)

PHP also documents `read_and_close` and early `session_write_close()` as ways for an application to avoid unnecessary locking. [PHP `session_start`](https://www.php.net/manual/en/function.session-start.php), [PHP `session_write_close`](https://www.php.net/session-write-close)

An HTTP client timeout only abandons the client-side wait; it does not guarantee that the PHP script has stopped or released its session lock. Thus lowering Nuclei's `-timeout` can limit a client request while queued or still-running server work continues to block that session.

### 4. DVWA starts the session and keeps it open through page execution

DVWA's shared `dvwaPage.inc.php` calls `session_start()` when no session is already active. The file only calls `session_write_close()` as part of reconfiguring and immediately restarting the session during login; it does not close the normal session immediately after reading authentication state. [DVWA session initialization](https://github.com/digininja/DVWA/blob/master/dvwa/includes/dvwaPage.inc.php#L408-L450)

DVWA's authenticated index imports that shared file before checking authenticated page startup. [DVWA authenticated index](https://github.com/digininja/DVWA/blob/master/index.php#L1-L6)

The official DVWA code and PHP's documented lock behavior therefore establish this sequence:

1. Nuclei sends concurrent requests with one accepted `PHPSESSID`.
2. The first DVWA PHP request opens and locks that session.
3. Other PHP requests carrying the same ID block at session startup.
4. A slow/intrusive request prolongs the lock; Nuclei statistics stop advancing even though many templates remain in flight.

## What the recurring template IDs show

Five IDs recurred across two independent stalled resume snapshots:

| Template          | Protocol/shape in v10.4.5                            | Relevant observation                                        |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| `CNVD-2022-43245` | One raw HTTP POST; body/header word matchers         | Ordinary HTTP matcher; not a default-login template         |
| `CVE-2023-6329`   | HTTP + JavaScript flow; three HTTP requests          | Tagged `intrusive`; the only JavaScript flow among the five |
| `CVE-2024-3234`   | One raw HTTP GET; word/status matchers               | Ordinary HTTP matcher                                       |
| `CVE-2024-6396`   | Three raw HTTP requests, including an alternate port | Arbitrary-file-overwrite probe; multi-request template      |
| `CVE-2025-29925`  | Two HTTP payload paths; word/status matchers         | Ordinary HTTP matcher                                       |

Sources: official templates [CNVD-2022-43245](https://github.com/projectdiscovery/nuclei-templates/blob/v10.4.5/http/cnvd/2022/CNVD-2022-43245.yaml), [CVE-2023-6329](https://github.com/projectdiscovery/nuclei-templates/blob/v10.4.5/http/cves/2023/CVE-2023-6329.yaml), [CVE-2024-3234](https://github.com/projectdiscovery/nuclei-templates/blob/v10.4.5/http/cves/2024/CVE-2024-3234.yaml), [CVE-2024-6396](https://github.com/projectdiscovery/nuclei-templates/blob/v10.4.5/http/cves/2024/CVE-2024-6396.yaml), and [CVE-2025-29925](https://github.com/projectdiscovery/nuclei-templates/blob/v10.4.5/http/cves/2025/CVE-2025-29925.yaml).

There is no common special protocol across the five: four are plain HTTP and only one uses JavaScript. All use matchers, but so do thousands of templates. Their recurrence is consistent with several workers waiting behind a shared target-side lock; it does not identify any one of them as the lock holder. Resume/in-flight lists show unfinished work, not necessarily the request causing other work to wait.

Local differential testing strengthens that interpretation: using the current exact-origin Cookie-header Secret File, each of the five recurring IDs completed individually in 0.38–0.73 seconds, and all five completed together in one Nuclei process in 0.47 seconds. Their authenticated requests and matchers therefore terminate normally outside the broad concurrent scan.

This also explains why excluding `default-login` did not solve the broader run: none of these five templates is tagged `default-login`.

## Interpretation of the Nuclei stack dump

The reported stack dump placed many goroutines around:

```text
MatchWords -> expressions.Evaluate -> replacer.Replace -> types.ToString
```

and showed the main execution path waiting on template-spray concurrency and parallel HTTP wait groups. That is evidence of where goroutines were sampled, not by itself proof of an infinite loop in `MatchWords`. Goroutine dumps can contain runnable matcher workers while other HTTP workers hold the completion barrier.

There is a plausible version-specific expression concern: Nuclei v3.8.0 shipped substantial expression-evaluation security changes, and v3.9.0 subsequently fixed expression placeholder preference. [Nuclei v3.8.0 release](https://github.com/projectdiscovery/nuclei/releases/tag/v3.8.0), [Nuclei v3.9.0 release](https://github.com/projectdiscovery/nuclei/releases/tag/v3.9.0)

However, no primary-source issue or release note located during this research links v3.8.0's expression engine to this exact authenticated DVWA plateau. The stack alone is insufficient to attribute the hang to that code. Upgrading remains necessary, but should not be presented as a proven fix for PHP session serialization.

At the time of research, the locally resolved `nuclei` binary reports v3.11.0, while the captured failing runs reported v3.8.0. Nuclei v3.10.0 added per-host HTTP pooling and fixed resource leaks, and v3.11.0 is the current local engine. [Nuclei v3.10.0 release](https://github.com/projectdiscovery/nuclei/releases/tag/v3.10.0), [Nuclei v3.11.0 release](https://github.com/projectdiscovery/nuclei/releases/tag/v3.11.0)

## Why the attempted flags did not settle it

- `-dialer-keep-alive 1s` changes connection reuse; it does not change the shared PHP session ID or unlock server-side session state.
- `-stats -si 2` exposes the plateau but does not alter execution.
- `-no-interactsh` rules out waiting for out-of-band callbacks in that run, but not target-side session locking.
- `-id allnet-default-login ...` narrows the catalog, but a request still receives the shared authenticated session. Reaching `2/2` means request accounting finished; it does not prove every execution/finalization goroutine exited.
- `-etags headless,fuzz,code` is a tag filter, not a protocol filter. It does not exclude JavaScript unless a template actually carries one of those tags. Nuclei provides `-ept javascript` / `-exclude-type javascript` for protocol filtering. [ProjectDiscovery running/CLI reference](https://docs.projectdiscovery.io/opensource/nuclei/running)
- `-c 5 -bs 2` still allows several requests to share one session concurrently.
- `-rl 15` limits request start rate, not simultaneous session use after requests begin.
- `-timeout 10` limits Nuclei's wait, not necessarily the lifetime of the PHP process holding the lock.
- `-no-mhe` disables max-host-error protection. For this diagnosis it can make the scan less self-limiting; it should not be part of the mitigation.
- `-hm` / `-hang-monitor` is diagnostic. ProjectDiscovery maintainers describe it as detecting inactivity and warn that slow operations can trigger it; a report is not automatically a deadlock diagnosis. [ProjectDiscovery discussion #4655](https://github.com/projectdiscovery/nuclei/discussions/4655)
- Re-encoding a cookie as a Secret File header changes Nuclei's injection path, not DVWA's session-lock key.

## Decisive local test

Run the same authenticated scan on the updated engine with all relevant worker concurrency reduced to one:

```text
-c 1 -bs 1 -pc 1 -jsc 1 -timeout 10 -retries 0 -no-interactsh -stats -si 2 -hm
```

Keep the same target, Secret File, severity, and template set. Do not add `-no-mhe`.

Interpretation:

- If steady progress resumes and the scan completes, session-lock contention is confirmed as the operational cause.
- If the same one-template reproduction still reaches 100% and never exits on v3.11.0, capture the new v3.11.0 stack dump and resume file. That would isolate a separate current-engine finalization defect suitable for an upstream Nuclei issue.
- If a single worker stalls before request completion, inspect the DVWA web/PHP process and access log to identify the executing URI; the recurring resume IDs should not be assumed to be the holder.

A useful follow-up comparison is the same one-worker command without `-sf`. A large difference is expected because unauthenticated requests do not all reuse the accepted authenticated session identity.

## Safe product mitigations for NullTrace

1. **Require/recommend a supported Nuclei version.** Detect and warn on v3.8.0; v3.11.0 is locally available. This removes known intervening engine bugs even though no release note proves it fixes this exact case.
2. **Use conservative concurrency for authenticated scans by default.** For a single saved session, append or recommend `-c 1 -bs 1 -pc 1 -jsc 1`. This sacrifices speed but respects session-serialized targets. Do not silently override an explicit operator choice without showing the effective policy.
3. **Keep exact-origin Secret File scoping and cleanup.** Those security properties remain correct and are not implicated by the lock mechanism.
4. **Keep statistics visible and add a no-progress timeout.** On no request-count movement for a defined period, cancel cleanly, report the diagnostic state, and remove the Secret File. Do not claim that the stalled in-flight IDs caused the stall.
5. **Do not automatically disable max-host-error handling.** `-no-mhe` removes a safety valve.
6. **Treat broad authenticated catalog scans as higher risk.** Default templates include intrusive and state-changing probes; authentication gives them access to more application code. Offer smaller protocol/severity/template profiles before a full authenticated catalog run.

The target-side alternative is to change DVWA/PHP to release the session lock early or use a concurrency-capable session backend. That is unsuitable as a general NullTrace assumption and changes the system being tested.

## What is not verified

- The exact DVWA request that held the session lock in either reported run was not captured.
- A controlled full-catalog authenticated A/B run using v3.11.0 with concurrency 1 versus higher concurrency was not performed as part of this research. Focused v3.11.0 runs of the five recurring IDs did complete.
- No upstream Nuclei issue matching the exact v3.8.0 stack and DVWA reproduction was found.
- It is not proven that the v3.8.0 expression changes contributed to the hang; this remains a secondary hypothesis.
- The five recurring template IDs are not proven causes; evidence supports treating them as blocked/in-flight work.
- This report did not inspect or record any authorization value.
