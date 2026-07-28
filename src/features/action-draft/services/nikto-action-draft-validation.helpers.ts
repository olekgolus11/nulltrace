import { niktoCustomTuning } from "../../tool/nikto/config/nikto.config";
import { assertNiktoCommand } from "../../tool/nikto/services/nikto-command.helpers";
import {
  NiktoProfile,
  NiktoTuningCode,
} from "../../tool/nikto/types/nikto.types";

export function getNiktoActionDraftValidationError(
  command: string | null,
  formState: Record<string, unknown> | null,
  currentProfile: NiktoProfile = "standard",
) {
  const prohibitedField = Object.keys(formState ?? {}).find((field) =>
    /mutat|evasion/i.test(field),
  );
  if (prohibitedField) {
    return "Nikto Action Drafts reject mutation and evasion options.";
  }
  const profile = formState?.profile;
  const effectiveProfile =
    profile === "standard" || profile === "custom" ? profile : currentProfile;
  if (formState?.tuning !== undefined && !getNiktoDraftTuning(formState.tuning)) {
    return "Nikto Action Draft tuning must use guided codes 2, 3, 6, or b.";
  }
  if (command) {
    try {
      assertNiktoCommand(command, effectiveProfile);
    } catch (error) {
      return error instanceof Error ? error.message : "Nikto Action Draft command is invalid.";
    }
  }
  return null;
}

export function getNiktoDraftTuning(value: unknown): NiktoTuningCode[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set<string>(niktoCustomTuning.map(({ code }) => code));
  if (!value.every((code) => typeof code === "string" && allowed.has(code))) {
    return null;
  }
  const selected = new Set(value as string[]);
  return niktoCustomTuning
    .map(({ code }) => code)
    .filter((code) => selected.has(code));
}
