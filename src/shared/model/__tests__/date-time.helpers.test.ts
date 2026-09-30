import { describe, expect, test } from "bun:test";
import { formatSessionTimestamp } from "../date-time.helpers";

describe("formatSessionTimestamp", () => {
  test("formats timestamp with mm/dd hh:mm format", () => {
    const result = formatSessionTimestamp("2024-03-15T14:30:00Z");
    expect(result).toMatch(/^\d{2}\/\d{2}, \d{1,2}:\d{2} (AM|PM)$/);
  });

  test("handles different timezones consistently", () => {
    const result1 = formatSessionTimestamp("2024-01-01T00:00:00Z");
    const result2 = formatSessionTimestamp("2024-01-01T12:00:00Z");
    expect(result1).toBeTruthy();
    expect(result2).toBeTruthy();
    expect(result1).not.toBe(result2);
  });
});
