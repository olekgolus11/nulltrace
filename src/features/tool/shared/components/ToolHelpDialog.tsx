import { theme } from "../../../../app/theme/theme";
import { fieldOrder } from "../config/tool.config";
import { helpContent } from "../registry/tool-registry";
import { ToolName } from "../types/tool-screen.types";

export function ToolHelpDialog<ToolFieldId extends number>({
  fieldId,
  toolName,
}: {
  fieldId: ToolFieldId;
  toolName: ToolName;
}) {
  const toolFieldOrder = fieldOrder[toolName];
  const fieldName = toolFieldOrder[fieldId];
  const help = helpContent[toolName]?.[fieldName];

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
        height={"auto"}
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
              <strong>{help?.title ?? "Help"}</strong>
            </text>
          </box>
          <text fg={theme.text.dim}>Ctrl+H or Esc close</text>
        </box>

        {help ? (
          <>
            <text fg={theme.text.primary}>{help.summary}</text>
            <text fg={theme.text.secondary}>Command: {help.commandEffect}</text>
            <text fg={theme.text.dim}>Tip: {help.guidance}</text>
          </>
        ) : (
          <text fg={theme.text.dim}>No help available for this field.</text>
        )}
      </box>
    </box>
  );
}
