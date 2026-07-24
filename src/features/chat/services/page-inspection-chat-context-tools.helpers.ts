import { ChatContextToolArgs } from "../model/chat-context-tool.types";

export function assertInspectPageArgs(args: ChatContextToolArgs) {
  if (typeof args.url !== "string" || !args.url.trim()) {
    throw new Error("inspect_page url must be a non-empty string.");
  }

  return { url: args.url.trim() };
}
