import { describe, expect, test } from "bun:test";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import { PageInspectionPermissionService } from "../../../page-inspection/services/page-inspection-permission.service";
import { PageInspectionService } from "../../../page-inspection/services/page-inspection.service";
import { PageInspectionChatContextToolsService } from "../page-inspection-chat-context-tools.service";

class FakeAttachments {
  findActiveAttachmentByOpenCodeConversationId(conversationId: string) {
    return conversationId === "conversation-one"
      ? ({
          sessionId: "session-one",
          opencodeConversationId: conversationId,
          isDefault: true,
          archivedAt: null,
          createdAt: "2026-07-24T10:00:00.000Z",
        } satisfies ConversationAttachmentRecord)
      : null;
  }
}

class FakeSessions {
  getSessionById(sessionId: string) {
    return sessionId === "session-one"
      ? {
          id: sessionId,
          targetId: "target-one",
          normalizedUrl: "https://target.example/app",
          displayUrl: "https://target.example/app",
        }
      : null;
  }
}

class FakeBrowser {
  async inspect(input: { requestedUrl: string; targetOrigin: string }) {
    return {
      requestedUrl: input.requestedUrl,
      finalUrl: input.requestedUrl,
      status: 200,
      contentType: "text/html",
      title: "Rendered page",
      visibleText: "Rendered after JavaScript.",
      forms: [],
      links: [],
      scripts: [],
      domOutline: [],
      metadata: [],
      securitySignals: {
        contentSecurityPolicy: null,
        frameOptions: null,
        referrerPolicy: null,
        permissionsPolicy: null,
        hasPasswordFields: false,
      },
      isPartial: false,
      truncatedSections: [],
    };
  }
}

class FakeSitemap {
  listEntries() {
    return { entries: [] };
  }
}

describe("PageInspectionChatContextToolsService", () => {
  test("exposes read-only inspect_page only through a granted session", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const pageInspection = new PageInspectionService(permissions, new FakeBrowser());
    const service = new PageInspectionChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      pageInspection,
      new FakeSitemap(),
    );

    const definitions = service.createToolDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      name: "inspect_page",
      args: { url: { type: "string" } },
    });

    await expect(service.inspectPage("conversation-one", { url: "https://target.example/app" })).resolves.toMatchObject({
      title: "Rendered page",
      visibleText: "Rendered after JavaScript.",
    });
  });

  test("keeps authenticated sitemap paths out of Page Inspection", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.grant("session-one");
    const pageInspection = new PageInspectionService(permissions, new FakeBrowser());
    const service = new PageInspectionChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      pageInspection,
      {
        listEntries: () => ({
          entries: [{ normalizedUrl: "https://target.example/app/private" }],
        }),
      },
    );

    await expect(
      service.inspectPage("conversation-one", { url: "https://target.example/app/private/profile" }),
    ).rejects.toThrow("known protected paths");
  });
});
