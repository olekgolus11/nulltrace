import { readFileSync } from "node:fs";
import { parseCurlWorkerConfiguration } from "./curl-worker.helpers";
import { CurlWorkerService } from "./curl-worker.service";

const inputPath = "/work/input-curl-config";
let input: Buffer | null = null;
try {
  if (Bun.argv.length !== 2 || Bun.argv[1] !== "/opt/nulltrace/workers/curl-worker.ts") {
    throw new Error("Invalid cURL worker invocation.");
  }
  if (Bun.file(inputPath).size > 2 * 1024 * 1024) throw new Error("cURL request configuration exceeded its limit.");
  input = readFileSync(inputPath);
  const config = parseCurlWorkerConfiguration(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input)));
  await new CurlWorkerService().run(config);
} catch {
  console.error("cURL worker failed validation or execution.");
  process.exitCode = 2;
} finally {
  input?.fill(0);
}
