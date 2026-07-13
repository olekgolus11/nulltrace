import { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import { theme } from "../../../app/theme/theme";
import {
  AuthCheckMetadata,
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

type AuthenticationMode = "manual" | "curl" | "har" | "review";
type AuthenticationField =
  | "cookies"
  | "headers"
  | "verification_url"
  | "curlSource"
  | "harPath"
  | "harRequests"
  | "import"
  | "actions";

const modeFields: Record<
  AuthenticationMode,
  readonly AuthenticationField[]
> = {
  manual: ["cookies", "headers", "verification_url", "actions"],
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
  const [mode, setMode] = useState<AuthenticationMode>("manual");
  const [cookies, setCookies] = useState("");
  const [headers, setHeaders] = useState("");
  const [verificationUrl, setVerificationUrl] = useState(
    verificationUrlSuggestions[0] ?? targetUrl,
  );
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
  const bodyScrollRef = useRef<ScrollBoxRenderable | null>(null);
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
  const fields =
    mode === "har" && harRequests.length > 0
      ? harRequestFields
      : modeFields[mode];

  useEffect(() => {
    setMode("manual");
    setCookies("");
    setHeaders("");
    setVerificationUrl(verificationUrlSuggestions[0] ?? targetUrl);
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
    bodyScrollRef.current?.scrollTo(0);
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
    if (isBusy || (mode !== "manual" && mode !== "review")) {
      return;
    }
    const saved = await onSave({ origin: targetUrl, cookies, headers });
    if (saved) {
      setCookies("");
      setHeaders("");
      setMode("manual");
      setSelectedField("verification_url");
      setNotice("Authentication context saved.");
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
    setNotice(null);
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
    if (key.name === "pageup" || key.name === "pagedown") {
      bodyScrollRef.current?.scrollBy(
        key.name === "pageup" ? -8 : 8,
        "step",
      );
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
      const nextField = fields[nextIndex]!;
      setSelectedField(nextField);
      if (nextField === "actions" || nextField === "import") {
        const scrollbox = bodyScrollRef.current;
        scrollbox?.scrollTo(scrollbox.scrollHeight);
      } else if (nextField === fields[0]) {
        bodyScrollRef.current?.scrollTo(0);
      }
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
      if (mode === "curl" || mode === "har") {
        runImportAction();
      } else {
        void save();
      }
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
          ? "Ctrl+S import selected request"
          : mode === "har"
            ? isReadingHar
              ? "Reading HAR…"
              : "Ctrl+S list HAR requests"
            : "Ctrl+S parse curl";

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

        <scrollbox
          ref={bodyScrollRef}
          width="100%"
          height={Math.max(1, height - 6)}
        >
          <box flexDirection="column" width="100%" flexShrink={0}>
            <text fg={theme.text.dim}>PgUp/PgDn scroll</text>
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
                    onInput={setVerificationUrl}
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
              flexDirection="column"
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
              <text fg={theme.text.primary}>
                <strong>{isSaving ? "Saving…" : actionLabel}</strong>
              </text>
              <text>
                <span
                  fg={
                    metadata ? theme.accent.secondary : theme.text.muted
                  }
                >
                  Ctrl+K check
                </span>
                <span fg={theme.text.dim}> | </span>
                <span
                  fg={
                    authCheck?.status === "inconclusive" &&
                    !authCheck.isProceedAllowed
                      ? theme.accent.warning
                      : theme.text.muted
                  }
                >
                  Ctrl+Y acknowledge
                </span>
                <span fg={theme.text.dim}> | Ctrl+D clear</span>
              </text>
            </box>

            <text fg={theme.text.dim} marginTop={1}>
              Imports ignore methods and bodies; saving requires confirmation.
              Auth Check is heuristic only and does not establish authorization
              scope. Secrets and response content stay out of metadata.
            </text>
          </box>
        </scrollbox>
      </box>
    </box>
  );
}
