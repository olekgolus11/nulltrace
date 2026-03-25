import { theme } from "../../../../app/theme/theme";
import { nmapHelpContent } from "../data/nmap-help";
import { NmapFieldId } from "../types/nmap.types";

export function NmapHelpDialog({ fieldId }: { fieldId: NmapFieldId }) {
  const help = nmapHelpContent[fieldId];

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={68}
        height={10}
        flexDirection="column"
        border
        borderColor={theme.accent.primary}
        backgroundColor={theme.bg.panel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="row" marginBottom={1}>
          <box flexGrow={1}>
            <text fg={theme.accent.primary}>
              <strong>{help.title}</strong>
            </text>
          </box>
          <text fg={theme.text.dim}>Ctrl+H or Esc close</text>
        </box>

        <text fg={theme.text.primary}>{help.summary}</text>
        <text fg={theme.text.secondary}>Command: {help.commandEffect}</text>
        <text fg={theme.text.dim}>Tip: {help.guidance}</text>
      </box>
    </box>
  );
}
