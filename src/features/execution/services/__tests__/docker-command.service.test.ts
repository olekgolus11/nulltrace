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

  test("drains streaming worker output after the event limit without killing the command", async () => {
    const service = new DockerCommandService(process.execPath, 4096);
    let received = 0;
    const result = await service.run([
      "-e",
      "process.stdout.write('a'.repeat(200000)); process.stderr.write('done');",
    ], {
      outputLimitBytes: 16,
      timeoutMs: 5_000,
      onOutput(_stream, chunk) { received += chunk.byteLength; },
    });
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(received).toBe(200004);
  });

  test("kills a running command when its owner cancels", async () => {
    const service = new DockerCommandService(process.execPath, 4096);
    const owner = new AbortController();
    const running = service.run(["-e", "setInterval(() => undefined, 1_000);"], {
      signal: owner.signal,
      timeoutMs: 5_000,
    });
    setTimeout(() => owner.abort(), 50);
    await expect(running).rejects.toThrow("cancelled");
  });
});
