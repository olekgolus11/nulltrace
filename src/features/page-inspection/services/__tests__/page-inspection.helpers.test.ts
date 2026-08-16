import { describe, expect, test } from "bun:test";
import { defaultPageInspectionLimits } from "../../config/page-inspection.config";
import { PageInspectionSnapshot } from "../../model/page-inspection.types";
import { getPageInspectionAuthenticationOutcome } from "../page-inspection-authentication.helpers";
import { getPageInspectionRequestDecision } from "../page-inspection-request-policy.helpers";
import { applyPageInspectionBounds } from "../page-inspection-snapshot.helpers";

function createSnapshot(overrides: Partial<PageInspectionSnapshot> = {}): PageInspectionSnapshot {
  return {
    requestedUrl: "https://target.example/page",
    finalUrl: "https://target.example/page",
    status: 200,
    contentType: "text/html",
    title: "Client rendered page",
    visibleText: "Rendered text",
    forms: [],
    links: [],
    scripts: [],
    domOutline: [],
    metadata: [],
    securitySignals: {
      contentSecurityPolicy: null,
      frameOptions: null,
      referrerPolicy: null,
      permissionsPolicy: null,
      hasPasswordFields: false,
    },
    isPartial: false,
    truncatedSections: [],
    ...overrides,
  };
}

describe("getPageInspectionRequestDecision", () => {
  test("allows only GET and HEAD on the target origin", () => {
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "GET",
        resourceType: "fetch",
        targetOrigin: "https://target.example",
        url: "https://target.example/api/public",
      }),
    ).toBe("allow");
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "POST",
        resourceType: "fetch",
        targetOrigin: "https://target.example",
        url: "https://target.example/api/beacon",
      }),
    ).toBe("block");
  });

  test("allows CDN display resources but blocks cross-origin documents and application requests", () => {
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "GET",
        resourceType: "stylesheet",
        targetOrigin: "https://target.example",
        url: "https://cdn.example/site.css",
      }),
    ).toBe("allow");
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "HEAD",
        resourceType: "font",
        targetOrigin: "https://target.example",
        url: "https://cdn.example/site.woff2",
      }),
    ).toBe("allow");
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "GET",
        resourceType: "image",
        targetOrigin: "https://target.example",
        url: "https://images.example/site.png",
      }),
    ).toBe("allow");
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "GET",
        resourceType: "document",
        targetOrigin: "https://target.example",
        url: "https://outside.example/redirected",
      }),
    ).toBe("block");
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: true,
        method: "GET",
        resourceType: "xhr",
        targetOrigin: "https://target.example",
        url: "https://api.example/data",
      }),
    ).toBe("block");
    expect(
      getPageInspectionRequestDecision({
        isMainFrame: false,
        method: "GET",
        resourceType: "document",
        targetOrigin: "https://target.example",
        url: "https://target.example/embedded",
      }),
    ).toBe("block");
  });
});

describe("getPageInspectionAuthenticationOutcome", () => {
  test("distinguishes HTTP rejection, permission denial, and rendered login redirects", () => {
    expect(getPageInspectionAuthenticationOutcome(createSnapshot({ status: 401 }))).toBe(
      "unauthorized",
    );
    expect(getPageInspectionAuthenticationOutcome(createSnapshot({ status: 403 }))).toBe(
      "forbidden",
    );
    expect(
      getPageInspectionAuthenticationOutcome(
        createSnapshot({ finalUrl: "https://target.example/login" }),
      ),
    ).toBe("login_redirect");
    expect(
      getPageInspectionAuthenticationOutcome(
        createSnapshot({
          requestedUrl: "https://target.example/login",
          finalUrl: "https://target.example/login",
        }),
      ),
    ).toBeNull();
  });
});

describe("applyPageInspectionBounds", () => {
  test("labels every truncated section and preserves no raw browser state", () => {
    const result = applyPageInspectionBounds(
      createSnapshot({
        visibleText: "x".repeat(20),
        forms: [
          {
            method: "POST",
            action: "https://target.example/login",
            fields: [
              { name: "email", type: "email", isRequired: true },
              { name: "remember", type: "checkbox", isRequired: false },
            ],
          },
          {
            method: "GET",
            action: "https://target.example/search",
            fields: [],
          },
        ],
        links: [
          { url: "https://target.example/one", text: "one" },
          { url: "https://target.example/two", text: "two" },
        ],
      }),
      {
        ...defaultPageInspectionLimits,
        maxVisibleTextCharacters: 10,
        maxForms: 1,
        maxFormFields: 1,
        maxLinks: 1,
      },
    );

    expect(result.visibleText).toBe("x".repeat(10));
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0]?.fields).toHaveLength(1);
    expect(result.links).toHaveLength(1);
    expect(result.isPartial).toBe(true);
    expect(result.truncatedSections).toEqual(
      expect.arrayContaining(["visible_text", "forms", "form_fields", "links"]),
    );
    expect(result).not.toHaveProperty("cookies");
    expect(result).not.toHaveProperty("storage");
    expect(result).not.toHaveProperty("html");
  });

  test("uses a labeled compact fallback when bounded sections still exceed serialized output limits", () => {
    const result = applyPageInspectionBounds(
      createSnapshot({
        metadata: [{ name: "oversized", content: "m".repeat(20_000) }],
      }),
      {
        ...defaultPageInspectionLimits,
        maxSerializedCharacters: 4_000,
      },
    );

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(4_000);
    expect(result.isPartial).toBe(true);
    expect(result.truncatedSections).toContain("serialized_result");
    expect(result.metadata).toEqual([]);
  });
});
