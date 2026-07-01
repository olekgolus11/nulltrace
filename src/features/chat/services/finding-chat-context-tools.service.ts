import { ConversationAttachmentRecord } from "../model/conversation-attachment.types";
import {
  ChatContextToolArgs,
  ChatContextToolDefinition,
} from "../model/chat-context-tool.types";
import { SessionFindingRecord } from "../../finding/model/finding.types";
import { findingRepository } from "../../finding/services/finding.repository";
import {
  createFindingSourceContextFields,
  FindingSourceContextField,
} from "../../finding/services/finding-source-context";
import {
  ConversationAttachmentService,
  conversationAttachmentService,
} from "./conversation-attachment.service";

type GetFindingArgs = {
  findingId: string;
};

export interface ChatFindingListItem {
  id: string;
  severity: SessionFindingRecord["severity"];
  reviewStatus: SessionFindingRecord["reviewStatus"];
  sourceTool: string;
  target: string;
  title: string;
  summary: string;
}

export interface ChatFindingDetail extends ChatFindingListItem {
  kind: string;
  toolRunArtifactId: string;
  fingerprint: string;
  reviewUpdatedAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  sourceContext: FindingSourceContextField[];
}

export interface ListFindingsResult {
  findings: ChatFindingListItem[];
}

export interface GetFindingResult {
  finding: ChatFindingDetail | null;
}

interface ConversationAttachmentScope {
  findActiveAttachmentByOpenCodeConversationId: (
    opencodeConversationId: string,
  ) => ConversationAttachmentRecord | null;
}

interface FindingReadRepository {
  listBySessionId: (sessionId: string) => SessionFindingRecord[];
}

function assertGetFindingArgs(args: ChatContextToolArgs): GetFindingArgs {
  const findingId = args.findingId;
  if (typeof findingId !== "string" || !findingId.trim()) {
    throw new Error("get_finding requires a findingId string.");
  }

  return {
    findingId: findingId.trim(),
  };
}

function toListItem(finding: SessionFindingRecord): ChatFindingListItem {
  return {
    id: finding.id,
    severity: finding.severity,
    reviewStatus: finding.reviewStatus,
    sourceTool: finding.sourceTool,
    target: finding.target,
    title: finding.title,
    summary: finding.summary,
  };
}

function toDetail(finding: SessionFindingRecord): ChatFindingDetail {
  return {
    ...toListItem(finding),
    kind: finding.kind,
    toolRunArtifactId: finding.toolRunArtifactId,
    fingerprint: finding.fingerprint,
    reviewUpdatedAt: finding.reviewUpdatedAt,
    firstSeenAt: finding.firstSeenAt,
    lastSeenAt: finding.lastSeenAt,
    createdAt: finding.createdAt,
    sourceContext: createFindingSourceContextFields(finding),
  };
}

export class FindingChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope =
      conversationAttachmentService,
    private readonly findings: FindingReadRepository = findingRepository,
  ) {}

  listFindings(opencodeConversationId: string): ListFindingsResult {
    const attachment = this.requireActiveAttachment(opencodeConversationId);

    return {
      findings: this.findings
        .listBySessionId(attachment.sessionId)
        .map(toListItem),
    };
  }

  getFinding(
    opencodeConversationId: string,
    args: GetFindingArgs,
  ): GetFindingResult {
    const attachment = this.requireActiveAttachment(opencodeConversationId);
    const finding =
      this.findings
        .listBySessionId(attachment.sessionId)
        .find((candidate) => candidate.id === args.findingId) ?? null;

    return {
      finding: finding ? toDetail(finding) : null,
    };
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    return [
      {
        name: "list_findings",
        description:
          "List findings for the active NullTrace testing session attached to this OpenCode conversation.",
        args: {},
        execute: ({ opencodeConversationId }) =>
          this.listFindings(opencodeConversationId),
      },
      {
        name: "get_finding",
        description:
          "Get normalized detail and bounded source context for one finding in the active NullTrace testing session.",
        args: {
          findingId: {
            type: "string",
            description:
              "Finding ID from list_findings. Do not provide a NullTrace session ID.",
          },
        },
        execute: ({ opencodeConversationId, args }) =>
          this.getFinding(opencodeConversationId, assertGetFindingArgs(args)),
      },
    ];
  }

  private requireActiveAttachment(opencodeConversationId: string) {
    const attachment =
      this.attachments.findActiveAttachmentByOpenCodeConversationId(
        opencodeConversationId,
      );
    if (!attachment) {
      throw new Error(
        "No active NullTrace session attachment exists for this OpenCode conversation.",
      );
    }

    return attachment;
  }
}

export const findingChatContextToolsService =
  new FindingChatContextToolsService();
