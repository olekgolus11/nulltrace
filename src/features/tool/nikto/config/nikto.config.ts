import { NiktoFieldId } from "../types/nikto.types";

export const niktoFieldOrder: NiktoFieldId[] = [
  "target",
  "rootPath",
  "vhost",
  "timeoutSeconds",
];

export const niktoDefaultTimeoutSeconds = 300;
export const niktoMaximumTimeoutSeconds = 900;
