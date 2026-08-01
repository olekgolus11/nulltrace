import { describe, expect, it } from "bun:test";
import { mapSessionReportDraftResponse } from "../session-report-draft-response.mapper";

describe("mapSessionReportDraftResponse", () => {
  it("maps a bounded editorial plan to exact selected Finding identities", () => {
    const response = JSON.stringify({
      executiveSummaryStyle: "risk_prioritized",
      findings: [
        {
          findingId: "finding-1",
          descriptionStyle: "technical",
          recommendationActions: ["verify", "remediate"],
        },
        {
          findingId: "finding-2",
          descriptionStyle: "concise",
          recommendationActions: ["retest"],
        },
      ],
    });

    expect(mapSessionReportDraftResponse(response, ["finding-1", "finding-2"])).toEqual({
      executiveSummaryStyle: "risk_prioritized",
      findings: [
        {
          findingId: "finding-1",
          descriptionStyle: "technical",
          recommendationActions: ["verify", "remediate"],
        },
        {
          findingId: "finding-2",
          descriptionStyle: "concise",
          recommendationActions: ["retest"],
        },
      ],
    });
  });

  it("rejects malformed output and any invented or missing Finding identity", () => {
    expect(() => mapSessionReportDraftResponse("not json", ["finding-1"])).toThrow(
      "Provider returned malformed report draft JSON.",
    );
    expect(() =>
      mapSessionReportDraftResponse(
        JSON.stringify({
          executiveSummaryStyle: "review_status",
          findings: [
            {
              findingId: "invented-finding",
              descriptionStyle: "concise",
              recommendationActions: ["verify"],
            },
          ],
        }),
        ["finding-1"],
      ),
    ).toThrow("Provider report draft did not preserve selected Finding identities.");
  });

  it("rejects free-form prose and values outside the bounded editorial plan", () => {
    expect(() =>
      mapSessionReportDraftResponse(
        JSON.stringify({
          executiveSummary: "The application allows anonymous administrator access.",
          findings: [
            {
              findingId: "finding-1",
              description: "Private keys are public.",
              recommendation: "Rotate keys.",
            },
          ],
        }),
        ["finding-1"],
      ),
    ).toThrow("Provider returned malformed report draft JSON.");

    expect(() =>
      mapSessionReportDraftResponse(
        JSON.stringify({
          executiveSummaryStyle: "review_status",
          executiveSummary: "The application allows anonymous administrator access.",
          findings: [
            {
              findingId: "finding-1",
              descriptionStyle: "concise",
              recommendationActions: ["verify"],
              description: "Private keys are public.",
            },
          ],
        }),
        ["finding-1"],
      ),
    ).toThrow("Provider returned malformed report draft JSON.");
  });
});
