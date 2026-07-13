import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { theme } from "../../../app/theme/theme";
import {
  AuthCheckMetadata,
  AuthenticatedRequestContextInput,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { createRedactedAuthenticatedRequestContextPreview } from "../services/authenticated-request-context-redaction";
import { getAuthCheckPresentation } from "./auth-check-presentation";

interface AuthenticationContextModalProps {
  targetUrl: string;
  width: number;
  height: number;
  metadata: AuthenticatedRequestContextMetadata | null;
  verificationUrlSuggestions: string[];
  isSaving: boolean;
  isChecking: boolean;
  error: string | null;
  onSave: (input: AuthenticatedRequestContextInput) => Promise<boolean>;
  onClear: () => Promise<void>;
  onRunAuthCheck: (verificationUrl: string) => Promise<boolean>;
  onAcknowledgeInconclusive: () => boolean;
  onClose: () => void;
}

type AuthenticationField =
  | "cookies"
  | "headers"
  | "verification_url"
  | "actions";

const fields: AuthenticationField[] = [
  "cookies",
  "headers",
  "verification_url",
  "actions",
];

function getStorageLabel(metadata: AuthenticatedRequestContextMetadata | null) {
  if (!metadata) {
    return "No active context";
  }
  return metadata.storageMode === "secure"
    ? "Platform secret store"
    : "Memory only (cleared on restart)";
}

function getSignalSummary(authCheck: AuthCheckMetadata) {
  const signals = authCheck.signals;
  if (!signals) {
    return "No bounded response comparison is available.";
  }

  return [
    `HTTP ${signals.unauthenticatedStatus}→${signals.authenticatedStatus}`,
    `redirects ${signals.hasRedirectsChanged ? "changed" : "same"}`,
    `type ${signals.hasContentTypeChanged ? "changed" : "same"}`,
    `content ${signals.hasContentFingerprintChanged ? "changed" : "same"}`,
    `title ${signals.hasTitleChanged ? "changed" : "same"}`,
    `login ${signals.unauthenticatedHasLoginForm ? "yes" : "no"} to ${signals.authenticatedHasLoginForm ? "yes" : "no"}`,
  ].join(" | ");
}

export function AuthenticationContextModal({
  targetUrl,
  width,
  height,
  metadata,
  verificationUrlSuggestions,
  isSaving,
  isChecking,
  error,
  onSave,
  onClear,
  onRunAuthCheck,
  onAcknowledgeInconclusive,
  onClose,
}: AuthenticationContextModalProps) {
  const [cookies, setCookies] = useState("");
  const [headers, setHeaders] = useState("");
  const [verificationUrl, setVerificationUrl] = useState(
    verificationUrlSuggestions[0] ?? targetUrl,
  );
  const [selectedField, setSelectedField] = useState<AuthenticationField>(
    "cookies",
  );
  const preview = createRedactedAuthenticatedRequestContextPreview({
    origin: targetUrl,
    cookies,
    headers,
  });
  const authCheck = metadata?.authCheck;
  const checkPresentation = authCheck
    ? getAuthCheckPresentation(authCheck)
    : null;
  const isBusy = isSaving || isChecking;

  useEffect(() => {
    setCookies("");
    setHeaders("");
    setVerificationUrl(verificationUrlSuggestions[0] ?? targetUrl);
    setSelectedField("cookies");
  }, [targetUrl]);

  const save = async () => {
    if (isBusy) {
      return;
    }
    const saved = await onSave({ origin: targetUrl, cookies, headers });
    if (saved) {
      setCookies("");
      setHeaders("");
      setSelectedField("verification_url");
    }
  };

  const clear = async () => {
    if (isBusy) {
      return;
    }
    await onClear();
    setCookies("");
    setHeaders("");
    setSelectedField("cookies");
  };

  const runAuthCheck = async () => {
    if (isBusy) {
      return;
    }
    await onRunAuthCheck(verificationUrl);
  };

  const cycleSuggestion = (direction: -1 | 1) => {
    if (verificationUrlSuggestions.length === 0) {
      return;
    }
    const currentIndex = verificationUrlSuggestions.indexOf(verificationUrl);
    const nextIndex =
      (Math.max(0, currentIndex) + direction + verificationUrlSuggestions.length) %
      verificationUrlSuggestions.length;
    setVerificationUrl(verificationUrlSuggestions[nextIndex]!);
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "tab") {
      const currentIndex = fields.indexOf(selectedField);
      const nextIndex =
        (currentIndex + (key.shift ? -1 : 1) + fields.length) % fields.length;
      setSelectedField(fields[nextIndex]!);
      return;
    }
    if (
      selectedField === "verification_url" &&
      key.ctrl &&
      (key.name === "up" || key.name === "down")
    ) {
      cycleSuggestion(key.name === "up" ? -1 : 1);
      return;
    }
    if (key.ctrl && key.name === "s") {
      void save();
      return;
    }
    if (key.ctrl && key.name === "d") {
      void clear();
      return;
    }
    if (key.ctrl && key.name === "k") {
      void runAuthCheck();
      return;
    }
    if (key.ctrl && key.name === "y") {
      onAcknowledgeInconclusive();
      return;
    }
    if (selectedField === "actions" && key.name === "return") {
      if (metadata) {
        void runAuthCheck();
      } else {
        void save();
      }
    }
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor={theme.bg.overlay}
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={width}
        height={height}
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
              <strong>Authentication Context</strong>
            </text>
          </box>
          <text fg={theme.text.dim}>Esc close</text>
        </box>

        <text fg={theme.text.secondary}>Exact origin: {preview.origin}</text>
        <text
          fg={
            metadata?.storageMode === "memory"
              ? theme.accent.warning
              : theme.text.dim
          }
        >
          Storage: {getStorageLabel(metadata)}
        </text>

        <box flexDirection="row" marginTop={1}>
          <box width={18}>
            <text
              fg={
                selectedField === "cookies"
                  ? theme.accent.primary
                  : theme.text.secondary
              }
            >
              {selectedField === "cookies" ? "> Cookies" : "  Cookies"}
            </text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <input
              value={cookies}
              width="100%"
              onChange={setCookies}
              placeholder="session=…; csrf=…"
              focused={selectedField === "cookies"}
              backgroundColor={theme.bg.input}
              textColor={theme.text.primary}
              cursorColor={theme.accent.primary}
              focusedBackgroundColor={theme.bg.elevated}
              placeholderColor={theme.text.dim}
            />
          </box>
        </box>

        <box flexDirection="row" marginTop={1}>
          <box width={18}>
            <text
              fg={
                selectedField === "headers"
                  ? theme.accent.primary
                  : theme.text.secondary
              }
            >
              {selectedField === "headers" ? "> Headers" : "  Headers"}
            </text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <input
              value={headers}
              width="100%"
              onChange={setHeaders}
              placeholder="Authorization: … | X-CSRF-Token: …"
              focused={selectedField === "headers"}
              backgroundColor={theme.bg.input}
              textColor={theme.text.primary}
              cursorColor={theme.accent.primary}
              focusedBackgroundColor={theme.bg.elevated}
              placeholderColor={theme.text.dim}
            />
          </box>
        </box>

        <text fg={theme.text.dim} marginTop={1}>
          Redacted: {preview.cookiePreview} | {preview.headerPreview.length} headers
        </text>

        <box flexDirection="column" marginTop={1}>
          <text fg={theme.accent.secondary}>
            <strong>Auth Check</strong>
          </text>
          <box flexDirection="row">
            <box width={18}>
              <text
                fg={
                  selectedField === "verification_url"
                    ? theme.accent.primary
                    : theme.text.secondary
                }
              >
                {selectedField === "verification_url" ? "> Verify URL" : "  Verify URL"}
              </text>
            </box>
            <box flexGrow={1} minWidth={0}>
              <input
                value={verificationUrl}
                width="100%"
                onChange={setVerificationUrl}
                focused={selectedField === "verification_url"}
                backgroundColor={theme.bg.input}
                textColor={theme.text.primary}
                cursorColor={theme.accent.primary}
                focusedBackgroundColor={theme.bg.elevated}
                placeholderColor={theme.text.dim}
              />
            </box>
          </box>
          <text fg={theme.text.dim}>
            Ctrl+↑/↓ known route ({verificationUrlSuggestions.length} suggestions, root included)
          </text>
          <text fg={checkPresentation?.color ?? theme.text.muted}>
            <strong>
              {isChecking
                ? "CHECKING…"
                : checkPresentation?.modalLabel ?? "SAVE CONTEXT FIRST"}
            </strong>
          </text>
          {authCheck ? (
            <>
              <text fg={theme.text.secondary}>{authCheck.summary}</text>
              <text fg={theme.text.dim}>{getSignalSummary(authCheck)}</text>
            </>
          ) : null}
        </box>

        {error ? (
          <text fg={theme.accent.critical} marginTop={1}>
            {error}
          </text>
        ) : null}

        <box
          flexDirection="row"
          marginTop={1}
          border
          borderColor={
            selectedField === "actions"
              ? theme.accent.primary
              : theme.border.muted
          }
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexGrow={1}>
            <text fg={theme.text.primary}>
              <strong>{isSaving ? "Saving…" : "Ctrl+S save / replace"}</strong>
            </text>
          </box>
          <text fg={metadata ? theme.accent.secondary : theme.text.muted}>
            Ctrl+K check
          </text>
          <text fg={theme.text.dim}> | </text>
          <text
            fg={
              authCheck?.status === "inconclusive" &&
              !authCheck.isProceedAllowed
                ? theme.accent.warning
                : theme.text.muted
            }
          >
            Ctrl+Y acknowledge
          </text>
          <text fg={theme.text.dim}> | Ctrl+D clear</text>
        </box>

        <text fg={theme.text.dim} marginTop={1}>
          Heuristic check only: it does not establish authorization scope. Secrets and response content stay out of metadata.
        </text>
      </box>
    </box>
  );
}
