async function readStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLines: (lines: string[]) => void,
) {
  if (!stream) {
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";

    if (parts.length > 0) {
      onLines(parts);
    }
  }

  const trailing = (buffer + decoder.decode()).replace(/\r/g, "").trimEnd();
  if (trailing) {
    onLines([trailing]);
  }
}

export class CommandRunnerService {
  private currentProcess: ReturnType<typeof Bun.spawn> | null = null;

  stop() {
    this.currentProcess?.kill();
    this.currentProcess = null;
  }

  async run(command: string, onLines: (lines: string[]) => void) {
    this.stop();

    const proc = Bun.spawn({
      cmd: ["zsh", "-lc", command],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    this.currentProcess = proc;

    await Promise.all([
      readStream(proc.stdout, onLines),
      readStream(proc.stderr, onLines),
    ]);

    const exitCode = await proc.exited;
    this.currentProcess = null;
    return exitCode;
  }
}

export const commandRunnerService = new CommandRunnerService();
