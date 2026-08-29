import { ChatContextToolArgs, ChatContextToolDefinition } from "../model/chat-context-tool.types";
import { PageInspectionService, pageInspectionService } from "../../page-inspection/services/page-inspection.service";
import { conversationAttachmentService } from "./conversation-attachment.service";
import { assertInspectPageArgs } from "./page-inspection-chat-context-tools.helpers";
import { InspectPageArgs } from "./page-inspection-chat-context-tools.types";
import { sessionRepository } from "../../session/services/session.repository";
import { sitemapRepository } from "../../sitemap/services/sitemap.repository";

function sanitizePersistedPageUrl(value: string, baseUrl?: string) {
  try {
    const url = new URL(value, baseUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function createPersistedPageInspectionSnapshot(
  snapshot: Awaited<ReturnType<PageInspectionService["inspect"]>>,
) {
  const finalUrl = sanitizePersistedPageUrl(snapshot.finalUrl) ?? "[invalid URL]";

  return {
    requestedUrl: sanitizePersistedPageUrl(snapshot.requestedUrl) ?? "[invalid URL]",
    finalUrl,
    status: snapshot.status,
    contentType: snapshot.contentType,
    title: snapshot.title,
    visibleText: snapshot.visibleText,
    forms: snapshot.forms.map((form) => ({
      method: form.method,
      action: form.action ? sanitizePersistedPageUrl(form.action, finalUrl) : null,
      fields: form.fields,
    })),
    domOutline: snapshot.domOutline,
    securitySignals: snapshot.securitySignals,
    isPartial: snapshot.isPartial,
    truncatedSections: snapshot.truncatedSections,
  };
}

export class PageInspectionChatContextToolsService {
  constructor(
    private readonly attachments: PageInspectionConversationAttachments = conversationAttachmentService,
    private readonly sessions: PageInspectionSessionRepository = sessionRepository,
    private readonly pageInspection: PageInspectionService = pageInspectionService,
    private readonly sitemap: PageInspectionSitemapRepository = sitemapRepository,
  ) {}

  async inspectPage(opencodeConversationId: string, args: InspectPageArgs) {
    const attachment = this.attachments.findActiveAttachmentByOpenCodeConversationId(
      opencodeConversationId,
    );
    if (!attachment) {
      throw new Error("No active NullTrace session attachment exists for this OpenCode conversation.");
    }
    const session = this.sessions.getSessionById(attachment.sessionId);
    if (!session) {
      throw new Error("The attached NullTrace session no longer exists.");
    }

    const snapshot = await this.pageInspection.inspect({
      sessionId: session.id,
      requestedUrl: args.url,
      targetOrigin: new URL(session.normalizedUrl).origin,
      protectedPaths: this.getProtectedPaths(session.targetId),
    });
    const persistedSnapshot = createPersistedPageInspectionSnapshot(snapshot);
    const persistedUrl = new URL(persistedSnapshot.finalUrl);
    const toolRun = this.sessions.recordToolRun(session.id, {
      toolName: "inspect_page",
      command: `inspect_page ${persistedUrl.toString()}`,
      commandSource: "assistant",
      status: "running",
    });
    const artifact = this.sessions.saveToolRunArtifact(toolRun.id, {
      artifactType: "page_inspection_snapshot",
      label: `Rendered page inspection: ${persistedUrl.pathname || "/"}`,
      source: "inspect_page",
      payload: persistedSnapshot,
    });
    this.sessions.finishToolRun(toolRun.id, "success", 0);

    return {
      ...snapshot,
      source: {
        toolRunId: toolRun.id,
        artifactId: artifact.id,
        sourceTool: "inspect_page" as const,
      },
    };
  }

  private getProtectedPaths(targetId: string) {
    const protectedPaths = new Set<string>();
    let offset = 0;
    let total = 0;

    do {
      const result = this.sitemap.listEntries({
        targetId,
        limit: 500,
        offset,
        provenance: "authenticated",
      });
      result.entries.forEach((entry) => protectedPaths.add(entry.normalizedUrl));
      total = result.total;
      offset += result.entries.length;
    } while (offset < total && offset > 0);

    return [...protectedPaths];
  }

  createToolDefinitions(): ChatContextToolDefinition<ChatContextToolArgs, unknown>[] {
    return [
      {
        name: "inspect_page",
        description:
          "Inspect one exact-origin page after JavaScript rendering using the active testing session's operator-selected Page Inspection mode. Returns a bounded structured snapshot and persists its safe snapshot provenance as a completed inspect_page tool run whose source.toolRunId can be passed to create_finding. It never stores HTML, screenshots, cookies, storage, raw response bodies, or hidden secret inputs.",
        args: {
          url: {
            type: "string",
            description:
              "Exact-origin page URL to inspect. Cross-origin navigation and redirects are blocked.",
          },
        },
        execute: ({ opencodeConversationId, args }) =>
          this.inspectPage(opencodeConversationId, assertInspectPageArgs(args)),
      },
    ];
  }
}

export const pageInspectionChatContextToolsService = new PageInspectionChatContextToolsService();

interface PageInspectionConversationAttachments {
  findActiveAttachmentByOpenCodeConversationId: (opencodeConversationId: string) => {
    sessionId: string;
  } | null;
}

interface PageInspectionSessionRepository {
  getSessionById: (sessionId: string) => {
    id: string;
    targetId: string;
    normalizedUrl: string;
  } | null;
  recordToolRun: (
    sessionId: string,
    input: {
      toolName: string;
      command: string;
      commandSource: string;
      status: string;
    },
  ) => { id: string };
  saveToolRunArtifact: (
    toolRunId: string,
    artifact: {
      artifactType: string;
      label: string;
      source: string;
      payload: unknown;
    },
  ) => { id: string };
  finishToolRun: (toolRunId: string, status: string, exitCode: number | null) => void;
}

interface PageInspectionSitemapRepository {
  listEntries: (filters: {
    targetId: string;
    limit: number;
    offset: number;
    provenance: "authenticated";
  }) => {
    entries: Array<{ normalizedUrl: string }>;
    total: number;
  };
}
