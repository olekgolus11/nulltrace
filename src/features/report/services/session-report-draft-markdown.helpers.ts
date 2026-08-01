import {
  SessionReportDraftDescriptionStyle,
  SessionReportDraftEditorialPlan,
  SessionReportDraftExecutiveSummaryStyle,
  SessionReportDraftRecommendationAction,
} from "../model/session-report-draft.types";
import { SessionReportDraft, SessionReportFinding } from "../model/session-report.types";
import { createSessionReportMarkdown } from "./session-report-markdown.helpers";
import { redactSessionReportText } from "./session-report-redaction.helpers";

function createCodeSpan(value: string) {
  return `\`${redactSessionReportText(value).replace(/`/g, "′").replace(/\s+/g, " ").trim()}\``;
}

function createExecutiveSummary(
  style: SessionReportDraftExecutiveSummaryStyle,
  findings: SessionReportFinding[],
) {
  const confirmedCount = findings.filter(
    (finding) => finding.reviewStatus === "confirmed",
  ).length;
  const needsReviewCount = findings.filter(
    (finding) => finding.reviewStatus === "needs_review",
  ).length;
  const highImpactCount = findings.filter(
    (finding) => finding.severity === "critical" || finding.severity === "high",
  ).length;

  if (style === "review_status") {
    return `This draft covers ${findings.length} operator-selected Findings: ${confirmedCount} confirmed and ${needsReviewCount} awaiting review. Needs-review observations remain unverified.`;
  }
  if (style === "remediation") {
    return `This draft organizes remediation for ${findings.length} operator-selected Findings. Validate unverified observations, address confirmed Findings, and retest scanner-reported targets after changes.`;
  }

  return `This draft prioritizes ${findings.length} operator-selected Findings, including ${highImpactCount} with critical or high scanner severity. Review status and deterministic Source Context remain authoritative below.`;
}

function createFindingDescription(
  style: SessionReportDraftDescriptionStyle,
  finding: SessionReportFinding,
) {
  const identity = `${createCodeSpan(finding.sourceTool)} reported ${createCodeSpan(finding.title)} for ${createCodeSpan(finding.target)}`;
  if (style === "technical") {
    return `${identity} as a ${createCodeSpan(finding.severity)} ${createCodeSpan(finding.kind)} observation. Its persisted review status is ${createCodeSpan(finding.reviewStatus)}; consult deterministic Source Context before drawing conclusions.`;
  }
  if (style === "review_focused") {
    const verification =
      finding.reviewStatus === "needs_review"
        ? "This observation is unverified and requires operator review."
        : `The operator review status is ${createCodeSpan(finding.reviewStatus)}.`;
    return `${identity}. ${verification}`;
  }

  return `${identity}. Scanner severity is ${createCodeSpan(finding.severity)} and review status is ${createCodeSpan(finding.reviewStatus)}.`;
}

function createRecommendation(
  actions: SessionReportDraftRecommendationAction[],
  finding: SessionReportFinding,
) {
  const recommendations: Record<SessionReportDraftRecommendationAction, string> = {
    verify: `Verify the scanner observation against ${createCodeSpan(finding.target)} and record the operator decision separately.`,
    contain: "Apply proportionate temporary containment if operator verification confirms exposure.",
    remediate: "Plan remediation appropriate to the confirmed condition without changing the persisted scanner observation.",
    retest: `Retest ${createCodeSpan(finding.target)} with ${createCodeSpan(finding.sourceTool)} after remediation and compare new scanner results separately.`,
  };

  return actions.map((action) => `- ${recommendations[action]}`).join("\n");
}

export function createLlmAssistedSessionReportMarkdown(
  draft: SessionReportDraft,
  selectedFindingIds: string[],
  editorialPlan: SessionReportDraftEditorialPlan,
) {
  const findingsById = new Map(draft.findings.map((finding) => [finding.id, finding]));
  const selectedIds = new Set(selectedFindingIds);
  const selectedFindings = draft.findings.filter((finding) => selectedIds.has(finding.id));
  const generatedFindingSections = editorialPlan.findings.flatMap((findingPlan) => {
    const finding = findingsById.get(findingPlan.findingId);
    if (!finding) {
      return [];
    }

    return [
      [
        `### Finding Draft: ${createCodeSpan(finding.id)}`,
        "",
        `- Finding ID: ${createCodeSpan(finding.id)}`,
        `- Severity: ${createCodeSpan(finding.severity)}`,
        `- Source Tool: ${createCodeSpan(finding.sourceTool)}`,
        `- Review Status: ${createCodeSpan(finding.reviewStatus)}`,
        "",
        "#### LLM-Authored Description — Editable, Verify Before Use",
        "",
        createFindingDescription(findingPlan.descriptionStyle, finding),
        "",
        "#### LLM-Authored Recommendation — Editable, Verify Before Use",
        "",
        createRecommendation(findingPlan.recommendationActions, finding),
      ].join("\n"),
    ];
  });

  return [
    "# NullTrace LLM-Assisted Report Draft",
    "",
    "> LLM-assisted editable draft requiring operator verification. Generated prose does not replace persisted scanner facts, Finding Reviews, or Source Context.",
    "",
    "## LLM-Authored Executive Summary — Editable, Verify Before Use",
    "",
    createExecutiveSummary(editorialPlan.executiveSummaryStyle, selectedFindings),
    "",
    "## LLM-Assisted Finding Drafts",
    "",
    ...(generatedFindingSections.length > 0
      ? [generatedFindingSections.join("\n\n")]
      : ["No Findings selected for LLM-assisted prose."]),
    "",
    "---",
    "",
    "## Deterministic Scanner-Derived Report",
    "",
    createSessionReportMarkdown(draft, selectedFindingIds),
  ].join("\n");
}
