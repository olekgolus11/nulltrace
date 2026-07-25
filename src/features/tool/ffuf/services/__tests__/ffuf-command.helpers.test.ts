import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

process.env.XDG_DATA_HOME = "/private/tmp/nulltrace-test";

const {
  buildFfufContentDiscoveryCommand,
  collectFfufArtifacts,
  createInitialFfufToolData,
  prepareFfufCommandForRun,
  setFfufContentDiscoveryField,
} = await import("../ffuf-command.helpers");
const { parseFfufOutput, selectExactOriginFfufMatches } = await import("../ffuf-output.helpers");
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
});
