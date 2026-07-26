import { describe, expect, it } from "bun:test";
import { ActionDraftRecord } from "../../model/action-draft.types";
import { mapActionDraftToWorkspaceState } from "../action-draft-workspace.mapper";
import { nmapCommandService } from "../../../tool/nmap/services/nmap-command.service";
import { nucleiCommandService } from "../../../tool/nuclei/services/nuclei-command.service";
import {
  buildFfufCommand,
  createInitialFfufToolData,
} from "../../../tool/ffuf/services/ffuf-command.helpers";
import { niktoCommandService } from "../../../tool/nikto/services/nikto-command.service";

function createDraft(overrides: Partial<ActionDraftRecord> = {}): ActionDraftRecord {
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
    const currentToolData = nmapCommandService.createInitialToolData("https://example.com");
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
    const currentToolData = nucleiCommandService.createInitialToolData("https://example.com");
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

  it("maps FFUF Content Discovery state without running it", () => {
    const currentToolData = createInitialFfufToolData("https://example.com");
    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({
        targetTool: "ffuf",
        title: "Discover hidden content",
        payload: {
          formState: {
            targetPattern: "https://example.com/FUZZ",
            wordlist: "/tmp/common.txt",
            extensions: ".php",
            recursion: true,
            recursionDepth: "2",
            matchCodes: "200,301",
            filterCodes: "404",
            rate: "20",
            timeLimit: "10",
          },
        },
      }),
      currentToolName: "ffuf",
      currentToolData,
      buildGeneratedCommand: (toolData) => buildFfufCommand(toolData as typeof currentToolData),
    });

    expect(result).toMatchObject({
      ok: true,
      application: {
        commandInput:
          "ffuf -u https://example.com/FUZZ -w /tmp/common.txt -e .php -recursion -recursion-depth 2 -mc 200,301 -fc 404 -rate 20 -maxtime 10",
        commandSource: "generated",
      },
    });
    expect(result.ok && result.application.toolData).toMatchObject({
      mode: "content_discovery",
      form: {
        wordlist: "/tmp/common.txt",
        recursion: true,
      },
    });
  });

  it("maps a Parameter Discovery draft into an editable FFUF workspace without running it", () => {
    const currentToolData = createInitialFfufToolData("https://example.com");
    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({
        targetTool: "ffuf",
        title: "Discover search parameters",
        payload: {
          formState: {
            mode: "parameter_discovery",
            endpoint: "https://example.com/search",
            requestLocation: "header",
            wordlist: "/tmp/parameters.txt",
            matchCodes: "200,302",
            filterCodes: "404",
            rate: "20",
            timeLimit: "15",
          },
        },
      }),
      currentToolName: "ffuf",
      currentToolData,
      buildGeneratedCommand: (toolData) => buildFfufCommand(toolData as typeof currentToolData),
    });

    expect(result).toMatchObject({
      ok: true,
      application: {
        commandInput:
          "ffuf -u 'https://example.com/search' -H 'FUZZ: nulltrace' -w /tmp/parameters.txt -mc 200,302 -fc 404 -rate 20 -maxtime 15",
        commandSource: "generated",
      },
    });
    expect(result.ok && result.application.toolData).toMatchObject({
      mode: "parameter_discovery",
      form: {
        endpoint: "https://example.com/search",
        requestLocation: "header",
      },
    });
  });

  it("rejects mismatched tool and unusable payloads", () => {
    const currentToolData = nmapCommandService.createInitialToolData("https://example.com");

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
      reason: "This draft has no usable command or form state for the current workspace.",
    });
  });

  it("applies Nikto Standard draft without running it", () => {
    const currentToolData = niktoCommandService.createInitialToolData("https://example.com");
    const result = mapActionDraftToWorkspaceState({
      draft: createDraft({
        targetTool: "nikto",
        title: "Scan web server",
        payload: {
          formState: {
            target: "https://example.com",
            rootPath: "/app",
            vhost: "app.example.com",
            timeoutSeconds: "120",
            profile: "standard",
          },
        },
      }),
      currentToolName: "nikto",
      currentToolData,
      buildGeneratedCommand: (data) =>
        niktoCommandService.buildCommand(data as typeof currentToolData),
    });

    expect(result).toMatchObject({
      ok: true,
      application: {
        commandInput:
          "nikto -h 'https://example.com' -root '/app' -vhost 'app.example.com' -maxtime 120s",
        commandSource: "generated",
        message: "Applied action draft: Scan web server",
      },
    });
  });
});
