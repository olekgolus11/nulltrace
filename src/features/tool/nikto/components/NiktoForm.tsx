import { theme } from "../../../../app/theme/theme";
import { niktoFieldOrder } from "../config/nikto.config";
import { NiktoFormState } from "../types/nikto.types";

export function NiktoForm({
  form,
  selectedField,
  focused,
  onFieldChange,
}: {
  form: NiktoFormState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (field: keyof NiktoFormState, value: string) => void;
}) {
  const selectedId = niktoFieldOrder[selectedField];
  const fields = [
    ["target", "Target URL", "https://example.com"],
    ["rootPath", "Root path", "/app"],
    ["vhost", "Virtual host", "app.example.com"],
    ["timeoutSeconds", "Timeout (sec)", "300"],
  ] as const;

  return (
    <box flexDirection="column">
      <text fg={theme.text.dim}>Standard profile: no tuning, mutation, or evasion options.</text>
      {fields.map(([field, label, placeholder]) => (
        <box key={field} flexDirection="row" width="100%">
          <box width={20}>
            <text fg={selectedId === field ? theme.accent.primary : theme.text.secondary}>
              {selectedId === field ? `> ${label}` : `  ${label}`}
            </text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <input
              value={form[field]}
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
