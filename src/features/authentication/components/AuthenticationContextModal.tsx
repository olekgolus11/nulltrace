import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { theme } from "../../../app/theme/theme";
import {
  AuthenticatedRequestContextInput,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import {
  HarAuthenticationRequestSelection,
  listHarAuthenticationRequests,
  parseCurlAuthenticationContext,
  parseHarAuthenticationContext,
} from "../services/authenticated-request-context-import";
import { createRedactedAuthenticatedRequestContextPreview } from "../services/authenticated-request-context-redaction";

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

type AuthenticationMode = "manual" | "curl" | "har" | "review";
type AuthenticationField =
  | "cookies"
  | "headers"
  | "curlSource"
  | "harPath"
  | "harRequests"
  | "import"
  | "actions";

const modeFields: Record<
  AuthenticationMode,
  readonly AuthenticationField[]
> = {
  manual: ["cookies", "headers", "actions"],
  curl: ["curlSource", "import"],
  har: ["harPath", "import"],
  review: ["actions"],
} as const;
const harRequestFields = ["harRequests", "import"] as const;

function getStorageLabel(metadata: AuthenticatedRequestContextMetadata | null) {
  if (!metadata) {
    return "No active context";
  }
  return metadata.storageMode === "secure"
    ? "Platform secret store"
    : "Memory only (cleared on restart)";
}

function getImportError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to import authentication context.";
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
  const [mode, setMode] = useState<AuthenticationMode>("manual");
  const [cookies, setCookies] = useState("");
  const [headers, setHeaders] = useState("");
  const [curlSource, setCurlSource] = useState("");
  const [harPath, setHarPath] = useState("");
  const [harData, setHarData] = useState("");
  const [harRequests, setHarRequests] = useState<
    HarAuthenticationRequestSelection[]
  >([]);
  const [selectedHarRequest, setSelectedHarRequest] = useState(0);
  const [selectedField, setSelectedField] =
    useState<AuthenticationField>("cookies");
  const [importError, setImportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isReadingHar, setIsReadingHar] = useState(false);
  const preview = createRedactedAuthenticatedRequestContextPreview({
    origin: targetUrl,
    cookies,
    headers,
  });
  const fields =
    mode === "har" && harRequests.length > 0
      ? harRequestFields
      : modeFields[mode];

  useEffect(() => {
    setMode("manual");
    setCookies("");
    setHeaders("");
    setCurlSource("");
    setHarPath("");
    setHarData("");
    setHarRequests([]);
    setSelectedHarRequest(0);
    setSelectedField("cookies");
    setImportError(null);
    setNotice(null);
  }, [targetUrl]);

  const selectMode = (nextMode: Exclude<AuthenticationMode, "review">) => {
    setMode(nextMode);
    setCookies("");
    setHeaders("");
    setCurlSource("");
    setSelectedField(modeFields[nextMode][0]!);
    setImportError(null);
    setNotice(null);
    setHarData("");
    setHarRequests([]);
    setSelectedHarRequest(0);
  };

  const prepareImportedContext = (
    context: AuthenticatedRequestContextInput,
    source: "curl" | "HAR",
  ) => {
    setCookies(context.cookies);
    setHeaders(context.headers);
    setCurlSource("");
    setHarData("");
    setHarRequests([]);
    setMode("review");
    setSelectedField("actions");
    setImportError(null);
    setNotice(
      `${source} import prepared. Review the redacted preview, then press Ctrl+S to replace context.`,
    );
  };

  const importCurl = () => {
    try {
      prepareImportedContext(
        parseCurlAuthenticationContext(curlSource, targetUrl),
        "curl",
      );
    } catch (nextError) {
      setImportError(getImportError(nextError));
      setNotice(null);
    }
  };

  const loadHar = async () => {
    if (!harPath.trim() || isReadingHar) {
      setImportError("Enter the path to a HAR file.");
      return;
    }
    setIsReadingHar(true);
    try {
      let data: string;
      try {
        data = await Bun.file(harPath.trim()).text();
      } catch {
        setImportError(
          "Unable to read the HAR file. Check its path and permissions.",
        );
        return;
      }
      const requests = listHarAuthenticationRequests(data, targetUrl);
      setHarData(data);
      setHarRequests(requests);
      setSelectedHarRequest(0);
      setSelectedField("harRequests");
      setImportError(null);
      setNotice("Select a same-origin request, then press Enter.");
    } catch (nextError) {
      setHarData("");
      setHarRequests([]);
      setImportError(getImportError(nextError));
      setNotice(null);
    } finally {
      setIsReadingHar(false);
    }
  };

  const importHarRequest = (selectionIndex = selectedHarRequest) => {
    const selection = harRequests[selectionIndex];
    if (!selection) {
      setImportError("Select a HAR request to import.");
      return;
    }
    try {
      prepareImportedContext(
        parseHarAuthenticationContext(
          harData,
          targetUrl,
          selection.entryIndex,
        ),
        "HAR",
      );
    } catch (nextError) {
      setImportError(getImportError(nextError));
      setNotice(null);
    }
  };

  const runImportAction = () => {
    if (mode === "curl") {
      importCurl();
    } else if (mode === "har") {
      if (harRequests.length === 0) {
        void loadHar();
      } else {
        importHarRequest();
      }
    }
  };

  const save = async () => {
    if (isSaving || (mode !== "manual" && mode !== "review")) {
      return;
    }
    const saved = await onSave({ origin: targetUrl, cookies, headers });
    if (saved) {
      setCookies("");
      setHeaders("");
      setMode("manual");
      setSelectedField("cookies");
      setNotice("Authentication context saved.");
    }
  };

  const clear = async () => {
    if (isSaving) {
      return;
    }
    await onClear();
    setCookies("");
    setHeaders("");
    setNotice(null);
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.ctrl && key.name === "e") {
      selectMode("manual");
      return;
    }
    if (key.ctrl && key.name === "u") {
      selectMode("curl");
      return;
    }
    if (key.ctrl && key.name === "r") {
      selectMode("har");
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
      return;
    }
    if (selectedField === "import" && key.name === "return") {
      runImportAction();
    }
  });

  const actionLabel =
    mode === "manual"
      ? "Ctrl+S save / replace"
      : mode === "review"
        ? "Ctrl+S confirm replace"
        : mode === "har" && harRequests.length > 0
          ? "Enter import selected request"
          : mode === "har"
            ? isReadingHar
              ? "Reading HAR…"
              : "Enter list HAR requests"
            : "Enter parse curl";

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
        <text fg={theme.text.dim}>
          Modes: Ctrl+E manual | Ctrl+U curl | Ctrl+R HAR
        </text>
        <text fg={theme.accent.secondary}>
          Active: {mode === "review" ? "redacted import review" : mode}
        </text>

        {mode === "manual" ? (
          <>
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
                  onInput={setCookies}
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
                  onInput={setHeaders}
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
          </>
        ) : null}

        {mode === "curl" ? (
          <box flexDirection="row" marginTop={1}>
            <box width={18}>
              <text
                fg={
                  selectedField === "curlSource"
                    ? theme.accent.primary
                    : theme.text.secondary
                }
              >
                {selectedField === "curlSource"
                  ? "> curl command"
                  : "  curl command"}
              </text>
            </box>
            <box flexGrow={1} minWidth={0}>
              <input
                value={curlSource}
                width="100%"
                onInput={setCurlSource}
                placeholder="curl 'https://target/…' -H 'Authorization: …'"
                focused={selectedField === "curlSource"}
                backgroundColor={theme.bg.input}
                textColor={theme.text.primary}
                cursorColor={theme.accent.primary}
                focusedBackgroundColor={theme.bg.elevated}
                placeholderColor={theme.text.dim}
              />
            </box>
          </box>
        ) : null}

        {mode === "har" ? (
          <>
            {harRequests.length === 0 ? (
              <box flexDirection="row" marginTop={1}>
                <box width={18}>
                  <text
                    fg={
                      selectedField === "harPath"
                        ? theme.accent.primary
                        : theme.text.secondary
                    }
                  >
                    {selectedField === "harPath" ? "> HAR file" : "  HAR file"}
                  </text>
                </box>
                <box flexGrow={1} minWidth={0}>
                  <input
                    value={harPath}
                    width="100%"
                    onInput={setHarPath}
                    placeholder="/path/to/session.har"
                    focused={selectedField === "harPath"}
                    backgroundColor={theme.bg.input}
                    textColor={theme.text.primary}
                    cursorColor={theme.accent.primary}
                    focusedBackgroundColor={theme.bg.elevated}
                    placeholderColor={theme.text.dim}
                  />
                </box>
              </box>
            ) : (
              <box flexDirection="column" marginTop={1} height={8}>
                <text fg={theme.text.secondary}>
                  Same-origin requests ({harRequests.length})
                </text>
                <select
                  options={harRequests.map((request) => ({
                    name: `${request.method} ${request.path}`,
                    description: `HAR request ${request.entryIndex + 1}`,
                    value: request.entryIndex,
                  }))}
                  height={6}
                  selectedIndex={selectedHarRequest}
                  focused={selectedField === "harRequests"}
                  showScrollIndicator
                  onChange={(index) => setSelectedHarRequest(index)}
                  onSelect={(index) => importHarRequest(index)}
                />
              </box>
            )}
          </>
        ) : null}

        <box flexDirection="column" marginTop={1}>
          <text fg={theme.accent.primary}>
            <strong>Redacted preview</strong>
          </text>
          <text fg={theme.text.secondary}>Cookies: {preview.cookiePreview}</text>
          <text fg={theme.text.secondary}>
            Headers:{" "}
            {preview.headerPreview.length > 0
              ? preview.headerPreview.join(" | ")
              : "No headers"}
          </text>
        </box>

        {notice ? (
          <text fg={theme.accent.info} marginTop={1}>
            {notice}
          </text>
        ) : null}
        {importError || error ? (
          <text fg={theme.accent.critical} marginTop={1}>
            {importError ?? error}
          </text>
        ) : null}

        <box
          flexDirection="row"
          marginTop={1}
          border
          borderColor={
            selectedField === "actions" || selectedField === "import"
              ? theme.accent.primary
              : theme.border.muted
          }
          paddingLeft={1}
          paddingRight={1}
        >
          <box flexGrow={1}>
            <text fg={theme.text.primary}>
              <strong>{isSaving ? "Saving…" : actionLabel}</strong>
            </text>
          </box>
          <text fg={metadata ? theme.accent.warning : theme.text.dim}>
            Ctrl+D clear
          </text>
        </box>

        <text fg={theme.text.dim} marginTop={1}>
          Imports ignore methods and bodies. Saving requires confirmation.
        </text>
      </box>
    </box>
  );
}
