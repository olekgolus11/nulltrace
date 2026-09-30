import { ExecutionPlan } from "../types/execution-plan.types";
import { ExecutionBrokerClientConfiguration } from "../types/execution-broker-client.types";

export class ExecutionBrokerAdminClientService {
  constructor(private readonly configuration: ExecutionBrokerClientConfiguration) {}

  async issueGrant(plan: ExecutionPlan): Promise<void> {
    const response = await fetch("http://execution-broker/v1/grants", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.configuration.adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        principal: this.configuration.principal,
        plan,
        expiresAt: Date.now() + 60_000,
      }),
      signal: AbortSignal.timeout(10_000),
      unix: `${this.configuration.directory}/broker-admin.sock`,
    } as RequestInit & { unix: string });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Isolated cURL broker is unavailable.");
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4_096) throw new Error("Isolated cURL broker returned an invalid grant receipt.");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("Isolated cURL broker returned an invalid grant receipt."); }
    if (response.status !== 201 || !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 || (value as { status?: unknown }).status !== "issued") {
      throw new Error("Isolated cURL broker rejected the execution grant.");
    }
  }
}
