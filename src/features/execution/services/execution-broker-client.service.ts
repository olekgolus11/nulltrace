import { ExecutionReceipt } from "../types/execution-broker.types";
import { ExecutionPlan } from "../types/execution-plan.types";
import { ExecutionEventPage, ExecutionOutputEvent } from "../types/execution-event.types";
import { ExecutionBrokerError } from "./execution-broker.error";
import { requireExecutionId, requireExecutionRecord } from "./execution-validation.helpers";

export class ExecutionBrokerClient {
  constructor(
    private readonly transport: (request: Request) => Promise<Response>,
    private readonly token: string,
  ) {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid broker credential.");
  }

  prepare(plan: ExecutionPlan): Promise<ExecutionReceipt> {
    return this.send("/v1/prepare", JSON.stringify(plan), "application/json", plan.executionId);
  }

  get(executionId: string): Promise<ExecutionReceipt> {
    return this.send("/v1/get", JSON.stringify({ executionId }), "application/json", executionId);
  }

  start(executionId: string): Promise<ExecutionReceipt> {
    return this.send("/v1/start", JSON.stringify({ executionId }), "application/json", executionId);
  }

  putInput(executionId: string, slotId: string, bytes: Uint8Array): Promise<ExecutionReceipt> {
    return this.send(`/v1/input/${requireExecutionId(executionId)}/${requireExecutionId(slotId)}`, Buffer.from(bytes), "application/octet-stream", executionId);
  }

  async readEvents(executionId: string, afterSequence: number): Promise<ExecutionEventPage> {
    requireExecutionId(executionId);
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1) throw new ExecutionBrokerError("INVALID_REQUEST");
    try {
      const value = await this.request("/v1/events", JSON.stringify({ executionId, afterSequence }), "application/json", 65_536);
      const record = requireExecutionRecord(value, ["executionId", "events", "nextSequence", "hasMore"]);
      if (record.executionId !== executionId || !Array.isArray(record.events) || record.events.length > 10 ||
        !Number.isSafeInteger(record.nextSequence) || typeof record.hasMore !== "boolean") {
        throw new Error("Invalid broker event page.");
      }
      const events: ExecutionOutputEvent[] = record.events.map((item, index) => {
        const event = requireExecutionRecord(item, ["executionId", "sequence", "stream", "line"]);
        if (event.executionId !== executionId || event.sequence !== afterSequence + index + 1 ||
          (event.stream !== "stdout" && event.stream !== "stderr" && event.stream !== "system") ||
          typeof event.line !== "string" || Buffer.byteLength(event.line) > 4_096 ||
          /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(event.line)) {
          throw new Error("Invalid broker output event.");
        }
        return { executionId, sequence: event.sequence as number, stream: event.stream, line: event.line as string };
      });
      if (record.nextSequence !== (events.at(-1)?.sequence ?? afterSequence)) throw new Error("Invalid broker event cursor.");
      return { executionId, events, nextSequence: record.nextSequence as number, hasMore: record.hasMore as boolean };
    } catch (error) {
      throw error instanceof ExecutionBrokerError ? error : new ExecutionBrokerError("UNAVAILABLE");
    }
  }

  private async send(path: string, body: BodyInit, contentType: string, executionId: string): Promise<ExecutionReceipt> {
    try {
      const value = await this.request(path, body, contentType, 4_096);
      const record = requireExecutionRecord(value, ["executionId", "status", "cleanup"]);
      const { status, cleanup } = record;
      if ((status !== "prepared" && status !== "start_committed" && status !== "started" && status !== "interrupted" && status !== "closed") ||
        (cleanup !== "pending" && cleanup !== "confirmed")) throw new Error("Invalid broker response.");
      if (requireExecutionId(record.executionId) !== executionId || (status === "closed") !== (cleanup === "confirmed")) {
        throw new Error("Mismatched broker receipt.");
      }
      return { executionId, status, cleanup };
    } catch (error) {
      throw error instanceof ExecutionBrokerError ? error : new ExecutionBrokerError("UNAVAILABLE");
    }
  }

  private async request(path: string, body: BodyInit, contentType: string, maximumBytes: number): Promise<unknown> {
    const response = await this.transport(new Request(`http://execution-broker${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.token}`, "content-type": contentType },
      body,
      signal: AbortSignal.timeout(10_000),
    }));
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing broker response.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maximumBytes) throw new Error("Oversized broker response.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!response.ok) {
      const error = requireExecutionRecord(value, ["error"]).error;
      if (error === "INVALID_REQUEST" || error === "UNAUTHORIZED" || error === "NOT_FOUND" ||
        error === "CONFLICT" || error === "CAPACITY") throw new ExecutionBrokerError(error);
      throw new ExecutionBrokerError("UNAVAILABLE");
    }
    return value;
  }
}
