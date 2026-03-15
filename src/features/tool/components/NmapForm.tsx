import { theme } from "../../../app/theme/theme";
import {
  NmapFieldId,
  NmapFormState,
  NmapTiming,
} from "../model/tool.types";

const FIELD_IDS: NmapFieldId[] = [
  "target",
  "ports",
  "timing",
  "serviceDetection",
  "osDetection",
  "defaultScripts",
  "aggressive",
  "extraArgs",
];

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
    <box marginBottom={1}>
      <text fg={selected ? theme.accent.primary : theme.text.secondary}>
        {selected ? ">" : " "} [{value ? "x" : " "}] {label}
      </text>
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
  const selectedId = FIELD_IDS[selectedField];

  return (
    <box flexDirection="column">
      <box flexDirection="row" marginBottom={1}>
        <box width={20}>
          <text fg={selectedId === "target" ? theme.accent.primary : theme.text.secondary}>
            {selectedId === "target" ? "> Target" : "  Target"}
          </text>
        </box>
        <input
          value={form.target}
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

      <box flexDirection="row" marginBottom={1}>
        <box width={20}>
          <text fg={selectedId === "ports" ? theme.accent.primary : theme.text.secondary}>
            {selectedId === "ports" ? "> Ports" : "  Ports"}
          </text>
        </box>
        <input
          value={form.ports}
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

      <box flexDirection="row" marginBottom={1}>
        <box width={20}>
          <text fg={selectedId === "timing" ? theme.accent.primary : theme.text.secondary}>
            {selectedId === "timing" ? "> Timing" : "  Timing"}
          </text>
        </box>
        <text fg={selectedId === "timing" ? theme.text.primary : theme.text.secondary}>
          {["T2", "T3", "T4", "T5"]
            .map((option) => (option === form.timing ? `[${option}]` : option))
            .join("  ")}{" "}
        </text>
        <text fg={theme.text.dim}>use left/right</text>
      </box>

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

      <box flexDirection="row">
        <box width={20}>
          <text fg={selectedId === "extraArgs" ? theme.accent.primary : theme.text.secondary}>
            {selectedId === "extraArgs" ? "> Extra args" : "  Extra args"}
          </text>
        </box>
        <input
          value={form.extraArgs}
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
  );
}
