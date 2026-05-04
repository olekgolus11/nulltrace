import { PanelDefinition } from "../../../shared/model/panel-navigation.types";

export type EntryPanel = "input" | "sessions";

export const entryPanels: Array<PanelDefinition<EntryPanel>> = [
  { id: "input", label: "INPUT" },
  { id: "sessions", label: "SESSIONS" },
];

export interface EntryState {
  activePanel: EntryPanel;
  selectedRow: number;
  urlInput: string;
  expandedTargetId: string | null;
}

export const initialEntryState: EntryState = {
  activePanel: "input",
  selectedRow: 0,
  urlInput: "",
  expandedTargetId: null,
};
