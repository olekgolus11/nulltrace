import { describe, expect, it } from "bun:test";

function createResponse(body: string, contentType = "text/html") {
  return new Response(body, {
    headers: {
      "content-type": contentType,
    },
  });
}

describe("session sitemap crawl startup", () => {
  it("starts the public sitemap crawl when creating a session for a new target", async () => {
    const targetUrl = `https://session-sitemap-crawl-${crypto.randomUUID()}.test`;
    const originalFetch = globalThis.fetch;
    const mockFetch = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));

      if (url.pathname === "/robots.txt") {
        return createResponse("", "text/plain");
      }

      if (url.pathname === "/sitemap.xml") {
        return createResponse(
          `<?xml version="1.0" encoding="UTF-8"?>
           <urlset>
             <url><loc>${targetUrl}/from-sitemap</loc></url>
           </urlset>`,
          "application/xml",
        );
      }

      if (url.pathname === "/") {
        return createResponse('<html><a href="/from-html">HTML</a></html>');
      }

      return createResponse("<html></html>");
    };
    globalThis.fetch = Object.assign(mockFetch, {
      preconnect: originalFetch.preconnect,
    });

    try {
      const { useSessionContextStore } = await import("../session-context.store");
      const { sessionDatabase } = await import("../../services/session-database");

      await useSessionContextStore.getState().createSessionForNewTarget(targetUrl);
      const targetId = useSessionContextStore.getState().targetId;
      if (!targetId) {
        throw new Error("Expected a target to be created for the sitemap crawl.");
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const status = sessionDatabase
        .query<{ status: string }, [string]>(
          "SELECT status FROM target_sitemap_crawl_statuses WHERE target_id = ?1",
        )
        .get(targetId);
      const entries = sessionDatabase
        .query<{ path: string }, [string]>(
          "SELECT path FROM target_sitemap_entries WHERE target_id = ?1 ORDER BY path ASC",
        )
        .all(targetId)
        .map((entry) => entry.path);

      expect(status?.status).toBe("completed");
      expect(entries).toContain("/");
      expect(entries).toContain("/from-html");
      expect(entries).toContain("/from-sitemap");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
