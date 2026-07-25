import { ChatContextToolArgs } from "../model/chat-context-tool.types";
import { InspectPageArgs } from "./page-inspection-chat-context-tools.types";

export function assertInspectPageArgs(args: ChatContextToolArgs): InspectPageArgs {
  if (typeof args.url !== "string" || !args.url.trim()) {
    throw new Error("inspect_page url must be a non-empty string.");
  }

  if (
    args.authenticationMode !== undefined &&
    args.authenticationMode !== "public" &&
    args.authenticationMode !== "accepted_context"
  ) {
    throw new Error(
      'inspect_page authenticationMode must be "public" or "accepted_context".',
    );
  }

  return {
    url: args.url.trim(),
    authenticationMode: args.authenticationMode ?? "public",
  };
}
