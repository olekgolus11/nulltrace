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
  | "useAuthenticatedContext"
  | `tuning:${NiktoTuningCode}`;

export interface NiktoAuthenticationState {
  strategy: "none" | "session";
  isAvailable: boolean;
  origin: string | null;
}

export interface NiktoFormState extends Record<string, unknown> {
  target: string;
  rootPath: string;
  vhost: string;
  timeoutSeconds: string;
  requestTimeoutSeconds: string;
  pauseSeconds: string;
  profile: NiktoProfile;
  tuning: NiktoTuningCode[];
  useAuthenticatedContext: boolean;
}

export interface NiktoToolData extends ToolData {
  form: NiktoFormState;
  selectedField: number;
  authentication: NiktoAuthenticationState;
}
