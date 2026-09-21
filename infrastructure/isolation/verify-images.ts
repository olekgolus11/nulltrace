import { createHash, randomUUID } from "node:crypto";
import { createIsolationBuildArguments } from "./isolation-build.helpers";
import { parseDatasetCatalog } from "../../src/features/execution/services/dataset-catalog.helpers";
import release from "./release.lock.json";

const platform = Bun.argv[2];
if (!platform || Bun.argv.length !== 3) throw new Error("Usage: bun run infrastructure/isolation/verify-images.ts <linux/arm64|linux/amd64>");
createIsolationBuildArguments("tools", platform);
const architecture = platform.split("/")[1]!;
const evidence: Record<string, unknown> = { platform, release: release.resolvedAt, checkedAt: new Date().toISOString(), images: {} };
const images: Record<string, unknown> = {};
const lockHash = createHash("sha256").update(Buffer.from(await Bun.file(new URL("./release.lock.json", import.meta.url)).arrayBuffer())).digest("hex");
evidence.releaseLockSha256 = lockHash;
evidence.runtime = JSON.parse(await docker(["info", "--format", '{"engine":{{json .ServerVersion}},"kernel":{{json .KernelVersion}},"os":{{json .OperatingSystem}}}']));
for (const target of ["tools", "proxy", "network-init", "datasets", "browser", "chat"]) {
  const tag = `nulltrace-isolation-${target}:${release.resolvedAt}-${architecture}`;
  const id = (await docker(["image", "inspect", tag, "--format", "{{.Id}}"])).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("Missing immutable local image ID.");
  const installedPlatform = (await docker(["image", "inspect", id, "--format", "{{.Os}}/{{.Architecture}}"])).trim();
  if (installedPlatform !== platform) throw new Error("Image architecture mismatch.");
  const user = (await docker(["image", "inspect", id, "--format", "{{.Config.User}}"])).trim();
  if (user !== "65532:65532") throw new Error("Image user is not restricted.");
  await run(id, ["sh", "-c", "test \"$(id -u)\" = 65532 && test ! -e /var/run/docker.sock && ! touch /opt/nulltrace/provenance/write-probe && touch /work/write-probe"]);
  const installedLockHash = (await run(id, ["sha256sum", "/opt/nulltrace/provenance/release.lock.json"])).split(" ")[0];
  if (installedLockHash !== lockHash) throw new Error("Image release manifest mismatch.");
  const versions: Record<string, string> = {};
  const commands = target === "tools"
    ? [["bun", "--version"], ["curl", "--version"], ["ffuf", "-V"], ["nmap", "--version"], ["nuclei", "-version"], ["nikto", "-Version"], ["sqlmap", "--version"]]
    : target === "proxy" ? [["squid", "-v"]]
      : target === "network-init" ? [["nft", "--version"], ["ip", "-Version"]]
        : target === "chat" ? [["opencode", "--version"]]
          : target === "browser" ? [["bun", "--version"], ["bun", "-e", "const { chromium } = require('/opt/nulltrace/browser/node_modules/playwright'); if (!require('fs').existsSync(chromium.executablePath())) process.exit(1); console.log(require('/opt/nulltrace/browser/node_modules/playwright/package.json').version);"]]
            : [];
  for (const command of commands) {
    const key = target === "browser" && command[1] === "-e" ? "playwright" : command[0]!;
    versions[key] = (await run(id, command)).replace(/\x1b\[[0-9;]*m/g, "").trim();
  }
  if (target === "datasets") {
    const revisions = { seclists: release.datasets.seclists.revision, "nuclei-templates": release.datasets["nuclei-templates"].revision };
    for (const dataset of ["seclists", "nuclei-templates"] as const) {
      const raw = await run(id, ["cat", `/opt/nulltrace/catalogs/${dataset}/catalog.json`]);
      const catalog = parseDatasetCatalog(JSON.parse(raw), revisions);
      if (!catalog.entries.length) throw new Error("Empty installed catalog.");
      versions[dataset] = `${catalog.revision}: ${catalog.entries.length} files; catalog sha256 ${createHash("sha256").update(raw).digest("hex")}`;
      const first = catalog.entries[0]!;
      const path = `/opt/nulltrace/catalogs/${dataset}/files/${first.path}`;
      const checksum = (await run(id, ["sha256sum", path])).split(" ")[0];
      if (checksum !== first.sha256) throw new Error("Installed dataset content mismatch.");
      await run(id, ["sh", "-c", '! touch "$1"', "probe", path]);
    }
  }
  if (target === "tools" && (!versions.bun?.includes(release.images.bun.version) ||
    !versions.ffuf?.includes(release.ffuf.version) || !versions.nuclei?.includes(release.images.nuclei.version.slice(1)))) {
    throw new Error("Bundled scanner version mismatch.");
  }
  if (target === "browser" && (versions.playwright !== release.images.browser.version || versions.bun !== release.images.bun.version)) throw new Error("Browser package mismatch.");
  if (target === "chat" && !versions.opencode?.includes(release.opencode.version)) throw new Error("Chat runtime mismatch.");
  const packages = target === "datasets" || target === "chat" ? "" : await run(id, ["cat", "/opt/nulltrace/provenance/packages.tsv"]);
  for (const [name, expected] of Object.entries(release.packages)) {
    const installed = packages.split("\n").find((line) => line.split("\t")[0]?.split(":")[0] === name)?.split("\t")[1];
    if (installed && target !== "browser" && architecture === "arm64" && installed !== expected) throw new Error(`Pinned package mismatch: ${name}`);
  }
  images[target] = { id, platform: installedPlatform, user, versions, packages };
}
evidence.images = images;
await Bun.write(new URL(`./build-evidence-${architecture}.json`, import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
console.log(`Verified ${Object.keys(images).length} images on ${platform}.`);

async function run(image: string, command: string[]): Promise<string> {
  const name = `nulltrace-image-check-${randomUUID()}`;
  try {
    return await docker([
      "run", "--rm", "--platform", platform!, "--name", name, "--network", "none", "--read-only", "--cap-drop", "ALL",
      "--security-opt", "no-new-privileges", "--memory", "512m", "--cpus", "1", "--pids-limit", "64",
      "--tmpfs", "/work:rw,noexec,nosuid,nodev,size=64m,uid=65532,gid=65532",
      "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,mode=1777", image, ...command,
    ]);
  } finally { await docker(["rm", "-f", name], true); }
}

async function docker(args: string[], allowFailure = false): Promise<string> {
  const child = Bun.spawn(["docker", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
  try {
    const [stdout, stderr, status] = await Promise.all([bounded(child.stdout), bounded(child.stderr), child.exited]);
    if (status !== 0 && !allowFailure) throw new Error(`Image check failed (${args[0]}): ${stderr.slice(0, 1000)}`);
    return stdout || stderr;
  } finally { clearTimeout(timer); }
}

async function bounded(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error("Image check output limit exceeded.");
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
