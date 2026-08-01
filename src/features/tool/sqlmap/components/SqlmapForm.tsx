import { theme } from "../../../../app/theme/theme";
import { sqlmapFieldOrder } from "../config/sqlmap.config";
import { SqlmapFormState } from "../types/sqlmap.types";

export function SqlmapForm({
  form,
  selectedField,
  focused,
  onFieldChange,
}: {
  form: SqlmapFormState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (field: keyof SqlmapFormState, value: string) => void;
}) {
  const selectedId = sqlmapFieldOrder[selectedField];
  const inputFields = [
    ["targetUrl", "Target URL", "http://127.0.0.1/item?id=1"],
    ["parameter", "Parameter", "id"],
    ["body", "Body (POST)", "id=1&category=2"],
    ["timeLimitSeconds", "Time limit (sec)", "300"],
    ["extraSafeOptions", "Extra safe options", "--technique=BE --smart"],
  ] as const;

  return (
    <box flexDirection="column">
      <text fg={theme.text.dim}>
        Targeted verification: one endpoint + one parameter. Risk locked to 1.
      </text>
      <InputRow
        field={inputFields[0][0]}
        label={inputFields[0][1]}
        placeholder={inputFields[0][2]}
        value={form.targetUrl}
        selected={selectedId === "targetUrl"}
        focused={focused}
        onFieldChange={onFieldChange}
      />
      <ChoiceRow
        label="Method"
        value={`${form.method === "GET" ? "[GET]  POST" : "GET  [POST]"}  use left/right`}
        selected={selectedId === "method"}
      />
      {inputFields.slice(1, 3).map(([field, label, placeholder]) => (
        <InputRow
          key={field}
          field={field}
          label={label}
          placeholder={placeholder}
          value={form[field]}
          selected={selectedId === field}
          focused={focused}
          onFieldChange={onFieldChange}
        />
      ))}
      <ChoiceRow
        label="Test level"
        value={`1  2  3  selected [${form.level}]  use left/right`}
        selected={selectedId === "level"}
      />
      <ChoiceRow label="Risk" value="[1]  locked" selected={selectedId === "risk"} />
      {inputFields.slice(3).map(([field, label, placeholder]) => (
        <InputRow
          key={field}
          field={field}
          label={label}
          placeholder={placeholder}
          value={form[field]}
          selected={selectedId === field}
          focused={focused}
          onFieldChange={onFieldChange}
        />
      ))}
    </box>
  );
}

function ChoiceRow({
  label,
  value,
  selected,
}: {
  label: string;
  value: string;
  selected: boolean;
}) {
  return (
    <box flexDirection="row" width="100%">
      <box width={22}>
        <text fg={selected ? theme.accent.primary : theme.text.secondary}>
          {selected ? `> ${label}` : `  ${label}`}
        </text>
      </box>
      <text fg={selected ? theme.text.primary : theme.text.secondary}>{value}</text>
    </box>
  );
}

function InputRow({
  field,
  label,
  placeholder,
  value,
  selected,
  focused,
  onFieldChange,
}: {
  field: keyof SqlmapFormState;
  label: string;
  placeholder: string;
  value: string;
  selected: boolean;
  focused: boolean;
  onFieldChange: (field: keyof SqlmapFormState, value: string) => void;
}) {
  return (
    <box flexDirection="row" width="100%">
      <box width={22}>
        <text fg={selected ? theme.accent.primary : theme.text.secondary}>
          {selected ? `> ${label}` : `  ${label}`}
        </text>
      </box>
      <box flexGrow={1} minWidth={0}>
        <input
          value={value}
          width="100%"
          onChange={(nextValue) => onFieldChange(field, nextValue)}
          placeholder={placeholder}
          focused={focused && selected}
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
