import {
  SessionReportDraft,
  SessionReportFinding,
} from "../model/session-report.types";
import { redactSessionReportText } from "./session-report-redaction.helpers";
import { createSessionReportSourceContext } from "./session-report-source-context.helpers";

const severityRank: Record<SessionReportFinding["severity"], number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en");
}

function normalizeInlineText(value: string) {
  return redactSessionReportText(value).replace(/\s+/g, " ").trim();
}

function escapeMarkdownText(value: string) {
  return normalizeInlineText(value).replace(/([\\`*_[\]<>#])/g, "\\$1");
}

function createCodeSpan(value: string) {
  return `\`${normalizeInlineText(value).replace(/`/g, "′")}\``;
}

function compareToolRuns(
  left: SessionReportDraft["toolRuns"][number],
  right: SessionReportDraft["toolRuns"][number],
) {
  return compareText(left.startedAt, right.startedAt) || compareText(left.id, right.id);
}

function compareFindings(left: SessionReportFinding, right: SessionReportFinding) {
  return (
    severityRank[right.severity] - severityRank[left.severity] ||
    compareText(left.sourceTool, right.sourceTool) ||
    compareText(left.title, right.title) ||
    compareText(left.fingerprint, right.fingerprint) ||
    compareText(left.id, right.id)
  );
}

function renderToolsUsed(draft: SessionReportDraft) {
  const toolNames = [...new Set(draft.toolRuns.map((run) => run.toolName))].sort(compareText);

  if (toolNames.length === 0) {
    return "No tool runs recorded.";
  }

  return toolNames.map((toolName) => `- ${createCodeSpan(toolName)}`).join("\n");
}

function renderToolRuns(draft: SessionReportDraft) {
  const toolRuns = [...draft.toolRuns].sort(compareToolRuns);

  if (toolRuns.length === 0) {
    return "No tool runs recorded.";
  }

  return toolRuns
    .map((run) =>
      [
        `### ${createCodeSpan(run.id)} — ${escapeMarkdownText(run.toolName)}`,
        "",
        `- Status: ${createCodeSpan(run.status)}`,
        `- Started: ${createCodeSpan(run.startedAt)}`,
        `- Ended: ${run.endedAt ? createCodeSpan(run.endedAt) : "Not recorded"}`,
        `- Exit Code: ${run.exitCode === null ? "Not recorded" : createCodeSpan(String(run.exitCode))}`,
      ].join("\n"),
    )
    .join("\n\n");
}

function renderFindings(draft: SessionReportDraft, selectedFindingIds: string[]) {
  const selectedIds = new Set(selectedFindingIds);
  const findings = draft.findings
    .filter((finding) => selectedIds.has(finding.id))
    .sort(compareFindings);

  if (findings.length === 0) {
    return "No Findings selected.";
  }

  return findings
    .map((finding, index) => {
      const sourceContext = createSessionReportSourceContext(finding);

      return [
        `### ${index + 1}. [${finding.severity.toUpperCase()}] ${escapeMarkdownText(finding.title)}`,
        "",
        `- Finding ID: ${createCodeSpan(finding.id)}`,
        `- Fingerprint: ${createCodeSpan(finding.fingerprint)}`,
        `- Review Status: ${createCodeSpan(finding.reviewStatus)}`,
        `- Source Tool: ${createCodeSpan(finding.sourceTool)}`,
        `- Kind: ${createCodeSpan(finding.kind)}`,
        `- Target: ${createCodeSpan(finding.target)}`,
        `- Tool Run ID: ${finding.toolRunId ? createCodeSpan(finding.toolRunId) : "Unavailable"}`,
        `- Artifact ID: ${createCodeSpan(finding.toolRunArtifactId)}`,
        `- Artifact Type: ${finding.artifactType ? createCodeSpan(finding.artifactType) : "Unavailable"}`,
        `- Artifact Label: ${finding.artifactLabel ? escapeMarkdownText(finding.artifactLabel) : "Unavailable"}`,
        `- Artifact Created: ${finding.artifactCreatedAt ? createCodeSpan(finding.artifactCreatedAt) : "Unavailable"}`,
        `- First Seen: ${createCodeSpan(finding.firstSeenAt)}`,
        `- Last Seen: ${createCodeSpan(finding.lastSeenAt)}`,
        "",
        escapeMarkdownText(finding.summary),
        "",
        "#### Source Context",
        "",
        ...(sourceContext.length > 0
          ? sourceContext.map(
              (field) =>
                `- ${escapeMarkdownText(field.label)}: ${createCodeSpan(field.value)}`,
            )
          : ["No bounded Source Context available."]),
      ].join("\n");
    })
    .join("\n\n");
}

export function createSessionReportMarkdown(
  draft: SessionReportDraft,
  selectedFindingIds: string[],
) {
  return [
    "# NullTrace Session Findings Report",
    "",
    "> Deterministic export of persisted session facts and scanner-derived Source Context.",
    "",
    "## Session Scope",
    "",
    `- Target: ${createCodeSpan(draft.session.displayUrl)}`,
    `- Normalized Target: ${createCodeSpan(draft.session.normalizedUrl)}`,
    `- Session ID: ${createCodeSpan(draft.session.id)}`,
    `- Session Started: ${createCodeSpan(draft.session.createdAt)}`,
    `- Last Activity: ${createCodeSpan(draft.session.lastActivityAt)}`,
    "",
    "## Tools Used",
    "",
    renderToolsUsed(draft),
    "",
    "## Tool Runs",
    "",
    renderToolRuns(draft),
    "",
    "## Findings",
    "",
    renderFindings(draft, selectedFindingIds),
    "",
  ].join("\n");
}
