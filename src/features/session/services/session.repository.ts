import {
  ToolRunArtifactInput,
  ToolRunArtifactRecord,
  ToolRunDetail,
  ToolRunSummary,
} from "../model/session.repository.types";
import { SessionSummary, TargetSummary } from "../model/session.types";
import { sessionDatabase } from "./session-database";

interface SessionDetail {
  id: string;
  targetId: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

interface TargetRecord {
  id: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
}

interface SessionRecord {
  id: string;
  targetId: string;
  createdAt: string;
}

interface TargetRow {
  id: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
  sessionCount: number;
}

interface SessionRow {
  id: string;
  targetId: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

interface SessionDetailRow {
  id: string;
  targetId: string;
  normalizedUrl: string;
  displayUrl: string;
  createdAt: string;
  lastActivityAt: string;
}

interface ToolRunInput {
  toolName: string;
  command: string;
  commandSource: string;
  status: string;
}

interface ToolRunRecord {
  id: string;
  sessionId: string;
  toolName: string;
  command: string;
  commandSource: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
}

interface ToolRunLogLine {
  seq: number;
  stream: string;
  line: string;
  createdAt: string;
}

function createTimestamp() {
  return new Date().toISOString();
}

function createId() {
  return crypto.randomUUID();
}

function parseJsonPayload(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function mapSessionRow(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    targetId: row.targetId,
    displayUrl: row.displayUrl,
    createdAt: row.createdAt,
    lastActivityAt: row.lastActivityAt,
  };
}

export const sessionRepository = {
  findOrCreateTarget(normalizedUrl: string, displayUrl: string) {
    const existingTarget = sessionDatabase
      .query<
        {
          id: string;
          normalizedUrl: string;
          displayUrl: string;
          createdAt: string;
        },
        [string]
      >(
        `SELECT
          id,
          normalized_url AS normalizedUrl,
          display_url AS displayUrl,
          created_at AS createdAt
        FROM targets
        WHERE normalized_url = ?1`,
      )
      .get(normalizedUrl);

    if (existingTarget) {
      return existingTarget;
    }

    const target: TargetRecord = {
      id: createId(),
      normalizedUrl,
      displayUrl,
      createdAt: createTimestamp(),
    };

    sessionDatabase
      .query(
        `INSERT INTO targets (id, normalized_url, display_url, created_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .run(
        target.id,
        target.normalizedUrl,
        target.displayUrl,
        target.createdAt,
      );

    return target;
  },

  createSession(targetId: string) {
    const session: SessionRecord = {
      id: createId(),
      targetId,
      createdAt: createTimestamp(),
    };

    sessionDatabase
      .query(
        `INSERT INTO sessions (id, target_id, created_at, last_activity_at)
         VALUES (?1, ?2, ?3, ?4)`,
      )
      .run(session.id, session.targetId, session.createdAt, session.createdAt);

    return session;
  },

  listTargetsWithSessions() {
    const targetRows = sessionDatabase
      .query<TargetRow, []>(
        `SELECT
          targets.id AS id,
          targets.normalized_url AS normalizedUrl,
          targets.display_url AS displayUrl,
          targets.created_at AS createdAt,
          COALESCE(MAX(sessions.last_activity_at), targets.created_at) AS lastActivityAt,
          COUNT(sessions.id) AS sessionCount
        FROM targets
        LEFT JOIN sessions ON sessions.target_id = targets.id
        GROUP BY targets.id
        ORDER BY lastActivityAt DESC, targets.created_at DESC`,
      )
      .all();

    const sessionRows = sessionDatabase
      .query<SessionRow, []>(
        `SELECT
          sessions.id AS id,
          sessions.target_id AS targetId,
          targets.display_url AS displayUrl,
          sessions.created_at AS createdAt,
          sessions.last_activity_at AS lastActivityAt
        FROM sessions
        INNER JOIN targets ON targets.id = sessions.target_id
        ORDER BY sessions.last_activity_at DESC, sessions.created_at DESC`,
      )
      .all();

    const sessionsByTargetId = sessionRows.reduce<
      Record<string, SessionSummary[]>
    >((accumulator, row) => {
      const session = mapSessionRow(row);
      accumulator[row.targetId] = accumulator[row.targetId]
        ? [...accumulator[row.targetId], session]
        : [session];
      return accumulator;
    }, {});

    return targetRows.map<TargetSummary>((row) => ({
      id: row.id,
      normalizedUrl: row.normalizedUrl,
      displayUrl: row.displayUrl,
      createdAt: row.createdAt,
      lastActivityAt: row.lastActivityAt,
      sessionCount: Number(row.sessionCount),
      sessions: sessionsByTargetId[row.id] ?? [],
    }));
  },

  getSessionById(sessionId: string) {
    const session = sessionDatabase
      .query<SessionDetailRow, [string]>(
        `SELECT
          sessions.id AS id,
          sessions.target_id AS targetId,
          targets.normalized_url AS normalizedUrl,
          targets.display_url AS displayUrl,
          sessions.created_at AS createdAt,
          sessions.last_activity_at AS lastActivityAt
        FROM sessions
        INNER JOIN targets ON targets.id = sessions.target_id
        WHERE sessions.id = ?1`,
      )
      .get(sessionId);

    if (!session) {
      return null;
    }

    return {
      id: session.id,
      targetId: session.targetId,
      normalizedUrl: session.normalizedUrl,
      displayUrl: session.displayUrl,
      createdAt: session.createdAt,
      lastActivityAt: session.lastActivityAt,
    } satisfies SessionDetail;
  },

  listToolRuns(sessionId: string, toolName: string) {
    return sessionDatabase
      .query<ToolRunSummary, [string, string]>(
        `SELECT
          id,
          tool_name AS toolName,
          command,
          command_source AS commandSource,
          status,
          started_at AS startedAt,
          ended_at AS endedAt,
          exit_code AS exitCode
        FROM tool_runs
        WHERE session_id = ?1
          AND tool_name = ?2
        ORDER BY started_at DESC`,
      )
      .all(sessionId, toolName);
  },

  listToolRunsBySessionId(sessionId: string) {
    return sessionDatabase
      .query<ToolRunSummary, [string]>(
        `SELECT
          id,
          tool_name AS toolName,
          command,
          command_source AS commandSource,
          status,
          started_at AS startedAt,
          ended_at AS endedAt,
          exit_code AS exitCode
        FROM tool_runs
        WHERE session_id = ?1
        ORDER BY started_at DESC`,
      )
      .all(sessionId);
  },

  getToolRunWithLogs(toolRunId: string) {
    const toolRun = sessionDatabase
      .query<ToolRunSummary, [string]>(
        `SELECT
          id,
          tool_name AS toolName,
          command,
          command_source AS commandSource,
          status,
          started_at AS startedAt,
          ended_at AS endedAt,
          exit_code AS exitCode
        FROM tool_runs
        WHERE id = ?1`,
      )
      .get(toolRunId);

    if (!toolRun) {
      return null;
    }

    const logs = sessionDatabase
      .query<ToolRunLogLine, [string]>(
        `SELECT
          seq,
          stream,
          line,
          created_at AS createdAt
        FROM tool_run_logs
        WHERE tool_run_id = ?1
        ORDER BY seq ASC`,
      )
      .all(toolRunId);

    const artifacts = sessionDatabase
      .query<
        {
          id: string;
          toolRunId: string;
          artifactType: string;
          label: string;
          source: string;
          payloadJson: string;
          createdAt: string;
        },
        [string]
      >(
        `SELECT
          id,
          tool_run_id AS toolRunId,
          artifact_type AS artifactType,
          label,
          source,
          payload_json AS payloadJson,
          created_at AS createdAt
        FROM tool_run_artifacts
        WHERE tool_run_id = ?1
        ORDER BY created_at ASC`,
      )
      .all(toolRunId)
      .map<ToolRunArtifactRecord>((artifact) => ({
        id: artifact.id,
        toolRunId: artifact.toolRunId,
        artifactType: artifact.artifactType,
        label: artifact.label,
        source: artifact.source,
        payload: parseJsonPayload(artifact.payloadJson),
        createdAt: artifact.createdAt,
      }));

    return {
      ...toolRun,
      logs,
      artifacts,
    } satisfies ToolRunDetail;
  },

  findToolRunArtifactByIdForSession(sessionId: string, artifactId: string) {
    const artifact = sessionDatabase
      .query<
        {
          id: string;
          toolRunId: string;
          artifactType: string;
          label: string;
          source: string;
          payloadJson: string;
          createdAt: string;
        },
        [string, string]
      >(
        `SELECT
          tool_run_artifacts.id,
          tool_run_artifacts.tool_run_id AS toolRunId,
          tool_run_artifacts.artifact_type AS artifactType,
          tool_run_artifacts.label,
          tool_run_artifacts.source,
          tool_run_artifacts.payload_json AS payloadJson,
          tool_run_artifacts.created_at AS createdAt
        FROM tool_run_artifacts
        INNER JOIN tool_runs
          ON tool_runs.id = tool_run_artifacts.tool_run_id
        WHERE tool_run_artifacts.id = ?2
          AND tool_runs.session_id = ?1`,
      )
      .get(sessionId, artifactId);

    if (!artifact) {
      return null;
    }

    return {
      id: artifact.id,
      toolRunId: artifact.toolRunId,
      artifactType: artifact.artifactType,
      label: artifact.label,
      source: artifact.source,
      payload: parseJsonPayload(artifact.payloadJson),
      createdAt: artifact.createdAt,
    } satisfies ToolRunArtifactRecord;
  },

  recordToolRun(sessionId: string, runInput: ToolRunInput) {
    const toolRun: ToolRunRecord = {
      id: createId(),
      sessionId,
      toolName: runInput.toolName,
      command: runInput.command,
      commandSource: runInput.commandSource,
      status: runInput.status,
      startedAt: createTimestamp(),
      endedAt: null,
      exitCode: null,
    };

    sessionDatabase
      .query(
        `INSERT INTO tool_runs (
          id,
          session_id,
          tool_name,
          command,
          command_source,
          status,
          started_at,
          ended_at,
          exit_code
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .run(
        toolRun.id,
        toolRun.sessionId,
        toolRun.toolName,
        toolRun.command,
        toolRun.commandSource,
        toolRun.status,
        toolRun.startedAt,
        toolRun.endedAt,
        toolRun.exitCode,
      );

    this.touchSessionActivity(sessionId);
    return toolRun;
  },

  appendToolRunLog(toolRunId: string, lines: string[], stream = "stdout") {
    if (lines.length === 0) {
      return;
    }

    const existingSequence = sessionDatabase
      .query<{ lastSeq: number | null }, [string]>(
        `SELECT MAX(seq) AS lastSeq
        FROM tool_run_logs
        WHERE tool_run_id = ?1`,
      )
      .get(toolRunId);

    let nextSequence = (existingSequence?.lastSeq ?? -1) + 1;

    lines.forEach((line) => {
      sessionDatabase
        .query(
          `INSERT INTO tool_run_logs (id, tool_run_id, seq, stream, line, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
        )
        .run(
          createId(),
          toolRunId,
          nextSequence,
          stream,
          line,
          createTimestamp(),
        );

      nextSequence += 1;
    });

    const sessionId = sessionDatabase
      .query<{ sessionId: string }, [string]>(
        `SELECT session_id AS sessionId
        FROM tool_runs
        WHERE id = ?1`,
      )
      .get(toolRunId)?.sessionId;

    if (sessionId) {
      this.touchSessionActivity(sessionId);
    }
  },

  saveToolRunArtifact(toolRunId: string, artifact: ToolRunArtifactInput) {
    const record: ToolRunArtifactRecord = {
      id: createId(),
      toolRunId,
      artifactType: artifact.artifactType,
      label: artifact.label,
      source: artifact.source,
      payload: artifact.payload,
      createdAt: createTimestamp(),
    };

    sessionDatabase
      .query(
        `INSERT INTO tool_run_artifacts (
          id,
          tool_run_id,
          artifact_type,
          label,
          source,
          payload_json,
          created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .run(
        record.id,
        record.toolRunId,
        record.artifactType,
        record.label,
        record.source,
        JSON.stringify(record.payload),
        record.createdAt,
      );

    const sessionId = sessionDatabase
      .query<{ sessionId: string }, [string]>(
        `SELECT session_id AS sessionId
         FROM tool_runs
         WHERE id = ?1`,
      )
      .get(toolRunId)?.sessionId;

    if (sessionId) {
      this.touchSessionActivity(sessionId);
    }

    return record;
  },

  saveOutputSummaryArtifact(toolRunId: string) {
    const logs = sessionDatabase
      .query<ToolRunLogLine, [string]>(
        `SELECT
          seq,
          stream,
          line,
          created_at AS createdAt
        FROM tool_run_logs
        WHERE tool_run_id = ?1
        ORDER BY seq ASC`,
      )
      .all(toolRunId);

    const stdoutLineCount = logs.filter((line) => line.stream === "stdout")
      .length;
    const stderrLineCount = logs.filter((line) => line.stream === "stderr")
      .length;

    return this.saveToolRunArtifact(toolRunId, {
      artifactType: "output_summary",
      label: "Command output summary",
      source: "logs",
      payload: {
        lineCount: logs.length,
        stdoutLineCount,
        stderrLineCount,
        firstLine: logs[0]?.line ?? null,
        lastLine: logs.at(-1)?.line ?? null,
      },
    });
  },

  touchSessionActivity(sessionId: string) {
    sessionDatabase
      .query(
        `UPDATE sessions
         SET last_activity_at = ?2
         WHERE id = ?1`,
      )
      .run(sessionId, createTimestamp());
  },

  cancelToolRun(toolRunId: string) {
    sessionDatabase
      .query(
        `UPDATE tool_runs
         SET status = ?2,
             ended_at = ?3
         WHERE id = ?1`,
      )
      .run(toolRunId, "cancelled", createTimestamp());

    const sessionId = sessionDatabase
      .query<{ sessionId: string }, [string]>(
        `SELECT session_id AS sessionId
         FROM tool_runs
         WHERE id = ?1`,
      )
      .get(toolRunId)?.sessionId;

    if (sessionId) {
      this.touchSessionActivity(sessionId);
    }
  },

  finishToolRun(toolRunId: string, status: string, exitCode: number | null) {
    sessionDatabase
      .query(
        `UPDATE tool_runs
         SET status = ?2,
             exit_code = ?3,
             ended_at = ?4
         WHERE id = ?1`,
      )
      .run(toolRunId, status, exitCode, createTimestamp());

    if (status === "success" || status === "error") {
      this.saveOutputSummaryArtifact(toolRunId);
    }

    const sessionId = sessionDatabase
      .query<{ sessionId: string }, [string]>(
        `SELECT session_id AS sessionId
         FROM tool_runs
         WHERE id = ?1`,
      )
      .get(toolRunId)?.sessionId;

    if (sessionId) {
      this.touchSessionActivity(sessionId);
    }
  },
};
