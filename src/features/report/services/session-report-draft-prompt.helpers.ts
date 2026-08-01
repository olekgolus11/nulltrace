import {
  sessionReportDraftDescriptionStyles,
  sessionReportDraftExecutiveSummaryStyles,
  sessionReportDraftRecommendationActions,
} from "../model/session-report-draft.types";
import { SessionReportDraft } from "../model/session-report.types";
import { redactSessionReportText } from "./session-report-redaction.helpers";
import { createSessionReportSourceContext } from "./session-report-source-context.helpers";

const reportDraftFindingLimit = 25;
const reportDraftTextLimit = 1_200;

function boundText(value: string) {
  const redacted = redactSessionReportText(value).trim();
  if (redacted.length <= reportDraftTextLimit) {
    return redacted;
  }

  return `${redacted.slice(0, reportDraftTextLimit - 3)}...`;
}

export function createSessionReportDraftPrompt(
  draft: SessionReportDraft,
  selectedFindingIds: string[],
) {
  const selectedIds = new Set(selectedFindingIds);
  const selectedFindings = draft.findings.filter((finding) => selectedIds.has(finding.id));

  if (selectedFindings.length > reportDraftFindingLimit) {
    throw new Error(`Select no more than ${reportDraftFindingLimit} Findings for LLM-assisted drafting.`);
  }
  const selectedToolRunIds = new Set(
    selectedFindings.flatMap((finding) => (finding.toolRunId ? [finding.toolRunId] : [])),
  );

  const projection = {
    session: {
      id: draft.session.id,
      target: boundText(draft.session.displayUrl),
      normalizedTarget: boundText(draft.session.normalizedUrl),
      startedAt: draft.session.createdAt,
      lastActivityAt: draft.session.lastActivityAt,
    },
    toolRuns: draft.toolRuns
      .filter((run) => selectedToolRunIds.has(run.id))
      .map((run) => ({
        id: run.id,
        toolName: run.toolName,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        exitCode: run.exitCode,
      })),
    findings: selectedFindings.map((finding) => ({
      findingId: finding.id,
      title: boundText(finding.title),
      severity: finding.severity,
      sourceTool: finding.sourceTool,
      reviewStatus: finding.reviewStatus,
      kind: finding.kind,
      target: boundText(finding.target),
      scannerSummary: boundText(finding.summary),
      sourceContext: createSessionReportSourceContext(finding).map((field) => ({
        label: field.label,
        value: boundText(field.value),
      })),
    })),
  };

  return [
    "Choose a bounded editorial plan for an editable security report draft.",
    "The application renders prose locally from deterministic facts; do not return free-form prose.",
    "Return JSON only with this exact shape:",
    JSON.stringify({
      executiveSummaryStyle: sessionReportDraftExecutiveSummaryStyles.join("|"),
      findings: [
        {
          findingId: "exact selected id",
          descriptionStyle: sessionReportDraftDescriptionStyles.join("|"),
          recommendationActions: [sessionReportDraftRecommendationActions.join("|")],
        },
      ],
    }),
    "Return exactly one findings entry for every provided Finding and no others.",
    "Choose one to four distinct recommendationActions per Finding.",
    "Bounded report facts:",
    JSON.stringify(projection),
  ].join("\n");
}
