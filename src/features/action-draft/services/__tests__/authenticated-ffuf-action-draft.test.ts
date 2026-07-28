import { describe, expect, test } from "bun:test";
import { ActionDraftRecord } from "../../model/action-draft.types";
import {
  buildFfufCommand,
  createInitialFfufToolData,
} from "../../../tool/ffuf/services/ffuf-command.helpers";
import {
  setFfufAuthenticationAvailability,
  toggleFfufAuthenticatedContext,
} from "../../../tool/ffuf/services/ffuf-authentication.helpers";
import { FfufToolData } from "../../../tool/ffuf/types/ffuf.types";
import { mapActionDraftToWorkspaceState } from "../action-draft-workspace.mapper";

const acceptedAuthenticationContext = {
  origin: "https://example.com",
  cookieCount: 1,
  headerNames: ["Authorization"],
  storageMode: "secure" as const,
  importSource: "manual" as const,
  updatedAt: "2026-07-28T10:00:00.000Z",
  authCheck: {
    status: "verified" as const,
    verificationUrl: "https://example.com/account",
    checkedAt: "2026-07-28T10:01:00.000Z",
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
    targetTool: "ffuf",
    status: "draft",
    title: "Authenticated FFUF run",
    summary: "",
    payload: { formState },
    createdAt: "2026-07-28T10:04:00.000Z",
    updatedAt: "2026-07-28T10:04:00.000Z",
  };
}

function applyDraft(draft: ActionDraftRecord, currentToolData: FfufToolData) {
  return mapActionDraftToWorkspaceState({
    draft,
    currentToolName: "ffuf",
    currentToolData,
    authenticatedContext: acceptedAuthenticationContext,
    buildGeneratedCommand: (toolData) => buildFfufCommand(toolData as FfufToolData),
  });
}

describe("authenticated FFUF action drafts", () => {
  test("applies explicit accepted opt-in to all three modes without command secrets", () => {
    const cases = [
      {
        mode: "content_discovery",
        targetPattern: "https://example.com/FUZZ",
        wordlist: "/tmp/content.txt",
      },
      {
        mode: "parameter_discovery",
        endpoint: "https://example.com/search",
        requestLocation: "query",
        wordlist: "/tmp/parameters.txt",
      },
      {
        mode: "value_fuzzing",
        endpoint: "https://example.com/search",
        parameterName: "q",
        requestLocation: "query",
        wordlist: "/tmp/payloads.txt",
      },
    ];

    for (const formState of cases) {
      const result = applyDraft(
        createDraft({ ...formState, useAuthenticatedContext: true }),
        createInitialFfufToolData("https://example.com"),
      );

      expect(result.ok && result.application.toolData).toMatchObject({
        mode: formState.mode,
        form: { isAuthenticatedContextEnabled: true },
        authentication: {
          strategy: "session",
          isAvailable: true,
          origin: "https://example.com",
        },
      });
      expect(result.ok && result.application.commandInput).not.toContain("Authorization");
      expect(result.ok && result.application.commandInput).not.toContain("Cookie");
    }
  });

  test("rejects missing, unaccepted, mismatched, and raw credential contexts", () => {
    const currentToolData = createInitialFfufToolData("https://example.com");
    const draft = createDraft({
      mode: "content_discovery",
      targetPattern: "https://example.com/FUZZ",
      useAuthenticatedContext: true,
    });
    const buildGeneratedCommand = (toolData: unknown) =>
      buildFfufCommand(toolData as FfufToolData);

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
      {
        ...acceptedAuthenticationContext,
        origin: "https://api.example.com",
      },
    ]) {
      expect(
        mapActionDraftToWorkspaceState({
          draft,
          currentToolName: "ffuf",
          currentToolData,
          authenticatedContext,
          buildGeneratedCommand,
        }),
      ).toEqual({
        ok: false,
        reason:
          "This draft requires an accepted authentication context for the target's exact origin.",
      });
    }

    expect(
      applyDraft(
        {
          ...draft,
          payload: {
            command:
              "ffuf -u https://example.com/FUZZ -b session=secret -w /tmp/content.txt",
            formState: {
              mode: "content_discovery",
              targetPattern: "https://example.com/FUZZ",
              useAuthenticatedContext: true,
            },
          },
        },
        currentToolData,
      ),
    ).toEqual({
      ok: false,
      reason:
        "Authenticated FFUF drafts must not include credential or raw-request command flags.",
    });
  });

  test("does not inherit authentication when next draft omits explicit selection", () => {
    let currentToolData: FfufToolData = createInitialFfufToolData("https://example.com");
    currentToolData = setFfufAuthenticationAvailability(
      currentToolData,
      "https://example.com",
    );
    currentToolData = toggleFfufAuthenticatedContext(currentToolData);
    const result = applyDraft(
      createDraft({
        mode: "content_discovery",
        targetPattern: "https://example.com/FUZZ",
        wordlist: "/tmp/content.txt",
      }),
      currentToolData,
    );

    expect(result.ok && result.application.toolData).toMatchObject({
      form: { isAuthenticatedContextEnabled: false },
      authentication: { strategy: "none" },
    });
  });
});
