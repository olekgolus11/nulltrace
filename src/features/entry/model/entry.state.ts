export type EntryPanel = "input" | "sessions";

export interface EntryState {
  activePanel: EntryPanel;
  selectedRow: number;
  urlInput: string;
  expandedTargetId: string | null;
  hasInitializedTargetExpansion: boolean;
}

export const initialEntryState: EntryState = {
  activePanel: "input",
  selectedRow: 0,
  urlInput: "",
  expandedTargetId: null,
  hasInitializedTargetExpansion: false,
};
