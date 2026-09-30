import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CurlWorkerConfiguration } from "./curl-worker.types";
import {
  formatCurlWorkerUrl,
  quoteCurlConfigValue,
  readCurlWorkerFile,
  readCurlWorkerLocation,
  readCurlWorkerStream,
  redactCurlWorkerHeaders,
  redactCurlWorkerOutput,
} from "./curl-worker.helpers";

export class CurlWorkerService {
  constructor(
    private readonly directory = "/work",
    private readonly environment?: Record<string, string>,
  ) {}

  async run(config: CurlWorkerConfiguration): Promise<void> {
    const directory = this.directory;
    const startedAt = performance.now();
    let url = config.targetUrl;
    let method = config.method;
    let bodyOperations = config.bodyOperations;
    const initialUrl = new URL(config.targetUrl);
    const previousQueryValues = [...initialUrl.searchParams.values(), ...initialUrl.search.slice(1).split("&").map((part) => part.slice(part.indexOf("=") + 1)).filter(Boolean)];
    for (let redirectCount = 0; ; redirectCount += 1) {
      const remainingSeconds = config.timeoutSeconds - (performance.now() - startedAt) / 1000;
      if (remainingSeconds <= 0) throw new Error("cURL request timed out.");
      const headerPath = join(directory, `curl-response-${redirectCount}.headers`);
      const responsePath = join(directory, `curl-response-${redirectCount}.body`);
      const requestConfigPath = join(directory, `curl-request-${redirectCount}.conf`);
      const curlConfig = [
        `url = ${quoteCurlConfigValue(url)}`,
        `request = ${quoteCurlConfigValue(method)}`,
        ...(method === "HEAD" ? ["head"] : []),
        ...config.headers.map((header) => `header = ${quoteCurlConfigValue(header)}`),
        ...bodyOperations.map((operation) => `${operation.kind} = ${quoteCurlConfigValue(operation.value)}`),
      ].join("\n") + "\n";
      writeFileSync(requestConfigPath, curlConfig, { mode: 0o600, flag: "wx" });
      const args = [
        "--disable", "--globoff", "--silent", "--show-error",
        "--max-redirs", "0", "--max-filesize", String(config.maximumResponseBytes),
        "--connect-timeout", String(Math.min(remainingSeconds, 10)), "--max-time", String(remainingSeconds),
        "--dump-header", headerPath, "--output", responsePath,
        "--write-out", "%{http_code}\t%{time_total}\t%{url_effective}", "--config", requestConfigPath,
      ];
      try {
        const child = Bun.spawn({ cmd: ["curl", ...args], stdin: "ignore", stdout: "pipe", stderr: "pipe", env: this.environment });
        let fileLimitExceeded = false;
        const fileMonitor = setInterval(() => {
          if (Bun.file(headerPath).size > 64 * 1024 || Bun.file(responsePath).size > config.maximumResponseBytes) {
            fileLimitExceeded = true;
            child.kill("SIGKILL");
          }
        }, 20);
        const [stdout, stderr, exitCode] = await Promise.all([
          readCurlWorkerStream(child.stdout, 8192, () => child.kill("SIGKILL")),
          readCurlWorkerStream(child.stderr, 8192, () => child.kill("SIGKILL")),
          child.exited,
        ]).finally(() => clearInterval(fileMonitor));
        if (fileLimitExceeded) throw new Error("cURL response exceeded its size limit.");
        const [statusText = "000", elapsed = "0", effectiveUrl = url] = stdout.split("\t");
        const status = Number.parseInt(statusText, 10);
        const responseHeaders = existsSync(headerPath) ? readCurlWorkerFile(headerPath, 64 * 1024).toString("utf8") : "";
        const responseBody = existsSync(responsePath) ? readCurlWorkerFile(responsePath, config.maximumResponseBytes) : Buffer.alloc(0);
        const location = readCurlWorkerLocation(responseHeaders);
        const outputConfiguration = { ...config, targetUrl: url };
        if (![301, 302, 303, 307, 308].includes(status) || !location) {
          if (responseHeaders.trim()) console.log(redactCurlWorkerOutput(redactCurlWorkerHeaders(responseHeaders, config.exactOrigin), outputConfiguration, previousQueryValues));
          if (responseBody.length && method !== "HEAD") console.log(redactCurlWorkerOutput(responseBody.toString("utf8"), outputConfiguration, previousQueryValues));
          console.log(`[http ${statusText}] ${elapsed}s ${formatCurlWorkerUrl(effectiveUrl)}`);
          if (stderr.trim()) console.error(redactCurlWorkerOutput(stderr.trim(), outputConfiguration, previousQueryValues));
          if (exitCode !== 0) process.exitCode = exitCode;
          return;
        }
        if (redirectCount >= config.maximumRedirectCount) throw new Error(`cURL redirect limit exceeded (${config.maximumRedirectCount}).`);
        const nextUrl = new URL(location, url);
        if (nextUrl.origin !== config.exactOrigin) throw new Error("cURL refused a redirect outside the approved exact origin.");
        previousQueryValues.push(
          ...nextUrl.searchParams.values(),
          ...nextUrl.search.slice(1).split("&").map((part) => part.slice(part.indexOf("=") + 1)).filter(Boolean),
        );
        if ([301, 302, 303].includes(status) && method !== "GET" && method !== "HEAD") {
          method = "GET";
          bodyOperations = [];
        }
        url = nextUrl.toString();
      } finally {
        rmSync(headerPath, { force: true });
        rmSync(responsePath, { force: true });
        rmSync(requestConfigPath, { force: true });
      }
    }
  }
}
