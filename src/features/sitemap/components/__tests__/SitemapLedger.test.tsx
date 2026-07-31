import { afterEach, describe, expect, it } from "bun:test";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { SitemapNode } from "../../model/sitemap.types";
import { SitemapLedger } from "../SitemapLedger";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

function createBranchingSitemapNodes(): SitemapNode[] {
  return [
    {
      id: "api-group",
      path: "/api",
      status: 0,
      children: [
        {
          id: "users-route",
          entryId: "entry-users",
          path: "/api/users",
          method: "GET",
          status: 200,
        },
        {
          id: "orders-route",
          entryId: "entry-orders",
          path: "/api/orders",
          method: "GET",
          status: 200,
        },
      ],
    },
  ];
}

describe("SitemapLedger", () => {
  it("shows a compact long route and its complete value when selected", async () => {
    const path = "/api/v1/customers/123456/orders/987654/invoice/42";
    const nodes: SitemapNode[] = [
      {
        id: "route-1",
        entryId: "entry-1",
        path,
        method: "GET",
        status: 200,
        provenance: "authenticated",
        source: "sitemap_xml",
        accessObservation: {
          sessionId: "session-1",
          targetId: "target-1",
          entryId: "entry-1",
          httpStatus: 200,
          observedAt: "2026-07-14T12:00:00.000Z",
        },
      },
    ];

    testSetup = await testRender(
      <SitemapLedger
        nodes={nodes}
        selectedIndex={0}
        isFocused
        availableWidth={35}
        onSelectEntry={() => {}}
      />,
      { width: 35, height: 10 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("\u2026");
    expect(frame).toContain("AUTH");
    expect(frame.replace(/\s/g, "")).toContain(path);
    expect(frame).toContain("source sitemap_xml");
    expect(frame.replace(/\s+/g, " ")).toContain("access current session · HTTP 200");
  });

  it("separates branching route prefixes with explicit group rows", async () => {
    const nodes: SitemapNode[] = [
      {
        id: "vulnerabilities-group",
        entryId: "entry-vulnerabilities",
        path: "/vulnerabilities",
        method: "GET",
        status: 200,
        provenance: "authenticated",
        children: [
          {
            id: "sql-route",
            entryId: "entry-sql",
            path: "/vulnerabilities/sqli",
            method: "GET",
            status: 200,
            provenance: "authenticated",
          },
          {
            id: "xss-route",
            entryId: "entry-xss",
            path: "/vulnerabilities/xss",
            method: "GET",
            status: 200,
            provenance: "authenticated",
          },
        ],
      },
    ];

    testSetup = await testRender(
      <SitemapLedger
        nodes={nodes}
        selectedIndex={1}
        isFocused={false}
        availableWidth={35}
        onSelectEntry={() => {}}
      />,
      { width: 35, height: 10 },
    );

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("\u25c6 /vulnerabilities/* \u00b7 2 routes");
    expect(frame.indexOf("/vulnerabilities/*")).toBeLessThan(frame.indexOf("/sqli"));
  });

  it("selects a nested entry using its flattened visible entry index", async () => {
    const selectedIndexes: number[] = [];
    const nodes = createBranchingSitemapNodes();

    testSetup = await testRender(
      <SitemapLedger
        nodes={nodes}
        selectedIndex={0}
        isFocused
        availableWidth={35}
        onSelectEntry={(index) => selectedIndexes.push(index)}
      />,
      { width: 35, height: 10 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.click(5, 5);
    });

    expect(selectedIndexes).toEqual([1]);
  });

  it("does not select an entry when a group row is clicked", async () => {
    const selectedIndexes: number[] = [];
    const nodes = createBranchingSitemapNodes();

    testSetup = await testRender(
      <SitemapLedger
        nodes={nodes}
        selectedIndex={0}
        isFocused
        availableWidth={35}
        onSelectEntry={(index) => selectedIndexes.push(index)}
      />,
      { width: 35, height: 10 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.click(5, 0);
    });

    expect(selectedIndexes).toEqual([]);
  });

  it("ignores non-primary mouse buttons on concrete entries", async () => {
    const selectedIndexes: number[] = [];
    const nodes: SitemapNode[] = [
      {
        id: "route-1",
        entryId: "entry-1",
        path: "/api/users",
        method: "GET",
        status: 200,
      },
    ];

    testSetup = await testRender(
      <SitemapLedger
        nodes={nodes}
        selectedIndex={0}
        isFocused
        availableWidth={35}
        onSelectEntry={(index) => selectedIndexes.push(index)}
      />,
      { width: 35, height: 10 },
    );

    await testSetup.renderOnce();
    await act(async () => {
      await testSetup!.mockMouse.click(5, 0, MouseButtons.RIGHT);
    });

    expect(selectedIndexes).toEqual([]);
  });
});
