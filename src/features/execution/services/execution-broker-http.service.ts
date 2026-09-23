import { createHash, timingSafeEqual } from "node:crypto";
import { ExecutionBrokerIdentity, ExecutionPrincipal } from "../types/execution-broker.types";
import { ExecutionBrokerError } from "./execution-broker.error";
import { ExecutionBrokerService } from "./execution-broker.service";
import { requireExecutionId, requireExecutionRecord } from "./execution-validation.helpers";

export class ExecutionBrokerHttpService {
  private readonly identities: Array<{ digest: Buffer; principal: ExecutionPrincipal }>;
  private activeRequests = 0;
  private idleWaiters: Array<() => void> = [];
  private closing = false;

  constructor(private readonly broker: ExecutionBrokerService, identities: ExecutionBrokerIdentity[]) {
    if (!identities.length || identities.length > 32 || new Set(identities.map((identity) => identity.token)).size !== identities.length) {
      throw new Error("Invalid broker identities.");
    }
    this.identities = identities.map(({ token, principal }) => {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid broker credential.");
      return {
        digest: createHash("sha256").update(token).digest(),
        principal: {
          installationId: requireExecutionId(principal.installationId),
          instanceId: requireExecutionId(principal.instanceId),
        },
      };
    });
  }

  async handle(request: Request): Promise<Response> {
    if (this.closing) return this.errorResponse(new ExecutionBrokerError("UNAVAILABLE"));
    if (this.activeRequests >= 16) return this.errorResponse(new ExecutionBrokerError("CAPACITY"));
    this.activeRequests += 1;
    try {
      const principal = this.authenticate(request);
      if (request.method !== "POST") throw new ExecutionBrokerError("INVALID_REQUEST");
      const url = new URL(request.url);
      if (url.search) throw new ExecutionBrokerError("INVALID_REQUEST");
      const path = url.pathname;
      const inputMatch = /^\/v1\/input\/([A-Za-z0-9_-]{1,96})\/([A-Za-z0-9_-]{1,96})$/.exec(path);
      if (inputMatch) {
        if (request.headers.get("content-type") !== "application/octet-stream") throw new ExecutionBrokerError("INVALID_REQUEST");
        const [, executionId, slotId] = inputMatch;
        const limit = this.broker.inputLimit(principal, executionId!, slotId!);
        const bytes = await this.readBody(request, Math.min(limit, 8 * 1024 * 1024));
        try {
          return Response.json(await this.broker.putInput(principal, executionId!, slotId!, bytes));
        } finally {
          bytes.fill(0);
        }
      }
      if (!["/v1/prepare", "/v1/get", "/v1/start", "/v1/events", "/v1/cancel", "/v1/renew"].includes(path) || request.headers.get("content-type") !== "application/json") {
        throw new ExecutionBrokerError("INVALID_REQUEST");
      }
      const bytes = await this.readBody(request, 65_536);
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new ExecutionBrokerError("INVALID_REQUEST"); }
      if (path === "/v1/prepare") return Response.json(this.broker.prepare(principal, payload));
      if (path === "/v1/events") {
        const record = requireExecutionRecord(payload, ["executionId", "afterSequence"]);
        if (!Number.isSafeInteger(record.afterSequence) || (record.afterSequence as number) < -1) {
          throw new ExecutionBrokerError("INVALID_REQUEST");
        }
        return Response.json(this.broker.readEvents(principal, requireExecutionId(record.executionId), record.afterSequence as number));
      }
      let executionId: string;
      try { executionId = requireExecutionId(requireExecutionRecord(payload, ["executionId"]).executionId); }
      catch { throw new ExecutionBrokerError("INVALID_REQUEST"); }
      if (path === "/v1/cancel") return Response.json(this.broker.cancel(principal, executionId));
      if (path === "/v1/renew") return Response.json(this.broker.renewOwnership(principal, executionId));
      return Response.json(path === "/v1/get"
        ? this.broker.get(principal, executionId)
        : await this.broker.start(principal, executionId));
    } catch (error) {
      return this.errorResponse(error);
    } finally {
      this.activeRequests -= 1;
      if (this.activeRequests === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
    }
  }

  waitForIdle(): Promise<void> {
    if (this.activeRequests === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  beginShutdown(): void {
    this.closing = true;
  }

  private authenticate(request: Request): ExecutionPrincipal {
    const authorization = request.headers.get("authorization");
    if (!authorization || !/^Bearer [a-f0-9]{64}$/.test(authorization)) throw new ExecutionBrokerError("UNAUTHORIZED");
    const digest = createHash("sha256").update(authorization.slice(7)).digest();
    const identity = this.identities.find((identity) => timingSafeEqual(digest, identity.digest));
    if (!identity) throw new ExecutionBrokerError("UNAUTHORIZED");
    return identity.principal;
  }

  private async readBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
    if (request.signal.aborted) throw new ExecutionBrokerError("INVALID_REQUEST");
    const reader = request.body?.getReader();
    if (!reader) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let didFinish = false;
    let wasInterrupted = false;
    const interrupt = () => {
      wasInterrupted = true;
      void reader.cancel().catch(() => {});
    };
    request.signal.addEventListener("abort", interrupt, { once: true });
    const timer = setTimeout(interrupt, 5_000);
    try {
      while (true) {
        if (request.signal.aborted) throw new ExecutionBrokerError("INVALID_REQUEST");
        const { value, done } = await reader.read();
        if (wasInterrupted || request.signal.aborted) throw new ExecutionBrokerError("INVALID_REQUEST");
        if (done) { didFinish = true; break; }
        size += value.byteLength;
        if (size > maximumBytes) throw new ExecutionBrokerError("INVALID_REQUEST");
        chunks.push(value);
      }
      return Uint8Array.from(Buffer.concat(chunks, size));
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener("abort", interrupt);
      if (!didFinish) await reader.cancel().catch(() => {});
      chunks.forEach((chunk) => chunk.fill(0));
      reader.releaseLock();
    }
  }

  private errorResponse(error: unknown): Response {
    const code = error instanceof ExecutionBrokerError ? error.code : "UNAVAILABLE";
    const status = {
      INVALID_REQUEST: 400, UNAUTHORIZED: 401, NOT_FOUND: 404,
      CONFLICT: 409, UNAVAILABLE: 503, CAPACITY: 429,
    }[code];
    return Response.json({ error: code }, { status });
  }
}
