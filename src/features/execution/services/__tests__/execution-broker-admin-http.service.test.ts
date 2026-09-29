import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ExecutionBrokerAdminHttpService } from "../execution-broker-admin-http.service";
import { ExecutionAuthorizationLedgerRepository } from "../execution-authorization-ledger.repository";

const administratorToken = "b".repeat(64);
const principal = { installationId: "installation", instanceId: "instance" };
const profile = {
  id: "public-curl-v1", tool: "curl", mode: "public", executableIds: ["curl"], inputs: [],
  maximumLimits: {
    timeoutMs: 30_000, memoryBytes: 512 * 1024 * 1024, cpuMilliCores: 1_000,
    processCount: 128, scratchBytes: 64 * 1024 * 1024, fileBytes: 16 * 1024 * 1024, outputBytes: 1024 * 1024,
  },
};

describe("execution broker administrator channel", () => {
  test("drains an interrupted grant request before shutdown completes", async () => {
    const database = new Database(":memory:");
    const ledger = new ExecutionAuthorizationLedgerRepository(database, new Uint8Array(32).fill(7), [profile], () => 1000);
    const service = new ExecutionBrokerAdminHttpService(ledger, administratorToken);
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ start(writer) { writer.enqueue(new Uint8Array([123])); } });
    const request = new Request("http://broker/v1/grants", {
      method: "POST",
      headers: { authorization: `Bearer ${administratorToken}`, "content-type": "application/json" },
      body: stream,
      signal: controller.signal,
    });
    try {
      const response = service.handle(request);
      await Bun.sleep(0);
      let drained = false;
      const idle = service.waitForIdle().then(() => { drained = true; });
      service.beginShutdown();
      expect(drained).toBe(false);
      expect((await service.handle(new Request("http://broker/v1/grants"))).status).toBe(503);
      controller.abort();
      expect((await response).status).toBe(400);
      await idle;
      expect(drained).toBe(true);
    } finally {
      database.close();
    }
  });
});
