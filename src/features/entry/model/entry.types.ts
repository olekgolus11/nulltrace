import { TargetSummary } from "../../session/model/session.types";

export type EntryPanel = "input" | "sessions";

export interface EntryState {
  activePanel: EntryPanel;
  selectedRow: number;
  urlInput: string;
  expandedTargetId: string | null;
}
