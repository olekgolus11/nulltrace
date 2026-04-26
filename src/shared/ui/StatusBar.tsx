import { theme } from "../../app/theme/theme";

interface StatusBarProps {
  activePanel: string;
  showBack?: boolean;
  hintText?: string;
  panels?: Array<{ id: string; label: string }>;
}

export function StatusBar({
  activePanel,
  showBack = true,
  hintText,
  panels = [
    { id: "sitemap", label: "SITEMAP" },
    { id: "vulns", label: "VULNS" },
    { id: "chat", label: "CHAT" },
    { id: "tools", label: "TOOLS" },
  ],
}: StatusBarProps) {
  const defaultHintText = `Tab switch panel  Up/Down navigate  Enter select${
    showBack ? "  ESC back" : ""
  }  Ctrl+Q quit`;

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
        <text fg={theme.text.dim}>{hintText ?? defaultHintText}</text>
      </box>

      {/* Right side - Panel indicators */}
      <box flexDirection="row" gap={1}>
        {panels.map((panel) => {
          const isActive = panel.id === activePanel;
          return (
            <text
              key={panel.id}
              fg={isActive ? theme.accent.primary : theme.text.dim}
            >
              {isActive ? <strong>[{panel.label}]</strong> : `[${panel.label}]`}
            </text>
          );
        })}
      </box>
    </box>
  );
}
