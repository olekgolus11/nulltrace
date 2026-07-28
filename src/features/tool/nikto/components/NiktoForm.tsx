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
}: NiktoFormProps) {
  const selectedId = getNiktoFieldOrder(form.profile)[selectedField];
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
      <box flexDirection="row" width="100%">
        <box width={18}>
          <text fg={selectedId === "profile" ? theme.accent.primary : theme.text.secondary}>
            {selectedId === "profile" ? "> Profile" : "  Profile"}
          </text>
        </box>
        <box onMouseDown={() => onProfileChange(form.profile === "standard" ? "custom" : "standard")}>
          <text fg={form.profile === "custom" ? theme.accent.warning : theme.accent.low}>
            {form.profile === "custom"
              ? "CUSTOM — guided tuning + bounded requests"
              : "STANDARD — broad, non-disruptive"}{" "}
            (Left/Right)
          </text>
        </box>
      </box>

      {form.profile === "custom" ? (
        <box flexDirection="row" width="100%">
          <box width={10}>
            <text fg={theme.text.secondary}>{"  Tuning"}</text>
          </box>
          {niktoCustomTuning.map(({ code, shortLabel, isDisruptive }) => {
            const fieldId = `tuning:${code}` as const;
            const isSelected = form.tuning.includes(code);
            return (
              <box
                key={code}
                flexDirection="row"
                marginRight={2}
                onMouseDown={() => onToggleTuning(code)}
              >
                <text
                  fg={
                    isDisruptive
                      ? theme.accent.critical
                      : selectedId === fieldId
                        ? theme.accent.primary
                        : theme.text.primary
                  }
                >
                  {selectedId === fieldId ? ">" : ""}
                  [{isSelected ? "x" : " "}] {code}{" "}
                  {shortLabel}
                </text>
              </box>
            );
          })}
        </box>
      ) : null}

      {textFields.map(([field, label, placeholder]) => (
        <box key={field} flexDirection="row" width="100%">
          <box width={18}>
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
}
