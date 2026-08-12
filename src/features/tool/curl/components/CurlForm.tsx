import { TextareaRenderable } from "@opentui/core";
import { useRef } from "react";
import { theme } from "../../../../app/theme/theme";
import { getCurlFieldOrder } from "../config/curl.config";
import {
  CurlFieldId,
  CurlFormState,
  CurlHttpMethod,
  CurlToolData,
} from "../types/curl.types";

interface CurlFormProps {
  toolData: CurlToolData;
  focused: boolean;
  onFieldChange: <K extends keyof CurlFormState>(
    field: K,
    value: CurlFormState[K],
  ) => void;
  onSelectField: (field: CurlFieldId) => void;
  onCycleMethod: (delta: -1 | 1) => void;
  onCycleBodyMode: () => void;
  onToggleAuthenticatedContext: () => void;
}

export function CurlForm({
  toolData,
  focused,
  onFieldChange,
  onSelectField,
  onCycleMethod,
  onCycleBodyMode,
  onToggleAuthenticatedContext,
}: CurlFormProps) {
  const selectedId = getCurlFieldOrder(
    toolData.authentication.isAvailable,
  )[toolData.selectedField];
  const methods: readonly CurlHttpMethod[] = [
    "GET",
    "HEAD",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ];

  return (
    <box flexDirection="column">
      <text fg={theme.text.dim}>
        Exact-origin request. TLS verified; redirects stay on the session origin.
      </text>
      <ChoiceRow
        label="Method"
        selected={selectedId === "method"}
        onMouseDown={() => {
          onSelectField("method");
          onCycleMethod(1);
        }}
      >
        {methods
          .map((method) => method === toolData.form.method ? `[${method}]` : method)
          .join("  ")}
      </ChoiceRow>
      <InputRow
        field="targetUrl"
        label="Target URL"
        placeholder="https://example.com/api/resource"
        value={toolData.form.targetUrl}
        selected={selectedId === "targetUrl"}
        focused={focused}
        onFieldChange={onFieldChange}
        onSelectField={onSelectField}
      />
      <TextareaRow
        field="headers"
        label="Headers"
        placeholder={'Accept: application/json\nX-Request-ID: manual-test'}
        value={toolData.form.headers}
        height={2}
        selected={selectedId === "headers"}
        focused={focused}
        onFieldChange={onFieldChange}
        onSelectField={onSelectField}
      />
      <ChoiceRow
        label="Body type"
        selected={selectedId === "bodyMode"}
        onMouseDown={() => {
          onSelectField("bodyMode");
          onCycleBodyMode();
        }}
      >
        {toolData.form.bodyMode === "text" ? "[Text]  JSON" : "Text  [JSON]"}
        <span fg={theme.text.dim}>  use left/right</span>
      </ChoiceRow>
      <TextareaRow
        field="body"
        label="Body"
        placeholder={
          toolData.form.bodyMode === "json"
            ? '{"key":"value"}'
            : "Request body (optional)"
        }
        value={toolData.form.body}
        height={3}
        selected={selectedId === "body"}
        focused={focused}
        onFieldChange={onFieldChange}
        onSelectField={onSelectField}
      />
      {toolData.authentication.isAvailable ? (
        <ChoiceRow
          label="Session auth"
          selected={selectedId === "useAuthenticatedContext"}
          onMouseDown={() => {
            onSelectField("useAuthenticatedContext");
            onToggleAuthenticatedContext();
          }}
        >
          {toolData.form.useAuthenticatedContext
            ? "[enabled]  disabled"
            : "enabled  [disabled]"}
          <span fg={theme.text.dim}>
            {`  use left/right  ${toolData.authentication.origin ?? ""}`}
          </span>
        </ChoiceRow>
      ) : null}
    </box>
  );
}

function ChoiceRow({
  label,
  selected,
  children,
  onMouseDown,
}: {
  label: string;
  selected: boolean;
  children: React.ReactNode;
  onMouseDown: () => void;
}) {
  return (
    <box flexDirection="row" width="100%" onMouseDown={onMouseDown}>
      <FieldLabel label={label} selected={selected} />
      <text fg={selected ? theme.text.primary : theme.text.secondary}>
        {children}
      </text>
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
  onSelectField,
}: {
  field: "targetUrl";
  label: string;
  placeholder: string;
  value: string;
  selected: boolean;
  focused: boolean;
  onFieldChange: CurlFormProps["onFieldChange"];
  onSelectField: (field: CurlFieldId) => void;
}) {
  return (
    <box
      flexDirection="row"
      width="100%"
      onMouseDown={() => onSelectField(field)}
    >
      <FieldLabel label={label} selected={selected} />
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

function TextareaRow({
  field,
  label,
  placeholder,
  value,
  height,
  selected,
  focused,
  onFieldChange,
  onSelectField,
}: {
  field: "headers" | "body";
  label: string;
  placeholder: string;
  value: string;
  height: number;
  selected: boolean;
  focused: boolean;
  onFieldChange: CurlFormProps["onFieldChange"];
  onSelectField: (field: CurlFieldId) => void;
}) {
  const textareaRef = useRef<TextareaRenderable | null>(null);

  return (
    <box
      flexDirection="row"
      width="100%"
      height={height}
      onMouseDown={() => onSelectField(field)}
    >
      <FieldLabel label={label} selected={selected} />
      <box flexGrow={1} minWidth={0} height={height}>
        <textarea
          ref={textareaRef}
          initialValue={value}
          width="100%"
          height="100%"
          placeholder={placeholder}
          focused={focused && selected}
          wrapMode="word"
          backgroundColor={theme.bg.input}
          textColor={theme.text.primary}
          focusedBackgroundColor={theme.bg.elevated}
          focusedTextColor={theme.text.primary}
          cursorColor={theme.accent.primary}
          onContentChange={() =>
            onFieldChange(field, textareaRef.current?.plainText ?? "")
          }
        />
      </box>
    </box>
  );
}

function FieldLabel({ label, selected }: { label: string; selected: boolean }) {
  return (
    <box width={18} flexShrink={0}>
      <text fg={selected ? theme.accent.primary : theme.text.secondary}>
        {selected ? `> ${label}` : `  ${label}`}
      </text>
    </box>
  );
}
