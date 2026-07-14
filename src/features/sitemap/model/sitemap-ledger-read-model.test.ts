import { describe, expect, it } from "bun:test";
import {
  createSitemapLedgerColumns,
  formatSitemapLedgerPath,
  getSitemapLedgerScopeLabel,
} from "./sitemap-ledger-read-model";

describe("sitemap ledger read model", () => {
  it("keeps fixed columns while giving remaining width to routes", () => {
    expect(createSitemapLedgerColumns(35)).toEqual({
      method: 4,
      route: 21,
      status: 3,
      scope: 4,
    });
    expect(createSitemapLedgerColumns(56)).toEqual({
      method: 4,
      route: 40,
      status: 3,
      scope: 6,
    });
  });

  it("middle-truncates long routes while preserving their root and tail", () => {
    const path = "/api/v1/customers/123456/orders/987654/invoice/42";
    const displayPath = formatSitemapLedgerPath(path, 20);

    expect(displayPath).toBe("/api/v1/\u2026/invoice/42");
    expect(Bun.stringWidth(displayPath)).toBe(20);
  });

  it("measures terminal cells and shortens scope labels only in narrow ledgers", () => {
    const displayPath = formatSitemapLedgerPath("/api/\ud83d\udce6/customers/123456", 15);

    expect(Bun.stringWidth(displayPath)).toBeLessThanOrEqual(15);
    expect(getSitemapLedgerScopeLabel("public", 4)).toBe("PUB");
    expect(getSitemapLedgerScopeLabel("authenticated", 4)).toBe("AUTH");
    expect(getSitemapLedgerScopeLabel("public", 6)).toBe("PUBLIC");
  });
});
