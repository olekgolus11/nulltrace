import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolRunCompleted } from "../../shared/types/tool-screen.types";
import {
  FfufParameterDiscoveryToolData,
  FfufToolData,
  FfufValueFuzzingToolData,
} from "../types/ffuf.types";
import {
  mapFfufParameterCandidates,
  mapFfufValueFuzzingResults,
  parseFfufOutput,
} from "./ffuf-output.helpers";

const maximumParameterCandidateCount = 200;
const maximumValueFuzzingResultCount = 200;

export async function collectFfufArtifacts(
  options: ToolRunCompleted,
): Promise<ToolRunArtifactInput[]> {
  const { sessionId, toolRunId, command, status, exitCode, toolData } = options;
  if (!sessionId || !toolRunId) return [];

  const jsonOutputPath = getFfufJsonOutputPath(sessionId, toolRunId);
  if (!existsSync(jsonOutputPath)) return [];

  const rawJson = readFileSync(jsonOutputPath, "utf8");
  const json = options.redactArtifact?.(rawJson) ?? options.redactOutput?.(rawJson) ?? rawJson;
  if (json !== rawJson) {
    writeFileSync(jsonOutputPath, json, { encoding: "utf8", mode: 0o600 });
    chmodSync(jsonOutputPath, 0o600);
  }
  if (!json.trim() || status === "cancelled") return [];

  const parsed = parseFfufOutput(json);
  const parsedToolData = readFfufArtifactToolData(toolData);
  if (parsedToolData?.mode === "value_fuzzing") {
    const results = mapFfufValueFuzzingResults(
      parsed.results,
      parsedToolData.form,
      toolRunId,
      maximumValueFuzzingResultCount,
    );
    return [{
      artifactType: "ffuf_value_fuzzing",
      label: "FFUF Value Fuzzing",
      source: "ffuf.json",
      payload: {
        source: getFfufArtifactSource(jsonOutputPath, json),
        scanner: { name: "ffuf", mode: "value_fuzzing", status, exitCode },
        runContext: {
          endpoint: stripFfufEndpointQuery(parsedToolData.form.endpoint),
          parameterName: parsedToolData.form.parameterName,
          requestLocation: parsedToolData.form.requestLocation,
          wordlist: parsedToolData.form.wordlist,
          provenance: getFfufRunProvenance(parsedToolData),
        },
        parseErrorCount: parsed.parseErrorCount,
        results,
        isTruncated: parsed.results.length > results.length,
      },
    }];
  }
  if (parsedToolData?.mode === "parameter_discovery") {
    const candidates = mapFfufParameterCandidates(
      parsed.results,
      parsedToolData.form,
      toolRunId,
      maximumParameterCandidateCount,
    );
    return [{
      artifactType: "ffuf_parameter_discovery",
      label: "FFUF Parameter Discovery",
      source: "ffuf.json",
      payload: {
        source: getFfufArtifactSource(jsonOutputPath, json),
        scanner: {
          name: "ffuf",
          mode: "parameter_discovery",
          status,
          exitCode,
        },
        runContext: {
          command: command ?? null,
          endpoint: parsedToolData.form.endpoint,
          requestLocation: parsedToolData.form.requestLocation,
          wordlist: parsedToolData.form.wordlist,
          provenance: getFfufRunProvenance(parsedToolData),
        },
        parseErrorCount: parsed.parseErrorCount,
        candidates,
        isTruncated: parsed.results.length > candidates.length,
      },
    }];
  }

  return [{
    artifactType: "ffuf_content_discovery",
    label: "FFUF Content Discovery",
    source: "ffuf.json",
    payload: {
      source: getFfufArtifactSource(jsonOutputPath, json),
      scanner: {
        name: "ffuf",
        mode: "content_discovery",
        status,
        exitCode,
      },
      runContext: {
        command: command ?? null,
        provenance: parsedToolData
          ? getFfufRunProvenance(parsedToolData)
          : "public",
      },
      parseErrorCount: parsed.parseErrorCount,
      results: parsed.results,
    },
  }];
}

export function getFfufJsonOutputPath(sessionId: string, toolRunId: string) {
  return join(
    getAppDataDirectory(),
    "artifacts",
    "sessions",
    sessionId,
    "tool-runs",
    toolRunId,
    "ffuf.json",
  );
}

function readFfufArtifactToolData(toolData: unknown): FfufToolData | null {
  if (
    !toolData ||
    typeof toolData !== "object" ||
    !(toolData as { form?: unknown }).form ||
    typeof (toolData as { form?: unknown }).form !== "object"
  ) {
    return null;
  }
  if ((toolData as { mode?: unknown }).mode === "value_fuzzing") {
    return toolData as FfufValueFuzzingToolData;
  }
  if ((toolData as { mode?: unknown }).mode === "parameter_discovery") {
    return toolData as FfufParameterDiscoveryToolData;
  }
  return toolData as FfufToolData;
}

function getFfufRunProvenance(toolData: FfufToolData) {
  return toolData.form.isAuthenticatedContextEnabled ? "authenticated" : "public";
}

function getFfufArtifactSource(jsonOutputPath: string, json: string) {
  return {
    format: "ffuf_json",
    path: jsonOutputPath,
    bytes: statSync(jsonOutputPath).size,
    sha256: createHash("sha256").update(json).digest("hex"),
  };
}

function stripFfufEndpointQuery(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}
