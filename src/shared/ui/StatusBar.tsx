import { theme } from "../../app/theme/theme";
import { PanelDefinition } from "../model/panel-navigation.types";
import { ShortcutHint } from "./shortcut-hints.types";
import { ShortcutHints } from "./ShortcutHints";

interface StatusBarProps {
  activePanel: string;
  hints: ShortcutHint[];
  panels: Array<PanelDefinition<string>>;
}

export function StatusBar({
  activePanel,
  hints,
  panels,
}: StatusBarProps) {
  return (
    <box
      height={1}
      flexDirection="row"
      backgroundColor={theme.bg.panel}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Left side - Keyboard shortcuts */}
      <box flexGrow={1}>
        <ShortcutHints hints={hints} />
      </box>

      {/* Right side - Panel indicators */}
      <box flexDirection="row" gap={1}>
        {panels.map((panel, index) => {
          const isActive = panel.id === activePanel;
          return (
            <text
              key={panel.id}
              fg={isActive ? theme.accent.primary : theme.text.dim}
            >
              {isActive ? (
                <strong>
                  [{index + 1} {panel.label}]
                </strong>
              ) : (
                `[${index + 1} ${panel.label}]`
              )}
            </text>
          );
        })}
      </box>
    </box>
  );
}
