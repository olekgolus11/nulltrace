import { theme } from "../../../../app/theme/theme";
import { getSqlmapFieldOrder } from "../config/sqlmap.config";
import {
  SqlmapAuthenticationState,
  SqlmapFormState,
} from "../types/sqlmap.types";

export function SqlmapForm({
  form,
  authentication,
  selectedField,
  focused,
  onFieldChange,
}: {
  form: SqlmapFormState;
  authentication: SqlmapAuthenticationState;
  selectedField: number;
  focused: boolean;
  onFieldChange: (field: keyof SqlmapFormState, value: string) => void;
}) {
  const selectedId = getSqlmapFieldOrder(authentication.isAvailable)[selectedField];
  const requestInputFields = [
    ["parameter", "Parameter", "id"],
    ["body", "Body (POST)", "id=1&category=2"],
  ] as const;

  return (
    <box flexDirection="column">
      <text fg={theme.text.dim}>
        Targeted verification: one endpoint + one parameter. Risk locked to 1.
      </text>
      <InputRow
        field="targetUrl"
        label="Target URL"
        placeholder="http://127.0.0.1/item?id=1"
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
      {requestInputFields.map(([field, label, placeholder]) => (
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
      <InputRow
        field="timeLimitSeconds"
        label="Time limit (sec)"
        placeholder="300"
        value={form.timeLimitSeconds}
        selected={selectedId === "timeLimitSeconds"}
        focused={focused}
        onFieldChange={onFieldChange}
      />
      <InputRow
        field="extraSafeOptions"
        label="Extra safe options"
        placeholder="--technique=BE --smart"
        value={form.extraSafeOptions}
        selected={selectedId === "extraSafeOptions"}
        focused={focused}
        onFieldChange={onFieldChange}
      />
      {authentication.isAvailable ? (
        <ChoiceRow
          label="Session auth"
          value={
            form.useAuthenticatedContext
              ? `[enabled]  disabled  raw request added at run  ${authentication.origin ?? ""}`
              : `enabled  [disabled]  use left/right  ${authentication.origin ?? ""}`
          }
          selected={selectedId === "useAuthenticatedContext"}
        />
      ) : null}
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
