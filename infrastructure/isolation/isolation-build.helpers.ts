import { fileURLToPath } from "node:url";
import release from "./release.lock.json";

export function createIsolationBuildArguments(target: string, platform: string): string[] {
  if (!["tools", "proxy", "network-init", "datasets", "browser", "chat"].includes(target) ||
    (platform !== "linux/arm64" && platform !== "linux/amd64")) {
    throw new Error("Unsupported isolation image target or platform.");
  }
  const architecture = platform === "linux/arm64" ? "arm64" : "amd64";
  const pins = {
    DEBIAN_IMAGE: release.images.debian.reference,
    BUN_IMAGE: release.images.bun.reference,
    NUCLEI_IMAGE: release.images.nuclei.reference,
    BROWSER_IMAGE: release.images.browser.reference,
  };
  if (Object.values(pins).some((pin) => !/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(pin)) ||
    !/^[0-9]{8}T[0-9]{6}Z$/.test(release.debianSnapshot) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(release.ffuf.version) ||
    !/^[a-f0-9]{64}$/.test(release.ffuf.sha256[architecture]) ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(release.opencode.version) ||
    !/^[a-f0-9]{64}$/.test(release.opencode.sha256[architecture])) {
    throw new Error("Unpinned isolation build input.");
  }
  return [
    "build", "--platform", platform, "--target", target,
    "--tag", `nulltrace-isolation-${target}:${release.resolvedAt}-${architecture}`,
    ...Object.entries(pins).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`]),
    "--build-arg", `DEBIAN_SNAPSHOT=${release.debianSnapshot}`,
    "--build-arg", `FFUF_URL=https://github.com/ffuf/ffuf/releases/download/v${release.ffuf.version}/ffuf_${release.ffuf.version}_linux_${architecture}.tar.gz`,
    "--build-arg", `FFUF_SHA256=${release.ffuf.sha256[architecture]}`,
    "--build-arg", `OPENCODE_URL=https://github.com/anomalyco/opencode/releases/download/v${release.opencode.version}/opencode-linux-${architecture === "amd64" ? "x64" : "arm64"}.tar.gz`,
    "--build-arg", `OPENCODE_SHA256=${release.opencode.sha256[architecture]}`,
    fileURLToPath(new URL(".", import.meta.url)),
  ];
}
