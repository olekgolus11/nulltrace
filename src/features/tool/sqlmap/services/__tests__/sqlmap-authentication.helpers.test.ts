import { describe, expect, test } from "bun:test";
import { sqlmapCommandService } from "../sqlmap-command.service";
import {
  resetSqlmapRunScopedState,
  setSqlmapAuthenticationAvailability,
  toggleSqlmapAuthenticatedContext,
} from "../sqlmap-authentication.helpers";

describe("sqlmap authentication selection", () => {
  test("defaults each workspace to public mode", () => {
    const toolData = sqlmapCommandService.createInitialToolData(
      "https://example.com/products?id=1",
    );

    expect(toolData.form.useAuthenticatedContext).toBe(false);
    expect(toolData.authentication).toEqual({
      strategy: "none",
      isAvailable: false,
      origin: null,
    });
  });

  test("enables only an explicitly selected exact-origin accepted context", () => {
    let toolData = sqlmapCommandService.createInitialToolData(
      "https://example.com/products?id=1",
    );
    toolData = setSqlmapAuthenticationAvailability(
      toolData,
      "https://example.com",
    );

    expect(toolData.authentication.isAvailable).toBe(true);
    expect(toolData.form.useAuthenticatedContext).toBe(false);
    toolData = toggleSqlmapAuthenticatedContext(toolData);
    expect(toolData.form.useAuthenticatedContext).toBe(true);
    expect(toolData.authentication.strategy).toBe("session");

    toolData = sqlmapCommandService.setField(
      toolData,
      "targetUrl",
      "https://api.example.com/products?id=1",
    );
    expect(toolData.form.useAuthenticatedContext).toBe(false);
    expect(toolData.authentication.isAvailable).toBe(false);
    expect(toolData.authentication.strategy).toBe("none");
  });

  test("resets explicit authentication selection after one run", () => {
    let toolData = sqlmapCommandService.createInitialToolData(
      "https://example.com/products?id=1",
    );
    toolData = setSqlmapAuthenticationAvailability(
      toolData,
      "https://example.com",
    );
    toolData = toggleSqlmapAuthenticatedContext(toolData);

    const reset = resetSqlmapRunScopedState(toolData);

    expect(reset.form.useAuthenticatedContext).toBe(false);
    expect(reset.authentication.strategy).toBe("none");
    expect(reset.authentication.isAvailable).toBe(true);
  });
});
