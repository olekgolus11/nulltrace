import { useKeyboard } from "@opentui/react";
import { theme } from "../../../app/theme/theme";
import { AuthenticatedContextStorageMode } from "../../authentication/model/authenticated-request-context.types";
import { PageInspectionPermissionStatus } from "../model/page-inspection.types";

interface PageInspectionPermissionModalProps {
  width: number;
  height: number;
  status: PageInspectionPermissionStatus | null;
  hasAcceptedAuthenticationContext: boolean;
  authenticationContextStorageMode: AuthenticatedContextStorageMode | null;
  onAllowPublic: () => void;
  onAllowAuthenticated: () => void;
  onNoInspection: () => void;
  onClose: () => void;
}

export function PageInspectionPermissionModal({
  width,
  height,
  status,
  hasAcceptedAuthenticationContext,
  authenticationContextStorageMode,
  onAllowPublic,
  onAllowAuthenticated,
  onNoInspection,
  onClose,
}: PageInspectionPermissionModalProps) {
  const isBrowserMissing = status?.status === "browser_missing";
  const isAuthenticatedInspectionAvailable =
    hasAcceptedAuthenticationContext && authenticationContextStorageMode === "secure";

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (!isBrowserMissing && key.name === "p") {
      onAllowPublic();
      return;
    }
    if (!isBrowserMissing && isAuthenticatedInspectionAvailable && key.name === "a") {
      onAllowAuthenticated();
      return;
    }
    if (key.name === "n") {
      onNoInspection();
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
            : status?.mode === "authenticated"
              ? "Authenticated inspection allowed for this testing session."
              : status?.mode === "public"
                ? "Public inspection allowed for this testing session."
                : "Inspection disabled for this testing session."}
        </text>
        <box marginTop={1}>
          <text fg={theme.text.secondary}>
            Choose one session-wide mode. Every inspection uses a fresh isolated browser context.
          </text>
        </box>
        {!hasAcceptedAuthenticationContext ? (
          <box marginTop={1}>
            <text fg={theme.text.secondary}>
              Auth inspection requires an accepted Authentication Context.
            </text>
          </box>
        ) : null}
        {hasAcceptedAuthenticationContext && authenticationContextStorageMode !== "secure" ? (
          <box marginTop={1}>
            <text fg={theme.text.secondary}>
              Auth inspection requires a platform secure store.
            </text>
          </box>
        ) : null}
        {isBrowserMissing ? (
          <box marginTop={1}>
            <text fg={theme.accent.warning}>
              Install Chromium separately: bunx playwright install chromium
            </text>
          </box>
        ) : null}
        <box flexDirection="column" marginTop={1}>
          {!isBrowserMissing ? (
            <box onMouseDown={onAllowPublic}>
              <text
                fg={
                  status?.mode === "public" ? theme.accent.primary : theme.text.secondary
                }
              >
                Allow public inspection
              </text>
            </box>
          ) : null}
          {!isBrowserMissing ? (
            <box
              onMouseDown={
                isAuthenticatedInspectionAvailable ? onAllowAuthenticated : undefined
              }
            >
              <text
                fg={
                  status?.mode === "authenticated"
                    ? theme.accent.primary
                    : isAuthenticatedInspectionAvailable
                      ? theme.text.secondary
                      : theme.text.muted
                }
              >
                Allow auth inspection
              </text>
            </box>
          ) : null}
          <box onMouseDown={onNoInspection}>
            <text fg={status?.mode === "none" ? theme.accent.warning : theme.text.secondary}>
              No inspection
            </text>
          </box>
          <box onMouseDown={onClose} marginTop={1}>
            <text fg={theme.text.muted}>[P] public | [A] auth | [N] none | [Esc] close</text>
          </box>
        </box>
      </box>
    </box>
  );
}
