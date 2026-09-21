import { describe, expect, test } from "bun:test";
import { DockerCommandService } from "../docker-command.service";

describe("Docker command boundary", () => {
  test("bounds combined stdout and stderr for each call", async () => {
    const service = new DockerCommandService(process.execPath, 4096);
    await expect(service.run([
      "-e",
      "process.stdout.write('a'.repeat(12)); process.stderr.write('b'.repeat(12));",
    ], { outputLimitBytes: 16, timeoutMs: 5_000 })).rejects.toThrow("output exceeded");
  });

  test("kills a command that exceeds its deadline", async () => {
    const service = new DockerCommandService(process.execPath, 4096);
    await expect(service.run([
      "-e",
      "setInterval(() => undefined, 1_000);",
    ], { timeoutMs: 100 })).rejects.toThrow("timed out");
  });
});
