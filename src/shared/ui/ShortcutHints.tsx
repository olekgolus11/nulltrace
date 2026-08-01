import { theme } from "../../app/theme/theme";
import { ShortcutHint } from "./shortcut-hints.types";

interface ShortcutHintsProps {
  hasOmittedHints?: boolean;
  hints: ShortcutHint[];
}

export function ShortcutHints({ hasOmittedHints = false, hints }: ShortcutHintsProps) {
  return (
    <text fg={theme.text.dim}>
      {hints.map((hint, index) => (
        <span key={`${hint.key}-${hint.label}`}>
          {index > 0 ? " | " : ""}
          <span fg={theme.text.secondary}>
            <strong>{hint.key}</strong>
          </span>{" "}
          {hint.label}
        </span>
      ))}
      {hasOmittedHints ? (
        <span>{hints.length > 0 ? " | …" : "…"}</span>
      ) : null}
    </text>
  );
}
