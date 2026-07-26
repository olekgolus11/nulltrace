import { describe, expect, it } from "bun:test";
import { ffufValueFindingMapper } from "../ffuf-value-finding.mapper";

describe("FFUF Value Finding mapper", () => {
  it("maps anomalies with deterministic parameter-scoped dedupe keys", () => {
    const candidates = ffufValueFindingMapper.mapArtifact({
      id: "artifact-1",
      toolRunId: "run-1",
      artifactType: "ffuf_value_fuzzing",
      label: "FFUF Value Fuzzing",
      source: "ffuf.json",
      payload: {
        results: [{
          payload: "' OR 1=1--",
          requestLocation: "query",
          parameterName: "q",
          response: { status: 500, size: 120, words: 10, lines: 2, redirectLocation: null },
          anomaly: { kind: "server_error", severity: "medium" },
          provenance: {
            toolRunId: "run-1",
            endpoint: "https://example.com/search",
            mode: "value_fuzzing",
          },
        }],
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceTool: "ffuf",
      kind: "ffuf.value.server_error",
      severity: "medium",
      target: "https://example.com/search",
      dedupeKeyParts: ["https://example.com/search", "query", "q", "server_error"],
      payload: { testedPayload: "' OR 1=1--", responseStatus: 500 },
    });
  });

  it("keeps ordinary and malformed matches out of Finding candidates", () => {
    const candidates = ffufValueFindingMapper.mapArtifact({
      id: "artifact-2",
      toolRunId: "run-2",
      artifactType: "ffuf_value_fuzzing",
      label: "FFUF Value Fuzzing",
      source: "ffuf.json",
      payload: {
        results: [
          { payload: "ordinary", anomaly: null },
          { anomaly: { kind: "server_error", severity: "medium" } },
          {
            payload: "bad",
            requestLocation: "query",
            parameterName: "q",
            response: {
              status: 500,
              size: null,
              words: null,
              lines: null,
              redirectLocation: null,
            },
            anomaly: { kind: "server_error", severity: "critical" },
            provenance: { endpoint: "https://example.com/search" },
          },
        ],
      },
      createdAt: "2026-07-26T10:00:00.000Z",
    });

    expect(candidates).toEqual([]);
  });
});
