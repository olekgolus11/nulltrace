import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createIsolationBuildArguments } from "./isolation-build.helpers";
import release from "./release.lock.json";

const [target, platform] = Bun.argv.slice(2);
if (!target || !platform || Bun.argv.length !== 4) {
  throw new Error("Usage: bun run infrastructure/isolation/build-images.ts <tools|proxy|network-init|datasets|browser|chat> <linux/arm64|linux/amd64>");
}
const args = createIsolationBuildArguments(target, platform);
if (target === "datasets" || target === "tools") {
  const directory = fileURLToPath(new URL("./archives/", import.meta.url));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const [id, dataset] of Object.entries(target === "datasets" ? release.datasets : release.sources)) {
    if (!/^[a-f0-9]{40}$/.test(dataset.revision) || !/^[a-f0-9]{64}$/.test(dataset.sha256)) throw new Error("Unpinned dataset.");
    const path = `${directory}${id}.tar.gz`;
    if (await Bun.file(path).exists()) {
      if (await hashFile(path) !== dataset.sha256) throw new Error("Cached dataset checksum mismatch; remove the archive before retrying.");
      continue;
    }
    const pending = `${path}.part`;
    try {
      const response = await fetch(`https://codeload.github.com/${dataset.repository}/tar.gz/${dataset.revision}`, { signal: AbortSignal.timeout(600_000) });
      if (!response.ok || !response.body) throw new Error("Dataset download failed.");
      const output = Bun.file(pending).writer();
      let size = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          size += chunk.byteLength;
          if (size > 2 * 1024 ** 3) throw new Error("Dataset download exceeded the limit.");
          output.write(chunk);
          await output.flush();
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
        await output.end();
      }
      if (await hashFile(pending) !== dataset.sha256) throw new Error("Downloaded dataset checksum mismatch.");
      await rename(pending, path);
    } finally { await rm(pending, { force: true }); }
  }
}
const child = Bun.spawn(["docker", ...args], { stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const timer = setTimeout(() => child.kill("SIGTERM"), 30 * 60_000);
try {
  if (await child.exited !== 0) throw new Error("Isolation image build failed.");
} finally { clearTimeout(timer); }

async function hashFile(path: string): Promise<string> {
  if (Bun.file(path).size > 2 * 1024 ** 3) throw new Error("Dataset archive exceeds the limit.");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
