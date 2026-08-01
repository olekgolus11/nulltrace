import { OpencodeClient } from "@opencode-ai/sdk";
import {
  SessionReportDraftProvider,
  SessionReportDraftProviderInput,
} from "../model/session-report-draft.types";
import { openCodeServerService } from "../../chat/services/opencode-server.service";
import {
  abortOpenCodeReportDraftConversation,
  createOpenCodeSessionReportDraftPromptBody,
  deleteOpenCodeReportDraftConversation,
  readOpenCodeSessionReportDraftText,
} from "./opencode-session-report-draft-provider.helpers";

export class OpenCodeSessionReportDraftProvider implements SessionReportDraftProvider {
  constructor(
    private readonly runtime: OpenCodeReportDraftRuntime = openCodeServerService,
    private readonly timeoutMs = 45_000,
  ) {}

  async generate({
    sessionId,
    prompt,
    signal,
  }: SessionReportDraftProviderInput): Promise<string> {
    if (signal?.aborted) {
      throw new Error("Report drafting was cancelled");
    }

    return this.runtime.run(sessionId, "once-after-crash", async (client) => {
      const conversation = await client.session.create({
        body: {
          title: "NullTrace Report Draft",
        },
      });
      const conversationId = conversation.data?.id;
      if (!conversationId) {
        throw new Error("Provider returned no temporary report conversation");
      }

      const requestController = new AbortController();
      let isTimedOut = false;
      const cancelRequest = () => requestController.abort();
      signal?.addEventListener("abort", cancelRequest, { once: true });
      const timeout = setTimeout(() => {
        isTimedOut = true;
        requestController.abort();
      }, this.timeoutMs);

      try {
        const response = await client.session.prompt({
          path: {
            id: conversationId,
          },
          signal: requestController.signal,
          body: createOpenCodeSessionReportDraftPromptBody(prompt),
        });
        return readOpenCodeSessionReportDraftText(
          response.data?.parts ?? [],
          response.data?.info.error,
        );
      } catch (error) {
        if (isTimedOut) {
          await abortOpenCodeReportDraftConversation(client, conversationId);
          throw new Error(`Provider timed out after ${this.timeoutMs}ms`);
        }
        if (signal?.aborted) {
          await abortOpenCodeReportDraftConversation(client, conversationId);
          throw new Error("Report drafting was cancelled");
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", cancelRequest);
        await deleteOpenCodeReportDraftConversation(client, conversationId);
      }
    });
  }
}

interface OpenCodeReportDraftRuntime {
  run<T>(
    sessionId: string,
    retryPolicy: "once-after-crash",
    operation: (client: OpencodeClient) => Promise<T>,
  ): Promise<T>;
}
