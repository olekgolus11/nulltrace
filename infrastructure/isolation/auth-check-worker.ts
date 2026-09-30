import { readFileSync } from "node:fs";
import {
  createAuthCheckWorkerProxyFetch,
  getAuthCheckWorkerProxyUrl,
  parseAuthCheckWorkerConfiguration,
  runAuthCheckWorker,
} from "./auth-check-worker.helpers";

const inputPath = "/work/input-auth-check-config";
let input: Buffer | null = null;
try {
  if (Bun.argv.length !== 2 || Bun.argv[1] !== "/opt/nulltrace/workers/auth-check-worker.js") {
    throw new Error("Invalid worker invocation.");
  }
  if (Bun.file(inputPath).size > 128 * 1024) throw new Error("Invalid worker input.");
  input = readFileSync(inputPath);
  const configuration = parseAuthCheckWorkerConfiguration(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)),
  );
  const proxyUrl = getAuthCheckWorkerProxyUrl(process.env);
  const result = await runAuthCheckWorker(configuration, createAuthCheckWorkerProxyFetch(proxyUrl));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch {
  console.error("Auth Check worker failed validation or execution.");
  process.exitCode = 2;
} finally {
  input?.fill(0);
}
