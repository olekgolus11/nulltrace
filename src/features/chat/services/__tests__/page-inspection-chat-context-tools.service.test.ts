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
  calls: Array<{
    requestedUrl: string;
    targetOrigin: string;
    authentication?: { origin: string; cookies: string; headers: string };
  }> = [];

  async inspect(input: { requestedUrl: string; targetOrigin: string }) {
    this.calls.push(input);
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
    return { entries: [], total: 0, limit: 500, offset: 0 };
  }
}

describe("PageInspectionChatContextToolsService", () => {
  test("exposes read-only inspect_page only through a granted session", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
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
      args: {
        url: { type: "string" },
      },
    });

    await expect(service.inspectPage("conversation-one", { url: "https://target.example/app" })).resolves.toMatchObject({
      title: "Rendered page",
      visibleText: "Rendered after JavaScript.",
    });
  });

  test("uses authenticated inspection mode for the whole session", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowAuthenticated("session-one");
    const browser = new FakeBrowser();
    const pageInspection = new PageInspectionService(
      permissions,
      browser,
      {
        getMetadata: async () => ({ storageMode: "secure" }),
        loadProtectedContext: async () => ({
          origin: "https://target.example",
          cookies: "session=never-returned",
          headers: "Authorization: Bearer never-returned",
          updatedAt: "2026-07-25T10:00:00.000Z",
        }),
      },
      { isProceedAllowed: () => true },
    );
    const service = new PageInspectionChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      pageInspection,
      new FakeSitemap(),
    );

    await service.inspectPage("conversation-one", { url: "https://target.example/app" });
    await service.inspectPage("conversation-one", {
      url: "https://target.example/app/private",
    });

    expect(browser.calls).toEqual([
      {
        requestedUrl: "https://target.example/app",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=never-returned",
          headers: "Authorization: Bearer never-returned",
        },
      },
      {
        requestedUrl: "https://target.example/app/private",
        targetOrigin: "https://target.example",
        authentication: {
          origin: "https://target.example",
          cookies: "session=never-returned",
          headers: "Authorization: Bearer never-returned",
        },
      },
    ]);
  });

  test("keeps authenticated sitemap paths out of Page Inspection", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const pageInspection = new PageInspectionService(permissions, new FakeBrowser());
    const service = new PageInspectionChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      pageInspection,
      {
        listEntries: () => ({
          entries: [{ normalizedUrl: "https://target.example/app/private" }],
          total: 1,
          limit: 500,
          offset: 0,
        }),
      },
    );

    await expect(
      service.inspectPage("conversation-one", { url: "https://target.example/app/private/profile" }),
    ).rejects.toThrow("known protected paths");
  });

  test("loads protected paths after the first sitemap page", async () => {
    const permissions = new PageInspectionPermissionService({ isChromiumAvailable: () => true });
    permissions.allowPublic("session-one");
    const pageInspection = new PageInspectionService(permissions, new FakeBrowser());
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      normalizedUrl: `https://target.example/app/private-${index}`,
    }));
    const service = new PageInspectionChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      pageInspection,
      {
        listEntries: ({ offset }) =>
          (offset ?? 0) === 0
            ? { entries: firstPage, total: 501, limit: 500, offset }
            : {
                entries: [{ normalizedUrl: "https://target.example/app/private-last" }],
                total: 501,
                limit: 500,
                offset,
              },
      },
    );

    await expect(
      service.inspectPage("conversation-one", { url: "https://target.example/app/private-last" }),
    ).rejects.toThrow("known protected paths");
  });
});
