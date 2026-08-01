import {
  sessionReportDraftDescriptionStyles,
  sessionReportDraftExecutiveSummaryStyles,
  sessionReportDraftRecommendationActions,
  SessionReportDraftDescriptionStyle,
  SessionReportDraftEditorialPlan,
  SessionReportDraftExecutiveSummaryStyle,
  SessionReportDraftRecommendationAction,
} from "../model/session-report-draft.types";

export function mapSessionReportDraftResponse(
  response: string,
  selectedFindingIds: string[],
): SessionReportDraftEditorialPlan {
  const parsed = parseResponse(response);
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ["executiveSummaryStyle", "findings"]) ||
    !sessionReportDraftExecutiveSummaryStyles.includes(
      parsed.executiveSummaryStyle as SessionReportDraftExecutiveSummaryStyle,
    ) ||
    !Array.isArray(parsed.findings)
  ) {
    throw new Error("Provider returned malformed report draft JSON.");
  }

  const findings = parsed.findings.map((finding) => {
    if (
      !isRecord(finding) ||
      !hasExactKeys(finding, [
        "findingId",
        "descriptionStyle",
        "recommendationActions",
      ]) ||
      typeof finding.findingId !== "string" ||
      !sessionReportDraftDescriptionStyles.includes(
        finding.descriptionStyle as SessionReportDraftDescriptionStyle,
      ) ||
      !Array.isArray(finding.recommendationActions) ||
      finding.recommendationActions.length === 0 ||
      finding.recommendationActions.length > sessionReportDraftRecommendationActions.length ||
      new Set(finding.recommendationActions).size !== finding.recommendationActions.length ||
      !finding.recommendationActions.every((action) =>
        sessionReportDraftRecommendationActions.includes(
          action as SessionReportDraftRecommendationAction,
        ),
      )
    ) {
      throw new Error("Provider returned malformed report draft JSON.");
    }

    return {
      findingId: finding.findingId,
      descriptionStyle: finding.descriptionStyle as SessionReportDraftDescriptionStyle,
      recommendationActions:
        finding.recommendationActions as SessionReportDraftRecommendationAction[],
    };
  });
  const selectedIds = [...new Set(selectedFindingIds)];
  const returnedIds = findings.map((finding) => finding.findingId);
  const hasExactIdentities =
    returnedIds.length === selectedIds.length &&
    new Set(returnedIds).size === returnedIds.length &&
    returnedIds.every((findingId) => selectedIds.includes(findingId));

  if (!hasExactIdentities) {
    throw new Error("Provider report draft did not preserve selected Finding identities.");
  }

  const contentByFindingId = new Map(
    findings.map((finding) => [finding.findingId, finding]),
  );
  const orderedFindings = selectedIds.flatMap((findingId) => {
    const finding = contentByFindingId.get(findingId);
    return finding ? [finding] : [];
  });

  return {
    executiveSummaryStyle:
      parsed.executiveSummaryStyle as SessionReportDraftExecutiveSummaryStyle,
    findings: orderedFindings,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]) {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function parseResponse(response: string): unknown {
  const trimmedResponse = response.trim();
  const json = trimmedResponse.startsWith("```")
    ? trimmedResponse.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmedResponse;

  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Provider returned malformed report draft JSON.");
  }
}
