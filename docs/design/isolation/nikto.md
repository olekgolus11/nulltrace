# Nikto migration

Status: selected under delegated planning. [Decision](https://github.com/olekgolus11/nulltrace/issues/150).

## Preserve

Baseline modules: nikto-command.service.ts, nikto-command.helpers.ts, nikto-authenticated-command.helpers.ts, nikto-base-config.helpers.ts, authenticated-run service/helpers and JSON tests. Keep Standard with -Tuning x6, Custom guided codes 2/3/6/b, default Custom 2/3/b, root path and vhost, and the existing additional disruptive confirmation for code 6. Preserve mutate/mutate-options/evasion prohibitions, direct-auth/config restrictions and command editing. Bind disruptive confirmation to the same immutable parsed command/profile used for launch; edited tuning cannot reuse an earlier acknowledgement.

Keep maximum scan duration 300 seconds default/900 maximum; Custom request timeout 10 default/60 maximum and pause 0..10 seconds. Apply independent broker deadlines even on paths without persisted tool-run IDs. Preserve nikto_report, Standard/Custom labels, malformed/empty/missing-report diagnostics, Findings and no ordinary cancelled-run Findings.

## Adapter and isolation

Tokenize accepted simple commands and compile a structured target/profile/tuning plan, then argv. Existing validation is not complete target-scope authorization. Explicitly authorize the effective destination and vhost intent from the approved snapshot, preserving the existing vhost field without letting it select a second upstream network destination. HTTP Host and HTTPS SNI can differ from dialed IP; qualify the pinned Nikto behavior and report incompatibility instead of silently stripping vhost. Authenticated mode retains stricter origin/vhost checks.

Generate a bounded fixed-base Nikto configuration inside the image/run. Merge trusted proxy settings and per-run credential settings without reading host-installed Nikto config. Use private files for cookies/headers/Basic authorization; do not translate them to -id or environment values. Preserve current supported authentication representation; unsupported values fail clearly. Fixed proxy host/port and -useproxy are infrastructure controls, not operator-supplied destinations. Pin upstream databases/plugins at build; no update/version-check/telemetry exception at runtime.

Run non-root with no capabilities under the HTTP profile. Egress restricts worker to proxy and proxy to approved target tuples. External redirects are denied regardless of library behavior. Private JSON scratch is sanitized before import; handle both output-prefix and .json filename behavior without arbitrary file export. Sandbox writes never target the application artifact directory. Preserve raw-evidence policy without adding a plaintext preservation path.

## Acceptance

Run Standard and each Custom tuning combination, including a controlled harmless fixture for confirmation of disruptive mode; never aim it at third-party services. Verify request pause/timeout and whole-run deadlines, root path/vhost/Host/SNI behavior, public/authenticated response mapping and the separate confirmation race. Verify restricted options remain rejected and custom proxy/config cannot bypass the firewall.

A succeeds; external redirect B sees zero, with direct IPv4/IPv6/DNS attempts independently blocked. Test networked plugins and startup/update attempts. Synthetic credentials are absent from command, argv/env, base/generated config diagnostics, runtime/proxy logs and JSON. Test missing/truncated/malformed/oversized reports, Findings stability, cancellation, context replacement and all-path private-file cleanup. Pinned binary fidelity and measured finite resource budgets gate completion.
