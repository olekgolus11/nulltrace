import { ScannerToolId } from "../../tool/shared/registry/scanner-catalog";

export interface ActionDraftChatContextArgs {
  targetTool: ScannerToolId;
  title: string;
  command?: string;
  intentJson?: string;
  formStateJson?: string;
}

export interface ActionDraftChatSessionTarget {
  normalizedUrl: string;
  displayUrl: string;
}
