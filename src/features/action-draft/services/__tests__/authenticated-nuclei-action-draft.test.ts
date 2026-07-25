import { describe, expect, it } from "bun:test";
import { ActionDraftRecord } from "../../model/action-draft.types";
import { nucleiCommandService } from "../../../tool/nuclei/services/nuclei-command.service";
import { mapActionDraftToWorkspaceState } from "../action-draft-workspace.mapper";

const acceptedAuthenticationContext = {
  origin: "https://example.com",
  cookieCount: 1,
  headerNames: ["Authorization"],
  storageMode: "secure" as const,
  importSource: "manual" as const,
  updatedAt: "2026-05-10T10:00:00.000Z",
  authCheck: {
    status: "verified" as const,
    verificationUrl: "https://example.com/account",
    checkedAt: "2026-05-10T10:01:00.000Z",
    acknowledgedAt: null,
    isProceedAllowed: true,
    summary: "Authentication verified.",
    signals: null,
  },
};

function createAuthenticatedDraft(): ActionDraftRecord {
  return {
    id: "draft-1",
    sessionId: "session-1",
    opencodeConversationId: "conversation-1",
    targetTool: "nuclei",
    status: "draft",
    title: "Authenticated exposure check",
    summary: "",
    payload: {
      formState: {
        target: "https://example.com",
        useAuthenticatedContext: true,
      },
    },
    createdAt: "2026-05-10T10:04:00.000Z",
    updatedAt: "2026-05-10T10:04:00.000Z",
  };
}

describe("authenticated Nuclei action drafts", () => {
  it("applies explicit opt-in with accepted exact-origin context", () => {
    const currentToolData = nucleiCommandService.createInitialToolData("https://example.com");
    const result = mapActionDraftToWorkspaceState({
      draft: createAuthenticatedDraft(),
      currentToolName: "nuclei",
      currentToolData,
      authenticatedContext: acceptedAuthenticationContext,
      buildGeneratedCommand: (toolData) =>
        nucleiCommandService.buildCommand(toolData as typeof currentToolData),
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

  it("rejects opt-in without accepted exact-origin context", () => {
    const currentToolData = nucleiCommandService.createInitialToolData("https://example.com");
    const buildGeneratedCommand = (toolData: unknown) =>
      nucleiCommandService.buildCommand(toolData as typeof currentToolData);

    expect(
      mapActionDraftToWorkspaceState({
        draft: createAuthenticatedDraft(),
        currentToolName: "nuclei",
        currentToolData,
        authenticatedContext: null,
        buildGeneratedCommand,
      }),
    ).toEqual({
      ok: false,
      reason:
        "This draft requires an accepted authentication context for the target's exact origin.",
    });
    expect(
      mapActionDraftToWorkspaceState({
        draft: createAuthenticatedDraft(),
        currentToolName: "nuclei",
        currentToolData,
        authenticatedContext: {
          ...acceptedAuthenticationContext,
          origin: "https://api.example.com",
        },
        buildGeneratedCommand,
      }),
    ).toEqual({
      ok: false,
      reason:
        "This draft requires an accepted authentication context for the target's exact origin.",
    });
  });

  it("does not inherit authentication opt-in when the next draft omits it", () => {
    let currentToolData = nucleiCommandService.createInitialToolData("https://example.com");
    currentToolData = nucleiCommandService.setAuthenticationAvailability(
      currentToolData,
      "https://example.com",
    );
    currentToolData = nucleiCommandService.toggleAuthenticatedContext(currentToolData);
    const draft = createAuthenticatedDraft();
    draft.payload = {
      formState: {
        target: "https://example.com",
        tags: "exposure",
      },
    };

    const result = mapActionDraftToWorkspaceState({
      draft,
      currentToolName: "nuclei",
      currentToolData,
      authenticatedContext: acceptedAuthenticationContext,
      buildGeneratedCommand: (toolData) =>
        nucleiCommandService.buildCommand(toolData as typeof currentToolData),
    });

    expect(result.ok && result.application.toolData).toMatchObject({
      form: { useAuthenticatedContext: false },
      authentication: { strategy: "none" },
    });
  });
});
