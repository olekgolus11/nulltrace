import { ConversationAttachmentRecord } from "../model/conversation-attachment.types";
import {
  ChatContextToolArgs,
  ChatContextToolDefinition,
  ChatContextToolSchema,
} from "../model/chat-context-tool.types";
import {
  ActionDraftInput,
  ActionDraftRecord,
} from "../../action-draft/model/action-draft.types";
import { actionDraftRepository } from "../../action-draft/services/action-draft.repository.instance";
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
import {
  TargetSitemapCrawlStatusRecord,
  TargetSitemapEntryListFilters,
  TargetSitemapEntryListResult,
  TargetSitemapEntryRecord,
  TargetSitemapEntrySource,
} from "../../sitemap/model/sitemap.types";
import { sitemapRepository } from "../../sitemap/services/sitemap.repository";
import {
  ToolWorkspaceContextSnapshot,
  toolWorkspaceContextService,
} from "../../tool/shared/services/tool-workspace-context.service";
import { ChatContextToolRegistry } from "./chat-context-tool-registry";
import { conversationAttachmentService } from "./conversation-attachment.service";

const DEFAULT_ARTIFACT_PREVIEW_MAX_CHARACTERS = 4000;
const DEFAULT_FINDING_LIST_LIMIT = 25;
const MAX_FINDING_LIST_LIMIT = 100;
const DEFAULT_ACTIVE_TOOL_HISTORY_LIMIT = 5;
const DEFAULT_SITEMAP_LIST_LIMIT = 25;
const MAX_SITEMAP_LIST_LIMIT = 100;

const findingSeverityRanks: Record<SessionFindingRecord["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const findingReviewStatusLabels: Record<
  SessionFindingRecord["reviewStatus"],
  true
> = {
  needs_review: true,
  confirmed: true,
  dismissed: true,
};

type GetFindingArgs = {
  findingId: string;
};

type ListFindingsArgs = {
  limit?: number;
  offset?: number;
  query?: string;
  severity?: SessionFindingRecord["severity"];
  reviewStatus?: SessionFindingRecord["reviewStatus"];
  sourceTool?: string;
};

type NormalizedListFindingsArgs = {
  limit: number;
  offset: number;
  query?: string;
  severity?: SessionFindingRecord["severity"];
  reviewStatus?: SessionFindingRecord["reviewStatus"];
  sourceTool?: string;
};

type GetArtifactArgs = {
  artifactId: string;
  maxCharacters?: number;
};

type CreateActionDraftArgs = {
  targetTool: ScannerToolId;
  title: string;
  command?: string;
  intentJson?: string;
  formStateJson?: string;
};

type ListSitemapEntriesArgs = {
  limit?: number;
  offset?: number;
};

type SearchSitemapEntriesArgs = ListSitemapEntriesArgs & {
  depth?: number;
  maxDepth?: number;
  path?: string;
  method?: string;
  httpStatus?: number;
  source?: TargetSitemapEntrySource;
};

type GetSitemapEntryArgs = {
  entryId: string;
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

export interface ChatActiveToolWorkspaceCommandContext {
  currentCommand: string;
  generatedCommand: string;
  commandSource: ToolWorkspaceContextSnapshot["commandSource"];
  executionStatus: ToolWorkspaceContextSnapshot["executionStatus"];
  currentToolRunId: string | null;
  isHistoricPreview: boolean;
}

export interface ChatActiveToolWorkspaceContext {
  sessionId: string;
  activeTool: string;
  activePanel: string;
  updatedAt: string;
  command: ChatActiveToolWorkspaceCommandContext;
  form: Record<string, unknown>;
  selectedField: number;
  selectedHistoricalRun: ChatToolRunListItem | null;
  recentToolRuns: ChatToolRunListItem[];
}

export interface GetActiveToolWorkspaceResult {
  workspace: ChatActiveToolWorkspaceContext | null;
}

export interface GetArtifactResult {
  artifact: ChatToolRunArtifactDetail | null;
}

export interface ListFindingsPagination {
  limit: number;
  offset: number;
  nextOffset: number | null;
  total: number;
  hasMore: boolean;
}

export interface ListFindingsResult {
  findings: ChatFindingListItem[];
  pagination: ListFindingsPagination;
}

export interface GetFindingResult {
  finding: ChatFindingDetail | null;
}

export interface CreateActionDraftResult {
  actionDraft: {
    id: string;
    sessionId: string;
    opencodeConversationId: string | null;
    targetTool: ScannerToolId;
    status: ActionDraftRecord["status"];
    title: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface GetSessionContextResult {
  session: {
    id: string;
    targetId: string;
    normalizedTarget: string;
    displayTarget: string;
  } | null;
}

export interface ChatSitemapEntry {
  id: string;
  normalizedUrl: string;
  path: string;
  method: string | null;
  httpStatus: number | null;
  source: TargetSitemapEntrySource;
  depth: number;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}

export interface ChatSitemapPagination {
  limit: number;
  offset: number;
  nextOffset: number | null;
  total: number;
  hasMore: boolean;
}

export interface GetSitemapStatusResult {
  crawl: TargetSitemapCrawlStatusRecord & { entryCount: number };
}

export interface ListSitemapEntriesResult {
  entries: ChatSitemapEntry[];
  pagination: ChatSitemapPagination;
}

export interface GetSitemapEntryResult {
  entry: (ChatSitemapEntry & { discoveryContext: string }) | null;
}

interface ConversationAttachmentScope {
  findActiveAttachmentByOpenCodeConversationId: (
    opencodeConversationId: string,
  ) => ConversationAttachmentRecord | null;
}

interface SessionContextRecord {
  id: string;
  targetId: string;
  normalizedUrl: string;
  displayUrl: string;
}

interface SessionContextReadRepository {
  getSessionById: (sessionId: string) => SessionContextRecord | null;
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

interface ToolWorkspaceContextReadRepository {
  getActiveWorkspace: (sessionId: string) => ToolWorkspaceContextSnapshot | null;
}

interface ActionDraftWriteRepository {
  createDraft: (input: ActionDraftInput) => ActionDraftRecord;
}

interface SitemapReadRepository {
  getCrawlStatus: (targetId: string) => TargetSitemapCrawlStatusRecord;
  listEntries: (
    filters: TargetSitemapEntryListFilters,
  ) => TargetSitemapEntryListResult;
  findEntryByIdForTarget: (
    targetId: string,
    entryId: string,
  ) => TargetSitemapEntryRecord | null;
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

function normalizeOptionalString(value: unknown, argumentName: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`list_findings ${argumentName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isFindingSeverity(
  value: string,
): value is SessionFindingRecord["severity"] {
  return value in findingSeverityRanks;
}

function isFindingReviewStatus(
  value: string,
): value is SessionFindingRecord["reviewStatus"] {
  return value in findingReviewStatusLabels;
}

function normalizeSeverity(value: unknown) {
  const severity = normalizeOptionalString(value, "severity");
  if (!severity) {
    return undefined;
  }

  if (!isFindingSeverity(severity)) {
    throw new Error(
      "list_findings severity must be critical, high, medium, low, or info.",
    );
  }

  return severity;
}

function normalizeReviewStatus(value: unknown) {
  const reviewStatus = normalizeOptionalString(value, "reviewStatus");
  if (!reviewStatus) {
    return undefined;
  }

  if (!isFindingReviewStatus(reviewStatus)) {
    throw new Error(
      "list_findings reviewStatus must be needs_review, confirmed, or dismissed.",
    );
  }

  return reviewStatus;
}

function assertListFindingsArgs(
  args: ChatContextToolArgs | ListFindingsArgs,
): NormalizedListFindingsArgs {
  const limit = args.limit;
  if (limit !== undefined) {
    if (typeof limit !== "number" || !Number.isFinite(limit)) {
      throw new Error("list_findings limit must be a finite number.");
    }
  }

  const offset = args.offset;
  if (offset !== undefined) {
    if (typeof offset !== "number" || !Number.isFinite(offset)) {
      throw new Error("list_findings offset must be a finite number.");
    }
  }

  return {
    limit: Math.min(
      MAX_FINDING_LIST_LIMIT,
      Math.max(
        1,
        Math.floor(limit ?? DEFAULT_FINDING_LIST_LIMIT),
      ),
    ),
    offset: Math.max(0, Math.floor(offset ?? 0)),
    query: normalizeOptionalString(args.query, "query"),
    severity: normalizeSeverity(args.severity),
    reviewStatus: normalizeReviewStatus(args.reviewStatus),
    sourceTool: normalizeOptionalString(args.sourceTool, "sourceTool"),
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

function normalizeRequiredString(
  value: unknown,
  toolName: string,
  argumentName: string,
) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${toolName} requires a ${argumentName} string.`);
  }

  return value.trim();
}

function normalizeOptionalToolString(
  value: unknown,
  toolName: string,
  argumentName: string,
) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${toolName} ${argumentName} must be a string.`);
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseOptionalJson(value: string | undefined, argumentName: string) {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`create_action_draft ${argumentName} must be valid JSON.`);
  }
}

function normalizeOptionalCommand(value: unknown) {
  const command = normalizeOptionalToolString(
    value,
    "create_action_draft",
    "command",
  );
  return command;
}

function getScannerTargetForDraft(
  targetTool: ScannerToolId,
  session: SessionContextRecord | null,
) {
  const target = session?.normalizedUrl.trim() || session?.displayUrl.trim();
  if (!target) {
    return "";
  }

  if (targetTool === "nmap") {
    try {
      return new URL(target).hostname;
    } catch {
      return target.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    }
  }

  return target;
}

function replaceTargetPlaceholders(value: string, target: string) {
  if (!target) {
    return value;
  }

  return value
    .replaceAll("{{TARGET}}", target)
    .replaceAll("<TARGET>", target)
    .replaceAll("{TARGET}", target);
}

function toCreateActionDraftPayload(
  args: CreateActionDraftArgs,
  session: SessionContextRecord | null,
) {
  const scannerTarget = getScannerTargetForDraft(args.targetTool, session);
  const formState = parseOptionalJson(args.formStateJson, "formStateJson");
  const normalizedFormState =
    formState && typeof formState === "object" && !Array.isArray(formState)
      ? {
          ...formState,
          ...(typeof formState.target === "string"
            ? {
                target: replaceTargetPlaceholders(
                  formState.target,
                  scannerTarget,
                ),
              }
            : {}),
          ...(!("target" in formState) && scannerTarget
            ? { target: scannerTarget }
            : {}),
        }
      : formState;

  return {
    ...(scannerTarget
      ? {
          sessionTarget: {
            normalized: session?.normalizedUrl ?? scannerTarget,
            display: session?.displayUrl ?? scannerTarget,
            scannerTarget,
          },
        }
      : {}),
    ...(args.command
      ? {
          command: replaceTargetPlaceholders(args.command, scannerTarget),
        }
      : {}),
    ...(args.intentJson
      ? { intent: parseOptionalJson(args.intentJson, "intentJson") }
      : {}),
    ...(normalizedFormState !== undefined
      ? { formState: normalizedFormState }
      : {}),
  };
}

function normalizeActionDraftTargetTool(value: unknown) {
  const targetTool = normalizeRequiredString(
    value,
    "create_action_draft",
    "targetTool",
  ) as ScannerToolId;
  const scanner = scannerCatalog[targetTool];

  if (!scanner?.isImplemented) {
    throw new Error(
      `create_action_draft targetTool must be an implemented scanner tool: ${targetTool}`,
    );
  }

  return targetTool;
}

function assertCreateActionDraftArgs(
  args: ChatContextToolArgs,
): CreateActionDraftArgs {
  return {
    targetTool: normalizeActionDraftTargetTool(args.targetTool),
    title: normalizeRequiredString(
      args.title,
      "create_action_draft",
      "title",
    ),
    command: normalizeOptionalCommand(args.command),
    intentJson: normalizeOptionalToolString(
      args.intentJson,
      "create_action_draft",
      "intentJson",
    ),
    formStateJson: normalizeOptionalToolString(
      args.formStateJson,
      "create_action_draft",
      "formStateJson",
    ),
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

function matchesFindingQuery(
  finding: SessionFindingRecord,
  normalizedQuery: string,
) {
  const haystack = [
    finding.title,
    finding.summary,
    finding.target,
    finding.sourceTool,
    finding.severity,
    finding.reviewStatus,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(normalizedQuery);
}

function filterFindings(
  findings: SessionFindingRecord[],
  args: NormalizedListFindingsArgs,
) {
  const normalizedQuery = args.query?.toLowerCase();
  const normalizedSourceTool = args.sourceTool?.toLowerCase();

  return findings.filter((finding) => {
    if (args.severity && finding.severity !== args.severity) {
      return false;
    }

    if (args.reviewStatus && finding.reviewStatus !== args.reviewStatus) {
      return false;
    }

    if (
      normalizedSourceTool &&
      finding.sourceTool.toLowerCase() !== normalizedSourceTool
    ) {
      return false;
    }

    if (normalizedQuery && !matchesFindingQuery(finding, normalizedQuery)) {
      return false;
    }

    return true;
  });
}

function sortFindingsForDiscovery(findings: SessionFindingRecord[]) {
  return [...findings].sort((left, right) => {
    const severityDelta =
      findingSeverityRanks[right.severity] - findingSeverityRanks[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    const lastSeenDelta =
      Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    if (lastSeenDelta !== 0) {
      return lastSeenDelta;
    }

    return left.id.localeCompare(right.id);
  });
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

function toActiveToolWorkspaceContext(
  snapshot: ToolWorkspaceContextSnapshot,
  toolRuns: ToolRunSummary[],
): ChatActiveToolWorkspaceContext {
  const relevantToolRuns = toolRuns.filter(
    (run) => run.toolName === snapshot.toolName,
  );
  const selectedHistoricalRun =
    relevantToolRuns.find(
      (run) => run.id === snapshot.selectedHistoryRunId,
    ) ?? null;

  return {
    sessionId: snapshot.sessionId,
    activeTool: snapshot.toolName,
    activePanel: snapshot.activePanel,
    updatedAt: snapshot.updatedAt,
    command: {
      currentCommand: snapshot.commandInput,
      generatedCommand: snapshot.generatedCommand,
      commandSource: snapshot.commandSource,
      executionStatus: snapshot.executionStatus,
      currentToolRunId: snapshot.currentToolRunId,
      isHistoricPreview: snapshot.isHistoricPreview,
    },
    form: snapshot.toolData.form,
    selectedField: snapshot.toolData.selectedField,
    selectedHistoricalRun: selectedHistoricalRun
      ? toToolRunListItem(selectedHistoricalRun)
      : null,
    recentToolRuns: relevantToolRuns
      .slice(0, DEFAULT_ACTIVE_TOOL_HISTORY_LIMIT)
      .map(toToolRunListItem),
  };
}

function toCreateActionDraftResult(
  draft: ActionDraftRecord,
): CreateActionDraftResult {
  return {
    actionDraft: {
      id: draft.id,
      sessionId: draft.sessionId,
      opencodeConversationId: draft.opencodeConversationId,
      targetTool: draft.targetTool,
      status: draft.status,
      title: draft.title,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    },
  };
}

function normalizeSitemapNumber(
  value: unknown,
  argumentName: string,
  defaultValue?: number,
) {
  if (value === undefined) {
    return defaultValue;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${argumentName} must be a finite number.`);
  }

  return Math.max(0, Math.floor(value));
}

function normalizeOptionalSitemapDepth(value: unknown, argumentName: string) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${argumentName} must be a finite number.`);
  }

  const depth = Math.floor(value);
  return depth < 0 ? undefined : depth;
}

function normalizeSitemapListArgs(
  args: ChatContextToolArgs | ListSitemapEntriesArgs,
): Required<ListSitemapEntriesArgs> {
  const limit = normalizeSitemapNumber(args.limit, "sitemap limit");
  return {
    limit: Math.max(
      1,
      Math.min(limit ?? DEFAULT_SITEMAP_LIST_LIMIT, MAX_SITEMAP_LIST_LIMIT),
    ),
    offset: normalizeSitemapNumber(args.offset, "sitemap offset", 0) ?? 0,
  };
}

function normalizeSitemapSearchArgs(
  args: ChatContextToolArgs | SearchSitemapEntriesArgs,
): SearchSitemapEntriesArgs & { limit: number; offset: number } {
  const listArgs = normalizeSitemapListArgs(args);
  const source = normalizeOptionalToolString(
    args.source,
    "search_sitemap_entries",
    "source",
  ) as TargetSitemapEntrySource | undefined;
  const allowedSources: TargetSitemapEntrySource[] = [
    "seed",
    "html_link",
    "html_form",
    "sitemap_xml",
    "robots_sitemap",
    "manual",
  ];
  if (source && !allowedSources.includes(source)) {
    throw new Error(
      "search_sitemap_entries source must be seed, html_link, html_form, sitemap_xml, robots_sitemap, or manual.",
    );
  }

  return {
    ...listArgs,
    depth: normalizeOptionalSitemapDepth(args.depth, "sitemap depth"),
    maxDepth: normalizeOptionalSitemapDepth(
      args.maxDepth,
      "sitemap maxDepth",
    ),
    path: normalizeOptionalToolString(
      args.path,
      "search_sitemap_entries",
      "path",
    ),
    method: normalizeOptionalToolString(
      args.method,
      "search_sitemap_entries",
      "method",
    )?.toUpperCase(),
    httpStatus: normalizeSitemapNumber(
      args.httpStatus,
      "search_sitemap_entries httpStatus",
    ),
    source,
  };
}

function assertGetSitemapEntryArgs(
  args: ChatContextToolArgs,
): GetSitemapEntryArgs {
  return {
    entryId: normalizeRequiredString(
      args.entryId,
      "get_sitemap_entry",
      "entryId",
    ),
  };
}

function toChatSitemapEntry(
  entry: TargetSitemapEntryRecord,
): ChatSitemapEntry {
  return {
    id: entry.id,
    normalizedUrl: entry.normalizedUrl,
    path: entry.path,
    method: entry.method,
    httpStatus: entry.httpStatus,
    source: entry.source,
    depth: entry.depth,
    firstSeenAt: entry.firstSeenAt,
    lastSeenAt: entry.lastSeenAt,
    createdAt: entry.createdAt,
  };
}

function toSitemapListResult(
  result: TargetSitemapEntryListResult,
): ListSitemapEntriesResult {
  const nextOffset =
    result.offset + result.entries.length < result.total
      ? result.offset + result.entries.length
      : null;
  return {
    entries: result.entries.map(toChatSitemapEntry),
    pagination: {
      limit: result.limit,
      offset: result.offset,
      nextOffset,
      total: result.total,
      hasMore: nextOffset !== null,
    },
  };
}

export class SitemapChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly sessions: SessionContextReadRepository = sessionRepository,
    private readonly sitemap: SitemapReadRepository = sitemapRepository,
  ) {}

  private getTargetId(opencodeConversationId: string) {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const session = this.sessions.getSessionById(attachment.sessionId);
    if (!session) {
      throw new Error("The attached NullTrace session no longer exists.");
    }
    return session.targetId;
  }

  getStatus(opencodeConversationId: string): GetSitemapStatusResult {
    const targetId = this.getTargetId(opencodeConversationId);
    return {
      crawl: {
        ...this.sitemap.getCrawlStatus(targetId),
        entryCount: this.sitemap.listEntries({ targetId, limit: 1 }).total,
      },
    };
  }

  listEntries(
    opencodeConversationId: string,
    args: ListSitemapEntriesArgs = {},
  ) {
    const targetId = this.getTargetId(opencodeConversationId);
    return toSitemapListResult(
      this.sitemap.listEntries({ targetId, ...normalizeSitemapListArgs(args) }),
    );
  }

  searchEntries(
    opencodeConversationId: string,
    args: SearchSitemapEntriesArgs,
  ) {
    const targetId = this.getTargetId(opencodeConversationId);
    return toSitemapListResult(
      this.sitemap.listEntries({ targetId, ...normalizeSitemapSearchArgs(args) }),
    );
  }

  getEntry(
    opencodeConversationId: string,
    args: GetSitemapEntryArgs,
  ): GetSitemapEntryResult {
    const targetId = this.getTargetId(opencodeConversationId);
    const entry = this.sitemap.findEntryByIdForTarget(targetId, args.entryId);
    return {
      entry: entry
        ? {
            ...toChatSitemapEntry(entry),
            discoveryContext:
              entry.source === "html_form"
                ? "Discovered from an HTML form. The persisted sitemap model retains the form action and method, but not form fields or the referring page."
                : `Discovered via ${entry.source}. The persisted sitemap model does not retain the referring page.`,
          }
        : null,
    };
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    const paginationArgs = {
      limit: { type: "number", description: "Optional page size, capped at 100.", isOptional: true },
      offset: { type: "number", description: "Optional zero-based page offset.", isOptional: true },
    } as const;
    const depthFilterArgs = {
      depth: { type: "number", description: "Optional exact crawl depth. Omit unless the operator explicitly requests a depth-filtered result; zero is a real root-level filter.", isOptional: true },
      maxDepth: { type: "number", description: "Optional maximum crawl depth. Omit unless the operator explicitly requests a depth-filtered result; zero is a real root-level filter.", isOptional: true },
    } as const;
    return [
      {
        name: "get_sitemap_status",
        description: "Read crawl state, entry count, timestamps, and failure detail for the active conversation's session target.",
        args: {},
        execute: ({ opencodeConversationId }) => this.getStatus(opencodeConversationId),
      },
      {
        name: "list_sitemap_entries",
        description: "List a bounded page of all sitemap entries for the active conversation's session target. This tool does not filter by crawl depth; use search_sitemap_entries only when the operator explicitly requests filtered results.",
        args: paginationArgs,
        execute: ({ opencodeConversationId, args }) => this.listEntries(opencodeConversationId, normalizeSitemapListArgs(args)),
      },
      {
        name: "search_sitemap_entries",
        description: "Search sitemap entries for the active conversation's session target by path, method, HTTP status, discovery source, and optional depth filters. Omit depth and maxDepth unless the operator explicitly asks for a depth-filtered search.",
        args: {
          ...paginationArgs,
          ...depthFilterArgs,
          path: { type: "string", description: "Optional case-insensitive path substring.", isOptional: true },
          method: { type: "string", description: "Optional exact HTTP method.", isOptional: true },
          httpStatus: { type: "number", description: "Optional exact HTTP status.", isOptional: true },
          source: { type: "string", description: "Optional exact discovery source.", isOptional: true },
        },
        execute: ({ opencodeConversationId, args }) => this.searchEntries(opencodeConversationId, normalizeSitemapSearchArgs(args)),
      },
      {
        name: "get_sitemap_entry",
        description: "Get one sitemap entry and its persisted form or discovery context for the active conversation's session target.",
        args: { entryId: { type: "string", description: "Entry ID returned by a sitemap list or search tool." } },
        execute: ({ opencodeConversationId, args }) => this.getEntry(opencodeConversationId, assertGetSitemapEntryArgs(args)),
      },
    ];
  }
}

export const sitemapChatContextToolsService =
  new SitemapChatContextToolsService();

export class SessionContextChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly sessions: SessionContextReadRepository = sessionRepository,
  ) {}

  getSessionContext(opencodeConversationId: string): GetSessionContextResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const session = this.sessions.getSessionById(attachment.sessionId);

    return {
      session: session
        ? {
            id: session.id,
            targetId: session.targetId,
            normalizedTarget: session.normalizedUrl,
            displayTarget: session.displayUrl,
          }
        : null,
    };
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    return [
      {
        name: "get_session_context",
        description:
          "Get the active NullTrace session target attached to this OpenCode conversation. Use this before drafting scanner commands so commands contain the real target instead of placeholders.",
        args: {},
        execute: ({ opencodeConversationId }) =>
          this.getSessionContext(opencodeConversationId),
      },
    ];
  }
}

export const sessionContextChatContextToolsService =
  new SessionContextChatContextToolsService();

export class FindingChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly findings: FindingReadRepository = findingRepository,
  ) {}

  listFindings(
    opencodeConversationId: string,
    args: ListFindingsArgs = {},
  ): ListFindingsResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const normalizedArgs = assertListFindingsArgs(args);
    const findings = sortFindingsForDiscovery(
      filterFindings(
        this.findings.listBySessionId(attachment.sessionId),
        normalizedArgs,
      ),
    );
    const page = findings.slice(
      normalizedArgs.offset,
      normalizedArgs.offset + normalizedArgs.limit,
    );
    const nextOffset =
      normalizedArgs.offset + page.length < findings.length
        ? normalizedArgs.offset + page.length
        : null;

    return {
      findings: page.map(toFindingListItem),
      pagination: {
        limit: normalizedArgs.limit,
        offset: normalizedArgs.offset,
        nextOffset,
        total: findings.length,
        hasMore: nextOffset !== null,
      },
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
          "List a bounded page of findings for the active NullTrace testing session attached to this OpenCode conversation. Use filters or pagination to locate the exact finding ID before calling get_finding.",
        args: {
          limit: {
            type: "number",
            description:
              "Optional page size. Defaults to 25 and is capped at 100.",
            isOptional: true,
          },
          offset: {
            type: "number",
            description:
              "Optional zero-based offset from a previous list_findings response.",
            isOptional: true,
          },
          query: {
            type: "string",
            description:
              "Optional case-insensitive text to match title, summary, target, source tool, severity, or review status.",
            isOptional: true,
          },
          severity: {
            type: "string",
            description:
              "Optional exact severity filter: critical, high, medium, low, or info.",
            isOptional: true,
          },
          reviewStatus: {
            type: "string",
            description:
              "Optional exact review status filter: needs_review, confirmed, or dismissed.",
            isOptional: true,
          },
          sourceTool: {
            type: "string",
            description:
              "Optional exact source tool filter, such as nmap or nuclei.",
            isOptional: true,
          },
        },
        execute: ({ opencodeConversationId, args }) =>
          this.listFindings(
            opencodeConversationId,
            assertListFindingsArgs(args),
          ),
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

export class ActiveToolWorkspaceChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly workspaceContext: ToolWorkspaceContextReadRepository = toolWorkspaceContextService,
    private readonly tools: Pick<
      ToolReadRepository,
      "listToolRunsBySessionId"
    > = sessionRepository,
  ) {}

  getActiveToolWorkspace(
    opencodeConversationId: string,
  ): GetActiveToolWorkspaceResult {
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const workspace = this.workspaceContext.getActiveWorkspace(
      attachment.sessionId,
    );

    if (!workspace) {
      return {
        workspace: null,
      };
    }

    return {
      workspace: toActiveToolWorkspaceContext(
        workspace,
        this.tools.listToolRunsBySessionId(attachment.sessionId),
      ),
    };
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    return [
      {
        name: "get_active_tool_workspace",
        description:
          "Get the active scanner workspace context for the current NullTrace session, including active tool, command state, form state, selected historical run, and recent run history. Returns null when no scanner workspace is currently active.",
        args: {},
        execute: ({ opencodeConversationId }) =>
          this.getActiveToolWorkspace(opencodeConversationId),
      },
    ];
  }
}

export const activeToolWorkspaceChatContextToolsService =
  new ActiveToolWorkspaceChatContextToolsService();

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

export class ActionDraftChatContextToolsService {
  constructor(
    private readonly attachments: ConversationAttachmentScope = conversationAttachmentService,
    private readonly drafts: ActionDraftWriteRepository = actionDraftRepository,
    private readonly sessions: SessionContextReadRepository = sessionRepository,
  ) {}

  createActionDraft(
    opencodeConversationId: string,
    args: CreateActionDraftArgs,
  ): CreateActionDraftResult {
    const targetTool = normalizeActionDraftTargetTool(args.targetTool);
    const attachment = requireActiveAttachment(
      this.attachments,
      opencodeConversationId,
    );
    const session = this.sessions.getSessionById(attachment.sessionId);
    const draft = this.drafts.createDraft({
      sessionId: attachment.sessionId,
      opencodeConversationId: attachment.opencodeConversationId,
      targetTool,
      title: args.title,
      summary: "",
      payload: toCreateActionDraftPayload(args, session),
    });

    return toCreateActionDraftResult(draft);
  }

  createToolDefinitions(): ChatContextToolDefinition<
    ChatContextToolArgs,
    unknown
  >[] {
    return [
      {
        name: "create_action_draft",
        description:
          "Create a session-level scanner action draft for operator inspection. This is the only mutating NullTrace chat tool: it may persist a proposal for implemented scanner tools only, but it never executes scanners, starts tool runs, or changes finding review state.",
        args: {
          targetTool: {
            type: "string",
            description:
              "Implemented scanner tool to draft for. Must be nmap or nuclei; catalog-only tools such as ffuf, sqlmap, zap, and nikto are rejected.",
          },
          title: {
            type: "string",
            description:
              "Short human-readable title for the proposed scanner action.",
          },
          command: {
            type: "string",
            description:
              "Optional proposed scanner command text. This is persisted for review only and is never executed by the chat tool.",
            isOptional: true,
          },
          intentJson: {
            type: "string",
            description:
              "Optional JSON object or value describing the scanner intent.",
            isOptional: true,
          },
          formStateJson: {
            type: "string",
            description:
              "Optional JSON object or value with scanner form state to apply later.",
            isOptional: true,
          },
        },
        execute: ({ opencodeConversationId, args }) =>
          this.createActionDraft(
            opencodeConversationId,
            assertCreateActionDraftArgs(args),
          ),
      },
    ];
  }
}

export const actionDraftChatContextToolsService =
  new ActionDraftChatContextToolsService();

export const chatContextToolRegistry = new ChatContextToolRegistry([
  ...sessionContextChatContextToolsService.createToolDefinitions(),
  ...sitemapChatContextToolsService.createToolDefinitions(),
  ...findingChatContextToolsService.createToolDefinitions(),
  ...toolRunArtifactChatContextToolsService.createToolDefinitions(),
  ...activeToolWorkspaceChatContextToolsService.createToolDefinitions(),
  ...scannerCatalogChatContextToolsService.createToolDefinitions(),
  ...actionDraftChatContextToolsService.createToolDefinitions(),
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
