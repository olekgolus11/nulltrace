import { describe, expect, it } from "bun:test";
import { ActionDraftRecord } from "../../model/action-draft.types";
import { mapActionDraftToWorkspaceState } from "../action-draft-workspace.mapper";
import { nmapCommandService } from "../../../tool/nmap/services/nmap-command.service";
import { nucleiCommandService } from "../../../tool/nuclei/services/nuclei-command.service";

function createDraft(
  overrides: Partial<ActionDraftRecord> = {},
): ActionDraftRecord {
  return {
    id: "draft-1",
    sessionId: "session-1",
    opencodeConversationId: "conversation-1",
    targetTool: "nmap",
    status: "draft",
    title: "Probe web ports",
    summary: "Inspect common HTTP ports.",
    payload: {},
    createdAt: "2026-05-10T10:04:00.000Z",
    updatedAt: "2026-05-10T10:04:00.000Z",
    ...overrides,
  };
}

describe("mapActionDraftToWorkspaceState", () => {
  it("maps nmap form and command payloads into editable workspace state", () => {
    const currentToolData =
      nmapCommandService.createInitialToolData("https://example.com");
    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({
        payload: {
          command: "nmap -Pn -sS -sV -p 80,443 example.com",
          formState: {
            target: "example.com",
            ports: "80,443",
            timing: "T4",
            serviceDetection: true,
            osDetection: false,
            defaultScripts: true,
            aggressive: false,
            extraArgs: "-Pn -sS",
          },
        },
      }),
      currentToolName: "nmap",
      currentToolData,
      buildGeneratedCommand: (toolData) =>
        nmapCommandService.buildCommand(toolData as typeof currentToolData),
    });

    expect(result).toMatchObject({
      ok: true,
      application: {
        commandInput: "nmap -Pn -sS -sV -p 80,443 example.com",
        commandSource: "manual",
        message: "Applied action draft: Probe web ports",
      },
    });
    expect(result.ok && result.application.toolData).toMatchObject({
      form: {
        target: "example.com",
        ports: "80,443",
        timing: "T4",
        defaultScripts: true,
        extraArgs: "-Pn -sS",
      },
    });
  });

  it("maps nuclei form state and uses generated command when no command is supplied", () => {
    const currentToolData =
      nucleiCommandService.createInitialToolData("https://example.com");
    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({
        targetTool: "nuclei",
        title: "Check exposures",
        payload: {
          formState: {
            target: "https://example.com",
            severityPreset: "high+",
            tags: "exposure,misconfig",
            templatesPath: "http/exposures/",
            extraArgs: "-rate-limit 20",
          },
        },
      }),
      currentToolName: "nuclei",
      currentToolData,
      buildGeneratedCommand: (toolData) =>
        nucleiCommandService.buildCommand(toolData as typeof currentToolData),
    });

    expect(result).toMatchObject({
      ok: true,
      application: {
        commandInput:
          "nuclei -u https://example.com -severity high,critical -tags exposure,misconfig -t http/exposures/ -rate-limit 20",
        commandSource: "generated",
      },
    });
  });

  it("rejects mismatched tool and unusable payloads", () => {
    const currentToolData =
      nmapCommandService.createInitialToolData("https://example.com");

    expect(
      mapActionDraftToWorkspaceState({
        draft: createDraft({
          targetTool: "nuclei",
        }),
        currentToolName: "nmap",
        currentToolData,
        buildGeneratedCommand: (toolData) =>
          nmapCommandService.buildCommand(toolData as typeof currentToolData),
      }),
    ).toEqual({
      ok: false,
      reason: "This draft targets nuclei, not nmap.",
    });

    expect(
      mapActionDraftToWorkspaceState({
        draft: createDraft({
          payload: {
            formState: {
              timing: "invalid",
            },
          },
        }),
        currentToolName: "nmap",
        currentToolData,
        buildGeneratedCommand: (toolData) =>
          nmapCommandService.buildCommand(toolData as typeof currentToolData),
      }),
    ).toEqual({
      ok: false,
      reason:
        "This draft has no usable command or form state for the current workspace.",
    });
  });
});
