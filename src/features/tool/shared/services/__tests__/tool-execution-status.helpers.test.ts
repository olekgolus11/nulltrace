import { describe, expect, test } from "bun:test";
import { getToolExecutionStatusLabel, isToolExecutionBusy } from "../tool-execution-status.helpers";

describe("tool execution status", () => {
  test("treats pending isolated cleanup as busy and labels it clearly", () => {
    expect(isToolExecutionBusy("running")).toBe(true);
    expect(isToolExecutionBusy("cancelling")).toBe(true);
    expect(isToolExecutionBusy("cancelled")).toBe(false);
    expect(getToolExecutionStatusLabel("cancelling", null)).toBe("cancelling; waiting for cleanup");
    expect(getToolExecutionStatusLabel("success", 0)).toBe("success (0)");
  });
});
