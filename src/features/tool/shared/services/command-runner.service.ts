function emitLines(lines: string[], onLines: (lines: string[]) => void) {
  if (lines.length > 0) {
    onLines(lines);
  }
}

interface TerminalTextState {
  buffer: string;
  controlSequence: string | null;
  pendingCarriageReturn: boolean;
}

function isCsiFinalCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x40 && codePoint <= 0x7e;
}

function isSingleEscapeFinalCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint >= 0x30 && codePoint <= 0x7e;
}

function isControlCharacter(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x00 && codePoint <= 0x07) ||
    (codePoint >= 0x0b && codePoint <= 0x0c) ||
    (codePoint >= 0x0e && codePoint <= 0x1f) ||
    codePoint === 0x7f
  );
}

function isCompleteControlSequence(sequence: string) {
  if (sequence.length < 2) {
    return false;
  }

  if (sequence.startsWith("\u001B]")) {
    return sequence.endsWith("\u0007") || sequence.endsWith("\u001B\\");
  }

  if (sequence.startsWith("\u001B[")) {
    if (sequence.length < 3) {
      return false;
    }

    return isCsiFinalCharacter(sequence.at(-1) ?? "");
  }

  if (sequence.startsWith("\u001B(") || sequence.startsWith("\u001B)")) {
    return sequence.length >= 3;
  }

  return isSingleEscapeFinalCharacter(sequence.at(-1) ?? "");
}

export function consumeTerminalText(
  input: string,
  initialState: string | TerminalTextState = "",
): {
  lines: string[];
  buffer: string;
  controlSequence: string | null;
  pendingCarriageReturn: boolean;
} {
  const lines: string[] = [];
  let buffer = typeof initialState === "string" ? initialState : initialState.buffer;
  let controlSequence = typeof initialState === "string" ? null : initialState.controlSequence;
  let pendingCarriageReturn =
    typeof initialState === "string" ? false : initialState.pendingCarriageReturn;

  for (const character of input) {
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;

      if (character === "\n") {
        lines.push(buffer);
        buffer = "";
        continue;
      }

      buffer = "";
    }

    if (controlSequence) {
      controlSequence += character;
      if (isCompleteControlSequence(controlSequence)) {
        controlSequence = null;
      }
      continue;
    }

    if (character === "\u001B") {
      controlSequence = character;
      continue;
    }

    if (character === "\n") {
      lines.push(buffer);
      buffer = "";
      continue;
    }

    if (character === "\r") {
      pendingCarriageReturn = true;
      continue;
    }

    if (character === "\b") {
      buffer = buffer.slice(0, -1);
      continue;
    }

    if (isControlCharacter(character)) {
      continue;
    }

    buffer += character;
  }

  return { lines, buffer, controlSequence, pendingCarriageReturn };
}

async function readStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLines: (lines: string[]) => void,
) {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let state: TerminalTextState = {
    buffer: "",
    controlSequence: null,
    pendingCarriageReturn: false,
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const result = consumeTerminalText(decoder.decode(value, { stream: true }), state);
    state = {
      buffer: result.buffer,
      controlSequence: result.controlSequence,
      pendingCarriageReturn: result.pendingCarriageReturn,
    };
    emitLines(result.lines, onLines);
  }

  const result = consumeTerminalText(decoder.decode(), state);
  const trailing = (result.pendingCarriageReturn ? "" : result.buffer).trimEnd();
  emitLines(result.lines, onLines);

  if (trailing) {
    onLines([trailing]);
  }
}

export class CommandRunnerService {
  private currentProcess: ReturnType<typeof Bun.spawn> | null = null;

  stop(signal: NodeJS.Signals = "SIGINT") {
    this.currentProcess?.kill(signal);
    this.currentProcess = null;
  }

  async run(
    command: string,
    onStdoutLines: (lines: string[]) => void,
    onStderrLines: (lines: string[]) => void,
  ) {
    this.stop();

    const proc = Bun.spawn({
      cmd: ["zsh", "-lc", command],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    this.currentProcess = proc;

    await Promise.all([
      readStream(proc.stdout, onStdoutLines),
      readStream(proc.stderr, onStderrLines),
    ]);

    const exitCode = await proc.exited;
    this.currentProcess = null;
    return exitCode;
  }
}

export const commandRunnerService = new CommandRunnerService();
