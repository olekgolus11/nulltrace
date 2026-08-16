import { describe, expect, test } from "bun:test";
import {
  normalizeAuthenticatedRequestBrowserStorage,
  parseAuthenticatedRequestStorageEntries,
} from "../authenticated-request-browser-storage.helpers";

describe("authenticated request browser storage", () => {
  test("parses browser-exported JSON while preserving string values", () => {
    expect(
      parseAuthenticatedRequestStorageEntries(
        '{"user":"{\\"id\\":1}","theme":"dark"}',
        "localStorage",
      ),
    ).toEqual({
      user: '{"id":1}',
      theme: "dark",
    });
  });

  test("rejects malformed, non-object, and non-string storage values", () => {
    expect(() => parseAuthenticatedRequestStorageEntries("{", "localStorage")).toThrow(
      "valid JSON object",
    );
    expect(() => parseAuthenticatedRequestStorageEntries("[]", "localStorage")).toThrow(
      "JSON object",
    );
    expect(() =>
      parseAuthenticatedRequestStorageEntries('{"user":{"id":1}}', "localStorage"),
    ).toThrow("values must all be strings");
  });

  test("bounds entry count without limiting storage value length", () => {
    const tooManyEntries = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`key-${index}`, "value"]),
    );
    expect(() =>
      normalizeAuthenticatedRequestBrowserStorage({
        localStorage: tooManyEntries,
        sessionStorage: {},
      }),
    ).toThrow("more than 64 entries");
    expect(
      normalizeAuthenticatedRequestBrowserStorage({
        localStorage: { user: "x".repeat(256 * 1_024) },
        sessionStorage: {},
      }),
    ).toEqual({
      localStorage: { user: "x".repeat(256 * 1_024) },
      sessionStorage: {},
    });
  });
});
