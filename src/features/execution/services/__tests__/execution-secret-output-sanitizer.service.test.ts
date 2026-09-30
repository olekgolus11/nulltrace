import { describe, expect, test } from "bun:test";
import { ExecutionPlan } from "../../types/execution-plan.types";
import { HttpExecutionNetworkInput } from "../../types/http-execution-network.types";
import { ExecutionSecretOutputSanitizerService } from "../execution-secret-output-sanitizer.service";

const plan: ExecutionPlan = {
  version: 1,
  executionId: "run-1",
  authorizationId: "approval-1",
  profileId: "authenticated-curl-worker-v1",
  tool: "curl",
  mode: "authenticated-worker",
  invocation: { executableId: "bun", argv: ["run", "/opt/nulltrace/workers/curl-worker.ts"] },
  origins: ["https://example.test"],
  inputs: [
    { id: "curl-config", kind: "data", maximumBytes: 2 * 1024 * 1024 },
    { id: "curl-auth-context", kind: "secret", maximumBytes: 64 * 1024 },
  ],
  limits: {
    timeoutMs: 30_000,
    memoryBytes: 128 * 1024 * 1024,
    cpuMilliCores: 500,
    processCount: 48,
    scratchBytes: 32 * 1024 * 1024,
    fileBytes: 8 * 1024 * 1024,
    outputBytes: 1024 * 1024,
  },
};

function createInputs(): HttpExecutionNetworkInput[] {
  return [
    { slot: plan.inputs[0]!, bytes: new Uint8Array() },
    { slot: plan.inputs[1]!, bytes: new TextEncoder().encode(JSON.stringify({ cookies: "session=canary", headers: "" })) },
  ];
}

describe("authenticated cURL output sanitizer prerequisite", () => {
  test("creates a session only for the fixed profile, worker command, and exact slot metadata", () => {
    const sanitizer = new ExecutionSecretOutputSanitizerService();
    const inputs = createInputs();
    expect(sanitizer.create(plan, inputs)).not.toBeNull();
    expect(sanitizer.create({ ...plan, profileId: "other-profile" }, inputs)).toBeNull();
    expect(sanitizer.create({ ...plan, invocation: { ...plan.invocation, argv: [...plan.invocation.argv, "extra"] } }, inputs)).toBeNull();
    const mismatchedSlot = createInputs();
    mismatchedSlot[1]!.slot = { ...mismatchedSlot[1]!.slot, maximumBytes: 64 };
    expect(sanitizer.create(plan, mismatchedSlot)).toBeNull();
    expect(sanitizer.create(plan, [...inputs, inputs[1]!])).toBeNull();
  });

  test("redacts complete UTF-8 output split across frames and drops malformed UTF-8", () => {
    const sanitizer = new ExecutionSecretOutputSanitizerService();
    const session = sanitizer.create(plan, createInputs())!;
    expect(session.capture("stdout", Uint8Array.from([0xe2, 0x82]))).toBe(true);
    expect(session.capture("stdout", Uint8Array.from([0xac, 0x20, ...new TextEncoder().encode("canary")]))).toBe(true);
    expect(session.sanitize()).toEqual({ stdout: "€ [redacted]", stderr: "" });
    expect(session.sanitize()).toBeNull();
    expect(session.capture("stdout", new Uint8Array())).toBe(false);
    session.destroy();

    const malformed = sanitizer.create(plan, createInputs())!;
    malformed.capture("stdout", Uint8Array.from([0xff]));
    expect(malformed.sanitize()).toBeNull();
    malformed.destroy();
  });

  test("bounds zero-length, tiny-chunk and aggregate capture and never replays a prefix", () => {
    const sanitizer = new ExecutionSecretOutputSanitizerService();
    const zeroChunks = sanitizer.create(plan, createInputs())!;
    let zeroChunksAccepted = true;
    for (let index = 0; index < 20_000; index += 1) zeroChunksAccepted = zeroChunks.capture("stdout", new Uint8Array()) && zeroChunksAccepted;
    expect(zeroChunksAccepted).toBe(true);
    let acceptedChunks = true;
    for (let index = 0; index < 8_192; index += 1) acceptedChunks = zeroChunks.capture("stdout", Uint8Array.from([65])) && acceptedChunks;
    expect(acceptedChunks).toBe(true);
    expect(zeroChunks.capture("stdout", Uint8Array.from([66]))).toBe(false);
    expect(zeroChunks.sanitize()).toBeNull();
    zeroChunks.destroy();

    const oversized = sanitizer.create(plan, createInputs())!;
    expect(oversized.capture("stdout", new Uint8Array(1024 * 1024 + 1))).toBe(false);
    expect(oversized.sanitize()).toBeNull();
    oversized.destroy();
  });

  test("destroy is idempotent and prevents reuse", () => {
    const session = new ExecutionSecretOutputSanitizerService().create(plan, createInputs())!;
    expect(session.capture("stderr", new TextEncoder().encode("canary"))).toBe(true);
    session.destroy();
    session.destroy();
    expect(session.capture("stderr", new TextEncoder().encode("canary"))).toBe(false);
    expect(session.sanitize()).toBeNull();
  });

  test("withholds output when known-value redaction would exceed the expansion cap", () => {
    const sanitizer = new ExecutionSecretOutputSanitizerService();
    const inputs = createInputs();
    inputs[1]!.bytes.fill(0);
    inputs[1]!.bytes = new TextEncoder().encode(JSON.stringify({ cookies: "x=a", headers: "" }));
    const session = sanitizer.create(plan, inputs)!;
    expect(session.capture("stdout", new TextEncoder().encode("a ".repeat(100_000)))).toBe(true);
    expect(session.sanitize()).toBeNull();
    session.destroy();
  });
});
