import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { getAppDataDirectory } from "../../../session/services/session-database";
import {
  ToolPrepareCommand,
  ToolPreparedCommand,
} from "../../shared/types/tool-screen.types";
import {
  getSqlmapFieldOrder,
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
  redactSqlmapCommandForPersistence,
  redactSqlmapOutput,
} from "./sqlmap-output-redaction.helpers";
import {
  setSqlmapAuthenticationAvailability,
} from "./sqlmap-authentication.helpers";
import { sqlmapAuthenticatedRunService } from "./sqlmap-authenticated-run.service";

interface SqlmapCommandDependencies {
  getAppDataDirectory: typeof getAppDataDirectory;
  createDirectory: typeof mkdirSync;
  removeDirectory: typeof rmSync;
  authenticatedRunService: Pick<typeof sqlmapAuthenticatedRunService, "prepare">;
}

class SqlmapCommandService {
  constructor(
    private readonly dependencies: SqlmapCommandDependencies = {
      getAppDataDirectory,
      createDirectory: mkdirSync,
      removeDirectory: rmSync,
      authenticatedRunService: sqlmapAuthenticatedRunService,
    },
  ) {}

  createInitialToolData(targetUrl: string): SqlmapToolData {
    return {
      selectedField: 0,
      authentication: {
        strategy: "none",
        isAvailable: false,
        origin: null,
      },
      form: {
        targetUrl,
        method: "GET",
        parameter: getFirstSqlmapQueryParameter(targetUrl),
        body: "",
        level: "1",
        risk: "1",
        timeLimitSeconds: String(sqlmapDefaultTimeLimitSeconds),
        useAuthenticatedContext: false,
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
    const nextToolData = {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: nextValue,
      },
    };
    return field === "targetUrl"
      ? setSqlmapAuthenticationAvailability(
          nextToolData,
          toolData.authentication.origin,
        )
      : nextToolData;
  }

  moveSelection(toolData: SqlmapToolData, delta: -1 | 1): SqlmapToolData {
    return {
      ...toolData,
      selectedField: Math.max(
        0,
        Math.min(
          toolData.selectedField + delta,
          getSqlmapFieldOrder(toolData.authentication.isAvailable).length - 1,
        ),
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

  prepareCommandForRun({
    command,
    sessionId,
    toolRunId,
    toolData,
  }: ToolPrepareCommand): ToolPreparedCommand | Promise<ToolPreparedCommand> {
    validateTargetedSqlmapCommand(command);
    let preparedCommand = command.trim();
    if (!hasSqlmapOption(preparedCommand, "--batch")) preparedCommand += " --batch";
    if (!hasSqlmapOption(preparedCommand, "--disable-coloring")) {
      preparedCommand += " --disable-coloring";
    }
    if (!hasSqlmapOption(preparedCommand, "--technique")) {
      preparedCommand += " --technique BEU";
    }
    if (!hasSqlmapOption(preparedCommand, "--ignore-stdin")) {
      preparedCommand += " --ignore-stdin";
    }
    const timeoutMs =
      normalizeSqlmapTimeLimit(
        (toolData as SqlmapToolData | undefined)?.form.timeLimitSeconds,
        sqlmapMinimumTimeLimitSeconds,
        sqlmapDefaultTimeLimitSeconds,
        sqlmapMaximumTimeLimitSeconds,
      ) * 1000;
    const useAuthenticatedContext = Boolean(
      (toolData as SqlmapToolData | undefined)?.form.useAuthenticatedContext,
    );
    if (!sessionId || !toolRunId) {
      if (useAuthenticatedContext) {
        throw new Error(
          "Authenticated sqlmap runs require an active persisted tool run.",
        );
      }
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
    const protectedEnvironmentValues = getSensitiveSqlmapEnvironmentValues();
    const publicRedactor = (content: string) =>
      redactSqlmapOutput(content, outputDirectory, protectedEnvironmentValues);
    if (useAuthenticatedContext) {
      return this.prepareAuthenticatedCommand({
        sessionId,
        preparedCommand,
        outputDirectory,
        timeoutMs,
        publicRedactor,
      });
    }

    preparedCommand += ` --output-dir ${quoteSqlmapShellValue(outputDirectory)}`;

    return {
      command: preparedCommand,
      timeoutMs,
      redactOutput: publicRedactor,
      cleanup: () => {
        this.dependencies.removeDirectory(outputDirectory, { recursive: true, force: true });
      },
    };
  }

  private async prepareAuthenticatedCommand({
    sessionId,
    preparedCommand,
    outputDirectory,
    timeoutMs,
    publicRedactor,
  }: {
    sessionId: string;
    preparedCommand: string;
    outputDirectory: string;
    timeoutMs: number;
    publicRedactor: (content: string) => string;
  }) {
    try {
      const authenticated = await this.dependencies.authenticatedRunService.prepare({
        sessionId,
        command: preparedCommand,
      });
      return {
        command:
          `${authenticated.command} --output-dir ${quoteSqlmapShellValue(outputDirectory)}`,
        timeoutMs,
        redactOutput: (content: string) =>
          authenticated.redactOutput(publicRedactor(content)),
        redactArtifact: authenticated.redactArtifact,
        cleanup: () => {
          try {
            authenticated.cleanup();
          } finally {
            this.dependencies.removeDirectory(outputDirectory, {
              recursive: true,
              force: true,
            });
          }
        },
      };
    } catch (error) {
      this.dependencies.removeDirectory(outputDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  redactCommandForPersistence(command: string) {
    return redactSqlmapCommandForPersistence(
      command,
      getSensitiveSqlmapEnvironmentValues(),
    );
  }
}

export const sqlmapCommandService = new SqlmapCommandService();
