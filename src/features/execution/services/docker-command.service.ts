import { DockerCommandAdapter, DockerCommandOptions, DockerCommandResult } from "../types/http-execution-network.types";

export class DockerCommandService implements DockerCommandAdapter {
  constructor(private readonly executable = "docker", private readonly outputLimitBytes = 1024 * 1024) {
    if (!executable || !Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 4096) {
      throw new Error("Invalid Docker command configuration.");
    }
  }

  async run(args: string[], options: DockerCommandOptions = {}): Promise<DockerCommandResult> {
    if (!args.length || args.length > 256 || args.some((argument) => typeof argument !== "string" || argument.includes("\0"))) {
      throw new Error("Invalid Docker command.");
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30 * 60_000) {
      throw new Error("Invalid Docker command timeout.");
    }
    const outputLimitBytes = options.outputLimitBytes ?? this.outputLimitBytes;
    if (!Number.isSafeInteger(outputLimitBytes) || outputLimitBytes < 1 || outputLimitBytes > this.outputLimitBytes) {
      throw new Error("Invalid Docker output limit.");
    }
    if (options.signal?.aborted) throw new Error("Docker command cancelled.");
    const process = Bun.spawn([this.executable, ...args], {
      stdin: options.input ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    if (options.input) {
      const stdin = process.stdin;
      if (!stdin) throw new Error("Docker input pipe is unavailable.");
      stdin.write(options.input);
      stdin.end();
    }
    let didTimeOut = false;
    let wasCancelled = false;
    const cancel = () => {
      wasCancelled = true;
      process.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    const timer = setTimeout(() => {
      didTimeOut = true;
      process.kill("SIGKILL");
    }, timeoutMs);
    const output = { size: 0 };
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        this.readBounded(process.stdout, process, output, outputLimitBytes),
        this.readBounded(process.stderr, process, output, outputLimitBytes),
        process.exited,
      ]);
      if (wasCancelled) throw new Error("Docker command cancelled.");
      if (didTimeOut) throw new Error("Docker command timed out.");
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      await process.exited;
    }
  }

  private async readBounded(
    stream: ReadableStream<Uint8Array>,
    process: ReturnType<typeof Bun.spawn>,
    output: { size: number },
    outputLimitBytes: number,
  ): Promise<string> {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        output.size += value.byteLength;
        size += value.byteLength;
        if (output.size > outputLimitBytes) {
          process.kill("SIGKILL");
          throw new Error("Docker command output exceeded the limit.");
        }
        chunks.push(value);
      }
      return Buffer.concat(chunks, size).toString("utf8");
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
      chunks.forEach((chunk) => chunk.fill(0));
    }
  }
}
