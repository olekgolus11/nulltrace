import { PanelDefinition } from "../model/panel-navigation.types";
import { ShortcutHint } from "./shortcut-hints.types";

export interface CreateStatusBarReadModelInput {
  activePanel: string;
  hints: ShortcutHint[];
  panels: Array<PanelDefinition<string>>;
  width: number;
}

export interface StatusBarReadModel {
  activeIndicator: string;
  hasOmittedHints: boolean;
  hints: ShortcutHint[];
}
