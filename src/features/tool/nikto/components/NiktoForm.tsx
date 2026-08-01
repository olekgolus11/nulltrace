import { theme } from "../../../../app/theme/theme";
import {
  getNiktoFieldOrder,
  niktoCustomTuning,
} from "../config/nikto.config";
import {
  NiktoFormState,
  NiktoProfile,
  NiktoTuningCode,
} from "../types/nikto.types";

export function NiktoForm({
  form,
  selectedField,
  focused,
  onFieldChange,
  onProfileChange,
  onToggleTuning,
  authAvailable,
  authOrigin,
  onToggleAuthenticatedContext,
}: NiktoFormProps) {
  const selectedId = getNiktoFieldOrder(form.profile, authAvailable)[selectedField];
  const textFields = [
    ["target", "Target", "https://example.com"],
    ...(form.profile === "custom"
      ? [
          ["requestTimeoutSeconds", "Request timeout", "10"],
          ["pauseSeconds", "Pause (sec)", "0"],
        ]
      : []),
    ["rootPath", "Root path", "/app"],
    ["vhost", "Vhost", "app.example.com"],
    ["timeoutSeconds", "Max run (sec)", "300"],
  ] as const;

  return (
    <box flexDirection="column">
      <box
        flexDirection="column"
        width="100%"
        onMouseDown={() =>
          onProfileChange(form.profile === "standard" ? "custom" : "standard")
        }
      >
        <text fg={selectedId === "profile" ? theme.accent.primary : theme.text.secondary}>
          {selectedId === "profile" ? "> Mode" : "  Mode"}:{" "}
          {form.profile === "custom" ? "Custom" : "Standard"}
        </text>
        <text fg={theme.text.dim}>{"  "}press Left/Right to switch modes</text>
      </box>

      {form.profile === "custom" ? (
        <box flexDirection="column" width="100%">
          <box flexDirection="row" alignItems="center">
            <box width={20}>
              <text fg={theme.text.secondary}>{"  "}Flags</text>
            </box>
          </box>
          <box flexDirection="column" paddingLeft={2}>
            {niktoCustomTuning.map(({ code, label, isDisruptive }) => (
              <TuningFlagRow
                key={code}
                code={code}
                label={label}
                isDisruptive={isDisruptive}
                value={form.tuning.includes(code)}
                selected={focused && selectedId === `tuning:${code}`}
                onToggle={() => onToggleTuning(code)}
              />
            ))}
          </box>
        </box>
      ) : null}

      {textFields.map(([field, label, placeholder]) => (
        <box key={field} flexDirection="row" width="100%">
          <box width={20}>
            <text fg={selectedId === field ? theme.accent.primary : theme.text.secondary}>
              {selectedId === field ? `> ${label}` : `  ${label}`}
            </text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <input
              value={String(form[field])}
              width="100%"
              onChange={(value) => onFieldChange(field, value)}
              placeholder={placeholder}
              focused={focused && selectedId === field}
              backgroundColor={theme.bg.input}
              textColor={theme.text.primary}
              cursorColor={theme.accent.primary}
              focusedBackgroundColor={theme.bg.elevated}
              placeholderColor={theme.text.dim}
            />
          </box>
        </box>
      ))}

      {authAvailable ? (
        <box
          flexDirection="row"
          width="100%"
          onMouseDown={onToggleAuthenticatedContext}
        >
          <box width={20}>
            <text
              fg={
                selectedId === "useAuthenticatedContext"
                  ? theme.accent.primary
                  : theme.text.secondary
              }
            >
              {selectedId === "useAuthenticatedContext" ? "> Session auth" : "  Session auth"}
            </text>
          </box>
          <text fg={theme.text.primary}>
            {form.useAuthenticatedContext ? "[enabled]  disabled" : "enabled  [disabled]"}
          </text>
          <text fg={theme.text.dim}>
            {form.useAuthenticatedContext
              ? `  temp config added at run  ${authOrigin ?? ""}`
              : `  use left/right  ${authOrigin ?? ""}`}
          </text>
        </box>
      ) : null}
    </box>
  );
}

interface NiktoFormProps {
  form: NiktoFormState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (field: keyof NiktoFormState, value: string) => void;
  onProfileChange: (profile: NiktoProfile) => void;
  onToggleTuning: (code: NiktoTuningCode) => void;
  authAvailable: boolean;
  authOrigin: string | null;
  onToggleAuthenticatedContext: () => void;
}

function TuningFlagRow({
  code,
  label,
  isDisruptive,
  value,
  selected,
  onToggle,
}: TuningFlagRowProps) {
  const color = isDisruptive
    ? theme.accent.critical
    : selected
      ? theme.accent.primary
      : theme.text.secondary;

  return (
    <box flexDirection="row" alignItems="center" onMouseDown={onToggle}>
      <box width={2}>
        <text fg={color}>{selected ? ">" : " "}</text>
      </box>
      <text fg={color}>
        [{value ? "x" : " "}] {label} (-Tuning {code})
        {isDisruptive ? " [CONFIRM]" : ""}
      </text>
    </box>
  );
}

interface TuningFlagRowProps {
  code: NiktoTuningCode;
  label: string;
  isDisruptive: boolean;
  value: boolean;
  selected: boolean;
  onToggle: () => void;
}
