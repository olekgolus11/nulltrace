import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { sqlmapCommandService } from "../sqlmap-command.service";
import {
  setSqlmapAuthenticationAvailability,
  toggleSqlmapAuthenticatedContext,
} from "../sqlmap-authentication.helpers";

const preparedCleanups: Array<() => void> = [];

afterEach(() => {
  preparedCleanups.splice(0).forEach((cleanup) => cleanup());
});

describe("sqlmapCommandService", () => {
  it("builds a bounded GET verification for exactly one endpoint and parameter", () => {
    const toolData = sqlmapCommandService.createInitialToolData(
      "http://127.0.0.1:3000/products?id=1",
    );

    expect(sqlmapCommandService.buildCommand(toolData)).toBe(
      "sqlmap -u 'http://127.0.0.1:3000/products?id=1' --method GET -p 'id' --level 1 --risk 1 --timeout 10 --retries 1 --threads 1 --technique BEU --batch --disable-coloring",
    );
    expect(toolData.form).toMatchObject({
      method: "GET",
      parameter: "id",
      body: "",
      level: "1",
      risk: "1",
      timeLimitSeconds: "300",
    });
  });

  it("builds a targeted POST verification when the selected parameter is in the body", () => {
    let toolData = sqlmapCommandService.createInitialToolData(
      "http://127.0.0.1:3000/api/products",
    );
    toolData = sqlmapCommandService.setField(toolData, "method", "POST");
    toolData = sqlmapCommandService.setField(toolData, "parameter", "id");
    toolData = sqlmapCommandService.setField(toolData, "body", "id=1&category=2");
    toolData = sqlmapCommandService.setField(toolData, "level", "3");
    toolData = sqlmapCommandService.setField(
      toolData,
      "extraSafeOptions",
      "--technique=BE --smart --text-only",
    );

    expect(sqlmapCommandService.buildCommand(toolData)).toBe(
      "sqlmap -u 'http://127.0.0.1:3000/api/products' --method POST --data 'id=1&category=2' -p 'id' --level 3 --risk 1 --timeout 10 --retries 1 --threads 1 --batch --disable-coloring --technique=BE --smart --text-only",
    );
  });

  it("prepares controlled output and total run timeout without persisting its local path", () => {
    const command =
      "sqlmap -u 'http://127.0.0.1:3000/products?id=1' --method GET -p id --level 2 --risk 1 --batch";
    const toolData = sqlmapCommandService.createInitialToolData(
      "http://127.0.0.1:3000/products?id=1",
    );
    const configured = sqlmapCommandService.setField(toolData, "timeLimitSeconds", "120");
    const prepared = sqlmapCommandService.prepareCommandForRun({
      command,
      sessionId: "session-1",
      toolRunId: "run-1",
      toolData: configured,
    });

    expect(typeof prepared).toBe("object");
    if (prepared instanceof Promise) throw new Error("Expected public preparation metadata.");
    if (typeof prepared === "string") throw new Error("Expected prepared command metadata.");
    preparedCleanups.push(prepared.cleanup ?? (() => {}));
    expect(prepared.command).toContain("--output-dir '");
    expect(prepared.command).toContain("--disable-coloring");
    expect(prepared.command).toContain("--technique BEU");
    expect(prepared.command).toContain("--ignore-stdin");
    expect(prepared.timeoutMs).toBe(120_000);
    const outputDirectory = prepared.command.match(/--output-dir '([^']+)'/)?.[1];
    expect(outputDirectory).toBeString();
    expect(outputDirectory && existsSync(outputDirectory)).toBe(true);
    expect(prepared.redactOutput?.(`saved to ${outputDirectory}/target/log`)).toBe(
      "saved to [controlled sqlmap output]/target/log",
    );
    expect(
      prepared.redactOutput?.(
        "Traceback /Users/alice/tools/sqlmap.py SECRET_TOKEN=do-not-store",
      ),
    ).toBe("Traceback [local path redacted] SECRET_TOKEN=[redacted]");
  });

  it("requires a persisted run before execution-only authentication injection", () => {
    let toolData = sqlmapCommandService.createInitialToolData(
      "https://example.com/products?id=1",
    );
    toolData = setSqlmapAuthenticationAvailability(
      toolData,
      "https://example.com",
    );
    toolData = toggleSqlmapAuthenticatedContext(toolData);

    expect(() =>
      sqlmapCommandService.prepareCommandForRun({
        command: sqlmapCommandService.buildCommand(toolData),
        sessionId: null,
        toolRunId: null,
        toolData,
      }),
    ).toThrow("active persisted tool run");
  });

  it("redacts local paths and sensitive environment values from persisted command text", () => {
    const previousSecret = process.env.NULLTRACE_SQLMAP_TEST_SECRET;
    process.env.NULLTRACE_SQLMAP_TEST_SECRET = "environment-secret-value";
    try {
      expect(
        sqlmapCommandService.redactCommandForPersistence(
          "sqlmap -u 'http://127.0.0.1/a' --method POST --data 'username=alice&password=environment-secret-value' -p username --string '/custom/private/check environment-secret-value'",
        ),
      ).toBe(
        "sqlmap -u 'http://127.0.0.1/a' --method POST --data '[request body redacted]' -p username --string '[local path redacted] [redacted]'",
      );
    } finally {
      if (previousSecret === undefined) delete process.env.NULLTRACE_SQLMAP_TEST_SECRET;
      else process.env.NULLTRACE_SQLMAP_TEST_SECRET = previousSecret;
    }
  });

  it.each([
    ["crawling", "--crawl=2"],
    ["forms discovery", "--forms"],
    ["bulk targets", "-m targets.txt"],
    ["direct database target", "-d mysql://user:pass@localhost/db"],
    ["request files", "-r request.txt"],
    ["manual cookies", "--cookie=session=secret"],
    ["manual headers", "--headers='Authorization: Bearer secret'"],
    ["manual authentication credentials", "--auth-cred=user:pass"],
    ["automatic dumping", "--dump-all"],
    ["database enumeration", "--dbs"],
    ["SQL shell", "--sql-shell"],
    ["operating-system shell", "--os-shell"],
    ["takeover", "--os-pwn"],
    ["filesystem read", "--file-read=/etc/passwd"],
    ["filesystem write", "--file-write=payload.bin"],
    ["SQL execution", "--sql-query=SELECT+1"],
    ["host command hook", "--alert=whoami"],
  ])("rejects %s after manual command edits", (_label, prohibitedOption) => {
    const command =
      "sqlmap -u 'http://127.0.0.1:3000/products?id=1' -p id " + prohibitedOption;

    expect(() =>
      sqlmapCommandService.prepareCommandForRun({
        command,
        sessionId: "session-1",
        toolRunId: "run-1",
      }),
    ).toThrow("Targeted sqlmap verification rejects option");
  });

  it("rejects composed commands, duplicate targets, multiple parameters, and absent parameters", () => {
    const commands = [
      "sqlmap -u 'http://127.0.0.1/a?id=1' -p id; env",
      "sqlmap -u 'http://127.0.0.1/a?id=1' -u 'http://127.0.0.1/b?id=1' -p id",
      "sqlmap -u 'http://127.0.0.1/a?id=1&name=x' -p id,name",
      "sqlmap -u 'http://127.0.0.1/a' -p id",
      "sqlmap -u 'http://127.0.0.1/a?id=1' --method POST -p id",
    ];

    commands.forEach((command) => {
      expect(() =>
        sqlmapCommandService.prepareCommandForRun({
          command,
          sessionId: "session-1",
          toolRunId: "run-1",
        }),
      ).toThrow();
    });
  });

  it("rejects risk above one and test levels outside the guided bound", () => {
    expect(() =>
      sqlmapCommandService.prepareCommandForRun({
        command: "sqlmap -u 'http://127.0.0.1/a?id=1' -p id --risk 2",
        sessionId: "session-1",
        toolRunId: "run-1",
      }),
    ).toThrow("risk must be 1");
    expect(() =>
      sqlmapCommandService.prepareCommandForRun({
        command: "sqlmap -u 'http://127.0.0.1/a?id=1' -p id --level 4",
        sessionId: "session-1",
        toolRunId: "run-1",
      }),
    ).toThrow("level must be between 1 and 3");
  });
});
