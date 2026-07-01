import { describe, expect, it } from "bun:test";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import { SessionFindingRecord } from "../../../finding/model/finding.types";
import { FindingChatContextToolsService } from "../finding-chat-context-tools.service";
import { ChatContextToolRegistry } from "../chat-context-tool-registry";
import { createOpenCodeToolSource } from "../chat-context-tools.service";

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

function createService() {
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

describe("FindingChatContextToolsService", () => {
  it("lists findings for the session attached to the OpenCode conversation", () => {
    const result = createService().listFindings("opencode-1");

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
    const service = createService();

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
    const service = createService();

    expect(() => service.listFindings("opencode-archived")).toThrow(
      "No active NullTrace session attachment exists",
    );
    expect(() => service.listFindings("unknown-opencode")).toThrow(
      "No active NullTrace session attachment exists",
    );
  });

  it("executes through the shared registry without accepting session ids", async () => {
    const service = createService();
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
