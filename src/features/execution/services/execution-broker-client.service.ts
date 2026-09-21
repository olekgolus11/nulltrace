import { ExecutionReceipt } from "../types/execution-broker.types";
import { ExecutionPlan } from "../types/execution-plan.types";
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

  private async send(path: string, body: BodyInit, contentType: string, executionId: string): Promise<ExecutionReceipt> {
    try {
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
          if (size > 4_096) throw new Error("Oversized broker response.");
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
}
