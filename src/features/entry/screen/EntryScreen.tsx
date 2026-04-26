import { useTerminalDimensions } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import { useState } from "react";
import { EntryScreenProps } from "../model/entry.types";
import { SessionList } from "../../session/components/SessionList";
import { titleArtBlood, titleArtRebel } from "../data/entry.constants";
import { useEntryShortcuts } from "../hooks/use-entry-shortcuts";
import { sessionRepository } from "../../session/services/session.repository";

export function EntryScreen({
  onStartPentest,
  onOpenSession,
  onCreateSessionFromTarget,
}: EntryScreenProps) {
  const { width, height } = useTerminalDimensions();
  const [targets] = useState(() => sessionRepository.listTargetsWithSessions());
  const { entryState, rows, setUrlInput, submitUrlInput } = useEntryShortcuts({
    targets,
    onStartPentest,
    onOpenSession,
    onCreateSessionFromTarget,
  });

  const sidebarWidth = 38;
  const mainWidth = width - sidebarWidth;

  return (
    <box
      flexDirection="row"
      width={width}
      height={height}
      backgroundColor={theme.bg.primary}
    >
      <box
        width={mainWidth}
        height={height}
        flexDirection="column"
        justifyContent="center"
        alignItems="center"
        paddingLeft={2}
        paddingRight={2}
      >
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          {titleArtBlood.map((line, idx) => (
            <text key={`title-${idx}`} fg={theme.accent.primary}>
              {line}
            </text>
          ))}
        </box>

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
              width={50}
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
            to start pentest or{" "}
            <span fg={theme.accent.primary}>
              <strong>Tab</strong>
            </span>{" "}
            to browse sessions
          </text>
        </box>

        {/* Footer hints */}
        <box position="absolute" marginTop={height - 3} marginLeft={2}>
          <text fg={theme.text.dim}>
            <span fg={theme.text.secondary}>
              <strong>Ctrl+Q</strong>
            </span>{" "}
            quit{" | "}
            <span fg={theme.text.secondary}>
              <strong>Tab</strong>
            </span>{" "}
            switch focus{" | "}
            <span fg={theme.text.secondary}>
              <strong>↑↓</strong>
            </span>{" "}
            navigate{" | "}
            <span fg={theme.text.secondary}>
              <strong>Enter</strong>
            </span>{" "}
            select{" | "}
            <span fg={theme.text.secondary}>
              <strong>Ctrl+N</strong>
            </span>{" "}
            new session
          </text>
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
