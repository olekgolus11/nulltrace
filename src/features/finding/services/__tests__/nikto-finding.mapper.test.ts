import { describe, expect, it } from "bun:test";
import { ToolRunArtifactRecord } from "../../../session/model/session.repository.types";
import { niktoFindingMapper } from "../mappers/nikto-finding.mapper";

function artifact(payload: unknown): ToolRunArtifactRecord {
  return {
    id: "artifact-1",
    toolRunId: "run-1",
    artifactType: "nikto_report",
    label: "Nikto Standard report",
    source: "nikto.json",
    payload,
    createdAt: "2026-07-26T10:00:00.000Z",
  };
}

describe("niktoFindingMapper", () => {
  it("maps informational and warning observations with deterministic dedupe", () => {
    const input = artifact({
      findings: [
        { id: "001", method: "GET", url: "/admin", message: "Admin path", severity: "warning" },
        { id: null, method: "GET", url: "/", message: "Server banner", severity: null },
      ],
    });
    const first = niktoFindingMapper.mapArtifact(input);
    const second = niktoFindingMapper.mapArtifact(input);

    expect(first).toHaveLength(2);
    expect(first[0]).toMatchObject({
      sourceTool: "nikto",
      kind: "nikto.check",
      severity: "medium",
      title: "Nikto 001: Admin path",
      target: "/admin",
      dedupeKeyParts: ["001", "GET", "/admin"],
    });
    expect(first[1]).toMatchObject({
      kind: "nikto.observation",
      severity: "info",
      title: "Server banner",
    });
    expect(second.map((item) => item.dedupeKeyParts)).toEqual(
      first.map((item) => item.dedupeKeyParts),
    );
  });

  it("does not fabricate findings from malformed report payload", () => {
    expect(niktoFindingMapper.mapArtifact(artifact({ findings: [{ message: "missing URL" }] }))).toEqual([]);
    expect(niktoFindingMapper.mapArtifact(artifact({ parseWarning: "partial" }))).toEqual([]);
  });
});
