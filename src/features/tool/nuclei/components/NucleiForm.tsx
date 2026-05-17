import { theme } from "../../../../app/theme/theme";
import {
  nucleiFieldOrder,
  nucleiSeverityOptions,
} from "../config/nuclei.config";
import {
  NucleiFormState,
  NucleiSeverityPreset,
} from "../types/nuclei.types";

export function NucleiForm({
  form,
  selectedField,
  focused,
  onFieldChange,
}: {
  form: NucleiFormState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (
    field: keyof NucleiFormState,
    value: string | NucleiSeverityPreset,
  ) => void;
}) {
  const selectedId = nucleiFieldOrder[selectedField];

  return (
    <box flexDirection="column">
      <box flexDirection="row" width="100%">
        <box width={20}>
          <text
            fg={
              selectedId === "target"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "target" ? "> Target" : "  Target"}
          </text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={form.target}
            width="100%"
            onChange={(value) => onFieldChange("target", value)}
            placeholder="https://example.com"
            focused={focused && selectedId === "target"}
            backgroundColor={theme.bg.input}
            textColor={theme.text.primary}
            cursorColor={theme.accent.primary}
            focusedBackgroundColor={theme.bg.elevated}
            placeholderColor={theme.text.dim}
          />
        </box>
      </box>

      <box flexDirection="row" width="100%">
        <box width={20}>
          <text
            fg={
              selectedId === "severityPreset"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "severityPreset" ? "> Severity" : "  Severity"}
          </text>
        </box>
        <text
          fg={
            selectedId === "severityPreset"
              ? theme.text.primary
              : theme.text.secondary
          }
        >
          {nucleiSeverityOptions
            .map((option) =>
              option === form.severityPreset ? `[${option}]` : option,
            )
            .join("  ")}{" "}
        </text>
        <text fg={theme.text.dim}>use left/right</text>
      </box>

      <box flexDirection="row" width="100%">
        <box width={20}>
          <text
            fg={
              selectedId === "tags"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "tags" ? "> Tags" : "  Tags"}
          </text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={form.tags}
            width="100%"
            onChange={(value) => onFieldChange("tags", value)}
            placeholder="cve,rce,exposure"
            focused={focused && selectedId === "tags"}
            backgroundColor={theme.bg.input}
            textColor={theme.text.primary}
            cursorColor={theme.accent.primary}
            focusedBackgroundColor={theme.bg.elevated}
            placeholderColor={theme.text.dim}
          />
        </box>
      </box>

      <box flexDirection="row" width="100%">
        <box width={20}>
          <text
            fg={
              selectedId === "templatesPath"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "templatesPath" ? "> Templates" : "  Templates"}
          </text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={form.templatesPath}
            width="100%"
            onChange={(value) => onFieldChange("templatesPath", value)}
            placeholder="/path/to/templates"
            focused={focused && selectedId === "templatesPath"}
            backgroundColor={theme.bg.input}
            textColor={theme.text.primary}
            cursorColor={theme.accent.primary}
            focusedBackgroundColor={theme.bg.elevated}
            placeholderColor={theme.text.dim}
          />
        </box>
      </box>

      <box flexDirection="row" width="100%" marginTop={1}>
        <box width={20}>
          <text
            fg={
              selectedId === "extraArgs"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "extraArgs" ? "> Extra args" : "  Extra args"}
          </text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={form.extraArgs}
            width="100%"
            onChange={(value) => onFieldChange("extraArgs", value)}
            placeholder="-rate-limit 5 -proxy http://127.0.0.1:8080"
            focused={focused && selectedId === "extraArgs"}
            backgroundColor={theme.bg.input}
            textColor={theme.text.primary}
            cursorColor={theme.accent.primary}
            focusedBackgroundColor={theme.bg.elevated}
            placeholderColor={theme.text.dim}
          />
        </box>
      </box>
    </box>
  );
}
