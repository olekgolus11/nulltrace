import { ExecutionEventPage, ExecutionOutputEvent, ExecutionOutputStream } from "../types/execution-event.types";

const MAXIMUM_LINES = 2_000;
const MAXIMUM_LINE_BYTES = 4_096;
const MAXIMUM_FRAME_BYTES = 16_384;
const MAXIMUM_OUTPUT_BYTES = 1024 * 1024;

export class ExecutionEventBufferService {
  private readonly events: ExecutionOutputEvent[] = [];
  private readonly decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
  private readonly fragments = { stdout: "", stderr: "" };
  private readonly fragmentBytes = { stdout: 0, stderr: 0 };
  private readonly controlState: Record<ExecutionOutputStream, "text" | "escape" | "csi" | "osc" | "osc_escape"> = {
    stdout: "text",
    stderr: "text",
  };
  private readonly maximumBytes: number;
  private retainedBytes = 0;
  private outputLines = 0;
  private truncated = false;
  private closed = false;

  constructor(private readonly executionId: string, outputLimitBytes: number) {
    if (!/^[A-Za-z0-9_-]{1,96}$/.test(executionId) || !Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1) {
      throw new Error("Invalid execution event configuration.");
    }
    this.maximumBytes = Math.min(outputLimitBytes, MAXIMUM_OUTPUT_BYTES);
  }

  append(stream: ExecutionOutputStream, chunk: Uint8Array): void {
    if (this.closed || this.truncated) return;
    for (let offset = 0; offset < chunk.byteLength; offset += MAXIMUM_FRAME_BYTES) {
      if (this.truncated) break;
      const frame = chunk.subarray(offset, offset + MAXIMUM_FRAME_BYTES);
      this.consume(stream, this.decoders[stream].decode(frame, { stream: true }));
    }
  }

  finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stream of ["stdout", "stderr"] as const) {
      if (this.truncated) break;
      this.consume(stream, this.decoders[stream].decode());
      if (this.fragments[stream]) this.emit(stream, this.fragments[stream]);
      this.fragments[stream] = "";
      this.fragmentBytes[stream] = 0;
    }
  }

  read(afterSequence: number, maximumEvents = 100): ExecutionEventPage {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < -1 ||
      !Number.isSafeInteger(maximumEvents) || maximumEvents < 1 || maximumEvents > 100) {
      throw new Error("Invalid execution event cursor.");
    }
    if (afterSequence >= this.events.length && afterSequence !== -1) throw new Error("Execution event cursor is ahead of the stream.");
    const events = this.events.slice(afterSequence + 1, afterSequence + 1 + maximumEvents).map((event) => ({ ...event }));
    return {
      executionId: this.executionId,
      events,
      nextSequence: events.at(-1)?.sequence ?? afterSequence,
      hasMore: afterSequence + 1 + events.length < this.events.length,
    };
  }

  private consume(stream: ExecutionOutputStream, text: string): void {
    for (const character of text) {
      if (this.truncated) return;
      const state = this.controlState[stream];
      if (state === "escape") {
        this.controlState[stream] = character === "[" ? "csi" : character === "]" ? "osc" : "text";
        continue;
      }
      if (state === "csi") {
        const code = character.codePointAt(0)!;
        if (code >= 0x40 && code <= 0x7e) this.controlState[stream] = "text";
        continue;
      }
      if (state === "osc") {
        if (character === "\u0007") this.controlState[stream] = "text";
        if (character === "\u001b") this.controlState[stream] = "osc_escape";
        continue;
      }
      if (state === "osc_escape") {
        this.controlState[stream] = character === "\\" ? "text" : "osc";
        continue;
      }
      if (character === "\u001b") {
        this.controlState[stream] = "escape";
        continue;
      }
      if (character === "\n" || character === "\r") {
        this.emit(stream, this.fragments[stream]);
        this.fragments[stream] = "";
        this.fragmentBytes[stream] = 0;
        continue;
      }
      const code = character.codePointAt(0)!;
      if (code < 32 || (code >= 127 && code <= 159) ||
        (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
      const size = Buffer.byteLength(character);
      if (this.fragmentBytes[stream] + size > MAXIMUM_LINE_BYTES) {
        this.truncate();
        return;
      }
      this.fragments[stream] += character;
      this.fragmentBytes[stream] += size;
    }
  }

  private emit(stream: ExecutionOutputStream, line: string): void {
    const size = Buffer.byteLength(line);
    if (this.outputLines >= MAXIMUM_LINES || this.retainedBytes + size > this.maximumBytes) {
      this.truncate();
      return;
    }
    this.events.push({ executionId: this.executionId, sequence: this.events.length, stream, line });
    this.outputLines += 1;
    this.retainedBytes += size;
  }

  private truncate(): void {
    if (this.truncated) return;
    this.truncated = true;
    this.events.push({
      executionId: this.executionId,
      sequence: this.events.length,
      stream: "system",
      line: "[output truncated by isolation limit]",
    });
  }
}
