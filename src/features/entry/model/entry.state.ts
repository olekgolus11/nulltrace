import { PanelDefinition } from "../../../shared/model/panel-navigation.types";
import { EntryPanel, EntryState } from "./entry.types";

export const entryPanels: Array<PanelDefinition<EntryPanel>> = [
  { id: "input", label: "INPUT" },
  { id: "sessions", label: "SESSIONS" },
];

export const initialEntryState: EntryState = {
  activePanel: "input",
  selectedRow: 0,
  urlInput: "",
  expandedTargetId: null,
};
