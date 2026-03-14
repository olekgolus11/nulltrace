export type EntryPanel = "input" | "sessions";

export interface EntryState {
  activePanel: EntryPanel;
  selectedSession: number;
  urlInput: string;
}

export const initialEntryState: EntryState = {
  activePanel: "input",
  selectedSession: 0,
  urlInput: "",
};
