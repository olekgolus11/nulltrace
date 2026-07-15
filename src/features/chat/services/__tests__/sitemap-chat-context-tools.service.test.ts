import { describe, expect, it } from "bun:test";
import { ConversationAttachmentRecord } from "../../model/conversation-attachment.types";
import {
  TargetSitemapEntryListFilters,
  TargetSitemapEntryRecord,
} from "../../../sitemap/model/sitemap.types";
import { ChatContextToolRegistry } from "../chat-context-tool-registry";
import {
  chatContextToolRegistry,
  SitemapChatContextToolsService,
} from "../chat-context-tools.service";

const entries: TargetSitemapEntryRecord[] = [
  {
    id: "entry-root",
    targetId: "target-1",
    normalizedUrl: "https://example.com/",
    path: "/",
    method: "GET",
    httpStatus: 200,
    source: "seed",
    provenance: "public",
    depth: 0,
    firstSeenAt: "2026-07-10T10:00:00.000Z",
    lastSeenAt: "2026-07-10T10:02:00.000Z",
    createdAt: "2026-07-10T10:00:00.000Z",
  },
  {
    id: "entry-admin",
    targetId: "target-1",
    normalizedUrl: "https://example.com/admin",
    path: "/admin",
    method: "GET",
    httpStatus: 403,
    source: "html_link",
    provenance: "authenticated",
    depth: 1,
    firstSeenAt: "2026-07-10T10:01:00.000Z",
    lastSeenAt: "2026-07-10T10:02:00.000Z",
    createdAt: "2026-07-10T10:01:00.000Z",
  },
  {
    id: "entry-login",
    targetId: "target-1",
    normalizedUrl: "https://example.com/login",
    path: "/login",
    method: "POST",
    httpStatus: null,
    source: "html_form",
    provenance: "public",
    depth: 2,
    firstSeenAt: "2026-07-10T10:01:30.000Z",
    lastSeenAt: "2026-07-10T10:02:00.000Z",
    createdAt: "2026-07-10T10:01:30.000Z",
  },
  {
    id: "entry-other",
    targetId: "target-2",
    normalizedUrl: "https://other.example/private",
    path: "/private",
    method: "GET",
    httpStatus: 200,
    source: "manual",
    provenance: "public",
    depth: 0,
    firstSeenAt: "2026-07-10T10:00:00.000Z",
    lastSeenAt: "2026-07-10T10:00:00.000Z",
    createdAt: "2026-07-10T10:00:00.000Z",
  },
];

class FakeAttachments {
  findActiveAttachmentByOpenCodeConversationId(id: string) {
    if (id !== "conversation-1") return null;
    return {
      sessionId: "session-1",
      opencodeConversationId: id,
      isDefault: true,
      archivedAt: null,
      createdAt: "2026-07-10T10:00:00.000Z",
    } satisfies ConversationAttachmentRecord;
  }
}

class FakeSessions {
  getSessionById(id: string) {
    return id === "session-1"
      ? {
          id,
          targetId: "target-1",
          normalizedUrl: "https://example.com",
          displayUrl: "example.com",
        }
      : null;
  }
}

class FakeSitemapRepository {
  readonly reads: TargetSitemapEntryListFilters[] = [];

  getCrawlStatus(targetId: string) {
    return {
      targetId,
      status: "failed" as const,
      startedAt: "2026-07-10T10:00:00.000Z",
      completedAt: null,
      failedAt: "2026-07-10T10:03:00.000Z",
      errorMessage: "Request timeout",
      updatedAt: "2026-07-10T10:03:00.000Z",
    };
  }

  listEntries(filters: TargetSitemapEntryListFilters) {
    this.reads.push(filters);
    const filtered = entries.filter((entry) => {
      if (entry.targetId !== filters.targetId) return false;
      if (filters.depth !== undefined && entry.depth !== filters.depth) return false;
      if (filters.maxDepth !== undefined && entry.depth > filters.maxDepth) return false;
      if (filters.path && !entry.path.toLowerCase().includes(filters.path.toLowerCase())) return false;
      if (filters.method && entry.method !== filters.method) return false;
      if (filters.httpStatus !== undefined && entry.httpStatus !== filters.httpStatus) return false;
      if (filters.source && entry.source !== filters.source) return false;
      if (filters.provenance && entry.provenance !== filters.provenance) return false;
      if (filters.hasAccessObservation !== undefined) {
        const hasObservation = this.listAccessObservations("session-1").some(
          (observation) => observation.entryId === entry.id,
        );
        if (hasObservation !== filters.hasAccessObservation) return false;
      }
      return true;
    });
    const limit = filters.limit ?? 100;
    const offset = filters.offset ?? 0;
    return {
      entries: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    };
  }

  findEntryByIdForTarget(targetId: string, entryId: string) {
    return entries.find((entry) => entry.targetId === targetId && entry.id === entryId) ?? null;
  }

  listAccessObservations(sessionId: string) {
    return sessionId === "session-1"
      ? [
          {
            sessionId,
            targetId: "target-1",
            entryId: "entry-admin",
            httpStatus: 200,
            observedAt: "2026-07-10T10:04:00.000Z",
          },
        ]
      : [];
  }
}

function createService() {
  const repository = new FakeSitemapRepository();
  return {
    repository,
    service: new SitemapChatContextToolsService(
      new FakeAttachments(),
      new FakeSessions(),
      repository,
    ),
  };
}

describe("sitemap chat context tools", () => {
  it("reads crawl status, counts, timestamps, and errors through the attachment target", () => {
    const { service, repository } = createService();
    expect(service.getStatus("conversation-1")).toEqual({
      crawl: expect.objectContaining({
        targetId: "target-1",
        status: "failed",
        entryCount: 3,
        failedAt: "2026-07-10T10:03:00.000Z",
        errorMessage: "Request timeout",
      }),
    });
    expect(repository.reads[0]?.targetId).toBe("target-1");
  });

  it("lists bounded pages across every crawl depth", () => {
    const { service } = createService();
    const firstPage = service.listEntries("conversation-1", { limit: 1 });
    expect(firstPage.entries.map((entry) => entry.id)).toEqual(["entry-root"]);
    expect(firstPage.pagination).toMatchObject({ total: 3, nextOffset: 1, hasMore: true });
    expect(service.listEntries("conversation-1", { limit: 1000 }).pagination.limit).toBe(100);
  });

  it("ignores negative search depth sentinels from the chat runtime", () => {
    const { service } = createService();

    const result = service.searchEntries("conversation-1", {
      limit: 100,
      depth: -1,
      maxDepth: -1,
    });

    expect(result.entries.map((entry) => entry.id)).toEqual([
      "entry-root",
      "entry-admin",
      "entry-login",
    ]);
    expect(result.pagination.total).toBe(3);
  });

  it("searches by path, method, status, source, and depth", () => {
    const { service } = createService();
    expect(service.searchEntries("conversation-1", { path: "ADMIN", method: "get", httpStatus: 403, source: "html_link", depth: 1 }).entries.map((entry) => entry.id)).toEqual(["entry-admin"]);
    expect(service.searchEntries("conversation-1", { method: "post", source: "html_form", maxDepth: 2 }).entries.map((entry) => entry.id)).toEqual(["entry-login"]);
  });

  it("filters by discovery provenance and current-session access observations", () => {
    const { service } = createService();

    const result = service.searchEntries("conversation-1", {
      provenance: "authenticated",
      hasCurrentSessionAccess: true,
    });

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "entry-admin",
        provenance: "authenticated",
        accessObservation: {
          httpStatus: 200,
          observedAt: "2026-07-10T10:04:00.000Z",
        },
      }),
    ]);
  });

  it("returns scoped entry detail with persisted form discovery context", () => {
    const { service } = createService();
    const result = service.getEntry("conversation-1", { entryId: "entry-login" });
    expect(result.entry).toMatchObject({ id: "entry-login", method: "POST", source: "html_form" });
    expect(result.entry?.discoveryContext).toContain("HTML form");
    expect(service.getEntry("conversation-1", { entryId: "entry-other" })).toEqual({ entry: null });
  });

  it("rejects conversations without an active session attachment", () => {
    const { service } = createService();
    expect(() => service.listEntries("unattached")).toThrow("No active NullTrace session attachment");
  });

  it("registers sitemap reads without crawler mutation tools", () => {
    const registry = new ChatContextToolRegistry(serviceDefinitions());
    const names = registry.listDefinitions().map((definition) => definition.name);
    expect(names).toEqual(["get_sitemap_status", "list_sitemap_entries", "search_sitemap_entries", "get_sitemap_entry"]);
    expect(names.some((name) => /start|stop|refresh|crawl|mutate/.test(name))).toBe(false);
    const allNames = chatContextToolRegistry.listDefinitions().map((definition) => definition.name);
    expect(allNames).not.toContain("start_sitemap_crawl");
    expect(allNames).not.toContain("stop_sitemap_crawl");
    expect(allNames).not.toContain("refresh_sitemap");
  });

  it("tells the agent to omit depth filters for a complete sitemap list", () => {
    const definitions = serviceDefinitions();
    const listEntries = definitions.find(
      (definition) => definition.name === "list_sitemap_entries",
    );
    const searchEntries = definitions.find(
      (definition) => definition.name === "search_sitemap_entries",
    );

    expect(Object.keys(listEntries?.args ?? {})).toEqual(["limit", "offset"]);
    expect(listEntries?.description).toContain("all sitemap entries");
    expect(Object.keys(searchEntries?.args ?? {})).toContain("depth");
    expect(Object.keys(searchEntries?.args ?? {})).toContain("maxDepth");
  });
});

function serviceDefinitions() {
  return createService().service.createToolDefinitions();
}
