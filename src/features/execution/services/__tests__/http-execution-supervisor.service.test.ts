import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ExecutionPlan } from "../../types/execution-plan.types";
import { HttpExecutionNetworkPolicy } from "../../types/http-execution-network.types";
import { HttpExecutionSupervisedNetwork } from "../../types/http-execution-supervisor.types";
import { HttpExecutionRunError } from "../http-execution-run.error";
import { HttpExecutionSupervisorService } from "../http-execution-supervisor.service";
import { ExecutionReceiptRepository } from "../execution-receipt.repository";
import { toExecutionOutcome } from "../execution-outcome.helpers";
import { ExecutionSecretOutputSanitizerService } from "../execution-secret-output-sanitizer.service";
import { ExecutionAuthCheckOutputSanitizerService } from "../execution-auth-check-output-sanitizer.service";
import { createAuthCheckExecutionPlan } from "../auth-check-execution-profile.helpers";
import { ExecutionCredentialBinding } from "../../types/execution-broker.types";

const plan: ExecutionPlan = {
  version: 1,
  executionId: "run-1",
  authorizationId: "approval-1",
  profileId: "public-http",
  tool: "curl",
  mode: "public",
  invocation: { executableId: "curl", argv: ["https://example.test"] },
  origins: ["https://example.test"],
  inputs: [],
  limits: {
    timeoutMs: 500,
    memoryBytes: 128 * 1024 * 1024,
    cpuMilliCores: 500,
    processCount: 48,
    scratchBytes: 32 * 1024 * 1024,
    fileBytes: 8 * 1024 * 1024,
    outputBytes: 1024,
  },
};
const policy: HttpExecutionNetworkPolicy = {
  executionId: "run-1",
  origins: ["https://example.test"],
  endpoints: [{ origin: "https://example.test", hostname: "example.test", address: "93.184.216.34", family: 4, port: 443 }],
};

function fixture(leaseMs = 100) {
  const calls: AbortSignal[] = [];
  const network: HttpExecutionSupervisedNetwork = {
    async run(_policy, _limits, _executable, _argv, signal) {
      calls.push(signal!);
      await new Promise<void>((_, reject) => {
        signal!.addEventListener("abort", () => reject(new HttpExecutionRunError("cancelled", true)), { once: true });
      });
      throw new Error("Unreachable.");
    },
  };
  const supervisor = new HttpExecutionSupervisorService(network, {
    async resolve() { return policy; },
  }, { leaseMs, onSettled() {} });
  return { supervisor, calls };
}

describe("HTTP execution ownership", () => {
  test("releases only a valid Auth Check frame after successful worker exit and confirmed cleanup", async () => {
    const authPlan = createAuthCheckExecutionPlan({ executionId: "auth-check-run", authorizationId: "trusted-approval", origin: "https://example.test" });
    const authPolicy = { ...policy, executionId: authPlan.executionId };
    const binding: ExecutionCredentialBinding = { scopeId: "scope-1", generation: 3 };
    const config = new TextEncoder().encode(JSON.stringify({
      version: 1, operation: "auth-check", contextVersion: 3, targetOrigin: "https://example.test",
      verificationUrl: "https://example.test/check", authenticatedHeaders: ["cookie: session=must-not-return"],
      requestTimeoutMs: 10_000, maximumResponseBytes: 128_000, maximumRedirectCount: 5, totalDeadlineMs: 30_000,
    }));
    const frame = `${JSON.stringify({
      version: 1, operation: "auth-check", status: "verified", isProceedAllowed: true,
      unauthenticated: { status: 401, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: true },
      authenticated: { status: 200, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: false },
      differences: { statusChanged: true, redirectsChanged: false, contentKindChanged: false, contentChanged: false, titleChanged: false, loginFormChanged: true },
    })}\n`;
    const createSupervisor = (exitCode: number, cleanupConfirmed = true) => new HttpExecutionSupervisorService({
      async run(_policy, _limits, _executable, _argv, _signal, onOutput) {
        onOutput?.("stdout", new TextEncoder().encode(frame));
        return {
          command: { exitCode, stdout: "", stderr: "" },
          evidence: { executionId: authPlan.executionId, workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed },
        };
      },
    }, { async resolve() { return authPolicy; } }, {
      leaseMs: 1_000, secretOutputSanitizer: new ExecutionAuthCheckOutputSanitizerService(), onSettled() {},
    });
    const successful = createSupervisor(0);
    await successful.putInput(authPlan, authPlan.inputs[0]!, config, binding);
    await successful.start(authPlan, binding);
    await successful.wait(authPlan.executionId);
    expect(successful.readEvents(authPlan.executionId, -1).events).toHaveLength(1);
    expect(successful.readEvents(authPlan.executionId, -1).events[0]?.line).toBe(frame.trimEnd());

    const failed = createSupervisor(2);
    await failed.putInput(authPlan, authPlan.inputs[0]!, config, binding);
    await failed.start(authPlan, binding);
    await failed.wait(authPlan.executionId);
    expect(failed.readEvents(authPlan.executionId, -1).events).toEqual([]);

    const uncertain = createSupervisor(0, false);
    await uncertain.putInput(authPlan, authPlan.inputs[0]!, config, binding);
    await uncertain.start(authPlan, binding);
    await uncertain.wait(authPlan.executionId);
    expect(uncertain.readEvents(authPlan.executionId, -1).events).toEqual([]);
  });

  test("withholds a valid Auth Check frame when cancellation races worker completion", async () => {
    const authPlan = createAuthCheckExecutionPlan({ executionId: "auth-check-cancel", authorizationId: "trusted-approval", origin: "https://example.test" });
    const authPolicy = { ...policy, executionId: authPlan.executionId };
    const binding: ExecutionCredentialBinding = { scopeId: "scope-1", generation: 3 };
    const config = new TextEncoder().encode(JSON.stringify({
      version: 1, operation: "auth-check", contextVersion: 3, targetOrigin: "https://example.test",
      verificationUrl: "https://example.test/check", authenticatedHeaders: [], requestTimeoutMs: 10_000,
      maximumResponseBytes: 128_000, maximumRedirectCount: 5, totalDeadlineMs: 30_000,
    }));
    let finishRun!: () => void;
    let signalRunStarted!: () => void;
    const enteredRun = new Promise<void>((resolve) => { signalRunStarted = resolve; });
    const network: HttpExecutionSupervisedNetwork = {
      async run(_policy, _limits, _executable, _argv, _signal, onOutput) {
        onOutput?.("stdout", new TextEncoder().encode(`${JSON.stringify({
          version: 1, operation: "auth-check", status: "verified", isProceedAllowed: true,
          unauthenticated: { status: 401, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: true },
          authenticated: { status: 200, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: false },
          differences: { statusChanged: true, redirectsChanged: false, contentKindChanged: false, contentChanged: false, titleChanged: false, loginFormChanged: true },
        })}\n`));
        signalRunStarted();
        await new Promise<void>((finish) => { finishRun = finish; });
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: authPlan.executionId, workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    };
    const supervisor = new HttpExecutionSupervisorService(network, { async resolve() { return authPolicy; } }, {
      leaseMs: 1_000, secretOutputSanitizer: new ExecutionAuthCheckOutputSanitizerService(), onSettled() {},
    });
    await supervisor.putInput(authPlan, authPlan.inputs[0]!, config, binding);
    await supervisor.start(authPlan, binding);
    await enteredRun;
    supervisor.cancel(authPlan.executionId);
    finishRun();
    await supervisor.wait(authPlan.executionId);
    expect(supervisor.readEvents(authPlan.executionId, -1).events).toEqual([]);
  });

  test("stages bounded slot copies and wipes them after network delivery", async () => {
    const secret = new TextEncoder().encode("worker-secret-canary");
    let retained: Uint8Array | undefined;
    const network: HttpExecutionSupervisedNetwork = {
      async run(_policy, _limits, _executable, _argv, _signal, onOutput, inputs) {
        retained = inputs?.[0]?.bytes;
        expect(new TextDecoder().decode(retained)).toBe("worker-secret-canary");
        const leakedOutput = new TextEncoder().encode("worker-secret-canary");
        onOutput?.("stdout", leakedOutput);
        expect([...leakedOutput]).toEqual(new Array("worker-secret-canary".length).fill(0));
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    };
    const supervisor = new HttpExecutionSupervisorService(network, { async resolve() { return policy; } }, {
      leaseMs: 1_000, onSettled() {},
    });
    const inputPlan = { ...plan, inputs: [{ id: "auth", kind: "secret" as const, maximumBytes: 64 }] };
    await supervisor.putInput(inputPlan, inputPlan.inputs[0]!, secret);
    secret.fill(0);
    await supervisor.start(inputPlan);
    await supervisor.wait("run-1");
    expect([...retained!]).toEqual(new Array("worker-secret-canary".length).fill(0));
    expect(supervisor.readEvents("run-1", -1).events).toEqual([]);
  });

  test("retains only complete, control-normalized output after trusted secret redaction", async () => {
    const sanitizer = new ExecutionSecretOutputSanitizerService();
    const authenticatedPlan: ExecutionPlan = {
      ...plan,
      profileId: "authenticated-curl-worker-v1",
      mode: "authenticated-worker",
      invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      inputs: [
        { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
        { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
      ],
    };
    const secretInput = new TextEncoder().encode(JSON.stringify({ cookies: "session=COOKIE-CANARY", headers: "Authorization: Bearer HEADER-CANARY" }));
    const outputChunks: Uint8Array[] = [];
    const network: HttpExecutionSupervisedNetwork = {
      async run(_policy, _limits, _executable, _argv, _signal, onOutput) {
        for (const part of ["body COOKIE-", "CANARY; ", "Bearer [31mHEADER-", "CANARY\nstatus=200\n"]) {
          const chunk = new TextEncoder().encode(part);
          outputChunks.push(chunk);
          onOutput?.("stdout", chunk);
        }
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    };
    const supervisor = new HttpExecutionSupervisorService(network, { async resolve() { return policy; } }, {
      leaseMs: 1_000, secretOutputSanitizer: sanitizer, onSettled() {},
    });
    await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[0]!, new Uint8Array());
    await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[1]!, secretInput);
    secretInput.fill(0);
    await supervisor.start(authenticatedPlan);
    await supervisor.wait("run-1");
    const events = supervisor.readEvents("run-1", -1).events.map((event) => event.line);
    expect(events).toEqual(["body [redacted]; [redacted]", "status=200"]);
    expect(events.join(" ")).not.toContain("COOKIE-CANARY");
    expect(events.join(" ")).not.toContain("HEADER-CANARY");
    expect(outputChunks.every((chunk) => chunk.every((byte) => byte === 0))).toBe(true);
  });

  test("suppresses every secret output when the fixed profile schema or sanitizer fails", async () => {
    const sanitizer = new ExecutionSecretOutputSanitizerService();
    const authenticatedPlan: ExecutionPlan = {
      ...plan,
      profileId: "authenticated-curl-worker-v1",
      mode: "authenticated-worker",
      invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      inputs: [
        { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
        { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
      ],
    };
    const network: HttpExecutionSupervisedNetwork = {
      async run(_policy, _limits, _executable, _argv, _signal, onOutput) {
        onOutput?.("stdout", new TextEncoder().encode("should-not-be-retained"));
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    };
    const supervisor = new HttpExecutionSupervisorService(network, { async resolve() { return policy; } }, {
      leaseMs: 1_000, secretOutputSanitizer: sanitizer, onSettled() {},
    });
    await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[0]!, new Uint8Array());
    await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[1]!, new TextEncoder().encode("{\"cookies\":\"a=b\",\"cookies\":\"x=y\",\"headers\":\"\"}"));
    await supervisor.start(authenticatedPlan);
    await supervisor.wait("run-1");
    expect(supervisor.readEvents("run-1", -1).events).toEqual([]);
  });

  test("withholds both streams atomically when a trusted sanitizer returns malformed output", async () => {
    const authenticatedPlan: ExecutionPlan = {
      ...plan,
      profileId: "authenticated-curl-worker-v1",
      mode: "authenticated-worker",
      invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
      inputs: [
        { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
        { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
      ],
    };
    const supervisor = new HttpExecutionSupervisorService({
      async run() {
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    }, { async resolve() { return policy; } }, {
      leaseMs: 1_000,
      secretOutputSanitizer: {
        create() {
          return {
            capture() { return true; },
            sanitize() { return { stdout: "safe output\n", stderr: "bad\u001b[31mcontrol" }; },
            destroy() {},
          };
        },
      },
      onSettled() {},
    });
    await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[0]!, new Uint8Array());
    await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[1]!, new TextEncoder().encode(JSON.stringify({ cookies: "session=secret", headers: "" })));
    await supervisor.start(authenticatedPlan);
    await supervisor.wait("run-1");
    expect(supervisor.readEvents("run-1", -1).events).toEqual([]);
  });

  test("wipes inputs and settles when sanitizer setup, capture, or finalization throws", async () => {
    for (const failure of ["create", "capture", "sanitize"] as const) {
      const authenticatedPlan: ExecutionPlan = {
        ...plan,
        executionId: `run-${failure}`,
        profileId: "authenticated-curl-worker-v1",
        mode: "authenticated-worker",
        invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
        inputs: [
          { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
          { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
        ],
      };
      let retainedInput: Uint8Array | undefined;
      let sourceChunk: Uint8Array | undefined;
      let settled = false;
      const supervisor = new HttpExecutionSupervisorService({
        async run(_policy, _limits, _executable, _argv, _signal, onOutput, inputs) {
          retainedInput = inputs?.[1]?.bytes;
          if (failure !== "create") {
            sourceChunk = new TextEncoder().encode("session=secret-value");
            onOutput?.("stdout", sourceChunk);
          }
          return {
            command: { exitCode: 0, stdout: "", stderr: "" },
            evidence: { executionId: authenticatedPlan.executionId, workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
          };
        },
      }, { async resolve() { return policy; } }, {
        leaseMs: 1_000,
        secretOutputSanitizer: {
          create(_plan, inputs) {
            retainedInput = inputs[1]?.bytes;
            if (failure === "create") throw new Error("private failure");
            return {
              capture() { if (failure === "capture") throw new Error("private failure"); return true; },
              sanitize() { if (failure === "sanitize") throw new Error("private failure"); return { stdout: "safe", stderr: "" }; },
              destroy() { if (failure === "sanitize") throw new Error("private failure"); },
            };
          },
        },
        onSettled() { settled = true; },
      });
      await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[0]!, new Uint8Array());
      await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[1]!, new TextEncoder().encode(JSON.stringify({ cookies: "session=secret-value", headers: "" })));
      await supervisor.start(authenticatedPlan);
      await supervisor.wait(authenticatedPlan.executionId);
      expect(settled).toBe(true);
      expect(retainedInput?.every((byte) => byte === 0)).toBe(true);
      expect(sourceChunk?.every((byte) => byte === 0) ?? true).toBe(true);
      expect(supervisor.readEvents(authenticatedPlan.executionId, -1).events).toEqual([]);
    }
  });

  test("sanitizes only complete output on cancellation and deadline settlement", async () => {
    for (const stop of ["cancel", "deadline", "pending-cleanup"] as const) {
      let notifyStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
      const authenticatedPlan: ExecutionPlan = {
        ...plan,
        executionId: `run-${stop}`,
        limits: { ...plan.limits, timeoutMs: stop === "deadline" ? 80 : 5_000 },
        profileId: "authenticated-curl-worker-v1",
        mode: "authenticated-worker",
        invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
        inputs: [
          { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
          { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
        ],
      };
      const supervisor = new HttpExecutionSupervisorService({
        async run(_policy, _limits, _executable, _argv, signal, onOutput, inputs) {
          onOutput?.("stdout", new TextEncoder().encode("session=secret-value\nstatus=200\n"));
          notifyStarted?.();
          await new Promise<void>((resolve) => signal!.addEventListener("abort", () => resolve(), { once: true }));
          expect(inputs?.[1]?.bytes.every((byte) => byte !== 0)).toBe(true);
          return {
            command: { exitCode: 0, stdout: "", stderr: "" },
            evidence: { executionId: authenticatedPlan.executionId, workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: stop !== "pending-cleanup" },
          };
        },
      }, { async resolve() { return policy; } }, { leaseMs: 1_000, secretOutputSanitizer: new ExecutionSecretOutputSanitizerService(), onSettled() {} });
      await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[0]!, new Uint8Array());
      await supervisor.putInput(authenticatedPlan, authenticatedPlan.inputs[1]!, new TextEncoder().encode(JSON.stringify({ cookies: "session=secret-value", headers: "" })));
      await supervisor.start(authenticatedPlan);
      await started;
      if (stop !== "deadline") supervisor.cancel(authenticatedPlan.executionId);
      const result = await supervisor.wait(authenticatedPlan.executionId);
      expect(result.cleanup).toBe(stop === "pending-cleanup" ? "pending" : "confirmed");
      const lines = supervisor.readEvents(authenticatedPlan.executionId, -1).events.map((event) => event.line);
      expect(lines).toEqual(["[redacted]", "status=200"]);
      expect(lines.join(" ")).not.toContain("secret-value");
      if (stop === "pending-cleanup") {
        await expect(supervisor.start({ ...authenticatedPlan, executionId: "run-after-pending" })).rejects.toThrow("busy");
      }
    }
  });

  test("discards all earlier staged slots when a later slot is rejected", async () => {
    const supervisor = new HttpExecutionSupervisorService({ async run() { throw new Error("must not run"); } },
      { async resolve() { return policy; } }, { leaseMs: 1_000, onSettled() {} });
    const inputPlan = { ...plan, inputs: [
      { id: "auth", kind: "secret" as const, maximumBytes: 64 },
      { id: "payload", kind: "data" as const, maximumBytes: 64 },
    ] };
    await supervisor.putInput(inputPlan, inputPlan.inputs[0]!, new TextEncoder().encode("first-secret"));
    await expect(supervisor.putInput(inputPlan, { id: "unknown", kind: "data", maximumBytes: 64 }, new Uint8Array([1])))
      .rejects.toThrow("unsupported or invalid");
    await expect(supervisor.start(inputPlan)).rejects.toThrow("missing, expired");
  });

  test("wipes secret slots after a failed worker cleanup path", async () => {
    const secret = new TextEncoder().encode("worker-secret-canary");
    let retained: Uint8Array | undefined;
    const supervisor = new HttpExecutionSupervisorService({
      async run(_policy, _limits, _executable, _argv, _signal, _onOutput, inputs) {
        retained = inputs?.[0]?.bytes;
        throw new HttpExecutionRunError("worker failed", true);
      },
    }, { async resolve() { return policy; } }, { leaseMs: 1_000, onSettled() {} });
    const inputPlan = { ...plan, inputs: [{ id: "auth", kind: "secret" as const, maximumBytes: 64 }] };
    await supervisor.putInput(inputPlan, inputPlan.inputs[0]!, secret);
    secret.fill(0);
    await supervisor.start(inputPlan);
    await supervisor.wait("run-1");
    expect([...retained!]).toEqual(new Array("worker-secret-canary".length).fill(0));
  });

  test("fails closed for missing slots and expires unstarted staged bytes", async () => {
    const supervisor = new HttpExecutionSupervisorService({ async run() { throw new Error("must not run"); } },
      { async resolve() { return policy; } }, { leaseMs: 1_000, inputRetentionMs: 100, onSettled() {} });
    const inputPlan = { ...plan, inputs: [{ id: "auth", kind: "secret" as const, maximumBytes: 64 }] };
    await expect(supervisor.start(inputPlan)).rejects.toThrow("missing, expired");
    const source = new TextEncoder().encode("short-lived-secret");
    await supervisor.putInput(inputPlan, inputPlan.inputs[0]!, source);
    source.fill(0);
    await Bun.sleep(140);
    await expect(supervisor.start(inputPlan)).rejects.toThrow("missing, expired");
  });

  test("cancels an active run and waits for verified environment cleanup", async () => {
    const { supervisor, calls } = fixture();
    await supervisor.start(plan);
    expect(supervisor.get("run-1").cleanup).toBe("pending");
    supervisor.cancel("run-1");
    expect(() => supervisor.renewOwnership("run-1")).toThrow("can no longer be renewed");
    const result = await supervisor.wait("run-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.aborted).toBe(true);
    expect(result).toMatchObject({ status: "finished", stopReason: "cancelled", cleanup: "confirmed" });
  });

  test("expires an ownership lease and refuses revival", async () => {
    const { supervisor } = fixture(100);
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ stopReason: "lease_expired", cleanup: "confirmed" });
    expect(() => supervisor.renewOwnership("run-1")).toThrow();
  });

  test("renewal never extends the absolute execution deadline", async () => {
    const { supervisor } = fixture(100);
    await supervisor.start({ ...plan, limits: { ...plan.limits, timeoutMs: 180 } });
    await Bun.sleep(60);
    expect(supervisor.renewOwnership("run-1").status).toBe("running");
    await Bun.sleep(60);
    expect(supervisor.renewOwnership("run-1").status).toBe("running");
    expect(await supervisor.wait("run-1")).toMatchObject({ stopReason: "deadline", cleanup: "confirmed" });
  });

  test("rejects a second run until the first cleanup is confirmed", async () => {
    const { supervisor } = fixture();
    await supervisor.start(plan);
    await expect(supervisor.start({ ...plan, executionId: "run-2" })).rejects.toThrow("busy");
    supervisor.cancel("run-1");
    await supervisor.wait("run-1");
    await supervisor.start({ ...plan, executionId: "run-2" });
    supervisor.cancel("run-2");
    await supervisor.wait("run-2");
  });

  test("keeps the backend locked after failed cleanup", async () => {
    const supervisor = new HttpExecutionSupervisorService({
      async run() { throw new HttpExecutionRunError("cleanup unavailable", false); },
    }, {
      async resolve() { return policy; },
    }, { leaseMs: 100, onSettled() {} });
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ status: "interrupted", cleanup: "pending" });
    await expect(supervisor.start({ ...plan, executionId: "run-2" })).rejects.toThrow("busy");
  });

  test("marks a resolution failure clean because no environment was provisioned", async () => {
    let networkCalls = 0;
    const supervisor = new HttpExecutionSupervisorService({
      async run() { networkCalls++; throw new Error("unexpected invocation"); },
    }, {
      async resolve() { throw new Error("DNS failed"); },
    }, { leaseMs: 100, onSettled() {} });
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ status: "finished", cleanup: "confirmed" });
    expect(networkCalls).toBe(0);
  });

  test("commits a public result summary after verified cleanup", async () => {
    const database = new Database(":memory:");
    try {
      const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
      receipts.reserve("owner", "run-1", "plan-fingerprint");
      receipts.commitStart("run-1");
      const supervisor = new HttpExecutionSupervisorService({
        async run() {
          return {
            command: { exitCode: 0, stdout: "untrusted output", stderr: "" },
            evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
          };
        },
      }, { async resolve() { return policy; } }, {
        leaseMs: 100,
        onSettled(run) { receipts.recordOutcome(toExecutionOutcome(run)); },
      });
      await supervisor.start(plan);
      expect(await supervisor.wait("run-1")).toMatchObject({ status: "finished", cleanup: "confirmed", exitCode: 0 });
      expect(receipts.find("run-1")).toMatchObject({ status: "closed", cleanup: "confirmed" });
      expect(receipts.findOutcome("run-1")).toMatchObject({ cause: "normal", exitCode: 0 });
      expect(JSON.stringify(receipts.findOutcome("run-1"))).not.toContain("untrusted output");
    } finally {
      database.close();
    }
  });

  test("retains only sanitized bounded output events for a public run", async () => {
    const supervisor = new HttpExecutionSupervisorService({
      async run(_policy, _limits, _executable, _argv, _signal, onOutput) {
        onOutput?.("stdout", new TextEncoder().encode("ok\u001b[31m\n"));
        onOutput?.("stderr", new TextEncoder().encode("bad\n"));
        return {
          command: { exitCode: 0, stdout: "raw output must not be replayed", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    }, { async resolve() { return policy; } }, { leaseMs: 100, onSettled() {} });
    await supervisor.start(plan);
    await supervisor.wait("run-1");
    expect(supervisor.readEvents("run-1", -1).events.map((event) => event.line)).toEqual(["ok", "bad"]);
  });

  test("blocks another start until a failed durable settlement is retried", async () => {
    let available = false;
    const supervisor = new HttpExecutionSupervisorService({
      async run() {
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    }, { async resolve() { return policy; } }, {
      leaseMs: 100,
      onSettled() { if (!available) throw new Error("journal unavailable"); },
    });
    await supervisor.start(plan);
    expect(await supervisor.wait("run-1")).toMatchObject({ status: "interrupted", cleanup: "confirmed" });
    await expect(supervisor.start({ ...plan, executionId: "run-2" })).rejects.toThrow("busy");
    available = true;
    expect(await supervisor.retrySettlement("run-1")).toMatchObject({ status: "finished", cleanup: "confirmed" });
    await supervisor.start({ ...plan, executionId: "run-2" });
    await supervisor.wait("run-2");
  });

  test("waitForCleanup waits for durable settlement before confirming cleanup", async () => {
    const database = new Database(":memory:");
    try {
      const receipts = new ExecutionReceiptRepository(database, new Uint8Array(32).fill(7));
      receipts.reserve("owner", "run-1", "plan-fingerprint");
      receipts.commitStart("run-1");
      let announceSettlement!: () => void;
      let releaseSettlement!: () => void;
      const settlementStarted = new Promise<void>((resolve) => { announceSettlement = resolve; });
      const settlementGate = new Promise<void>((resolve) => { releaseSettlement = resolve; });
      const supervisor = new HttpExecutionSupervisorService({
        async run() {
          return {
            command: { exitCode: 0, stdout: "", stderr: "" },
            evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
          };
        },
      }, { async resolve() { return policy; } }, {
        leaseMs: 100,
        cleanupWaitMs: 1_000,
        async onSettled(run) {
          announceSettlement();
          await settlementGate;
          receipts.recordOutcome(toExecutionOutcome(run));
        },
      });
      await supervisor.start(plan);
      let cleanupReturned = false;
      const cleanup = supervisor.waitForCleanup("run-1").then((result) => {
        cleanupReturned = true;
        return result;
      });
      await settlementStarted;
      expect(receipts.find("run-1")).toMatchObject({ status: "start_committed", cleanup: "pending" });
      expect(cleanupReturned).toBe(false);
      releaseSettlement();
      await expect(cleanup).resolves.toMatchObject({ status: "finished", cleanup: "confirmed" });
      expect(receipts.find("run-1")).toMatchObject({ status: "closed", cleanup: "confirmed" });
    } finally {
      database.close();
    }
  });

  test("waitForCleanup rejects when bounded cleanup settlement times out", async () => {
    let releaseSettlement!: () => void;
    const settlementGate = new Promise<void>((resolve) => { releaseSettlement = resolve; });
    const supervisor = new HttpExecutionSupervisorService({
      async run() {
        return {
          command: { exitCode: 0, stdout: "", stderr: "" },
          evidence: { executionId: "run-1", workerRulesSha256: "", proxyRulesSha256: "", proxyDecisions: [], cleanupConfirmed: true },
        };
      },
    }, { async resolve() { return policy; } }, {
      leaseMs: 100,
      cleanupWaitMs: 100,
      async onSettled() { await settlementGate; },
    });
    await supervisor.start(plan);
    await expect(supervisor.waitForCleanup("run-1")).rejects.toThrow("cleanup wait expired");
    releaseSettlement();
    await expect(supervisor.waitForCleanup("run-1")).resolves.toMatchObject({ status: "finished", cleanup: "confirmed" });
  });

  test("rejects an invalid bounded cleanup wait", () => {
    const network: HttpExecutionSupervisedNetwork = { async run() { throw new Error("not reached"); } };
    expect(() => new HttpExecutionSupervisorService(network, { async resolve() { return policy; } }, {
      leaseMs: 100,
      cleanupWaitMs: 99,
      onSettled() {},
    })).toThrow("Invalid execution cleanup wait");
  });
});
