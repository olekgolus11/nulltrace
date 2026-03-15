import { createInitialNmapForm } from "../data/tool-definitions";
import { mockToolChatMessages, mockToolOutputLines } from "../data/tool.mock";
import { ToolState } from "./tool.types";

export function createInitialToolState(targetUrl: string): ToolState {
  return {
    activePanel: "form",
    selectedFormField: 0,
    chatInput: "",
    chatMessages: mockToolChatMessages,
    nmapForm: createInitialNmapForm(targetUrl),
    commandInput: "",
    commandSource: "generated",
    outputLines: mockToolOutputLines,
    executionStatus: "idle",
    lastExitCode: null,
  };
}
