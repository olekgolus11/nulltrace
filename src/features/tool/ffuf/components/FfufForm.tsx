import { theme } from "../../../../app/theme/theme";
import { ffufFieldOrder } from "../config/ffuf.config";
import { FfufFieldId, FfufFormProps } from "../types/ffuf.types";

type FfufTextField = Exclude<FfufFieldId, "recursion">;

export function FfufForm({ form, selectedField, focused, onFieldChange }: FfufFormProps) {
  const selectedId = ffufFieldOrder[selectedField];
  const fieldLabel = (field: typeof selectedId, label: string) =>
    selectedId === field ? `> ${label}` : `  ${label}`;
  const fieldColor = (field: typeof selectedId) =>
    selectedId === field ? theme.accent.primary : theme.text.secondary;
  const input = (
    field: FfufTextField,
    label: string,
    placeholder: string,
  ) => (
    <box flexDirection="row" width="100%">
      <box width={20}>
        <text fg={fieldColor(field)}>{fieldLabel(field, label)}</text>
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
  );

  return (
    <box flexDirection="column">
      <text fg={theme.accent.primary}>Mode: Content Discovery</text>
      {input("targetPattern", "Target pattern", "https://example.com/FUZZ")}
      {input("wordlist", "Wordlist", "/path/to/words.txt")}
      {input("extensions", "Extensions", ".php,.bak")}
      <box flexDirection="row" width="100%">
        <box width={20}>
          <text fg={fieldColor("recursion")}>{fieldLabel("recursion", "Recursion")}</text>
        </box>
        <text fg={fieldColor("recursion")}>{form.recursion ? "[enabled]" : "disabled"}</text>
        <text fg={theme.text.dim}>  press Enter</text>
      </box>
      {input("recursionDepth", "Recursion depth", "2")}
      {input("matchCodes", "Match codes", "200,204,301,302")}
      {input("filterCodes", "Filter codes", "404")}
      {input("rate", "Request rate", "25")}
      {input("timeLimit", "Time limit", "10 seconds")}
    </box>
  );
}
