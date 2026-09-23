import { describe, expect, test } from "bun:test";
import { toExecutionOutcome } from "../execution-outcome.helpers";

describe("execution outcome mapping", () => {
  test("keeps scanner exit, termination cause and cleanup independent", () => {
    expect(toExecutionOutcome({ executionId: "run-1", status: "finished", stopReason: null, exitCode: 0, cleanup: "confirmed" }))
      .toMatchObject({ cause: "normal", exitCode: 0, cleanup: "confirmed" });
    expect(toExecutionOutcome({ executionId: "run-2", status: "finished", stopReason: null, exitCode: 7, cleanup: "confirmed" }))
      .toMatchObject({ cause: "nonzero_exit", exitCode: 7, cleanup: "confirmed" });
    expect(toExecutionOutcome({ executionId: "run-3", status: "interrupted", stopReason: "cancelled", exitCode: null, cleanup: "pending" }))
      .toMatchObject({ cause: "cancelled", cleanup: "pending" });
  });
});
