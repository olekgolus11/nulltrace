import { describe, expect, it, mock } from "bun:test";
import { SessionFindingPipelineService } from "../session-finding-pipeline.service";

describe("SessionFindingPipelineService", () => {
  it("returns without side effects when the mapper registry is empty", () => {
    const repository = {
      upsertCandidates: mock(() => []),
    };
    const service = new SessionFindingPipelineService([], repository);

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
    const service = new SessionFindingPipelineService(
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
});
