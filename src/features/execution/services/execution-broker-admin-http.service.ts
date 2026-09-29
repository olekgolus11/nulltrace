import { createHash, timingSafeEqual } from "node:crypto";
import { ExecutionPrincipal } from "../types/execution-broker.types";
import { ExecutionAuthorizationLedgerRepository } from "./execution-authorization-ledger.repository";
import { requireExecutionRecord } from "./execution-validation.helpers";

/** Grant issuance is served on a separate administrator socket, never the execution bearer socket. */
export class ExecutionBrokerAdminHttpService {
  private readonly tokenDigest: Buffer;
  private closing = false;
  private activeRequests = 0;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly ledger: ExecutionAuthorizationLedgerRepository, token: string) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid broker administrator credential.");
    this.tokenDigest = createHash("sha256").update(token).digest();
  }

  beginShutdown(): void { this.closing = true; }

  waitForIdle(): Promise<void> {
    if (this.activeRequests === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  async handle(request: Request): Promise<Response> {
    if (this.closing) return this.error(503, "UNAVAILABLE");
    this.activeRequests += 1;
    try {
      return await this.handleRequest(request);
    } finally {
      this.activeRequests -= 1;
      if (this.activeRequests === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  private async handleRequest(request: Request): Promise<Response> {
    if (!this.authenticate(request)) return this.error(401, "UNAUTHORIZED");
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/v1/grants" || url.search ||
      request.headers.get("content-type") !== "application/json") return this.error(400, "INVALID_REQUEST");
    let bytes: Uint8Array | undefined;
    try {
      bytes = await this.readBody(request);
      const payload: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      const value = requireExecutionRecord(payload, ["principal", "plan", "expiresAt"]);
      const principalValue = requireExecutionRecord(value.principal, ["installationId", "instanceId"]);
      if (typeof principalValue.installationId !== "string" || typeof principalValue.instanceId !== "string" ||
        !/^[A-Za-z0-9_-]{1,96}$/.test(principalValue.installationId) || !/^[A-Za-z0-9_-]{1,96}$/.test(principalValue.instanceId) ||
        typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)) return this.error(400, "INVALID_REQUEST");
      const principal: ExecutionPrincipal = {
        installationId: principalValue.installationId,
        instanceId: principalValue.instanceId,
      };
      if (!this.ledger.issue(principal, value.plan, value.expiresAt)) return this.error(409, "CONFLICT");
      return Response.json({ status: "issued" }, { status: 201 });
    } catch {
      return this.error(400, "INVALID_REQUEST");
    } finally {
      bytes?.fill(0);
    }
  }

  private authenticate(request: Request): boolean {
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization)) return false;
    const digest = createHash("sha256").update(authorization.slice(7)).digest();
    return timingSafeEqual(digest, this.tokenDigest);
  }

  private async readBody(request: Request): Promise<Uint8Array> {
    if (request.signal.aborted) throw new Error("Request body interrupted.");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    let finished = false;
    let interrupted = false;
    const interrupt = () => { interrupted = true; void reader.cancel().catch(() => {}); };
    const timer = setTimeout(interrupt, 5_000);
    request.signal.addEventListener("abort", interrupt, { once: true });
    try {
      while (true) {
        const part = await reader.read();
        if (interrupted || request.signal.aborted) throw new Error("Request body interrupted.");
        if (part.done) { finished = true; break; }
        size += part.value.byteLength;
        if (size > 65_536) throw new Error("Request body exceeded its limit.");
        chunks.push(part.value);
      }
      if (!size) throw new Error("Missing request body.");
      return Uint8Array.from(Buffer.concat(chunks, size));
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", interrupt);
      if (!finished) await reader.cancel().catch(() => {});
      chunks.forEach((chunk) => chunk.fill(0));
      reader.releaseLock();
    }
  }

  private error(status: number, code: string): Response { return Response.json({ error: code }, { status }); }
}
