import { ConversationAttachmentRecord } from "../model/conversation-attachment.types";
import {
  ChatContextToolArgs,
  ChatContextToolDefinition,
  ChatContextToolSchema,
} from "../model/chat-context-tool.types";
import {
  ScannerCatalogContext,
  ScannerCatalogTool,
  ScannerToolId,
  listAvailableScannerToolsFromCatalog,
  scannerCatalog,
} from "../../tool/shared/registry/scanner-catalog";
import { SessionFindingRecord } from "../../finding/model/finding.types";
import { findingRepository } from "../../finding/services/finding.repository";
import {
  createFindingSourceContextFields,
  FindingSourceContextField,
} from "../../finding/services/finding-source-context";
import {
  ToolRunArtifactRecord,
  ToolRunSummary,
} from "../../session/model/session.repository.types";
import { sessionRepository } from "../../session/services/session.repository";
import { ChatContextToolRegistry } from "./chat-context-tool-registry";
import { conversationAttachmentService } from "./conversation-attachment.service";

const DEFAULT_ARTIFACT_PREVIEW_MAX_CHARACTERS = 4000;

type GetFindingArgs = {
  findingId: string;
};

type GetArtifactArgs = {
  artifactId: string;
  maxCharacters?: number;
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

export interface ChatToolRunListItem {
  id: string;
  toolName: string;
  command: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

export interface ChatArtifactPayloadPreview {
  content: string;
  format: "json" | "text";
  isTruncated: boolean;
  maxCharacters: number;
}

export interface ChatToolRunArtifactDetail {
  id: string;
  toolRunId: string;
  artifactType: string;
  label: string;
  source: string;
  createdAt: string;
  payloadPreview: ChatArtifactPayloadPreview;
}

export interface ListToolRunsResult {
  toolRuns: ChatToolRunListItem[];
}

export interface GetArtifactResult {
  artifact: ChatToolRunArtifactDetail | null;
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

interface ToolReadRepository {
  listToolRunsBySessionId: (sessionId: string) => ToolRunSummary[];
  findToolRunArtifactByIdForSession: (
    sessionId: string,
    artifactId: string,
  ) => ToolRunArtifactRecord | null;
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

function assertGetArtifactArgs(args: ChatContextToolArgs): GetArtifactArgs {
  const artifactId = args.artifactId;
  if (typeof artifactId !== "string" || !artifactId.trim()) {
    throw new Error("get_artifact requires an artifactId string.");
  }

  const maxCharacters = args.maxCharacters;
  if (maxCharacters !== undefined) {
    if (typeof maxCharacters !== "number" || !Number.isFinite(maxCharacters)) {
      throw new Error("get_artifact maxCharacters must be a finite number.");
    }
  }

  return {
    artifactId: artifactId.trim(),
    maxCharacters,
  };
}

function requireActiveAttachment(
  attachments: ConversationAttachmentScope,
  opencodeConversationId: string,
) {
  const attachment = attachments.findActiveAttachmentByOpenCodeConversationId(
    opencodeConversationId,
  );
  if (!attachment) {
    throw new Error(
      "No active NullTrace session attachment exists for this OpenCode conversation.",
    );
  }

  return attachment;
}

function toFindingListItem(finding: SessionFindingRecord): ChatFindingListItem {
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

function toFindingDetail(finding: SessionFindingRecord): ChatFindingDetail {
  return {
    ...toFindingListItem(finding),
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

function serializeArtifactPayload(payload: unknown): {
  content: string;
  format: "json" | "text";
} {
  if (typeof payload === "string") {
    return {
      content: payload,
      format: "text",
    };
  }

  const json = JSON.stringify(payload, null, 2);
  if (json !== undefined) {
    return {
      content: json,
      format: "json",
    };
  }

  return {
    content: String(payload),
    format: "text",
  };
}

export function createArtifactPayloadPreview(
  payload: unknown,
  maxCharacters = DEFAULT_ARTIFACT_PREVIEW_MAX_CHARACTERS,
): ChatArtifactPayloadPreview {
  const limit = Math.max(1, Math.floor(maxCharacters));
  const serialized = serializeArtifactPayload(payload);
  const isTruncated = serialized.content.length > limit;

  return {
    content: isTruncated
      ? serialized.content.slice(0, limit)
      : serialized.content,
    format: serialized.format,
    isTruncated,
    maxCharacters: limit,
  };
}

function toToolRunListItem(run: ToolRunSummary): ChatToolRunListItem {
  return {
    id: run.id,
    toolName: run.toolName,
    command: run.command,
    status: run.status,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    exitCode: run.exitCode,
  };
}

function toArtifactDetail(
  artifact: ToolRunArtifactRecord,
  maxCharacters?: number,
): ChatToolRunArtifactDetail {
  return {
    id: artifact.id,
    toolRunId: artifact.toolRunId,
    artifactType: artifact.artifactType,
    label: artifact.label,
    source: artifact.source,
    createdAt: artifact.createdAt,
    payloadPreview: createArtifactPayloadPreview(
      artifact.payload,
      maxCharacters,
    ),
  };
}

export class FindingChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly findings: FindingReadRepository = findingRepository,
  ) {}

  listFindings(opencodeConversationId: string): ListFindingsResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );

    return {
      findings: this.findings
        .listBySessionId(attachment.sessionId)
        .map(toFindingListItem),
    };
  }

  getFinding(
    opencodeConversationId: string,
    args: GetFindingArgs,
  ): GetFindingResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const finding =
      this.findings
        .listBySessionId(attachment.sessionId)
        .find((candidate) => candidate.id === args.findingId) ?? null;

    return {
      finding: finding ? toFindingDetail(finding) : null,
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
}

export const findingChatContextToolsService =
  new FindingChatContextToolsService();

export class ToolRunArtifactChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly tools: ToolReadRepository = sessionRepository,
  ) {}

  listToolRuns(opencodeConversationId: string): ListToolRunsResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );

    return {
      toolRuns: this.tools
        .listToolRunsBySessionId(attachment.sessionId)
        .map(toToolRunListItem),
    };
  }

  getArtifact(
    opencodeConversationId: string,
    args: GetArtifactArgs,
  ): GetArtifactResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const artifact = this.tools.findToolRunArtifactByIdForSession(
      attachment.sessionId,
      args.artifactId,
    );

    return {
      artifact: artifact
        ? toArtifactDetail(artifact, args.maxCharacters)
        : null,
    };
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    return [
      {
        name: "list_tool_runs",
        description:
          "List tool run history for the active NullTrace testing session attached to this OpenCode conversation.",
        args: {},
        execute: ({ opencodeConversationId }) =>
          this.listToolRuns(opencodeConversationId),
      },
      {
        name: "get_artifact",
        description:
          "Get a bounded artifact payload preview from the active NullTrace testing session.",
        args: {
          artifactId: {
            type: "string",
            description:
              "Artifact ID from a session finding or tool run. Do not provide a NullTrace session ID.",
          },
          maxCharacters: {
            type: "number",
            description:
              "Optional maximum preview characters. The preview is always bounded.",
            isOptional: true,
          },
        },
        execute: ({ opencodeConversationId, args }) =>
          this.getArtifact(opencodeConversationId, assertGetArtifactArgs(args)),
      },
    ];
  }
}

export const toolRunArtifactChatContextToolsService =
  new ToolRunArtifactChatContextToolsService();

export class ScannerCatalogChatContextToolsService {
  constructor(
    private readonly catalog: Record<ScannerToolId, ScannerCatalogTool> =
      scannerCatalog,
  ) {}

  listAvailableScannerTools(): ScannerCatalogContext {
    return listAvailableScannerToolsFromCatalog(this.catalog);
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    return [
      {
        name: "list_available_scanner_tools",
        description:
          "List scanner tools known to NullTrace, including implemented tools and catalog-only placeholders. This is read-only and does not generate or run scanner commands.",
        args: {},
        execute: () => this.listAvailableScannerTools(),
      },
    ];
  }
}

export const scannerCatalogChatContextToolsService =
  new ScannerCatalogChatContextToolsService();

export const chatContextToolRegistry = new ChatContextToolRegistry([
  ...findingChatContextToolsService.createToolDefinitions(),
  ...toolRunArtifactChatContextToolsService.createToolDefinitions(),
  ...scannerCatalogChatContextToolsService.createToolDefinitions(),
]);

function toOpenCodeSchemaSource(schema: ChatContextToolSchema) {
  const description = JSON.stringify(schema.description);
  const suffix = schema.isOptional ? ".optional()" : "";

  if (schema.type === "string") {
    return `tool.schema.string().describe(${description})${suffix}`;
  }

  if (schema.type === "number") {
    return `tool.schema.number().describe(${description})${suffix}`;
  }

  return `tool.schema.boolean().describe(${description})${suffix}`;
}

function createToolArgsSource(args: Record<string, ChatContextToolSchema>) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return "{}";
  }

  return `{
${entries
  .map(
    ([name, schema]) =>
      `    ${JSON.stringify(name)}: ${toOpenCodeSchemaSource(schema)},`,
  )
  .join("\n")}
  }`;
}

export function createOpenCodeToolSource(
  toolName: string,
  serviceImportPath: string,
  pluginImportPath: string,
) {
  const definition = chatContextToolRegistry
    .listDefinitions()
    .find((candidate) => candidate.name === toolName);
  if (!definition) {
    throw new Error(`Unknown chat context tool: ${toolName}`);
  }

  return `import { tool } from ${JSON.stringify(pluginImportPath)};
import { chatContextToolRegistry } from ${JSON.stringify(serviceImportPath)};

export default tool({
  description: ${JSON.stringify(definition.description)},
  args: ${createToolArgsSource(definition.args)},
  async execute(args, context) {
    const result = await chatContextToolRegistry.execute(
      ${JSON.stringify(definition.name)},
      context.sessionID,
      args,
    );

    return JSON.stringify(result);
  },
});
`;
}
