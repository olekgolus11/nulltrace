import { describe, expect, test } from "bun:test";
import type { AuthCheckWorkerResult } from "../../../../../infrastructure/isolation/auth-check-worker.types";
import { ExecutionAuthCheckOutputSanitizerService } from "../execution-auth-check-output-sanitizer.service";
import { createAuthCheckExecutionPlan } from "../auth-check-execution-profile.helpers";
import { ExecutionCredentialBinding } from "../../types/execution-broker.types";

const plan = createAuthCheckExecutionPlan({
  executionId: "auth-check-run",
  authorizationId: "trusted-approval",
  origin: "https://example.test",
});
const binding: ExecutionCredentialBinding = { scopeId: "installation-scope", generation: 7 };
const config = {
  version: 1,
  operation: "auth-check",
  contextVersion: 7,
  targetOrigin: "https://example.test",
  verificationUrl: "https://example.test/account",
  authenticatedHeaders: ["cookie: session=never-export"],
  requestTimeoutMs: 10_000,
  maximumResponseBytes: 128_000,
  maximumRedirectCount: 5,
  totalDeadlineMs: 30_000,
};
const result: AuthCheckWorkerResult = {
  version: 1,
  operation: "auth-check",
  status: "verified",
  isProceedAllowed: true,
  unauthenticated: { status: 401, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: true },
  authenticated: { status: 200, redirectCount: 0, hasCrossOriginRedirect: false, contentKind: "html", hasLoginForm: false },
  differences: {
    statusChanged: true,
    redirectsChanged: false,
    contentKindChanged: false,
    contentChanged: false,
    titleChanged: false,
    loginFormChanged: true,
  },
};

function createInput(contextVersion = config.contextVersion) {
  return [{
    slot: { ...plan.inputs[0]! },
    bytes: new TextEncoder().encode(JSON.stringify({ ...config, contextVersion })),
  }];
}

describe("Auth Check result sanitizer", () => {
  test("validates and reserializes exactly one safe worker frame", () => {
    const session = new ExecutionAuthCheckOutputSanitizerService().create(plan, createInput(), binding)!;
    const frame = `${JSON.stringify(result)}\n`;
    expect(session.capture("stdout", new TextEncoder().encode(frame))).toBe(true);
    expect(session.sanitize()).toEqual({ stdout: frame, stderr: "" });
    session.destroy();
  });

  test("withholds stderr, extra frames, malformed schemas, and generation or origin mismatches", () => {
    const sanitizer = new ExecutionAuthCheckOutputSanitizerService();
    expect(sanitizer.create(plan, createInput(8), binding)).toBeNull();
    const wrongOrigin = createInput();
    wrongOrigin[0]!.bytes = new TextEncoder().encode(JSON.stringify({ ...config, targetOrigin: "https://other.test" }));
    expect(sanitizer.create(plan, wrongOrigin, binding)).toBeNull();

    const stderr = sanitizer.create(plan, createInput(), binding)!;
    expect(stderr.capture("stderr", new TextEncoder().encode("secret error marker"))).toBe(false);
    expect(stderr.sanitize()).toBeNull();

    const multiple = sanitizer.create(plan, createInput(), binding)!;
    expect(multiple.capture("stdout", new TextEncoder().encode(`${JSON.stringify(result)}\n${JSON.stringify(result)}\n`))).toBe(true);
    expect(multiple.sanitize()).toBeNull();

    const invalid = sanitizer.create(plan, createInput(), binding)!;
    expect(invalid.capture("stdout", new TextEncoder().encode(`${JSON.stringify({ ...result, secret: "secret-marker" })}\n`))).toBe(true);
    expect(invalid.sanitize()).toBeNull();
  });
});
