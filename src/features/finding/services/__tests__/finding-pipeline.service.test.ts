import { describe, expect, it, mock } from "bun:test";
import { FindingPipelineService } from "../finding-pipeline.service";
import { nucleiFindingMapper } from "../mappers/nuclei-finding.mapper";

describe("FindingPipelineService", () => {
  it("returns without side effects when the mapper registry is empty", () => {
    const repository = {
      upsertCandidates: mock(() => []),
    };
    const service = new FindingPipelineService([], repository);

    service.processArtifacts({
      sessionId: "session-1",
      artifacts: [
        {
          id: "artifact-1",
          toolRunId: "run-1",
          artifactType: "nmap_scan",
          label: "Nmap scan",
          source: "nmap.xml",
          payload: {},
          createdAt: "2026-05-10T10:00:00.000Z",
        },
      ],
    });

    expect(repository.upsertCandidates).not.toHaveBeenCalled();
  });

  it("returns without side effects when no mapper matches an artifact type", () => {
    const repository = {
      upsertCandidates: mock(() => []),
    };
    const service = new FindingPipelineService(
      [
        {
          artifactType: "nuclei_jsonl",
          mapArtifact: mock(() => []),
        },
      ],
      repository,
    );

    service.processArtifacts({
      sessionId: "session-1",
      artifacts: [
        {
          id: "artifact-1",
          toolRunId: "run-1",
          artifactType: "nmap_scan",
          label: "Nmap scan",
          source: "nmap.xml",
          payload: {},
          createdAt: "2026-05-10T10:00:00.000Z",
        },
      ],
    });

    expect(repository.upsertCandidates).not.toHaveBeenCalled();
  });

  it("wraps nuclei finding candidates with the source artifact id", () => {
    const repository = {
      upsertCandidates: mock(() => []),
    };
    const service = new FindingPipelineService([nucleiFindingMapper], repository);

    service.processArtifacts({
      sessionId: "session-1",
      artifacts: [
        {
          id: "artifact-1",
          toolRunId: "run-1",
          artifactType: "nuclei_findings",
          label: "Nuclei findings",
          source: "nuclei.jsonl",
          payload: {
            findings: [
              {
                templateId: "cves/2024/test",
                name: "Example exposure",
                severity: "high",
                matchedAt: "https://example.com/login",
                type: "http",
                tags: ["cve"],
                description: null,
                references: [],
                raw: {},
              },
            ],
          },
          createdAt: "2026-05-10T10:00:00.000Z",
        },
      ],
    });

    expect(repository.upsertCandidates).toHaveBeenCalledTimes(1);
    expect(repository.upsertCandidates).toHaveBeenCalledWith([
      {
        sessionId: "session-1",
        toolRunArtifactId: "artifact-1",
        candidate: expect.objectContaining({
          sourceTool: "nuclei",
          title: "Example exposure",
        }),
      },
    ]);
  });
});
