import { ChatContextToolArgs, ChatContextToolDefinition } from "../model/chat-context-tool.types";
import { PageInspectionService, pageInspectionService } from "../../page-inspection/services/page-inspection.service";
import { conversationAttachmentService } from "./conversation-attachment.service";
import { assertInspectPageArgs } from "./page-inspection-chat-context-tools.helpers";
import { InspectPageArgs } from "./page-inspection-chat-context-tools.types";
import { sessionRepository } from "../../session/services/session.repository";
import { sitemapRepository } from "../../sitemap/services/sitemap.repository";

export class PageInspectionChatContextToolsService {
  constructor(
    private readonly attachments: PageInspectionConversationAttachments = conversationAttachmentService,
    private readonly sessions: PageInspectionSessionRepository = sessionRepository,
    private readonly pageInspection: PageInspectionService = pageInspectionService,
    private readonly sitemap: PageInspectionSitemapRepository = sitemapRepository,
  ) {}

  inspectPage(opencodeConversationId: string, args: InspectPageArgs) {
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

    return this.pageInspection.inspect({
      sessionId: session.id,
      requestedUrl: args.url,
      targetOrigin: new URL(session.normalizedUrl).origin,
      protectedPaths: this.getProtectedPaths(session.targetId),
    });
  }

  private getProtectedPaths(targetId: string) {
    return this.sitemap
      .listEntries({ targetId, limit: 500, provenance: "authenticated" })
      .entries.map((entry) => entry.normalizedUrl);
  }

  createToolDefinitions(): ChatContextToolDefinition<ChatContextToolArgs, unknown>[] {
    return [
      {
        name: "inspect_page",
        description:
          "Inspect one public exact-origin page after JavaScript rendering. This read-only tool returns a bounded structured snapshot without HTML, screenshots, cookies, storage, raw response bodies, or hidden secret inputs. It is available only while the operator has granted Page Inspection for the active testing session.",
        args: {
          url: {
            type: "string",
            description:
              "Exact-origin public page URL to inspect. Cross-origin navigation and redirects are blocked.",
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
}

interface PageInspectionSitemapRepository {
  listEntries: (filters: {
    targetId: string;
    limit: number;
    provenance: "authenticated";
  }) => {
    entries: Array<{ normalizedUrl: string }>;
  };
}
