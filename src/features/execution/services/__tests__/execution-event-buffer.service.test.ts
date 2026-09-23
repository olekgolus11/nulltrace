import { describe, expect, test } from "bun:test";
import { ExecutionEventBufferService } from "../execution-event-buffer.service";

const bytes = (value: string) => new TextEncoder().encode(value);

describe("isolated execution events", () => {
  test("sequences bounded stdout and stderr across split UTF-8 frames", () => {
    const events = new ExecutionEventBufferService("run-1", 1_024);
    const unicode = bytes("é");
    events.append("stdout", bytes("first\n"));
    events.append("stderr", unicode.subarray(0, 1));
    events.append("stderr", Uint8Array.from([unicode[1]!, 10]));
    events.finish();
    expect(events.read(-1, 1)).toMatchObject({
      nextSequence: 0,
      hasMore: true,
      events: [{ sequence: 0, stream: "stdout", line: "first" }],
    });
    expect(events.read(0)).toMatchObject({
      nextSequence: 1,
      hasMore: false,
      events: [{ sequence: 1, stream: "stderr", line: "é" }],
    });
  });

  test("removes terminal controls and bidi overrides before exposure", () => {
    const events = new ExecutionEventBufferService("run-1", 1_024);
    events.append("stdout", bytes("safe\u001b[31m\u202eunsafe\u0000\n"));
    events.finish();
    expect(events.read(-1).events[0]?.line).toBe("safeunsafe");
  });

  test("bounds a line, emits one truncation event, and discards subsequent output", () => {
    const events = new ExecutionEventBufferService("run-1", 1_024);
    events.append("stdout", bytes("a".repeat(4_097)));
    events.append("stderr", bytes("should never appear\n"));
    events.finish();
    expect(events.read(-1).events).toEqual([{
      executionId: "run-1",
      sequence: 0,
      stream: "system",
      line: "[output truncated by isolation limit]",
    }]);
  });

  test("bounds aggregate output and rejects invalid cursors", () => {
    const events = new ExecutionEventBufferService("run-1", 5);
    events.append("stdout", bytes("12345\n6\n"));
    expect(events.read(-1).events.map((event) => event.stream)).toEqual(["stdout", "system"]);
    expect(() => events.read(-2)).toThrow();
    expect(() => events.read(-1, 101)).toThrow();
  });
});
