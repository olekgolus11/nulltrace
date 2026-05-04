import { theme } from "../../app/theme/theme";
import { ShortcutHintsProps } from "./shortcut-hints.types";

export function ShortcutHints({ hints }: ShortcutHintsProps) {
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
    </text>
  );
}
