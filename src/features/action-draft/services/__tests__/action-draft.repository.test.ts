import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { ActionDraftRepository } from "../action-draft.repository";
import { createActionDraftsTable } from "../action-draft.schema";
import { ScannerToolId } from "../../../tool/shared/registry/scanner-catalog";

function createTestDatabase() {
  const database = new Database(":memory:", {
    create: true,
    strict: true,
  });

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      last_activity_at TEXT NOT NULL
    );

    CREATE TABLE conversation_attachments (
      session_id TEXT NOT NULL,
      opencode_conversation_id TEXT PRIMARY KEY,
      is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
      archived_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE tool_runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      command TEXT NOT NULL,
      command_source TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      exit_code INTEGER
    );
  `);
  createActionDraftsTable(database);

  database
    .query("INSERT INTO sessions (id, last_activity_at) VALUES (?1, ?2)")
    .run("session-1", "2026-05-10T10:00:00.000Z");
  database
    .query("INSERT INTO sessions (id, last_activity_at) VALUES (?1, ?2)")
    .run("session-2", "2026-05-10T10:00:00.000Z");
  database
    .query(
      `INSERT INTO conversation_attachments (
        session_id,
        opencode_conversation_id,
        is_default,
        archived_at,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .run("session-1", "conversation-1", 1, null, "2026-05-10T10:00:00.000Z");
  database
    .query(
      `INSERT INTO conversation_attachments (
        session_id,
        opencode_conversation_id,
        is_default,
        archived_at,
        created_at
      ) VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .run("session-2", "conversation-2", 1, null, "2026-05-10T10:00:00.000Z");

  return database;
}

function countToolRuns(database: Database) {
  return (
    database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM tool_runs").get()?.count ??
    0
  );
}

describe("ActionDraftRepository", () => {
  it("creates session-level action drafts attributed to a conversation", () => {
    const repository = new ActionDraftRepository(createTestDatabase());

    const draft = repository.createDraft({
      sessionId: "session-1",
      opencodeConversationId: "conversation-1",
      targetTool: "nmap",
      title: "Probe common web ports",
      summary: "Check the public target for HTTP and TLS exposure.",
      payload: {
        intent: "tcp_port_probe",
        command: "nmap -Pn -p 80,443 example.com",
        formState: {
          target: "example.com",
          ports: "80,443",
        },
      },
    });

    expect(draft).toMatchObject({
      sessionId: "session-1",
      opencodeConversationId: "conversation-1",
      targetTool: "nmap",
      status: "draft",
      title: "Probe common web ports",
      payload: {
        intent: "tcp_port_probe",
        command: "nmap -Pn -p 80,443 example.com",
      },
    });
    expect(draft.id).toBeString();
    expect(draft.createdAt).toBeString();
    expect(draft.updatedAt).toBeString();
  });

  it("lists action drafts by session without crossing session boundaries", () => {
    const repository = new ActionDraftRepository(createTestDatabase());
    const first = repository.createDraft({
      sessionId: "session-1",
      targetTool: "nmap",
      title: "Session one draft",
      summary: "A draft for the first session.",
      payload: {},
    });
    repository.createDraft({
      sessionId: "session-2",
      targetTool: "nuclei",
      title: "Session two draft",
      summary: "A draft for the second session.",
      payload: {},
    });

    const drafts = repository.listBySessionId("session-1");

    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(first.id);
  });

  it("lists action drafts by creation time even after lifecycle updates", () => {
    const database = createTestDatabase();
    const repository = new ActionDraftRepository(database);
    const older = repository.createDraft({
      sessionId: "session-1",
      targetTool: "nmap",
      title: "Older draft",
      summary: "Created first.",
      payload: {},
    });
    const newer = repository.createDraft({
      sessionId: "session-1",
      targetTool: "nuclei",
      title: "Newer draft",
      summary: "Created second.",
      payload: {},
    });

    database
      .query(
        `UPDATE action_drafts
         SET created_at = ?2
         WHERE id = ?1`,
      )
      .run(older.id, "2026-05-10T10:01:00.000Z");
    database
      .query(
        `UPDATE action_drafts
         SET created_at = ?2
         WHERE id = ?1`,
      )
      .run(newer.id, "2026-05-10T10:02:00.000Z");

    repository.setStatus({
      actionDraftId: older.id,
      status: "applied",
    });

    const drafts = repository.listBySessionId("session-1");

    expect(drafts.map((draft) => draft.id)).toEqual([newer.id, older.id]);
  });

  it("accepts implemented tools and rejects catalog-only or unknown scanner tools", () => {
    const repository = new ActionDraftRepository(createTestDatabase());
    const createDraft = (targetTool: ScannerToolId) =>
      repository.createDraft({
        sessionId: "session-1",
        targetTool,
        title: "Unsupported scanner",
        summary: "This scanner is not implemented.",
        payload: {},
      });

    expect(createDraft("ffuf")).toMatchObject({
      targetTool: "ffuf",
      status: "draft",
    });
    expect(() => createDraft("sqlmap")).toThrow(
      "Action drafts can only target implemented scanner tools: sqlmap",
    );
    expect(() => createDraft("not-real" as ScannerToolId)).toThrow(
      "Action drafts can only target implemented scanner tools: not-real",
    );
  });

  it("requires conversation attribution to belong to the same session", () => {
    const repository = new ActionDraftRepository(createTestDatabase());

    expect(() =>
      repository.createDraft({
        sessionId: "session-1",
        opencodeConversationId: "conversation-2",
        targetTool: "nmap",
        title: "Mismatched conversation",
        summary: "This should not be attributed across sessions.",
        payload: {},
      }),
    ).toThrow("Action draft conversation attribution must belong to the same session.");
  });

  it("transitions draft lifecycle status", () => {
    const repository = new ActionDraftRepository(createTestDatabase());
    const draft = repository.createDraft({
      sessionId: "session-1",
      targetTool: "nuclei",
      title: "Run targeted templates",
      summary: "Prepare a nuclei template selection for review.",
      payload: {
        templateTags: ["exposure"],
      },
    });

    const applied = repository.setStatus({
      actionDraftId: draft.id,
      status: "applied",
    });
    const dismissed = repository.setStatus({
      actionDraftId: draft.id,
      status: "dismissed",
    });
    const superseded = repository.setStatus({
      actionDraftId: draft.id,
      status: "superseded",
    });

    expect(applied?.status).toBe("applied");
    expect(dismissed?.status).toBe("dismissed");
    expect(superseded?.status).toBe("superseded");
    expect((superseded?.updatedAt ?? "") >= draft.updatedAt).toBe(true);
  });

  it("does not create tool runs when creating or updating a draft", () => {
    const database = createTestDatabase();
    const repository = new ActionDraftRepository(database);

    const draft = repository.createDraft({
      sessionId: "session-1",
      opencodeConversationId: "conversation-1",
      targetTool: "nmap",
      title: "Operator-reviewed scan",
      summary: "Prepare a scan but do not execute it.",
      payload: {
        command: "nmap -sV example.com",
      },
    });

    repository.setStatus({
      actionDraftId: draft.id,
      status: "applied",
    });

    expect(countToolRuns(database)).toBe(0);
  });
});
