import { describe, expect, it } from "bun:test";
import { CommandRunnerService, consumeTerminalText } from "../command-runner.service";

describe("consumeTerminalText", () => {
  it("treats carriage returns as overwriting the current line", () => {
    const result = consumeTerminalText(
      "[INF] Current nuclei version: v3.8.0 (outdated\r[INF] Current nuclei templates version: v10.4.4 (latest)\n",
    );

    expect(result).toEqual({
      lines: ["[INF] Current nuclei templates version: v10.4.4 (latest)"],
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });

  it("strips ANSI styling and erase-line sequences from terminal output", () => {
    const result = consumeTerminalText(
      "\u001B[31m[WRN]\u001B[0m Found 1 templates with runtime error\r\u001B[2K\u001B[34m[INF]\u001B[0m Current nuclei version: v3.8.0 (\u001B[31moutdated\u001B[0m)\n",
    );

    expect(result).toEqual({
      lines: ["[INF] Current nuclei version: v3.8.0 (outdated)"],
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });

  it("strips ANSI sequences split across stream chunks", () => {
    const first = consumeTerminalText("\u001B[2");
    const second = consumeTerminalText(";92mCVE-2017-18638\u001B[0", first);
    const third = consumeTerminalText("m [http]\n", second);

    expect(third).toEqual({
      lines: ["CVE-2017-18638 [http]"],
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });

  it("applies backspace edits inside a streamed line", () => {
    const result = consumeTerminalText("versx\bion\n");

    expect(result).toEqual({
      lines: ["version"],
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });

  it("preserves regular CRLF line endings", () => {
    const result = consumeTerminalText("first line\r\nsecond line\r\n");

    expect(result).toEqual({
      lines: ["first line", "second line"],
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });

  it("preserves CRLF line endings split across chunks", () => {
    const first = consumeTerminalText("first line\r");
    const second = consumeTerminalText("\nsecond line\r", first);
    const third = consumeTerminalText("\n", second);

    expect([...first.lines, ...second.lines, ...third.lines]).toEqual([
      "first line",
      "second line",
    ]);
    expect(third).toMatchObject({
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });

  it("continues a buffered line across chunks", () => {
    const first = consumeTerminalText("[INF] Loading", "");
    const second = consumeTerminalText(" templates\n", first.buffer);

    expect(second).toEqual({
      lines: ["[INF] Loading templates"],
      buffer: "",
      controlSequence: null,
      pendingCarriageReturn: false,
    });
  });
});

describe("CommandRunnerService", () => {
  it("terminates a process after the prepared total time limit", async () => {
    const service = new CommandRunnerService();

    await expect(
      service.run("sleep 1", () => {}, () => {}, { timeoutMs: 20 }),
    ).rejects.toThrow("Command timed out after 20 ms.");
  });
});
