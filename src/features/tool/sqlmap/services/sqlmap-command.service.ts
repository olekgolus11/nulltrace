import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolPrepareCommand } from "../../shared/types/tool-screen.types";
import {
  sqlmapFieldOrder,
  sqlmapDefaultTimeLimitSeconds,
  sqlmapMaximumTimeLimitSeconds,
  sqlmapMinimumTimeLimitSeconds,
} from "../config/sqlmap.config";
import {
  SqlmapFormState,
  SqlmapToolData,
} from "../types/sqlmap.types";
import {
  getFirstSqlmapQueryParameter,
  hasSqlmapOption,
  normalizeSqlmapLevel,
  normalizeSqlmapMethod,
  normalizeSqlmapTimeLimit,
  quoteSqlmapShellValue,
  validateTargetedSqlmapCommand,
} from "./sqlmap-command.helpers";
import {
  getSensitiveSqlmapEnvironmentValues,
  redactSqlmapOutput,
  redactSqlmapPersistentText,
} from "./sqlmap-output-redaction.helpers";

interface SqlmapCommandDependencies {
  getAppDataDirectory: typeof getAppDataDirectory;
  createDirectory: typeof mkdirSync;
  removeDirectory: typeof rmSync;
}

class SqlmapCommandService {
  constructor(
    private readonly dependencies: SqlmapCommandDependencies = {
      getAppDataDirectory,
      createDirectory: mkdirSync,
      removeDirectory: rmSync,
    },
  ) {}

  createInitialToolData(targetUrl: string): SqlmapToolData {
    return {
      selectedField: 0,
      form: {
        targetUrl,
        method: "GET",
        parameter: getFirstSqlmapQueryParameter(targetUrl),
        body: "",
        level: "1",
        risk: "1",
        timeLimitSeconds: String(sqlmapDefaultTimeLimitSeconds),
        extraSafeOptions: "",
      },
    };
  }

  buildCommand(toolData: SqlmapToolData) {
    const { form } = toolData;
    const command = [
      "sqlmap",
      "-u",
      quoteSqlmapShellValue(form.targetUrl.trim()),
      "--method",
      form.method,
    ];
    if (form.method === "POST") {
      command.push("--data", quoteSqlmapShellValue(form.body));
    }
    command.push(
      "-p",
      quoteSqlmapShellValue(form.parameter.trim()),
      "--level",
      normalizeSqlmapLevel(form.level),
      "--risk",
      "1",
      "--timeout",
      "10",
      "--retries",
      "1",
      "--threads",
      "1",
    );
    if (!/(?:^|\s)--technique(?:\s|=)/i.test(form.extraSafeOptions)) {
      command.push("--technique", "BEU");
    }
    command.push("--batch", "--disable-coloring");
    if (form.extraSafeOptions.trim()) command.push(form.extraSafeOptions.trim());
    return command.join(" ");
  }

  setField(
    toolData: SqlmapToolData,
    field: keyof SqlmapFormState,
    value: string,
  ): SqlmapToolData {
    const nextValue = field === "method" ? normalizeSqlmapMethod(value) : value;
    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: nextValue,
      },
    };
  }

  moveSelection(toolData: SqlmapToolData, delta: -1 | 1): SqlmapToolData {
    return {
      ...toolData,
      selectedField: Math.max(
        0,
        Math.min(toolData.selectedField + delta, sqlmapFieldOrder.length - 1),
      ),
    };
  }

  cycleMethod(toolData: SqlmapToolData): SqlmapToolData {
    return this.setField(
      toolData,
      "method",
      toolData.form.method === "GET" ? "POST" : "GET",
    );
  }

  cycleLevel(toolData: SqlmapToolData, delta: -1 | 1): SqlmapToolData {
    const current = Number.parseInt(toolData.form.level, 10);
    const next = Math.max(1, Math.min((Number.isFinite(current) ? current : 1) + delta, 3));
    return this.setField(toolData, "level", String(next));
  }

  prepareCommandForRun({ command, sessionId, toolRunId, toolData }: ToolPrepareCommand) {
    validateTargetedSqlmapCommand(command);
    let preparedCommand = command.trim();
    if (!hasSqlmapOption(preparedCommand, "--batch")) preparedCommand += " --batch";
    if (!hasSqlmapOption(preparedCommand, "--disable-coloring")) {
      preparedCommand += " --disable-coloring";
    }
    if (!hasSqlmapOption(preparedCommand, "--technique")) {
      preparedCommand += " --technique BEU";
    }
    const timeoutMs =
      normalizeSqlmapTimeLimit(
        (toolData as SqlmapToolData | undefined)?.form.timeLimitSeconds,
        sqlmapMinimumTimeLimitSeconds,
        sqlmapDefaultTimeLimitSeconds,
        sqlmapMaximumTimeLimitSeconds,
      ) * 1000;
    if (!sessionId || !toolRunId) {
      return {
        command: preparedCommand,
        timeoutMs,
      };
    }

    const outputDirectory = join(
      this.dependencies.getAppDataDirectory(),
      "artifacts",
      "sessions",
      sessionId,
      "tool-runs",
      toolRunId,
      "sqlmap",
    );
    this.dependencies.createDirectory(outputDirectory, { recursive: true });
    preparedCommand += ` --output-dir ${quoteSqlmapShellValue(outputDirectory)}`;
    const protectedEnvironmentValues = getSensitiveSqlmapEnvironmentValues();

    return {
      command: preparedCommand,
      timeoutMs,
      redactOutput: (content: string) =>
        redactSqlmapOutput(content, outputDirectory, protectedEnvironmentValues),
      cleanup: () => {
        this.dependencies.removeDirectory(outputDirectory, { recursive: true, force: true });
      },
    };
  }

  redactCommandForPersistence(command: string) {
    return redactSqlmapPersistentText(command, getSensitiveSqlmapEnvironmentValues());
  }
}

export const sqlmapCommandService = new SqlmapCommandService();
