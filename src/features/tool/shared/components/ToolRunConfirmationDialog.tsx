import { theme } from "../../../../app/theme/theme";
import { ToolPendingRunConfirmation } from "../types/tool-screen.types";

export function ToolRunConfirmationDialog({
  confirmation,
  onConfirm,
  onCancel,
}: ToolRunConfirmationDialogProps) {
  return (
    <box
      position="absolute"
      top="25%"
      left="20%"
      width="60%"
      border
      borderStyle="double"
      borderColor={theme.accent.critical}
      backgroundColor={theme.bg.elevated}
      flexDirection="column"
      padding={1}
      zIndex={30}
    >
      <text fg={theme.accent.critical}>
        <strong>{confirmation.title}</strong>
      </text>
      <text fg={theme.text.primary}>{confirmation.message}</text>
      <text fg={theme.text.secondary}>Command: {confirmation.command}</text>
      <box flexDirection="row" marginTop={1}>
        <box
          border
          borderColor={theme.accent.critical}
          padding={1}
          onMouseDown={onConfirm}
        >
          <text fg={theme.accent.critical}>
            {confirmation.confirmationKey.toUpperCase()} / Enter: confirm
          </text>
        </box>
        <box
          border
          borderColor={theme.border.muted}
          padding={1}
          marginLeft={1}
          onMouseDown={onCancel}
        >
          <text fg={theme.text.secondary}>N / Esc: cancel</text>
        </box>
      </box>
    </box>
  );
}

interface ToolRunConfirmationDialogProps {
  confirmation: ToolPendingRunConfirmation;
  onConfirm: () => void;
  onCancel: () => void;
}
