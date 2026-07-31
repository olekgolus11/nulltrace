import { ToolData } from "../../shared/types/tool-screen.types";

export type NiktoProfile = "standard" | "custom";

export type NiktoTuningCode = "2" | "3" | "6" | "b";

export type NiktoFieldId =
  | "profile"
  | "target"
  | "rootPath"
  | "vhost"
  | "timeoutSeconds"
  | "requestTimeoutSeconds"
  | "pauseSeconds"
  | `tuning:${NiktoTuningCode}`;

export interface NiktoFormState extends Record<string, unknown> {
  target: string;
  rootPath: string;
  vhost: string;
  timeoutSeconds: string;
  requestTimeoutSeconds: string;
  pauseSeconds: string;
  profile: NiktoProfile;
  tuning: NiktoTuningCode[];
}

export interface NiktoToolData extends ToolData {
  form: NiktoFormState;
  selectedField: number;
}
