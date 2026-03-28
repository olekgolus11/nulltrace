export type EntryPanel = "input" | "sessions";

export interface EntryState {
  activePanel: EntryPanel;
  selectedRow: number;
  urlInput: string;
  expandedTargetIds: Record<string, boolean>;
}

export const initialEntryState: EntryState = {
  activePanel: "input",
  selectedRow: 0,
  urlInput: "",
  expandedTargetIds: {},
};
