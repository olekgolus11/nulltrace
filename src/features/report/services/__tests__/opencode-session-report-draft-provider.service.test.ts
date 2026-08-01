import { OpencodeClient } from "@opencode-ai/sdk";
import { describe, expect, it } from "bun:test";
import { OpenCodeSessionReportDraftProvider } from "../opencode-session-report-draft-provider.service";

class FakeOpenCodeRuntime {
  abortCount = 0;
  deleteCount = 0;
  private resolvePromptStarted: (() => void) | null = null;
  private readonly promptStarted = new Promise<void>((resolve) => {
    this.resolvePromptStarted = resolve;
  });

  async run<T>(
    _sessionId: string,
    _retryPolicy: "once-after-crash",
    operation: (client: OpencodeClient) => Promise<T>,
  ) {
    const client = {
      session: {
        create: async () => ({ data: { id: "temporary-report-conversation" } }),
        prompt: async ({ signal }: { signal?: AbortSignal }) => {
          this.resolvePromptStarted?.();
          return new Promise((_, reject) => {
            signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Request aborted", "AbortError")),
              { once: true },
            );
          });
        },
        abort: async () => {
          this.abortCount += 1;
          return { data: true };
        },
        delete: async () => {
          this.deleteCount += 1;
          return { data: true };
        },
      },
    } as unknown as OpencodeClient;

    return operation(client);
  }

  waitForPrompt() {
    return this.promptStarted;
  }
}

describe("OpenCodeSessionReportDraftProvider", () => {
  it("aborts and deletes its temporary conversation after a provider timeout", async () => {
    const runtime = new FakeOpenCodeRuntime();
    const provider = new OpenCodeSessionReportDraftProvider(runtime, 5);

    await expect(
      provider.generate({
        sessionId: "session-1",
        prompt: "bounded synthetic prompt",
      }),
    ).rejects.toThrow("Provider timed out after 5ms");
    expect(runtime.abortCount).toBe(1);
    expect(runtime.deleteCount).toBe(1);
  });

  it("aborts and deletes its temporary conversation after operator cancellation", async () => {
    const runtime = new FakeOpenCodeRuntime();
    const provider = new OpenCodeSessionReportDraftProvider(runtime, 1_000);
    const abortController = new AbortController();
    const generation = provider.generate({
      sessionId: "session-1",
      prompt: "bounded synthetic prompt",
      signal: abortController.signal,
    });
    await runtime.waitForPrompt();

    abortController.abort();

    await expect(generation).rejects.toThrow("Report drafting was cancelled");
    expect(runtime.abortCount).toBe(1);
    expect(runtime.deleteCount).toBe(1);
  });
});
