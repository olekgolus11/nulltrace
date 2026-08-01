import { expect, test } from "bun:test";
import { getNiktoOutputScrollHeight } from "../nikto-workspace-layout.helpers";

test("uses the exact remaining Standard output height", () => {
  expect(getNiktoOutputScrollHeight(36, 16, 8)).toBe(8);
});

test("subtracts Custom and authentication rows from the output height", () => {
  expect(getNiktoOutputScrollHeight(36, 20, 8)).toBe(4);
});

test("uses the exact remaining height in compact Standard and Custom workspaces", () => {
  expect(getNiktoOutputScrollHeight(28, 14, 8)).toBe(2);
  expect(getNiktoOutputScrollHeight(32, 18, 8)).toBe(2);
});

test("clamps the output height to zero after a compact resize", () => {
  expect(getNiktoOutputScrollHeight(12, 18, 8)).toBe(0);
});
