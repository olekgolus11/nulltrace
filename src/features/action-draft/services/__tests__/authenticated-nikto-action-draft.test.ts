import { describe, expect, test } from "bun:test";
import { ActionDraftRecord } from "../../model/action-draft.types";
import { niktoCommandService } from "../../../tool/nikto/services/nikto-command.service";
import { mapActionDraftToWorkspaceState } from "../action-draft-workspace.mapper";

const acceptedAuthenticationContext = {
  origin: "https://example.com",
  cookieCount: 1,
  headerNames: ["Authorization"],
  storageMode: "secure" as const,
  importSource: "manual" as const,
  updatedAt: "2026-07-31T10:00:00.000Z",
  authCheck: {
    status: "verified" as const,
    verificationUrl: "https://example.com/account",
    checkedAt: "2026-07-31T10:01:00.000Z",
    acknowledgedAt: null,
    isProceedAllowed: true,
    summary: "Authentication verified.",
    signals: null,
  },
};

function createDraft(formState: Record<string, unknown>): ActionDraftRecord {
  return {
    id: "draft-nikto-auth",
    sessionId: "session-1",
    opencodeConversationId: "conversation-1",
    targetTool: "nikto",
    status: "draft",
    title: "Authenticated Nikto scan",
    summary: "",
    payload: { formState },
    createdAt: "2026-07-31T10:04:00.000Z",
    updatedAt: "2026-07-31T10:04:00.000Z",
  };
}

describe("authenticated Nikto action drafts", () => {
  test("applies explicit opt-in only with accepted exact-origin context", () => {
    const currentToolData = niktoCommandService.createInitialToolData(
      "https://example.com",
    );
    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({
        target: "https://example.com/protected",
        useAuthenticatedContext: true,
      }),
      currentToolName: "nikto",
      currentToolData,
      authenticatedContext: acceptedAuthenticationContext,
      buildGeneratedCommand: (toolData) =>
        niktoCommandService.buildCommand(toolData as typeof currentToolData),
    });

    expect(result.ok && result.application.toolData).toMatchObject({
      form: { useAuthenticatedContext: true },
      authentication: {
        strategy: "session",
        isAvailable: true,
        origin: "https://example.com",
      },
    });
  });

  test("rejects missing, rejected, and wrong-origin context", () => {
    const currentToolData = niktoCommandService.createInitialToolData(
      "https://example.com",
    );
    const buildGeneratedCommand = (toolData: unknown) =>
      niktoCommandService.buildCommand(toolData as typeof currentToolData);
    const expected = {
      ok: false,
      reason:
        "This draft requires an accepted authentication context for the target's exact origin.",
    } as const;

    expect(
      mapActionDraftToWorkspaceState({
        draft: createDraft({ useAuthenticatedContext: true }),
        currentToolName: "nikto",
        currentToolData,
        authenticatedContext: null,
        buildGeneratedCommand,
      }),
    ).toEqual(expected);
    expect(
      mapActionDraftToWorkspaceState({
        draft: createDraft({ useAuthenticatedContext: true }),
        currentToolName: "nikto",
        currentToolData,
        authenticatedContext: {
          ...acceptedAuthenticationContext,
          authCheck: {
            ...acceptedAuthenticationContext.authCheck,
            isProceedAllowed: false,
          },
        },
        buildGeneratedCommand,
      }),
    ).toEqual(expected);
    expect(
      mapActionDraftToWorkspaceState({
        draft: createDraft({
          target: "https://api.example.com",
          useAuthenticatedContext: true,
        }),
        currentToolName: "nikto",
        currentToolData,
        authenticatedContext: acceptedAuthenticationContext,
        buildGeneratedCommand,
      }),
    ).toEqual(expected);
  });

  test("does not inherit authentication when a later draft omits opt-in", () => {
    let currentToolData = niktoCommandService.createInitialToolData(
      "https://example.com",
    );
    currentToolData = niktoCommandService.setAuthenticationAvailability(
      currentToolData,
      "https://example.com",
    );
    currentToolData = niktoCommandService.toggleAuthenticatedContext(currentToolData);

    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({ target: "https://example.com", rootPath: "/admin" }),
      currentToolName: "nikto",
      currentToolData,
      authenticatedContext: acceptedAuthenticationContext,
      buildGeneratedCommand: (toolData) =>
        niktoCommandService.buildCommand(toolData as typeof currentToolData),
    });

    expect(result.ok && result.application.toolData).toMatchObject({
      form: { useAuthenticatedContext: false },
      authentication: { strategy: "none" },
    });
  });
});
