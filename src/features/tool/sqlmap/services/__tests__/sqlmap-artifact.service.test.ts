import { describe, expect, it } from "bun:test";
import { SqlmapArtifactService } from "../sqlmap-artifact.service";
import { parseSqlmapOutput } from "../sqlmap-output.parser";

const context = {
  endpoint: "http://127.0.0.1:3000/products?id=1",
  method: "GET" as const,
  parameter: "id",
};

describe("parseSqlmapOutput", () => {
  it("parses a positive observation without retaining injection payload text", () => {
    const output = `
[12:10:01] [INFO] testing connection to the target URL
Parameter: id (GET)
    Type: boolean-based blind
    Title: AND boolean-based blind - WHERE or HAVING clause
    Payload: id=1 AND 1234=1234

    Type: error-based
    Title: MySQL >= 5.0 AND error-based
    Payload: id=1 AND EXTRACTVALUE(...)
back-end DBMS: MySQL >= 5.0
`;

    expect(parseSqlmapOutput(output, context)).toEqual({
      outcome: "positive",
      observations: [
        {
          endpoint: context.endpoint,
          method: "GET",
          parameter: "id",
          place: "GET",
          databaseManagementSystem: "MySQL >= 5.0",
          techniques: [
            {
              type: "boolean-based blind",
              title: "AND boolean-based blind - WHERE or HAVING clause",
            },
            {
              type: "error-based",
              title: "MySQL >= 5.0 AND error-based",
            },
          ],
        },
      ],
      parseWarning: null,
    });
    expect(JSON.stringify(parseSqlmapOutput(output, context))).not.toContain("1234=1234");
    expect(JSON.stringify(parseSqlmapOutput(output, context))).not.toContain("EXTRACTVALUE");
  });

  it("treats explicit negative output as readable negative data without observations", () => {
    expect(
      parseSqlmapOutput(
        "[WARNING] all tested parameters do not appear to be injectable.",
        context,
      ),
    ).toEqual({
      outcome: "negative",
      observations: [],
      parseWarning: null,
    });
  });

  it("does not fabricate observations from partial, malformed, or unrelated parameter output", () => {
    const outputs = [
      "Parameter: id (GET)\n    Type: boolean-based blind",
      "parameter 'id' might be injectable",
      "Parameter: other (GET)\n    Type: error-based\n    Title: SQL error",
      "Traceback: /Users/alice/private/sqlmap.py SECRET_TOKEN=do-not-store",
    ];

    outputs.forEach((output) => {
      const parsed = parseSqlmapOutput(output, context);
      expect(parsed.outcome).toBe("inconclusive");
      expect(parsed.observations).toEqual([]);
      expect(parsed.parseWarning).toBeString();
      expect(JSON.stringify(parsed)).not.toContain("/Users/alice");
      expect(JSON.stringify(parsed)).not.toContain("do-not-store");
    });
  });
});

describe("SqlmapArtifactService", () => {
  it("collects a controlled normalized artifact from bounded persisted logs", async () => {
    const service = new SqlmapArtifactService({
      getToolRunWithLogs: () => ({
        id: "run-1",
        toolName: "sqlmap",
        command: "sqlmap -u 'http://127.0.0.1:3000/products?id=1' -p id",
        commandSource: "generated",
        status: "success",
        startedAt: "2026-07-31T10:00:00.000Z",
        endedAt: "2026-07-31T10:01:00.000Z",
        exitCode: 0,
        logs: [
          { seq: 1, stream: "stdout", line: "Parameter: id (GET)", createdAt: "now" },
          { seq: 2, stream: "stdout", line: "    Type: error-based", createdAt: "now" },
          { seq: 3, stream: "stdout", line: "    Title: MySQL error-based", createdAt: "now" },
          { seq: 4, stream: "stdout", line: "    Payload: secret payload", createdAt: "now" },
          { seq: 5, stream: "stdout", line: "back-end DBMS: MySQL", createdAt: "now" },
        ],
        artifacts: [],
      }),
    });

    const artifacts = await service.collectArtifacts({
      sessionId: "session-1",
      toolRunId: "run-1",
      status: "success",
      exitCode: 0,
      command: "sqlmap -u 'http://127.0.0.1:3000/products?id=1' -p id",
    });

    expect(artifacts).toEqual([
      {
        artifactType: "sqlmap_verification",
        label: "Targeted sqlmap verification",
        source: "sqlmap.normalized.json",
        payload: {
          runContext: {
            endpoint: "http://127.0.0.1:3000/products?id=1",
            method: "GET",
            parameter: "id",
            status: "success",
            exitCode: 0,
          },
          outcome: "positive",
          observations: [expect.objectContaining({ parameter: "id" })],
          parseWarning: null,
        },
      },
    ]);
    expect(JSON.stringify(artifacts)).not.toContain("secret payload");
  });
});
