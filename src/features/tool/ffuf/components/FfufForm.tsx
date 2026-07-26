import { theme } from "../../../../app/theme/theme";
import { getFfufFieldOrder } from "../config/ffuf.config";
import { FfufFieldId, FfufFormProps } from "../types/ffuf.types";

type FfufTextField = Exclude<FfufFieldId, "mode" | "recursion" | "requestLocation">;

export function FfufForm({ toolData, focused, onFieldChange }: FfufFormProps) {
  const fieldOrder = getFfufFieldOrder(toolData.mode);
  const selectedId = fieldOrder[toolData.selectedField];
  const fieldLabel = (field: typeof selectedId, label: string) =>
    selectedId === field ? `> ${label}` : `  ${label}`;
  const fieldColor = (field: typeof selectedId) =>
    selectedId === field ? theme.accent.primary : theme.text.secondary;
  const input = (field: FfufTextField, label: string, placeholder: string) => (
    <box flexDirection="row" width="100%">
      <box width={20}>
        <text fg={fieldColor(field)}>{fieldLabel(field, label)}</text>
      </box>
      <box flexGrow={1} minWidth={0}>
        <input
          value={toolData.form[field] as string}
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

  if (toolData.mode === "parameter_discovery") {
    return (
      <box flexDirection="column">
        <text fg={fieldColor("mode")}>{fieldLabel("mode", "Mode")}: Parameter Discovery</text>
        <text fg={theme.text.dim}>  press Left/Right to switch modes</text>
        {input("endpoint", "Endpoint", "https://example.com/search")}
        <box flexDirection="row" width="100%">
          <box width={20}>
            <text fg={fieldColor("requestLocation")}>
              {fieldLabel("requestLocation", "Request location")}
            </text>
          </box>
          <text fg={fieldColor("requestLocation")}>[{toolData.form.requestLocation}]</text>
          <text fg={theme.text.dim}>  press Left/Right</text>
        </box>
        {input("wordlist", "Wordlist", "/path/to/parameters.txt")}
        {input("matchCodes", "Match codes", "200,204,301,302")}
        {input("filterCodes", "Filter codes", "404")}
        {input("rate", "Request rate", "25")}
        {input("timeLimit", "Time limit", "10 seconds")}
      </box>
    );
  }

  if (toolData.mode === "value_fuzzing") {
    return (
      <box flexDirection="column">
        <text fg={fieldColor("mode")}>{fieldLabel("mode", "Mode")}: Value Fuzzing</text>
        <text fg={theme.text.dim}>  press Left/Right to switch modes</text>
        {input("endpoint", "Endpoint", "https://example.com/search")}
        {input("parameterName", "Parameter", "q")}
        <box flexDirection="row" width="100%">
          <box width={20}>
            <text fg={fieldColor("requestLocation")}>
              {fieldLabel("requestLocation", "Request location")}
            </text>
          </box>
          <text fg={fieldColor("requestLocation")}>[{toolData.form.requestLocation}]</text>
          <text fg={theme.text.dim}>  press Left/Right</text>
        </box>
        {input("wordlist", "Payload wordlist", "/path/to/payloads.txt")}
        {input("matchCodes", "Match codes", "200,302,500")}
        {input("filterCodes", "Filter codes", "404")}
        {input("rate", "Request rate", "25")}
        {input("timeLimit", "Time limit", "10 seconds")}
      </box>
    );
  }

  return (
    <box flexDirection="column">
      <text fg={fieldColor("mode")}>{fieldLabel("mode", "Mode")}: Content Discovery</text>
      <text fg={theme.text.dim}>  press Left/Right to switch modes</text>
      {input("targetPattern", "Target pattern", "https://example.com/FUZZ")}
      {input("wordlist", "Wordlist", "/path/to/words.txt")}
      {input("extensions", "Extensions", ".php,.bak")}
      <box flexDirection="row" width="100%">
        <box width={20}>
          <text fg={fieldColor("recursion")}>{fieldLabel("recursion", "Recursion")}</text>
        </box>
        <text fg={fieldColor("recursion")}>{toolData.form.recursion ? "[enabled]" : "disabled"}</text>
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
