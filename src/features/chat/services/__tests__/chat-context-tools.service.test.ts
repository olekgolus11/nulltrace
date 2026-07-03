import { describe, expect, it } from "bun:test";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import { SessionFindingRecord } from "../../../finding/model/finding.types";
import {
  ToolRunArtifactRecord,
  ToolRunSummary,
} from "../../../session/model/session.repository.types";
import { ChatContextToolRegistry } from "../chat-context-tool-registry";
import {
  createArtifactPayloadPreview,
  createOpenCodeToolSource,
  FindingChatContextToolsService,
  ToolRunArtifactChatContextToolsService,
} from "../chat-context-tools.service";

class FakeConversationAttachments {
  constructor(
    private readonly attachments: ConversationAttachmentRecord[],
  ) {}

  findActiveAttachmentByOpenCodeConversationId(opencodeConversationId: string) {
    return (
      this.attachments.find(
        (attachment) =>
          attachment.opencodeConversationId === opencodeConversationId &&
          !attachment.archivedAt,
      ) ?? null
    );
  }
}

class FakeFindingRepository {
  constructor(
    private readonly findings: SessionFindingRecord[],
  ) {}

  listBySessionId(sessionId: string) {
    return this.findings.filter((finding) => finding.sessionId === sessionId);
  }
}

class FakeToolRepository {
  constructor(
    private readonly toolRuns: Array<ToolRunSummary & { sessionId: string }>,
    private readonly artifacts: Array<
      ToolRunArtifactRecord & { sessionId: string }
    >,
  ) {}

  listToolRunsBySessionId(sessionId: string) {
    return this.toolRuns.filter((run) => run.sessionId === sessionId);
  }

  findToolRunArtifactByIdForSession(sessionId: string, artifactId: string) {
    return (
      this.artifacts.find(
        (artifact) =>
          artifact.sessionId === sessionId && artifact.id === artifactId,
      ) ?? null
    );
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
  };
}

function createFindingService() {
  return new FindingChatContextToolsService(
    new FakeConversationAttachments([
      createAttachment("session-1", "opencode-1"),
      createAttachment("session-2", "opencode-2"),
      createAttachment(
        "session-archived",
        "opencode-archived",
        "2026-05-10T10:03:00.000Z",
      ),
    ]),
    new FakeFindingRepository([
      createFinding("finding-1", "session-1", "Session one finding"),
      createFinding("finding-2", "session-2", "Session two finding"),
      createFinding(
        "finding-archived",
        "session-archived",
        "Archived finding",
      ),
    ]),
  );
}

function createToolRunArtifactService() {
  return new ToolRunArtifactChatContextToolsService(
    new FakeConversationAttachments([
      createAttachment("session-1", "opencode-1"),
      createAttachment("session-2", "opencode-2"),
      createAttachment(
        "session-archived",
        "opencode-archived",
        "2026-05-10T10:03:00.000Z",
      ),
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
    ]);
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
          value:
            "https://one.test, https://two.test, https://three.test, +1 more",
        },
      ]),
    });
    expect(ownFinding.finding).not.toHaveProperty("payload");
    expect(JSON.stringify(ownFinding)).not.toContain(
      "not exposed by chat context tools",
    );
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
    const registry = new ChatContextToolRegistry(
      service.createToolDefinitions(),
    );
    const definitions = registry.listDefinitions();
    const getFinding = definitions.find(
      (definition) => definition.name === "get_finding",
    );

    const result = await registry.execute("get_finding", "opencode-1", {
      findingId: "finding-1",
      sessionId: "session-2",
    });

    expect(getFinding?.args).toEqual({
      findingId: {
        type: "string",
        description:
          "Finding ID from list_findings. Do not provide a NullTrace session ID.",
      },
    });
    expect(result).toMatchObject({
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
    expect(source).toContain("\"get_finding\"");
    expect(source).toContain("\"findingId\"");
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
    const registry = new ChatContextToolRegistry(
      service.createToolDefinitions(),
    );
    const definitions = registry.listDefinitions();
    const getArtifact = definitions.find(
      (definition) => definition.name === "get_artifact",
    );

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
        description:
          "Optional maximum preview characters. The preview is always bounded.",
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
    expect(source).toContain("\"get_artifact\"");
    expect(source).toContain("\"artifactId\"");
    expect(source).toContain("\"maxCharacters\"");
    expect(source).not.toContain("sessionId");
  });
});
