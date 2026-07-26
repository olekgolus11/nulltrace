import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

process.env.XDG_DATA_HOME = "/private/tmp/nulltrace-test";

const {
  buildFfufContentDiscoveryCommand,
  buildFfufParameterDiscoveryCommand,
  collectFfufArtifacts,
  createInitialFfufToolData,
  createInitialFfufParameterDiscoveryToolData,
  createInitialFfufValueFuzzingToolData,
  buildFfufValueFuzzingCommand,
  prepareFfufCommandForRun,
  setFfufContentDiscoveryField,
} = await import("../ffuf-command.helpers");
const {
  classifyFfufValueAnomaly,
  mapFfufValueFuzzingResults,
  parseFfufOutput,
  selectExactOriginFfufMatches,
} = await import("../ffuf-output.helpers");
const { getAppDataDirectory } = await import("../../../../session/services/session-database");

describe("FFUF command helpers", () => {
  test("builds Content Discovery command from guided fields", () => {
    const initial = createInitialFfufToolData("https://example.com");
    const data = setFfufContentDiscoveryField(initial, "wordlist", "/tmp/common.txt");
    const withExtensions = setFfufContentDiscoveryField(data, "extensions", ".php,.bak");
    const withRecursion = setFfufContentDiscoveryField(withExtensions, "recursion", true);
    const withDepth = setFfufContentDiscoveryField(withRecursion, "recursionDepth", "3");
    const withMatchers = setFfufContentDiscoveryField(withDepth, "matchCodes", "200,204,301");
    const withFilters = setFfufContentDiscoveryField(withMatchers, "filterCodes", "404");
    const withRate = setFfufContentDiscoveryField(withFilters, "rate", "25");
    const configured = setFfufContentDiscoveryField(withRate, "timeLimit", "15");

    expect(buildFfufContentDiscoveryCommand(configured)).toBe(
      "ffuf -u https://example.com/FUZZ -w /tmp/common.txt -e .php,.bak -recursion -recursion-depth 3 -mc 200,204,301 -fc 404 -rate 25 -maxtime 15",
    );
  });

  test("owns JSON output flags at run preparation boundary", () => {
    const prepared = prepareFfufCommandForRun({
      command:
        "ffuf -u https://example.com/FUZZ -w words.txt -o='/tmp/manual.json' -of=ejson -json=true",
      sessionId: "session-1",
      toolRunId: "run-1",
    });

    expect(prepared).toContain("ffuf -u https://example.com/FUZZ -w words.txt");
    expect(prepared).not.toContain("manual.json");
    expect(prepared).not.toContain("-of=ejson");
    expect(prepared).not.toContain("-json");
    expect(prepared).toContain("-of json -o ");
    expect(prepared).toContain("artifacts/sessions/session-1/tool-runs/run-1/ffuf.json");
  });

  test("builds a bounded Parameter Discovery command for one query endpoint", () => {
    const initial = createInitialFfufParameterDiscoveryToolData("https://example.com/search");
    const configured = {
      ...initial,
      form: {
        ...initial.form,
        wordlist: "/tmp/parameters.txt",
        matchCodes: "200,302",
        filterCodes: "404",
        rate: "20",
        timeLimit: "15",
      },
    };

    expect(buildFfufParameterDiscoveryCommand(configured)).toBe(
      "ffuf -u 'https://example.com/search?FUZZ=nulltrace' -w /tmp/parameters.txt -mc 200,302 -fc 404 -rate 20 -maxtime 15",
    );
  });

  test("builds Value Fuzzing commands for one named parameter and location", () => {
    const initial = createInitialFfufValueFuzzingToolData("https://example.com/search");
    const configured = {
      ...initial,
      form: {
        ...initial.form,
        parameterName: "q",
        wordlist: "/tmp/payloads.txt",
        matchCodes: "200,500",
        filterCodes: "404",
        rate: "20",
        timeLimit: "15",
      },
    };

    expect(buildFfufValueFuzzingCommand(configured)).toBe(
      "ffuf -u 'https://example.com/search?q=FUZZ' -enc FUZZ:urlencode -w /tmp/payloads.txt -mc 200,500 -fc 404 -rate 20 -maxtime 15",
    );
    expect(
      buildFfufValueFuzzingCommand({
        ...configured,
        form: { ...configured.form, requestLocation: "body" },
      }),
    ).toContain("-X POST -d 'q=FUZZ'");
    expect(
      buildFfufValueFuzzingCommand({
        ...configured,
        form: { ...configured.form, endpoint: "not a url" },
      }),
    ).not.toContain("-u");
  });

  test("quotes body and header endpoints before shell execution", () => {
    const initial = createInitialFfufParameterDiscoveryToolData(
      "https://example.com/search?existing=value&flag=true",
    );

    expect(
      buildFfufParameterDiscoveryCommand({
        ...initial,
        form: { ...initial.form, requestLocation: "body" },
      }),
    ).toContain("-u 'https://example.com/search?existing=value&flag=true'");
    expect(
      buildFfufParameterDiscoveryCommand({
        ...initial,
        form: { ...initial.form, requestLocation: "header" },
      }),
    ).toContain("-u 'https://example.com/search?existing=value&flag=true'");
  });

  test("rejects manually edited FFUF commands outside the session exact origin", () => {
    const toolData = createInitialFfufParameterDiscoveryToolData("https://example.com/search");

    expect(() =>
      prepareFfufCommandForRun({
        command: "ffuf -u https://outside.example/search?FUZZ=nulltrace -w /tmp/parameters.txt",
        sessionId: "session-origin",
        toolRunId: "run-origin",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).toThrow("exact target origin");
  });

  test("rejects shell-composed and multi-target manually edited commands", () => {
    const toolData = createInitialFfufParameterDiscoveryToolData("https://example.com/search");

    expect(() =>
      prepareFfufCommandForRun({
        command:
          "ffuf -u https://example.com/search?FUZZ=nulltrace -w /tmp/parameters.txt; ffuf -u https://outside.example/search?FUZZ=nulltrace -w /tmp/parameters.txt",
        sessionId: "session-composed",
        toolRunId: "run-composed",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).toThrow("one simple FFUF command");

    expect(() =>
      prepareFfufCommandForRun({
        command:
          "ffuf -u https://example.com/search?FUZZ=nulltrace -u https://outside.example/search?FUZZ=nulltrace -w /tmp/parameters.txt",
        sessionId: "session-multiple-targets",
        toolRunId: "run-multiple-targets",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).toThrow("exactly one target URL");
  });

  test("forces bounded rate and time limits after manual command edits", () => {
    const toolData = createInitialFfufParameterDiscoveryToolData("https://example.com/search");
    const prepared = prepareFfufCommandForRun({
      command:
        "ffuf -u 'https://example.com/search?FUZZ=nulltrace' -w /tmp/parameters.txt -rate 999 -maxtime 3600",
      sessionId: "session-bounded",
      toolRunId: "run-bounded",
      targetUrl: "https://example.com",
      toolData,
    });

    expect(prepared).toContain("-rate 25 -maxtime 10");
    expect(prepared).not.toContain("999");
    expect(prepared).not.toContain("3600");
  });

  test("rejects manual commands that switch away from the selected FFUF mode", () => {
    const toolData = createInitialFfufParameterDiscoveryToolData("https://example.com/search");

    expect(() =>
      prepareFfufCommandForRun({
        command: "ffuf -u https://example.com/FUZZ -w /tmp/content.txt",
        sessionId: "session-mode",
        toolRunId: "run-mode",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).toThrow("Parameter Discovery mode");
  });

  test("rejects Value Fuzzing commands that do not target the selected parameter and location", () => {
    const toolData = createInitialFfufValueFuzzingToolData("https://example.com/search");
    toolData.form.parameterName = "q";

    expect(() =>
      prepareFfufCommandForRun({
        command: "ffuf -u https://example.com/FUZZ -w /tmp/payloads.txt",
        sessionId: "session-value-mode",
        toolRunId: "run-value-mode",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).toThrow("Value Fuzzing mode");
    expect(() =>
      prepareFfufCommandForRun({
        command: "ffuf -u 'https://example.com/search?other=FUZZ' -w /tmp/payloads.txt",
        sessionId: "session-value-parameter",
        toolRunId: "run-value-parameter",
        targetUrl: "https://example.com",
        toolData,
      }),
    ).toThrow("Value Fuzzing mode");
  });

  test("keeps valid results from partial data and counts malformed records", () => {
    const parsed = parseFfufOutput(
      JSON.stringify({
        results: [
          { url: "https://example.com/admin", status: 200, input: { FUZZ: "admin" } },
          { url: 42, status: "bad" },
        ],
      }),
    );

    expect(parsed.parseErrorCount).toBe(1);
    expect(parsed.results).toEqual([
      expect.objectContaining({
        url: "https://example.com/admin",
        status: 200,
        input: { FUZZ: "admin" },
      }),
    ]);
  });

  test("rejects malformed output without throwing", () => {
    expect(parseFfufOutput("{not json")).toEqual({
      results: [],
      parseErrorCount: 1,
    });
  });

  test("normalizes only exact-origin matched endpoints", () => {
    const parsed = parseFfufOutput(
      JSON.stringify({
        results: [
          { url: "https://example.com/admin#fragment", status: 200, input: {} },
          { url: "https://api.example.com/admin", status: 200, input: {} },
          { url: "https://example.com:8443/debug", status: 200, input: {} },
        ],
      }),
    );
    const matches = selectExactOriginFfufMatches(
      parsed.results,
      "https://example.com",
    );

    expect(matches).toEqual([
      {
        normalizedUrl: "https://example.com/admin",
        path: "/admin",
        httpStatus: 200,
        depth: 1,
      },
    ]);
  });

  test("collects valid partial output after a non-zero exit", async () => {
    const outputPath = join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      "session-partial",
      "tool-runs",
      "run-partial",
      "ffuf.json",
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      JSON.stringify({
        results: [{ url: "https://example.com/hidden", status: 200, input: { FUZZ: "hidden" } }],
      }),
    );

    const artifacts = await collectFfufArtifacts({
      sessionId: "session-partial",
      toolRunId: "run-partial",
      command: "ffuf -u https://example.com/FUZZ -w /tmp/common.txt",
      status: "error",
      exitCode: 1,
    });

    expect(artifacts).toMatchObject([
      {
        artifactType: "ffuf_content_discovery",
        payload: {
          scanner: { status: "error", exitCode: 1 },
          runContext: { command: "ffuf -u https://example.com/FUZZ -w /tmp/common.txt" },
          results: [{ url: "https://example.com/hidden", status: 200 }],
        },
      },
    ]);
  });

  test("maps bounded parameter candidates from partial output", async () => {
    const outputPath = join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      "session-parameter",
      "tool-runs",
      "run-parameter",
      "ffuf.json",
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      JSON.stringify({
        results: [
          {
            url: "https://example.com/search?debug=nulltrace",
            status: 200,
            input: { FUZZ: "debug" },
            length: 140,
            words: 20,
            lines: 4,
          },
          { url: 42, status: "bad" },
        ],
      }),
    );

    const artifacts = await collectFfufArtifacts({
      sessionId: "session-parameter",
      toolRunId: "run-parameter",
      command: "ffuf -u 'https://example.com/search?FUZZ=nulltrace' -w /tmp/parameters.txt",
      status: "error",
      exitCode: 1,
      toolData: createInitialFfufParameterDiscoveryToolData("https://example.com/search"),
    });

    expect(artifacts).toMatchObject([
      {
        artifactType: "ffuf_parameter_discovery",
        payload: {
          scanner: { mode: "parameter_discovery", status: "error", exitCode: 1 },
          parseErrorCount: 1,
          candidates: [
            {
              parameterName: "debug",
              requestLocation: "query",
              response: { status: 200, size: 140, signature: { words: 20, lines: 4 } },
              provenance: {
                toolRunId: "run-parameter",
                endpoint: "https://example.com/search",
              },
            },
          ],
        },
      },
    ]);
  });

  test("classifies only explicit security-relevant value anomalies", () => {
    const base = {
      url: "https://example.com/search?q=FUZZ",
      status: 500,
      input: { FUZZ: "' OR 1=1--" },
      length: 100,
      words: 10,
      lines: 2,
      redirectLocation: null,
      position: 1,
    };

    expect(classifyFfufValueAnomaly(base, "' OR 1=1--", "https://example.com/search"))
      .toEqual({ kind: "server_error", severity: "medium" });
    expect(classifyFfufValueAnomaly(base, "ordinary", "https://example.com/search")).toBeNull();
    expect(
      classifyFfufValueAnomaly(
        {
          ...base,
          status: 302,
          redirectLocation: "https://attacker.test/path",
        },
        "https://attacker.test/path",
        "https://example.com/search",
      ),
    ).toEqual({ kind: "external_redirect", severity: "medium" });
    expect(
      classifyFfufValueAnomaly(
        { ...base, status: 302, redirectLocation: "/ordinary" },
        "ordinary",
        "https://example.com/search",
      ),
    ).toBeNull();
  });

  test("bounds and redacts Value Fuzzing artifact context", () => {
    const results = mapFfufValueFuzzingResults(
      [{
        url: "https://example.com/search?q=FUZZ",
        status: 500,
        input: { FUZZ: `token=secret-value ${"x".repeat(300)}` },
        length: 100,
        words: 10,
        lines: 2,
        redirectLocation: "https://example.com/path?token=secret",
        position: 1,
      }],
      {
        endpoint: "https://example.com/search?existing=secret",
        parameterName: "q",
        requestLocation: "query",
        wordlist: "/tmp/payloads.txt",
        matchCodes: "500",
        filterCodes: "",
        rate: "10",
        timeLimit: "10",
      },
      "run-value",
      1,
    );

    expect(results[0]?.payload).toContain("token=[REDACTED]");
    expect(results[0]?.payload.length).toBeLessThanOrEqual(257);
    expect(results[0]?.response.redirectLocation).toBe("https://example.com/path");
    expect(results[0]?.provenance.endpoint).toBe("https://example.com/search");
  });

  test("removes queries from relative redirect evidence", () => {
    const results = mapFfufValueFuzzingResults(
      [{
        url: "https://example.com/search?q=FUZZ",
        status: 302,
        input: { FUZZ: "ordinary" },
        length: 0,
        words: 0,
        lines: 0,
        redirectLocation: "/next?token=secret",
        position: 1,
      }],
      {
        endpoint: "https://example.com/search",
        parameterName: "q",
        requestLocation: "query",
        wordlist: "/tmp/payloads.txt",
        matchCodes: "302",
        filterCodes: "",
        rate: "10",
        timeLimit: "10",
      },
      "run-relative",
      1,
    );

    expect(results[0]?.response.redirectLocation).toBe("https://example.com/next");
  });

  test("collects Value Fuzzing anomalies and ordinary matches from partial output", async () => {
    const outputPath = join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      "session-value",
      "tool-runs",
      "run-value",
      "ffuf.json",
    );
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      JSON.stringify({
        results: [
          {
            url: "https://example.com/search?q=FUZZ",
            status: 500,
            input: { FUZZ: "' OR 1=1--" },
            length: 120,
          },
          {
            url: "https://example.com/search?q=FUZZ",
            status: 200,
            input: { FUZZ: "ordinary" },
            length: 100,
          },
          { url: 42, status: "bad" },
        ],
      }),
    );
    const toolData = createInitialFfufValueFuzzingToolData("https://example.com/search");
    toolData.form.parameterName = "q";
    toolData.form.wordlist = "/tmp/payloads.txt";
    toolData.form.endpoint = "https://example.com/search?token=secret";

    const artifacts = await collectFfufArtifacts({
      sessionId: "session-value",
      toolRunId: "run-value",
      command: "ffuf -u 'https://example.com/search?q=FUZZ' -w /tmp/payloads.txt",
      status: "error",
      exitCode: 1,
      toolData,
    });

    expect(artifacts).toMatchObject([{
      artifactType: "ffuf_value_fuzzing",
      payload: {
        scanner: { mode: "value_fuzzing", status: "error", exitCode: 1 },
        runContext: { endpoint: "https://example.com/search" },
        parseErrorCount: 1,
        results: [
          { payload: "' OR 1=1--", anomaly: { kind: "server_error" } },
          { payload: "ordinary", anomaly: null },
        ],
      },
    }]);
  });
});
