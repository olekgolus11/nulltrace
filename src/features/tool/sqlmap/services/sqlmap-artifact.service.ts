import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";
import { sessionRepository } from "../../../session/services/session.repository";
import { ToolRunCompleted } from "../../shared/types/tool-screen.types";
import { validateTargetedSqlmapCommand } from "./sqlmap-command.helpers";
import { parseSqlmapOutput } from "./sqlmap-output.parser";

interface SqlmapToolRunReadRepository {
  getToolRunWithLogs: typeof sessionRepository.getToolRunWithLogs;
}

export class SqlmapArtifactService {
  constructor(
    private readonly repository: SqlmapToolRunReadRepository = sessionRepository,
  ) {}

  async collectArtifacts(options: ToolRunCompleted): Promise<ToolRunArtifactInput[]> {
    const { toolRunId, status, exitCode, command } = options;
    if (!toolRunId || !command || status === "cancelled") return [];

    const validated = validateTargetedSqlmapCommand(command);
    const run = this.repository.getToolRunWithLogs(toolRunId);
    const output = (run?.logs ?? [])
      .slice(0, 2_000)
      .map((log) => log.line)
      .join("\n")
      .slice(0, 250_000);
    const parsed = parseSqlmapOutput(output, {
      endpoint: validated.targetUrl,
      method: validated.method,
      parameter: validated.parameter,
    });

    return [
      {
        artifactType: "sqlmap_verification",
        label: "Targeted sqlmap verification",
        source: "sqlmap.normalized.json",
        payload: {
          runContext: {
            endpoint: validated.targetUrl,
            method: validated.method,
            parameter: validated.parameter,
            status,
            exitCode,
          },
          outcome: parsed.outcome,
          observations: parsed.observations,
          parseWarning: parsed.parseWarning,
        },
      },
    ];
  }
}

export const sqlmapArtifactService = new SqlmapArtifactService();
