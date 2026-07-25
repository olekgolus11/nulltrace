import { useKeyboard } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import { PageInspectionPermissionStatus } from "../model/page-inspection.types";

interface PageInspectionPermissionModalProps {
  width: number;
  height: number;
  status: PageInspectionPermissionStatus | null;
  onGrant: () => void;
  onRevoke: () => void;
  onClose: () => void;
}

export function PageInspectionPermissionModal({
  width,
  height,
  status,
  onGrant,
  onRevoke,
  onClose,
}: PageInspectionPermissionModalProps) {
  const isBrowserMissing = status?.status === "browser_missing";
  const isAllowed = status?.status === "ready";

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (!isBrowserMissing && !isAllowed && key.name === "a") {
      onGrant();
      return;
    }
    if (!isBrowserMissing && isAllowed && key.name === "r") {
      onRevoke();
    }
  });

  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      backgroundColor={theme.bg.overlay}
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={width}
        height={height}
        border
        borderColor={isBrowserMissing ? theme.accent.warning : theme.accent.primary}
        backgroundColor={theme.bg.panel}
        flexDirection="column"
        padding={2}
        title=" Page Inspection Permission "
      >
        <text fg={theme.text.primary}>
          {isBrowserMissing
            ? "Unavailable: Chromium is not installed."
            : isAllowed
              ? "Allowed for this testing session."
              : "Blocked until you allow it for this testing session."}
        </text>
        <box marginTop={1}>
          <text fg={theme.text.secondary}>
            Inspection opens one public exact-origin page in a fresh isolated browser. Results stay in
            chat only.
          </text>
        </box>
        {isBrowserMissing ? (
          <box marginTop={1}>
            <text fg={theme.accent.warning}>
              Install Chromium separately: bunx playwright install chromium
            </text>
          </box>
        ) : null}
        <box flexDirection="row" gap={2} marginTop={2}>
          {!isBrowserMissing && !isAllowed ? (
            <box onMouseDown={onGrant}>
              <text fg={theme.accent.primary}>[A] Allow inspection</text>
            </box>
          ) : null}
          {!isBrowserMissing && isAllowed ? (
            <box onMouseDown={onRevoke}>
              <text fg={theme.accent.warning}>[R] Revoke inspection</text>
            </box>
          ) : null}
          <box onMouseDown={onClose}>
            <text fg={theme.text.secondary}>[Esc] Close</text>
          </box>
        </box>
      </box>
    </box>
  );
}
