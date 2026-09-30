import { describe, expect, test } from "bun:test";
import { clamp } from "../number.helpers";

describe("clamp", () => {
  test("returns value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test("returns min when value is below range", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, 0, 10)).toBe(0);
  });

  test("returns max when value is above range", () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(100, 0, 10)).toBe(10);
  });

  test("handles negative ranges", () => {
    expect(clamp(-5, -10, 0)).toBe(-5);
    expect(clamp(-15, -10, 0)).toBe(-10);
    expect(clamp(5, -10, 0)).toBe(0);
  });

  test("handles single-value range", () => {
    expect(clamp(5, 10, 10)).toBe(10);
    expect(clamp(15, 10, 10)).toBe(10);
  });
});
