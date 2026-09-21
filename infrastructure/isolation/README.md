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
| `tools` | Bun, cURL, ffuf, Nmap, Nuclei, Nikto, sqlmap, zsh; scanner sources and license notices | 65532:65532 |
| `proxy` | Squid and package/license inventory | 65532:65532 |
| `network-init` | nftables and iproute2; no active firewall policy | 65532:65532 |
| `datasets` | Complete pinned SecLists and official Nuclei-template archives as regular files, plus catalogs | 65532:65532 |
| `browser` | Matching Playwright package and official browser image, Bun | 65532:65532 |
| `chat` | Pinned OpenCode binary; no provider credentials or inherited app configuration | 65532:65532 |

The network initializer's eventual short-lived administrative role is owned by F2, not by an image default. Images contain no Docker socket, added capabilities or production entrypoint that starts network activity. A default nonroot image user is not independently sufficient isolation: broker-owned runtime configuration must enforce it.

The tools image preserves an installed shell for future explicitly isolated edited-command profiles. It does not expose a host shell or interpret operator data as Docker arguments. Individual migrations still own supported command flags, fixed executable paths, update-disable options, authentication preparation and artifact compatibility. No tool migration or approval workflow changes are included here.

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

Docker Desktop, Linux AMD64 execution, Chromium sandbox launch, exact-origin proxy/firewall enforcement, scanner target behavior, credential delivery, lifecycle cleanup and application-result integration require their respective later tasks. The existing application's unisolated paths remain unchanged. These images alone do not prevent target traffic outside scope; the verifier's `--network none` establishes only the deliberately offline image smoke-test environment.


## Recorded validation

- 19 focused catalog/build tests passed, including real hostile tar archives (traversal, absolute paths, symlinks, hardlinks, duplicate entries and bad checksum).
- `bun test`: 642 passed, 0 failed, across 97 files.
- `bunx tsc --noEmit` and `git diff --check`: passed.
- Six native ARM64 images built and passed the offline verifier on OrbStack. See [the recorded evidence](evidence/orbstack-arm64.json).
- The existing Nikto authentication-selection unit test now stubs its runner instead of launching an installed scanner. This removes the earlier host-dependent timeout without changing application behavior.
