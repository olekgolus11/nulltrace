import { theme } from "../theme.ts";

interface StatusBarProps {
  activePanel: "sitemap" | "vulns" | "chat" | "tools";
  showBack?: boolean;
}

export function StatusBar({ activePanel, showBack = true }: StatusBarProps) {
  const panels = [
    { id: "sitemap", label: "SITEMAP" },
    { id: "vulns", label: "VULNS" },
    { id: "chat", label: "CHAT" },
    { id: "tools", label: "TOOLS" },
  ];

  return (
    <box
      height={3}
      flexDirection="row"
      flexGrow={1}
      backgroundColor={theme.bg.panel}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Left side - Keyboard shortcuts */}
      <box flexGrow={1}>
        <text fg={theme.text.dim}>
          <span fg={theme.text.secondary}>
            <strong>Tab</strong>
          </span>{" "}
          switch panel{" "}
          <span fg={theme.text.secondary}>
            <strong>↑↓</strong>
          </span>{" "}
          navigate{" "}
          <span fg={theme.text.secondary}>
            <strong>Enter</strong>
          </span>{" "}
          select
          {showBack && (
            <>
              {" "}
              <span fg={theme.text.secondary}>
                <strong>ESC</strong>
              </span>{" "}
              back
            </>
          )}{" "}
          <span fg={theme.text.secondary}>
            <strong>q</strong>
          </span>{" "}
          quit
        </text>
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
