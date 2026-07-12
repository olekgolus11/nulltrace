import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import {
  AuthenticatedRequestContextInput,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { createRedactedAuthenticatedRequestContextPreview } from "../services/authenticated-request-context-redaction";
import { theme } from "../../../app/theme/theme";

interface AuthenticationContextModalProps {
  targetUrl: string;
  width: number;
  height: number;
  metadata: AuthenticatedRequestContextMetadata | null;
  isSaving: boolean;
  error: string | null;
  onSave: (input: AuthenticatedRequestContextInput) => Promise<boolean>;
  onClear: () => Promise<void>;
  onClose: () => void;
}

type AuthenticationField = "cookies" | "headers" | "actions";

const fields: AuthenticationField[] = ["cookies", "headers", "actions"];

function getStorageLabel(metadata: AuthenticatedRequestContextMetadata | null) {
  if (!metadata) {
    return "No active context";
  }
  return metadata.storageMode === "secure"
    ? "Platform secret store"
    : "Memory only (cleared on restart)";
}

export function AuthenticationContextModal({
  targetUrl,
  width,
  height,
  metadata,
  isSaving,
  error,
  onSave,
  onClear,
  onClose,
}: AuthenticationContextModalProps) {
  const [cookies, setCookies] = useState("");
  const [headers, setHeaders] = useState("");
  const [selectedField, setSelectedField] = useState<AuthenticationField>(
    "cookies",
  );
  const preview = createRedactedAuthenticatedRequestContextPreview({
    origin: targetUrl,
    cookies,
    headers,
  });

  useEffect(() => {
    setCookies("");
    setHeaders("");
    setSelectedField("cookies");
  }, [targetUrl]);

  const save = async () => {
    if (isSaving) {
      return;
    }
    const saved = await onSave({ origin: targetUrl, cookies, headers });
    if (saved) {
      setCookies("");
      setHeaders("");
    }
  };

  const clear = async () => {
    if (isSaving) {
      return;
    }
    await onClear();
    setCookies("");
    setHeaders("");
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
    if (key.ctrl && key.name === "s") {
      void save();
      return;
    }
    if (key.ctrl && key.name === "d") {
      void clear();
      return;
    }
    if (selectedField === "actions" && key.name === "return") {
      void save();
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

        <text fg={theme.text.secondary}>
          Exact origin: {preview.origin}
        </text>
        <text fg={metadata?.storageMode === "memory" ? theme.accent.warning : theme.text.dim}>
          Storage: {getStorageLabel(metadata)}
        </text>

        <box flexDirection="row" marginTop={1}>
          <box width={18}>
            <text fg={selectedField === "cookies" ? theme.accent.primary : theme.text.secondary}>
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
            <text fg={selectedField === "headers" ? theme.accent.primary : theme.text.secondary}>
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

        <box flexDirection="column" marginTop={1}>
          <text fg={theme.accent.primary}>
            <strong>Redacted preview</strong>
          </text>
          <text fg={theme.text.secondary}>Cookies: {preview.cookiePreview}</text>
          <text fg={theme.text.secondary}>
            Headers: {preview.headerPreview.length > 0 ? preview.headerPreview.join(" | ") : "No headers"}
          </text>
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
          borderColor={selectedField === "actions" ? theme.accent.primary : theme.border.muted}
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexGrow={1}>
            <text fg={theme.text.primary}>
              <strong>{isSaving ? "Saving…" : "Ctrl+S save / replace"}</strong>
            </text>
          </box>
          <text fg={metadata ? theme.accent.warning : theme.text.dim}>
            Ctrl+D clear
          </text>
        </box>

        <text fg={theme.text.dim} marginTop={1}>
          Header values never appear in the dashboard, logs, or chat context.
        </text>
      </box>
    </box>
  );
}
