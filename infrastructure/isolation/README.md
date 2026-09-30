# Pinned isolation images and installed catalogs

Build foundation for [#158](https://github.com/olekgolus11/nulltrace/issues/158). This supplies images and catalog validation for the staged broker migrations. It does not change existing scanner execution or activate isolation in NullTrace.

## Build and verify

Requirements: Bun, Docker with BuildKit, and access to the official build sources. Python 3 is required on the host only for archive-extraction tests; production extraction runs in the pinned Debian build stage. No runtime component needs a host Python installation.

```sh
for target in tools proxy network-init datasets browser chat; do
  bun run infrastructure/isolation/build-images.ts "$target" linux/arm64
done
bun run infrastructure/isolation/verify-images.ts linux/arm64
```

Use `linux/amd64` for the alternative build architecture. Qualification results are recorded separately; a valid manifest entry is not a successful runtime test. The build script accepts only these fixed target/platform choices. The isolated build context contains no application database, home directory, credentials, application source or node_modules. Downloaded archives and local verification evidence are ignored by Git.

`release.lock.json` pins official base-image manifest digests, Bun, matching Playwright package/browser versions, Nuclei, ffuf and OpenCode binaries, scanner source revisions, Debian repository snapshot and dataset archive hashes. Debian packages and their dependencies resolve only against the fixed signed snapshot. The `packages` inventory records ARM64 package expectations, not a portable list of amd64 package versions. Verification checks matching installed packages and records full package inventories. Source scanner archives are validated and extracted without running repository hooks.

The native verifier uses immutable local image IDs, not mutable tags. It starts disposable containers with no network, no capabilities, `no-new-privileges`, a read-only root, bounded memory/CPU/PIDs and private temporary storage. It checks image architecture and nonroot user, tool versions, browser executable presence, forbidden writes, catalog structure and sampled file hashes. It removes only containers named for that verification run. Browser launch/sandboxing, authenticated traffic and scanner behavior against a target are deliberately not asserted by this image test.

## Images

| Target | Contents | Default user |
| --- | --- | --- |
| `tools` | Bun, cURL, ffuf, Nmap, Nuclei, Nikto, sqlmap, zsh; fixed public cURL worker, scanner sources and license notices | 65532:65532 |
| `proxy` | Squid and package/license inventory | 65532:65532 |
| `network-init` | nftables and iproute2; no active firewall policy | 65532:65532 |
| `datasets` | Complete pinned SecLists and official Nuclei-template archives as regular files, plus catalogs | 65532:65532 |
| `browser` | Matching Playwright package and official browser image, Bun | 65532:65532 |
| `chat` | Pinned OpenCode binary; no provider credentials or inherited app configuration | 65532:65532 |

The network initializer's eventual short-lived administrative role is owned by F2, not by an image default. Images contain no Docker socket, added capabilities or production entrypoint that starts network activity. A default nonroot image user is not independently sufficient isolation: broker-owned runtime configuration must enforce it.

The tools image preserves an installed shell for future explicitly isolated edited-command profiles. It does not expose a host shell or interpret operator data as Docker arguments. The public cURL worker is a fixed installed entrypoint behind a separate broker profile; its URL, method, headers and ordered inline body operations arrive through one declared private tmpfs input. The legacy public GET-only profile is unchanged. The TUI now submits public cURL through the broker; authenticated cURL remains unsupported in this slice.

## Public cURL application prerequisite

Before using public cURL from the TUI, a trusted installer must provision and start the dedicated execution broker. The app does not launch a broker or synthesize daemon policy. Its only setting is the path to the existing broker-owned directory:

```sh
export NULLTRACE_EXECUTION_BROKER_DIR="/absolute/path/to/private/broker-directory"
bun run infrastructure/isolation/run-broker.ts "$NULLTRACE_EXECUTION_BROKER_DIR"
```

The directory must be owned by the current user with mode `0700`, contain the trusted six-field `broker-daemon.json`, `client.token`, `admin.token`, `broker.key` and provisioned receipt journal, and use `0600` for each file. The broker process must remain running while the TUI submits requests. The manifest must come from trusted installation tooling and pin the immutable tools, proxy and network-initializer image IDs; do not create it from operator or model input. The app validates only its local client identity and socket tokens and never loads the daemon HMAC key or Docker policy. Same-user processes on macOS share access to these files and the desktop engine socket, so this is not a separate OS-user security boundary.

The repository currently has no end-user broker installation command that writes the daemon manifest and starts the service. This section describes the interface required by packaging/install tooling; it does not make a manually created directory trusted or provide a supported end-user installation workflow. If no installer has supplied the broker directory, cURL fails with setup guidance and does not run through the host shell. The authentication toggle remains unchanged, and authenticated cURL reports that it is not available with the public worker.

## Catalog trust boundary

The builder verifies the archive checksum before extraction, rejects links, special files, absolute/traversing/duplicate paths, and bounds member count, member size, total expanded size and catalog size. Dataset files are root-owned 0444 and directories 0555; source-code executable bits are preserved only for scanner source collections. Both archives and file inventories remain attributable to immutable upstream revisions. Original license/notice files stay inside their source trees.

Each catalog entry contains an opaque SHA-256 ID derived from its revision and relative path, content SHA-256 and byte size. `DatasetCatalogService` accepts only the installed dataset revision and entry ID. It derives a fixed sandbox path under `/opt/nulltrace/catalogs`, rejects host paths and mismatched revisions, and snapshots entries so the caller cannot mutate their paths afterward. It has no import/update operation. Load catalog JSON from trusted immutable infrastructure with an 8 MiB read limit before parsing; do not accept a model-supplied catalog.

F2 and the ffuf/Nuclei migrations must deliver selected immutable catalogs/files from the pinned data image through broker-controlled read-only storage. No operator-provided bind mount is introduced here. Filesystem modes protect immutable image-owned data, while the independent read-only mount/root and network policy prevent updates and alternate downloads during execution. Those runtime policies are not implemented by this foundation.

## Provenance, maintenance and licenses

Pins were resolved on 2026-09-21. SecLists and Nuclei templates use the upstream HEAD revisions observed on that date; they are not downloaded as mutable `latest` during execution. Updating a release is a reviewed lock change followed by image rebuild and qualification. An unavailable pinned source or checksum mismatch fails the build. There is no fallback to an unpinned source or host executable.

Copied Bun, Nuclei and OpenCode license files are checked in and hashed in the lock. ffuf's release archive supplies its LICENSE. Debian-installed package notices remain under `/usr/share/doc/*/copyright`; the browser image and npm packages retain their upstream notices. Scanner sources and datasets retain their original license files, including third-party notices. These inventories are not a declaration that all components share the application's license. Redistribution of the final combined product must preserve applicable source/notice obligations; [Nmap's license](https://nmap.org/npsl/) and the license notices shipped with Nikto's databases require explicit release review.

Sources:
- [Docker digest pinning](https://docs.docker.com/build/building/best-practices/) explains why tags alone do not fix image contents.
- [Playwright Docker guidance](https://playwright.dev/docs/docker) requires matching package/browser image versions and separate sandbox qualification for untrusted pages.
- [Debian snapshots](https://snapshot.debian.org/) supply fixed repository states; archive signature verification remains enabled while only expired `Valid-Until` checks are disabled for historical snapshots.
- [SecLists](https://github.com/danielmiessler/SecLists), [Nuclei templates](https://github.com/projectdiscovery/nuclei-templates), [ffuf releases](https://github.com/ffuf/ffuf/releases), [Nikto](https://github.com/sullo/nikto), [sqlmap](https://github.com/sqlmapproject/sqlmap), and [OpenCode releases](https://github.com/anomalyco/opencode/releases) supply the recorded release artifacts.

## Qualification boundaries

The checked-in evidence records the tested OrbStack/Linux ARM64 images, versions, local content IDs and package inventories. Local image IDs are immutable engine content identifiers; they are not published registry manifest digests. Registry publication, attestations/signing and final release digest promotion belong to packaging qualification. Base image digests and upstream archive hashes are already fixed.

Docker Desktop, Linux AMD64 execution, Chromium sandbox launch, authenticated credential delivery for other tools, and production broker installation remain later work. Public cURL application routing, redacted run history/output summaries, redirect denial, missing-broker fail-closed behavior and confirmed cancellation are qualified separately below. Other tools' existing unisolated paths remain unchanged. These images alone do not prevent target traffic outside scope; the verifier's `--network none` establishes only the deliberately offline image smoke-test environment.


## Recorded validation

- 19 focused catalog/build tests passed, including real hostile tar archives (traversal, absolute paths, symlinks, hardlinks, duplicate entries and bad checksum).
- `bun test`: 642 passed, 0 failed, across 97 files.
- `bunx tsc --noEmit` and `git diff --check`: passed.
- Six native ARM64 images built and passed the offline verifier on OrbStack. See [the recorded evidence](evidence/orbstack-arm64.json).
- The existing Nikto authentication-selection unit test now stubs its runner instead of launching an installed scanner. This removes the earlier host-dependent timeout without changing application behavior.

## Public cURL application qualification

The public cURL worker is exercised through the registered tool, `ToolRunnerService`, the real session repository and a separate broker daemon. The OrbStack ARM64 check verifies the approved POST reaches its receiver with its query, header and body intact; persisted command/log/output-summary data redact canaries; a missing broker produces setup guidance without a host-runner call; a redirect reaches only its first approved endpoint; cancellation confirms cleanup; and no installation-owned containers or networks remain. Authenticated cURL remains unsupported. See [the recorded application evidence](evidence/orbstack-curl-application-arm64.json).

Run it after building and qualifying the three worker/network images:

```sh
TMPDIR=/tmp bun run infrastructure/isolation/qualify-curl-application.ts
```

The short temporary directory keeps macOS Unix-socket paths within the broker's fixed platform limit. The qualifier uses a numeric controlled host address for the target because trusted address mappings constrain resolution results; they do not override host DNS.

## HTTP network qualification

After building the `tools`, `proxy` and `network-init` images, run the receiver-side HTTP containment checks with:

```sh
TMPDIR=/tmp bun run infrastructure/isolation/qualify-http-network.ts linux/arm64
```

The test uses controlled host receivers and verifies allowed delivery, blocked cross-origin redirects, blocked direct proxy bypass, blocked worker DNS and blocked unauthorized IPv6. See [the network design](../../docs/design/http-execution-network.md) for the boundary and platform limits.

The broker socket check also uploads a random secret slot through the authenticated `/v1/input` request and starts the supervised worker only after sealing. The worker reads `/work/input-auth` from its private tmpfs, verifies its mode, and sends the value as an Authorization header to the controlled approved receiver. The receiver compares the value with an in-memory canary and records only a boolean; the URL, headers, body and canary are excluded from the access log and evidence. Qualification scans broker host files for the random input bytes and checks that installation-labeled containers and networks are absent after completion. This validates the generic input transport path on OrbStack ARM64; TUI use of secret slots and authenticated tools remains future work.
