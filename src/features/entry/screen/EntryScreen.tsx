import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import { useState } from "react";
import { TargetSummary } from "../../session/model/session.types";
import { SessionList } from "../../session/components/SessionList";
import { titleArtBlood } from "../data/entry.constants";
import { useEntryShortcuts } from "../hooks/use-entry-shortcuts";
import { sessionRepository } from "../../session/services/session.repository";
import { ShortcutHints } from "../../../shared/ui/ShortcutHints";

interface EntryScreenProps {
  onStartPentestForNewTarget: (url: string) => void;
  onStartPentestForExistingTarget: (target: TargetSummary) => void;
  onOpenSession: (sessionId: string) => void;
}

export function EntryScreen({
  onStartPentestForNewTarget,
  onOpenSession,
  onStartPentestForExistingTarget,
}: EntryScreenProps) {
  const { width, height } = useTerminalDimensions();
  const [targets] = useState(() => sessionRepository.listTargetsWithSessions());
  const { entryState, rows, setUrlInput, submitUrlInput, setActivePanel } = useEntryShortcuts({
    targets,
    onStartPentestForNewTarget,
    onStartPentestForExistingTarget,
    onOpenSession,
  });

  const sidebarWidth = Math.max(20, Math.min(38, width - 60));
  const mainWidth = Math.max(40, width - sidebarWidth);
  const showTitleArt = width >= 100;

  return (
    <box flexDirection="row" width={width} height={height} backgroundColor={theme.bg.primary}>
      <box
        width={mainWidth}
        height={height}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
        onMouseDown={() => setActivePanel("input")}
      >
        {showTitleArt ? (
          <box flexDirection="column" alignItems="center" marginBottom={2}>
            {titleArtBlood.map((line, idx) => (
              <text key={`title-${idx}`} fg={theme.accent.primary}>
                {line}
              </text>
            ))}
          </box>
        ) : (
          <box flexDirection="column" alignItems="center" marginBottom={2}>
            <text fg={theme.accent.primary}>
              <strong>NULLTRACE</strong>
            </text>
          </box>
        )}

        <box marginBottom={2}>
          <text fg={theme.text.secondary}>
            AI-powered penetration testing assistant for web applications
          </text>
        </box>

        <box flexDirection="column" alignItems="center" marginBottom={2}>
          <box marginBottom={1}>
            <text fg={theme.text.muted}>Enter target URL to begin:</text>
          </box>
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={theme.accent.primary}>
              <strong>◆</strong>
            </text>
            <input
              value={entryState.urlInput}
              onChange={setUrlInput}
              placeholder="https://target-website.com"
              onSubmit={submitUrlInput}
              width={Math.max(30, Math.min(50, mainWidth - 10))}
              focused={entryState.activePanel === "input"}
              backgroundColor={theme.bg.input}
              textColor={theme.text.primary}
              cursorColor={theme.accent.primary}
              focusedBackgroundColor={theme.bg.elevated}
              placeholderColor={theme.text.dim}
            />
          </box>
        </box>

        <box marginTop={1}>
          <text fg={theme.text.dim}>
            Press{" "}
            <span fg={theme.accent.primary}>
              <strong>Enter</strong>
            </span>{" "}
            to start pentest or click sessions to browse history
          </text>
        </box>

        {/* Footer hints */}
        <box position="absolute" marginTop={height - 3} marginLeft={2}>
          <ShortcutHints
            hints={[
              { key: "Ctrl+Q", label: "quit" },
              { key: "Tab/Shift+Tab", label: "switch" },
              { key: "Enter", label: "select" },
              { key: "Ctrl+N", label: "new session" },
            ]}
          />
        </box>
      </box>

      <box
        width={sidebarWidth}
        height={height}
        flexDirection="column"
        backgroundColor={theme.bg.panel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        onMouseDown={() => setActivePanel("sessions")}
      >
        <SessionList
          rows={rows}
          selectedIndex={entryState.selectedRow}
          focused={entryState.activePanel === "sessions"}
        />
      </box>
    </box>
  );
}
