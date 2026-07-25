import { describe, expect, it } from "bun:test";
import {
  ActionDraftInput,
  ActionDraftRecord,
} from "../../../action-draft/model/action-draft.types";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import { SessionFindingRecord } from "../../../finding/model/finding.types";
import {
  ToolRunArtifactRecord,
  ToolRunSummary,
} from "../../../session/model/session.repository.types";
import { ChatContextToolRegistry } from "../chat-context-tool-registry";
import {
  ActiveToolWorkspaceChatContextToolsService,
  ActionDraftChatContextToolsService,
  chatContextToolRegistry,
  createArtifactPayloadPreview,
  createOpenCodeToolSource,
  FindingChatContextToolsService,
  SessionContextChatContextToolsService,
  ToolRunArtifactChatContextToolsService,
} from "../chat-context-tools.service";
import { ToolWorkspaceContextSnapshot } from "../../../tool/shared/services/tool-workspace-context.service";
import { ScannerToolId } from "../../../tool/shared/registry/scanner-catalog";

const chatContextToolsImportPath = new URL("../chat-context-tools.service.ts", import.meta.url)
  .pathname;
const openCodePluginImportPath = new URL(
  "../../../../../node_modules/@opencode-ai/plugin/dist/index.js",
  import.meta.url,
).pathname;

class FakeConversationAttachments {
  constructor(private readonly attachments: ConversationAttachmentRecord[]) {}

  findActiveAttachmentByOpenCodeConversationId(opencodeConversationId: string) {
    return (
      this.attachments.find(
        (attachment) =>
          attachment.opencodeConversationId === opencodeConversationId && !attachment.archivedAt,
      ) ?? null
    );
  }
}

class FakeFindingRepository {
  constructor(private readonly findings: SessionFindingRecord[]) {}

  listBySessionId(sessionId: string) {
    return this.findings.filter((finding) => finding.sessionId === sessionId);
  }
}

class FakeToolRepository {
  constructor(
    private readonly toolRuns: Array<ToolRunSummary & { sessionId: string }>,
    private readonly artifacts: Array<ToolRunArtifactRecord & { sessionId: string }>,
  ) {}

  listToolRunsBySessionId(sessionId: string) {
    return this.toolRuns.filter((run) => run.sessionId === sessionId);
  }

  findToolRunArtifactByIdForSession(sessionId: string, artifactId: string) {
    return (
      this.artifacts.find(
        (artifact) => artifact.sessionId === sessionId && artifact.id === artifactId,
      ) ?? null
    );
  }
}

class FakeToolWorkspaceContextRepository {
  constructor(private readonly snapshots: ToolWorkspaceContextSnapshot[]) {}

  getActiveWorkspace(sessionId: string) {
    return this.snapshots.find((snapshot) => snapshot.sessionId === sessionId) ?? null;
  }
}

class FakeActionDraftRepository {
  readonly drafts: ActionDraftRecord[] = [];

  createDraft(input: ActionDraftInput) {
    const draft: ActionDraftRecord = {
      id: `draft-${this.drafts.length + 1}`,
      sessionId: input.sessionId,
      opencodeConversationId: input.opencodeConversationId ?? null,
      targetTool: input.targetTool,
      status: "draft",
      title: input.title,
      summary: input.summary,
      payload: input.payload,
      createdAt: "2026-05-10T10:04:00.000Z",
      updatedAt: "2026-05-10T10:04:00.000Z",
    };

    this.drafts.push(draft);
    return draft;
  }
}

class FakeSessionRepository {
  getSessionById(sessionId: string) {
    if (sessionId === "session-1") {
      return {
        id: "session-1",
        targetId: "target-1",
        normalizedUrl: "http://honey.scanme.sh",
        displayUrl: "http://honey.scanme.sh",
      };
    }

    if (sessionId === "session-2") {
      return {
        id: "session-2",
        targetId: "target-2",
        normalizedUrl: "https://second.example.com",
        displayUrl: "https://second.example.com",
      };
    }

    return null;
  }
}

function createAttachment(
  sessionId: string,
  opencodeConversationId: string,
  archivedAt: string | null = null,
): ConversationAttachmentRecord {
  return {
    sessionId,
    opencodeConversationId,
    isDefault: true,
    archivedAt,
    createdAt: "2026-05-10T10:00:00.000Z",
  };
}

function createRun(
  id: string,
  sessionId: string,
  toolName: string,
): ToolRunSummary & { sessionId: string } {
  return {
    id,
    sessionId,
    toolName,
    command: `${toolName} example.com`,
    commandSource: "generated",
    status: "success",
    startedAt: "2026-05-10T10:00:00.000Z",
    endedAt: "2026-05-10T10:01:00.000Z",
    exitCode: 0,
  };
}

function createArtifact(
  id: string,
  sessionId: string,
  toolRunId: string,
  payload: unknown,
): ToolRunArtifactRecord & { sessionId: string } {
  return {
    id,
    sessionId,
    toolRunId,
    artifactType: "nuclei_findings",
    label: "Nuclei findings",
    source: "artifacts/nuclei.jsonl",
    payload,
    createdAt: "2026-05-10T10:02:00.000Z",
  };
}

function createFinding(
  id: string,
  sessionId: string,
  title: string,
  overrides: Partial<SessionFindingRecord> = {},
): SessionFindingRecord {
  return {
    id,
    sessionId,
    toolRunArtifactId: `artifact-${id}`,
    sourceTool: "nuclei",
    kind: "nuclei.http",
    severity: "high",
    title,
    summary: `${title} summary.`,
    target: "https://example.com/admin",
    fingerprint: `fingerprint-${id}`,
    payload: {
      artifactFindingIndex: 2,
      artifactItemPath: "$.findings[2]",
      templateId: "cves/2026/example",
      matchedAt: "https://example.com/admin",
      description: "A useful scanner description.",
      references: [
        "https://one.test",
        "https://two.test",
        "https://three.test",
        "https://four.test",
      ],
      raw: "not exposed by chat context tools",
    },
    reviewStatus: "confirmed",
    reviewUpdatedAt: "2026-05-10T10:01:00.000Z",
    firstSeenAt: "2026-05-10T10:00:00.000Z",
    lastSeenAt: "2026-05-10T10:02:00.000Z",
    createdAt: "2026-05-10T10:00:00.000Z",
    ...overrides,
  };
}

function createFindingService() {
  return new FindingChatContextToolsService(
    new FakeConversationAttachments([
      createAttachment("session-1", "opencode-1"),
      createAttachment("session-2", "opencode-2"),
      createAttachment("session-archived", "opencode-archived", "2026-05-10T10:03:00.000Z"),
    ]),
    new FakeFindingRepository([
      createFinding("finding-1", "session-1", "Session one finding"),
      createFinding("finding-3", "session-1", "Medium Nmap finding", {
        sourceTool: "nmap",
        severity: "medium",
        target: "https://example.com/login",
        summary: "Login page allows weak transport settings.",
        reviewStatus: "needs_review",
        reviewUpdatedAt: null,
        lastSeenAt: "2026-05-10T10:03:00.000Z",
      }),
      createFinding("finding-4", "session-1", "Dismissed info finding", {
        sourceTool: "nuclei",
        severity: "info",
        target: "https://example.com/status",
        summary: "Status endpoint discloses a harmless banner.",
        reviewStatus: "dismissed",
        lastSeenAt: "2026-05-10T10:04:00.000Z",
      }),
      createFinding("finding-2", "session-2", "Session two finding"),
      createFinding("finding-archived", "session-archived", "Archived finding"),
    ]),
  );
}

function createToolRunArtifactService() {
  return new ToolRunArtifactChatContextToolsService(
    new FakeConversationAttachments([
      createAttachment("session-1", "opencode-1"),
      createAttachment("session-2", "opencode-2"),
      createAttachment("session-archived", "opencode-archived", "2026-05-10T10:03:00.000Z"),
    ]),
    new FakeToolRepository(
      [
        createRun("run-1", "session-1", "nmap"),
        createRun("run-2", "session-2", "nuclei"),
        createRun("run-archived", "session-archived", "nmap"),
      ],
      [
        createArtifact("artifact-1", "session-1", "run-1", {
          findings: [
            {
              template: "exposed-panel",
              info: "A".repeat(50),
            },
          ],
        }),
        createArtifact("artifact-2", "session-2", "run-2", {
          hosts: [],
        }),
        createArtifact("artifact-archived", "session-archived", "run-3", {
          hidden: true,
        }),
      ],
    ),
  );
}

function createWorkspaceSnapshot(
  overrides: Partial<ToolWorkspaceContextSnapshot> = {},
): ToolWorkspaceContextSnapshot {
  return {
    sessionId: "session-1",
    toolName: "nmap",
    activePanel: "command",
    commandInput: "nmap -sV example.com",
    generatedCommand: "nmap -sV -T3 example.com",
    commandSource: "manual",
    executionStatus: "idle",
    currentToolRunId: null,
    selectedHistoryRunId: "run-1",
    isHistoricPreview: false,
    toolData: {
      selectedField: 0,
      form: {
        target: "example.com",
        ports: "80,443",
        timing: "T3",
        serviceDetection: true,
        osDetection: false,
        defaultScripts: false,
        aggressive: false,
        extraArgs: "",
      },
    },
    updatedAt: "2026-05-10T10:04:00.000Z",
    ...overrides,
  };
}

function createActiveToolWorkspaceService(
  snapshots: ToolWorkspaceContextSnapshot[] = [createWorkspaceSnapshot()],
) {
  return new ActiveToolWorkspaceChatContextToolsService(
    new FakeConversationAttachments([
      createAttachment("session-1", "opencode-1"),
      createAttachment("session-2", "opencode-2"),
      createAttachment("session-archived", "opencode-archived", "2026-05-10T10:03:00.000Z"),
    ]),
    new FakeToolWorkspaceContextRepository(snapshots),
    new FakeToolRepository(
      [
        createRun("run-1", "session-1", "nmap"),
        createRun("run-2", "session-1", "nuclei"),
        createRun("run-3", "session-2", "nmap"),
      ],
      [],
    ),
  );
}

function createSessionContextService() {
  return new SessionContextChatContextToolsService(
    new FakeConversationAttachments([
      createAttachment("session-1", "opencode-1"),
      createAttachment("session-2", "opencode-2"),
      createAttachment("session-archived", "opencode-archived", "2026-05-10T10:03:00.000Z"),
    ]),
    new FakeSessionRepository(),
  );
}

function createActionDraftService(
  drafts = new FakeActionDraftRepository(),
  isAuthenticationAccepted = false,
) {
  return {
    drafts,
    service: new ActionDraftChatContextToolsService(
      new FakeConversationAttachments([
        createAttachment("session-1", "opencode-1"),
        createAttachment("session-2", "opencode-2"),
        createAttachment("session-archived", "opencode-archived", "2026-05-10T10:03:00.000Z"),
      ]),
      drafts,
      new FakeSessionRepository(),
      {
        isProceedAllowed: () => isAuthenticationAccepted,
      },
    ),
  };
}

describe("SessionContextChatContextToolsService", () => {
  it("returns the active session target for the attached OpenCode conversation", () => {
    const result = createSessionContextService().getSessionContext("opencode-1");

    expect(result).toEqual({
      session: {
        id: "session-1",
        targetId: "target-1",
        normalizedTarget: "http://honey.scanme.sh",
        displayTarget: "http://honey.scanme.sh",
      },
    });
  });

  it("rejects archived or unknown OpenCode conversations", () => {
    const service = createSessionContextService();

    expect(() => service.getSessionContext("opencode-archived")).toThrow(
      "No active NullTrace session attachment exists",
    );
    expect(() => service.getSessionContext("unknown-opencode")).toThrow(
      "No active NullTrace session attachment exists",
    );
  });
});

describe("FindingChatContextToolsService", () => {
  it("lists findings for the session attached to the OpenCode conversation", () => {
    const result = createFindingService().listFindings("opencode-1");

    expect(result.findings).toEqual([
      {
        id: "finding-1",
        severity: "high",
        reviewStatus: "confirmed",
        sourceTool: "nuclei",
        target: "https://example.com/admin",
        title: "Session one finding",
        summary: "Session one finding summary.",
      },
      {
        id: "finding-3",
        severity: "medium",
        reviewStatus: "needs_review",
        sourceTool: "nmap",
        target: "https://example.com/login",
        title: "Medium Nmap finding",
        summary: "Login page allows weak transport settings.",
      },
      {
        id: "finding-4",
        severity: "info",
        reviewStatus: "dismissed",
        sourceTool: "nuclei",
        target: "https://example.com/status",
        title: "Dismissed info finding",
        summary: "Status endpoint discloses a harmless banner.",
      },
    ]);
    expect(result.pagination).toEqual({
      limit: 25,
      offset: 0,
      nextOffset: null,
      total: 3,
      hasMore: false,
    });
  });

  it("paginates findings with stable ordering and bounded limits", () => {
    const service = createFindingService();

    const firstPage = service.listFindings("opencode-1", {
      limit: 2,
      offset: 0,
    });
    const secondPage = service.listFindings("opencode-1", {
      limit: 2,
      offset: firstPage.pagination.nextOffset ?? 0,
    });
    const cappedPage = service.listFindings("opencode-1", {
      limit: 500,
      offset: 0,
    });

    expect(firstPage.findings.map((finding) => finding.id)).toEqual(["finding-1", "finding-3"]);
    expect(firstPage.pagination).toEqual({
      limit: 2,
      offset: 0,
      nextOffset: 2,
      total: 3,
      hasMore: true,
    });
    expect(secondPage.findings.map((finding) => finding.id)).toEqual(["finding-4"]);
    expect(secondPage.pagination).toEqual({
      limit: 2,
      offset: 2,
      nextOffset: null,
      total: 3,
      hasMore: false,
    });
    expect(cappedPage.pagination.limit).toBe(100);
  });

  it("narrows finding discovery by query and operator fields", () => {
    const service = createFindingService();

    const queryResult = service.listFindings("opencode-1", {
      limit: 25,
      offset: 0,
      query: "weak transport",
    });
    const sourceToolResult = service.listFindings("opencode-1", {
      limit: 25,
      offset: 0,
      sourceTool: "NMAP",
    });
    const reviewResult = service.listFindings("opencode-1", {
      limit: 25,
      offset: 0,
      severity: "info",
      reviewStatus: "dismissed",
    });

    expect(queryResult.findings.map((finding) => finding.id)).toEqual(["finding-3"]);
    expect(sourceToolResult.findings.map((finding) => finding.id)).toEqual(["finding-3"]);
    expect(reviewResult.findings.map((finding) => finding.id)).toEqual(["finding-4"]);
    expect(JSON.stringify(queryResult)).not.toContain("not exposed by chat context tools");
  });

  it("gets finding detail only inside the attached session", () => {
    const service = createFindingService();

    const ownFinding = service.getFinding("opencode-1", {
      findingId: "finding-1",
    });
    const otherSessionFinding = service.getFinding("opencode-1", {
      findingId: "finding-2",
    });

    expect(ownFinding.finding).toMatchObject({
      id: "finding-1",
      kind: "nuclei.http",
      toolRunArtifactId: "artifact-finding-1",
      fingerprint: "fingerprint-finding-1",
      reviewStatus: "confirmed",
      sourceContext: expect.arrayContaining([
        { label: "Template ID", value: "cves/2026/example" },
        {
          label: "References",
          value: "https://one.test, https://two.test, https://three.test, +1 more",
        },
      ]),
    });
    expect(ownFinding.finding).not.toHaveProperty("payload");
    expect(JSON.stringify(ownFinding)).not.toContain("not exposed by chat context tools");
    expect(otherSessionFinding.finding).toBeNull();
  });

  it("rejects archived or unknown OpenCode conversations", () => {
    const service = createFindingService();

    expect(() => service.listFindings("opencode-archived")).toThrow(
      "No active NullTrace session attachment exists",
    );
    expect(() => service.listFindings("unknown-opencode")).toThrow(
      "No active NullTrace session attachment exists",
    );
  });

  it("executes through the shared registry without accepting session ids", async () => {
    const service = createFindingService();
    const registry = new ChatContextToolRegistry(service.createToolDefinitions());
    const definitions = registry.listDefinitions();
    const getFinding = definitions.find((definition) => definition.name === "get_finding");

    const listResult = await registry.execute("list_findings", "opencode-1", {
      sessionId: "session-2",
      query: "Session two",
      limit: 10,
    });
    const getResult = await registry.execute("get_finding", "opencode-1", {
      findingId: "finding-1",
      sessionId: "session-2",
    });

    expect(getFinding?.args).toEqual({
      findingId: {
        type: "string",
        description: "Finding ID from list_findings. Do not provide a NullTrace session ID.",
      },
    });
    expect(listResult).toMatchObject({
      findings: [],
      pagination: {
        limit: 10,
        offset: 0,
        nextOffset: null,
        total: 0,
        hasMore: false,
      },
    });
    expect(getResult).toMatchObject({
      finding: {
        id: "finding-1",
        title: "Session one finding",
      },
    });
  });

  it("generates OpenCode wrappers that forward conversation context", () => {
    const source = createOpenCodeToolSource(
      "get_finding",
      "/tmp/nulltrace/chat-context-tools.service.ts",
      "/tmp/nulltrace/node_modules/@opencode-ai/plugin/dist/index.js",
    );

    expect(source).toContain("context.sessionID");
    expect(source).toContain('"get_finding"');
    expect(source).toContain('"findingId"');
    expect(source).not.toContain("sessionId");
  });

  it("generates bounded list_findings wrappers without session ids", () => {
    const source = createOpenCodeToolSource(
      "list_findings",
      "/tmp/nulltrace/chat-context-tools.service.ts",
      "/tmp/nulltrace/node_modules/@opencode-ai/plugin/dist/index.js",
    );

    expect(source).toContain("context.sessionID");
    expect(source).toContain('"list_findings"');
    expect(source).toContain('"limit"');
    expect(source).toContain('"offset"');
    expect(source).toContain('"query"');
    expect(source).toContain('"severity"');
    expect(source).toContain('"reviewStatus"');
    expect(source).toContain('"sourceTool"');
    expect(source).not.toContain("sessionId");
  });
});

describe("ToolRunArtifactChatContextToolsService", () => {
  it("returns bounded artifact payload previews", () => {
    const jsonPreview = createArtifactPayloadPreview(
      {
        findings: [
          {
            template: "exposed-panel",
            description: "A".repeat(50),
          },
        ],
      },
      40,
    );
    const textPreview = createArtifactPayloadPreview("abcdef", 3);

    expect(jsonPreview.format).toBe("json");
    expect(jsonPreview.content).toHaveLength(40);
    expect(jsonPreview.isTruncated).toBe(true);
    expect(jsonPreview.maxCharacters).toBe(40);
    expect(textPreview).toEqual({
      content: "abc",
      format: "text",
      isTruncated: true,
      maxCharacters: 3,
    });
  });

  it("lists tool runs for the session attached to the OpenCode conversation", () => {
    const result = createToolRunArtifactService().listToolRuns("opencode-1");

    expect(result.toolRuns).toEqual([
      {
        id: "run-1",
        toolName: "nmap",
        command: "nmap example.com",
        status: "success",
        startedAt: "2026-05-10T10:00:00.000Z",
        endedAt: "2026-05-10T10:01:00.000Z",
        exitCode: 0,
      },
    ]);
  });

  it("gets bounded artifact detail only inside the attached session", () => {
    const service = createToolRunArtifactService();

    const ownArtifact = service.getArtifact("opencode-1", {
      artifactId: "artifact-1",
      maxCharacters: 32,
    });
    const otherSessionArtifact = service.getArtifact("opencode-1", {
      artifactId: "artifact-2",
    });

    expect(ownArtifact.artifact).toMatchObject({
      id: "artifact-1",
      toolRunId: "run-1",
      artifactType: "nuclei_findings",
      label: "Nuclei findings",
      source: "artifacts/nuclei.jsonl",
      createdAt: "2026-05-10T10:02:00.000Z",
      payloadPreview: {
        format: "json",
        isTruncated: true,
        maxCharacters: 32,
      },
    });
    expect(ownArtifact.artifact?.payloadPreview.content).toHaveLength(32);
    expect(ownArtifact.artifact).not.toHaveProperty("payload");
    expect(otherSessionArtifact.artifact).toBeNull();
  });

  it("rejects archived or unknown OpenCode conversations", () => {
    const service = createToolRunArtifactService();

    expect(() => service.listToolRuns("opencode-archived")).toThrow(
      "No active NullTrace session attachment exists",
    );
    expect(() =>
      service.getArtifact("unknown-opencode", {
        artifactId: "artifact-1",
      }),
    ).toThrow("No active NullTrace session attachment exists");
  });

  it("executes through the shared registry without accepting session ids", async () => {
    const service = createToolRunArtifactService();
    const registry = new ChatContextToolRegistry(service.createToolDefinitions());
    const definitions = registry.listDefinitions();
    const getArtifact = definitions.find((definition) => definition.name === "get_artifact");

    const result = await registry.execute("get_artifact", "opencode-1", {
      artifactId: "artifact-1",
      sessionId: "session-2",
      maxCharacters: 32,
    });

    expect(getArtifact?.args).toEqual({
      artifactId: {
        type: "string",
        description:
          "Artifact ID from a session finding or tool run. Do not provide a NullTrace session ID.",
      },
      maxCharacters: {
        type: "number",
        description: "Optional maximum preview characters. The preview is always bounded.",
        isOptional: true,
      },
    });
    expect(result).toMatchObject({
      artifact: {
        id: "artifact-1",
        toolRunId: "run-1",
      },
    });
  });

  it("generates OpenCode wrappers that forward conversation context", () => {
    const source = createOpenCodeToolSource(
      "get_artifact",
      "/tmp/nulltrace/chat-context-tools.service.ts",
      "/tmp/nulltrace/node_modules/@opencode-ai/plugin/dist/index.js",
    );

    expect(source).toContain("context.sessionID");
    expect(source).toContain('"get_artifact"');
    expect(source).toContain('"artifactId"');
    expect(source).toContain('"maxCharacters"');
    expect(source).toContain(
      '"maxCharacters": tool.schema.number().describe("Optional maximum preview characters. The preview is always bounded.").optional()',
    );
    expect(source).not.toContain("sessionId");
  });
});

describe("ActiveToolWorkspaceChatContextToolsService", () => {
  it("returns active scanner workspace context for the attached session", () => {
    const result = createActiveToolWorkspaceService().getActiveToolWorkspace("opencode-1");

    expect(result).toEqual({
      workspace: {
        sessionId: "session-1",
        activeTool: "nmap",
        activePanel: "command",
        updatedAt: "2026-05-10T10:04:00.000Z",
        command: {
          currentCommand: "nmap -sV example.com",
          generatedCommand: "nmap -sV -T3 example.com",
          commandSource: "manual",
          executionStatus: "idle",
          currentToolRunId: null,
          isHistoricPreview: false,
        },
        form: {
          target: "example.com",
          ports: "80,443",
          timing: "T3",
          serviceDetection: true,
          osDetection: false,
          defaultScripts: false,
          aggressive: false,
          extraArgs: "",
        },
        selectedField: 0,
        selectedHistoricalRun: {
          id: "run-1",
          toolName: "nmap",
          command: "nmap example.com",
          status: "success",
          startedAt: "2026-05-10T10:00:00.000Z",
          endedAt: "2026-05-10T10:01:00.000Z",
          exitCode: 0,
        },
        recentToolRuns: [
          {
            id: "run-1",
            toolName: "nmap",
            command: "nmap example.com",
            status: "success",
            startedAt: "2026-05-10T10:00:00.000Z",
            endedAt: "2026-05-10T10:01:00.000Z",
            exitCode: 0,
          },
        ],
      },
    });
  });

  it("returns null when no scanner workspace is active for the session", () => {
    const result = createActiveToolWorkspaceService([]).getActiveToolWorkspace("opencode-1");

    expect(result).toEqual({
      workspace: null,
    });
  });

  it("rejects archived or unknown OpenCode conversations", () => {
    const service = createActiveToolWorkspaceService();

    expect(() => service.getActiveToolWorkspace("opencode-archived")).toThrow(
      "No active NullTrace session attachment exists",
    );
    expect(() => service.getActiveToolWorkspace("unknown-opencode")).toThrow(
      "No active NullTrace session attachment exists",
    );
  });

  it("executes through the shared registry without accepting session ids", async () => {
    const service = createActiveToolWorkspaceService();
    const registry = new ChatContextToolRegistry(service.createToolDefinitions());

    const result = await registry.execute("get_active_tool_workspace", "opencode-1", {
      sessionId: "session-2",
    });

    expect(registry.listDefinitions()).toMatchObject([
      {
        name: "get_active_tool_workspace",
        args: {},
      },
    ]);
    expect(result).toMatchObject({
      workspace: {
        sessionId: "session-1",
        activeTool: "nmap",
      },
    });
  });

  it("generates an OpenCode wrapper for get_active_tool_workspace", () => {
    const source = createOpenCodeToolSource(
      "get_active_tool_workspace",
      "/tmp/nulltrace/chat-context-tools.service.ts",
      "/tmp/nulltrace/node_modules/@opencode-ai/plugin/dist/index.js",
    );

    expect(source).toContain("context.sessionID");
    expect(source).toContain('"get_active_tool_workspace"');
    expect(source).toContain("args: {}");
    expect(source).not.toContain("sessionId");
  });
});

describe("ActionDraftChatContextToolsService", () => {
  it("creates an action draft for the session attached to the OpenCode conversation", () => {
    const { drafts, service } = createActionDraftService(new FakeActionDraftRepository(), true);

    const result = service.createActionDraft("opencode-1", {
      targetTool: "nmap",
      title: "Probe web ports",
      command: "nmap -Pn -sS -sV -p 80,443 example.com",
      intentJson: JSON.stringify({
        profile: "web-port-probe",
      }),
      formStateJson: JSON.stringify({
        target: "example.com",
        ports: "80,443",
      }),
    });

    expect(result).toEqual({
      actionDraft: {
        id: "draft-1",
        sessionId: "session-1",
        opencodeConversationId: "opencode-1",
        targetTool: "nmap",
        status: "draft",
        title: "Probe web ports",
        createdAt: "2026-05-10T10:04:00.000Z",
        updatedAt: "2026-05-10T10:04:00.000Z",
      },
    });
    expect(drafts.drafts[0]).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "opencode-1",
      targetTool: "nmap",
      status: "draft",
      summary: "",
      payload: {
        command: "nmap -Pn -sS -sV -p 80,443 example.com",
        sessionTarget: {
          normalized: "http://honey.scanme.sh",
          display: "http://honey.scanme.sh",
          scannerTarget: "honey.scanme.sh",
        },
        intent: {
          profile: "web-port-probe",
        },
        formState: {
          target: "example.com",
          ports: "80,443",
        },
      },
    });
  });

  it("replaces command target placeholders with the session scanner target", () => {
    const { drafts, service } = createActionDraftService();

    service.createActionDraft("opencode-1", {
      targetTool: "nmap",
      title: "Scan selected target",
      command: "nmap -sS -sV <TARGET>",
      formStateJson: JSON.stringify({
        target: "{{TARGET}}",
        ports: "80,443",
      }),
    });

    expect(drafts.drafts[0]).toMatchObject({
      payload: {
        command: "nmap -sS -sV honey.scanme.sh",
        sessionTarget: {
          normalized: "http://honey.scanme.sh",
          display: "http://honey.scanme.sh",
          scannerTarget: "honey.scanme.sh",
        },
        formState: {
          target: "honey.scanme.sh",
          ports: "80,443",
        },
      },
    });
  });

  it("scopes draft creation through the active conversation attachment", () => {
    const { drafts, service } = createActionDraftService();

    service.createActionDraft("opencode-2", {
      targetTool: "nuclei",
      title: "Check exposures",
    });

    expect(drafts.drafts[0]).toMatchObject({
      sessionId: "session-2",
      opencodeConversationId: "opencode-2",
      targetTool: "nuclei",
    });
  });

  it("redacts authorization values before persisting a Nuclei action draft", () => {
    const { drafts, service } = createActionDraftService(new FakeActionDraftRepository(), true);

    service.createActionDraft("opencode-1", {
      targetTool: "nuclei",
      title: "Authenticated check",
      command: "nuclei -u {{TARGET}} -H 'Authorization: Bearer secret-token'",
      formStateJson: JSON.stringify({
        target: "{{TARGET}}",
        useAuthenticatedContext: true,
        cookies: "session=secret-cookie",
        extraArgs: "-H 'Authorization: Bearer second-secret-token'",
      }),
      intentJson: JSON.stringify({
        token: "secret-token",
        note: "Cookie: session=second-secret-cookie",
      }),
    });

    expect(drafts.drafts[0]?.payload).toMatchObject({
      command: "nuclei -u http://honey.scanme.sh -H '[redacted]'",
      formState: {
        target: "http://honey.scanme.sh",
        useAuthenticatedContext: true,
        cookies: "[redacted]",
        extraArgs: "-H '[redacted]'",
      },
      intent: {
        token: "[redacted]",
        note: "Cookie: [redacted]",
      },
    });
    expect(JSON.stringify(drafts.drafts[0]?.payload)).not.toContain("secret-token");
    expect(JSON.stringify(drafts.drafts[0]?.payload)).not.toContain("secret-cookie");
  });

  it("rejects Nuclei auth opt-in without accepted authentication context", () => {
    const { drafts, service } = createActionDraftService();

    expect(() =>
      service.createActionDraft("opencode-1", {
        targetTool: "nuclei",
        title: "Authenticated check",
        formStateJson: JSON.stringify({
          target: "{{TARGET}}",
          useAuthenticatedContext: true,
        }),
      }),
    ).toThrow("Authenticated Nuclei drafts require an accepted authentication context.");
    expect(drafts.drafts).toHaveLength(0);
  });

  it("rejects shell expansion before persisting an authenticated Nuclei draft", () => {
    const { drafts, service } = createActionDraftService(new FakeActionDraftRepository(), true);

    expect(() =>
      service.createActionDraft("opencode-1", {
        targetTool: "nuclei",
        title: "Unsafe authenticated check",
        command: "F=-H; nuclei $F 'X-Auth: secret-value' -u {{TARGET}}",
        formStateJson: JSON.stringify({
          target: "{{TARGET}}",
          useAuthenticatedContext: true,
        }),
      }),
    ).toThrow("Authenticated Nuclei runs cannot use shell expansion or control syntax.");
    expect(drafts.drafts).toHaveLength(0);
  });

  it("rejects archived or unknown OpenCode conversations", () => {
    const { service } = createActionDraftService();
    const args = {
      targetTool: "nmap" as ScannerToolId,
      title: "Probe web ports",
    };

    expect(() => service.createActionDraft("opencode-archived", args)).toThrow(
      "No active NullTrace session attachment exists",
    );
    expect(() => service.createActionDraft("unknown-opencode", args)).toThrow(
      "No active NullTrace session attachment exists",
    );
  });

  it("creates FFUF drafts but rejects catalog-only scanner tools before persistence", () => {
    const { drafts, service } = createActionDraftService();

    expect(
      service.createActionDraft("opencode-1", {
        targetTool: "ffuf",
        title: "Discover directories",
      }),
    ).toMatchObject({
      actionDraft: {
        targetTool: "ffuf",
      },
    });
    expect(drafts.drafts[0]).toMatchObject({
      payload: {
        formState: {
          targetPattern: "http://honey.scanme.sh/FUZZ",
        },
      },
    });
    expect(() =>
      service.createActionDraft("opencode-1", {
        targetTool: "sqlmap",
        title: "SQL injection probe",
      }),
    ).toThrow("create_action_draft targetTool must be an implemented scanner tool: sqlmap");
    expect(drafts.drafts).toHaveLength(1);
  });

  it("creates a Parameter Discovery FFUF draft with the selected session endpoint", () => {
    const { drafts, service } = createActionDraftService();

    service.createActionDraft("opencode-1", {
      targetTool: "ffuf",
      title: "Discover query parameters",
      formStateJson: JSON.stringify({
        mode: "parameter_discovery",
        endpoint: "{{TARGET}}/search",
        requestLocation: "query",
        wordlist: "/tmp/parameters.txt",
      }),
    });

    expect(drafts.drafts[0]).toMatchObject({
      payload: {
        formState: {
          mode: "parameter_discovery",
          endpoint: "http://honey.scanme.sh/search",
          requestLocation: "query",
          wordlist: "/tmp/parameters.txt",
        },
      },
    });
  });

  it("does not create tool runs when creating an action draft", () => {
    const toolRepository = new FakeToolRepository([], []);
    const drafts = new FakeActionDraftRepository();
    const service = new ActionDraftChatContextToolsService(
      new FakeConversationAttachments([createAttachment("session-1", "opencode-1")]),
      drafts,
    );

    service.createActionDraft("opencode-1", {
      targetTool: "nmap",
      title: "Version scan",
      command: "nmap -sV example.com",
    });

    expect(drafts.drafts).toHaveLength(1);
    expect(toolRepository.listToolRunsBySessionId("session-1")).toHaveLength(0);
  });

  it("executes through the shared registry without accepting session ids", async () => {
    const { service } = createActionDraftService();
    const registry = new ChatContextToolRegistry(service.createToolDefinitions());
    const definitions = registry.listDefinitions();
    const createDraft = definitions.find((definition) => definition.name === "create_action_draft");

    const result = await registry.execute("create_action_draft", "opencode-1", {
      sessionId: "session-2",
      targetTool: "nuclei",
      title: "Targeted exposure check",
    });

    expect(createDraft?.args).toMatchObject({
      targetTool: {
        type: "string",
      },
      title: {
        type: "string",
      },
      command: {
        type: "string",
        isOptional: true,
      },
    });
    expect(createDraft?.args).not.toHaveProperty("sessionId");
    expect(result).toMatchObject({
      actionDraft: {
        sessionId: "session-1",
        opencodeConversationId: "opencode-1",
        targetTool: "nuclei",
        status: "draft",
      },
    });
  });

  it("generates an OpenCode wrapper for create_action_draft", () => {
    const source = createOpenCodeToolSource(
      "create_action_draft",
      "/tmp/nulltrace/chat-context-tools.service.ts",
      "/tmp/nulltrace/node_modules/@opencode-ai/plugin/dist/index.js",
    );

    expect(source).toContain("context.sessionID");
    expect(source).toContain('"create_action_draft"');
    expect(source).toContain('"targetTool"');
    expect(source).toContain('"command"');
    expect(source).not.toContain("sessionId");
  });
});

describe("createOpenCodeToolSource", () => {
  it("generates importable wrappers for every registered chat context tool", async () => {
    for (const definition of chatContextToolRegistry.listDefinitions()) {
      const source = createOpenCodeToolSource(
        definition.name,
        chatContextToolsImportPath,
        openCodePluginImportPath,
      );
      const wrapperPath = `/tmp/nulltrace-${definition.name}-${Date.now()}.ts`;

      await Bun.write(wrapperPath, source);

      const module = await import(wrapperPath);
      expect(module.default).toBeTruthy();
    }
  });
});
