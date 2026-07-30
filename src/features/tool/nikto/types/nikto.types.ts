import { ToolData } from "../../shared/types/tool-screen.types";

export type NiktoFieldId = "target" | "rootPath" | "vhost" | "timeoutSeconds";

export interface NiktoFormState extends Record<string, unknown> {
  target: string;
  rootPath: string;
  vhost: string;
  timeoutSeconds: string;
  profile: "standard";
}

export interface NiktoToolData extends ToolData {
  form: NiktoFormState;
  selectedField: number;
}
