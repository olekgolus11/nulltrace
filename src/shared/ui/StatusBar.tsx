import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../app/theme/theme";
import { PanelDefinition } from "../model/panel-navigation.types";
import { ShortcutHint } from "./shortcut-hints.types";
import { createStatusBarReadModel } from "./status-bar.helpers";
import { ShortcutHints } from "./ShortcutHints";

interface StatusBarProps {
  activePanel: string;
  hints: ShortcutHint[];
  panels: Array<PanelDefinition<string>>;
}

export function StatusBar({ activePanel, hints, panels }: StatusBarProps) {
  const { width } = useTerminalDimensions();
  const readModel = createStatusBarReadModel({
    activePanel,
    hints,
    panels,
    width,
  });

  return (
    <box
      width={width}
      height={1}
      flexDirection="row"
      overflow="hidden"
      backgroundColor={theme.bg.panel}
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexGrow={1} overflow="hidden">
        <ShortcutHints
          hints={readModel.hints}
          hasOmittedHints={readModel.hasOmittedHints}
        />
      </box>

      <box
        flexShrink={0}
        marginLeft={readModel.hints.length > 0 || readModel.hasOmittedHints ? 1 : 0}
      >
        <text fg={theme.accent.primary}>
          <strong>{readModel.activeIndicator}</strong>
        </text>
      </box>
    </box>
  );
}
