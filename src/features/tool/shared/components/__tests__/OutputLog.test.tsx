import { afterEach, expect, test } from "bun:test";
import { createMockKeys } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { OutputLog } from "../OutputLog";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(() => {
  act(() => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

test("keeps every line vertically scrollable and long lines horizontally scrollable", async () => {
  const longTail = "LONG-LINE-TAIL";
  const lines = Array.from({ length: 30 }, (_, index) =>
    index === 29
      ? `output-line-${index + 1}-${"x".repeat(60)}-${longTail}`
      : `output-line-${index + 1}`,
  );
  testSetup = await testRender(
    <box width={40} height={6}>
      <OutputLog lines={lines} focused height={6} />
    </box>,
    { width: 40, height: 6 },
  );
  await testSetup.renderOnce();

  expect(testSetup.captureCharFrame()).toContain("output-line-1");
  expect(testSetup.captureCharFrame()).not.toContain(longTail);

  const keys = createMockKeys(testSetup.renderer);
  keys.pressKey("END");
  await testSetup.renderOnce();

  expect(testSetup.captureCharFrame()).toContain("output-line-30");
  expect(testSetup.captureCharFrame()).not.toContain(longTail);

  await keys.pressKeys(Array.from({ length: 8 }, () => "ARROW_RIGHT"));
  await testSetup.renderOnce();

  expect(testSetup.captureCharFrame()).toContain(longTail);
});

test("keeps wide Unicode line tails horizontally scrollable", async () => {
  const wideTail = "尾部";
  const line = `${"界".repeat(30)}${wideTail}`;
  testSetup = await testRender(
    <box width={20} height={3}>
      <OutputLog lines={[line]} focused height={3} />
    </box>,
    { width: 20, height: 3 },
  );
  await testSetup.renderOnce();

  expect(testSetup.captureCharFrame()).not.toContain(wideTail);

  const keys = createMockKeys(testSetup.renderer);
  await keys.pressKeys(Array.from({ length: 12 }, () => "ARROW_RIGHT"));
  await testSetup.renderOnce();

  expect(testSetup.captureCharFrame()).toContain(wideTail);
});
