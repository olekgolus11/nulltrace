import {
  NiktoFieldId,
  NiktoProfile,
  NiktoTuningCode,
} from "../types/nikto.types";

export const niktoStandardFieldOrder = [
  "profile",
  "target",
  "rootPath",
  "vhost",
  "timeoutSeconds",
] as const satisfies readonly NiktoFieldId[];

export const niktoCustomTuning = [
  {
    code: "2",
    label: "Misconfiguration / defaults",
    shortLabel: "Defaults",
    isDisruptive: false,
  },
  {
    code: "3",
    label: "Information disclosure",
    shortLabel: "Info",
    isDisruptive: false,
  },
  {
    code: "6",
    label: "Denial of service",
    shortLabel: "DoS! CONFIRM",
    isDisruptive: true,
  },
  {
    code: "b",
    label: "Software identification",
    shortLabel: "Software",
    isDisruptive: false,
  },
] as const satisfies ReadonlyArray<{
  code: NiktoTuningCode;
  label: string;
  shortLabel: string;
  isDisruptive: boolean;
}>;

export const niktoCustomFieldOrder = [
  "profile",
  ...niktoCustomTuning.map(({ code }) => `tuning:${code}` as const),
  "target",
  "requestTimeoutSeconds",
  "pauseSeconds",
  "rootPath",
  "vhost",
  "timeoutSeconds",
] as const satisfies readonly NiktoFieldId[];

export const niktoDefaultTimeoutSeconds = 300;
export const niktoMaximumTimeoutSeconds = 900;
export const niktoDefaultRequestTimeoutSeconds = 10;
export const niktoMaximumRequestTimeoutSeconds = 60;
export const niktoMaximumPauseSeconds = 10;
export const niktoDefaultCustomTuning = [
  "2",
  "3",
  "b",
] as const satisfies readonly NiktoTuningCode[];

export function getNiktoFieldOrder(profile: NiktoProfile) {
  return profile === "custom" ? niktoCustomFieldOrder : niktoStandardFieldOrder;
}
