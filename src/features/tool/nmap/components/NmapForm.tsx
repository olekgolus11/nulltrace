import { theme } from "../../../../app/theme/theme";
import { nmapFieldOrder, nmapTimingOptions } from "../config/nmap.config";
import { NmapFormState, NmapTiming } from "../types/nmap.types";

function ToggleRow({
  label,
  value,
  selected,
}: {
  label: string;
  value: boolean;
  selected: boolean;
}) {
  return (
    <box>
      <box flexDirection="row" alignItems="center">
        <box width={2}>
          <text fg={selected ? theme.accent.primary : theme.text.secondary}>
            {selected ? ">" : " "}
          </text>
        </box>
        <text fg={selected ? theme.accent.primary : theme.text.secondary}>
          [{value ? "x" : " "}] {label}
        </text>
      </box>
    </box>
  );
}

export function NmapForm({
  form,
  selectedField,
  focused,
  onFieldChange,
}: {
  form: NmapFormState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (
    field: keyof NmapFormState,
    value: string | boolean | NmapTiming,
  ) => void;
}) {
  const selectedId = nmapFieldOrder[selectedField];

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
            placeholder="scanme.nmap.org"
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
              selectedId === "ports"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "ports" ? "> Ports" : "  Ports"}
          </text>
        </box>
        <box flexGrow={1} minWidth={0}>
          <input
            value={form.ports}
            width="100%"
            onChange={(value) => onFieldChange("ports", value)}
            placeholder="80,443,8080"
            focused={focused && selectedId === "ports"}
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
              selectedId === "timing"
                ? theme.accent.primary
                : theme.text.secondary
            }
          >
            {selectedId === "timing" ? "> Timing" : "  Timing"}
          </text>
        </box>
        <text
          fg={
            selectedId === "timing" ? theme.text.primary : theme.text.secondary
          }
        >
          {nmapTimingOptions
            .map((option) => (option === form.timing ? `[${option}]` : option))
            .join("  ")}{" "}
        </text>
        <text fg={theme.text.dim}>use left/right</text>
      </box>

      <box marginTop={1}>
        <text fg={theme.text.secondary}>{"  "}Flags</text>
      </box>

      <box flexDirection="column" paddingLeft={2}>
        <ToggleRow
          label="Service/version detection (-sV)"
          value={form.serviceDetection}
          selected={focused && selectedId === "serviceDetection"}
        />
        <ToggleRow
          label="OS detection (-O)"
          value={form.osDetection}
          selected={focused && selectedId === "osDetection"}
        />
        <ToggleRow
          label="Default scripts (-sC)"
          value={form.defaultScripts}
          selected={focused && selectedId === "defaultScripts"}
        />
        <ToggleRow
          label="Aggressive profile (-A)"
          value={form.aggressive}
          selected={focused && selectedId === "aggressive"}
        />
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
            placeholder="--open --reason"
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
