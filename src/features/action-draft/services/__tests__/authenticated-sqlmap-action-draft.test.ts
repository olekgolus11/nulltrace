import { describe, expect, test } from "bun:test";
import { ActionDraftRecord } from "../../model/action-draft.types";
import { AuthenticatedRequestContextMetadata } from "../../../authentication/model/authenticated-request-context.types";
import { sqlmapCommandService } from "../../../tool/sqlmap/services/sqlmap-command.service";
import {
  setSqlmapAuthenticationAvailability,
  toggleSqlmapAuthenticatedContext,
} from "../../../tool/sqlmap/services/sqlmap-authentication.helpers";
import { SqlmapToolData } from "../../../tool/sqlmap/types/sqlmap.types";
import { mapActionDraftToWorkspaceState } from "../action-draft-workspace.mapper";

const acceptedAuthenticationContext = {
  origin: "https://example.com",
  cookieCount: 1,
  headerNames: ["Authorization"],
  storageMode: "secure" as const,
  importSource: "manual" as const,
  updatedAt: "2026-08-01T10:00:00.000Z",
  authCheck: {
    status: "verified" as const,
    verificationUrl: "https://example.com/account",
    checkedAt: "2026-08-01T10:01:00.000Z",
    acknowledgedAt: null,
    isProceedAllowed: true,
    summary: "Authentication verified.",
    signals: null,
  },
};

function createDraft(formState: Record<string, unknown>): ActionDraftRecord {
  return {
    id: "draft-1",
    sessionId: "session-1",
    opencodeConversationId: "conversation-1",
    targetTool: "sqlmap",
    status: "draft",
    title: "Authenticated sqlmap verification",
    summary: "",
    payload: { formState },
    createdAt: "2026-08-01T10:04:00.000Z",
    updatedAt: "2026-08-01T10:04:00.000Z",
  };
}

function applyDraft(
  draft: ActionDraftRecord,
  currentToolData: SqlmapToolData,
  authenticatedContext: AuthenticatedRequestContextMetadata | null =
    acceptedAuthenticationContext,
) {
  return mapActionDraftToWorkspaceState({
    draft,
    currentToolName: "sqlmap",
    currentToolData,
    authenticatedContext,
    buildGeneratedCommand: (toolData) =>
      sqlmapCommandService.buildCommand(toolData as SqlmapToolData),
  });
}

describe("authenticated sqlmap action drafts", () => {
  test("applies explicit accepted opt-in without putting secrets in command state", () => {
    const result = applyDraft(
      createDraft({
        targetUrl: "https://example.com/products?id=1",
        method: "GET",
        parameter: "id",
        useAuthenticatedContext: true,
      }),
      sqlmapCommandService.createInitialToolData("https://example.com"),
    );

    expect(result.ok && result.application.toolData).toMatchObject({
      form: { useAuthenticatedContext: true },
      authentication: {
        strategy: "session",
        isAvailable: true,
        origin: "https://example.com",
      },
    });
    expect(result.ok && result.application.commandInput).not.toContain("Authorization");
    expect(result.ok && result.application.commandInput).not.toContain("Cookie");
  });

  test("rejects absent, rejected, and mismatched accepted contexts", () => {
    const draft = createDraft({
      targetUrl: "https://example.com/products?id=1",
      method: "GET",
      parameter: "id",
      useAuthenticatedContext: true,
    });
    const toolData = sqlmapCommandService.createInitialToolData("https://example.com");

    for (const authenticatedContext of [
      null,
      {
        ...acceptedAuthenticationContext,
        authCheck: {
          ...acceptedAuthenticationContext.authCheck,
          status: "failed" as const,
          isProceedAllowed: false,
        },
      },
      { ...acceptedAuthenticationContext, origin: "https://api.example.com" },
    ]) {
      expect(applyDraft(draft, toolData, authenticatedContext)).toEqual({
        ok: false,
        reason:
          "This draft requires an accepted authentication context for the target's exact origin.",
      });
    }
  });

  test("does not inherit authentication when next draft omits explicit selection", () => {
    let toolData = sqlmapCommandService.createInitialToolData(
      "https://example.com/products?id=1",
    );
    toolData = setSqlmapAuthenticationAvailability(
      toolData,
      "https://example.com",
    );
    toolData = toggleSqlmapAuthenticatedContext(toolData);
    const result = applyDraft(
      createDraft({
        targetUrl: "https://example.com/products?id=1",
        method: "GET",
        parameter: "id",
      }),
      toolData,
    );

    expect(result.ok && result.application.toolData).toMatchObject({
      form: { useAuthenticatedContext: false },
      authentication: { strategy: "none" },
    });
  });
});
