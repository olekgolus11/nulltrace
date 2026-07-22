import { shellTokenPattern } from "./nuclei-shell.helpers";

const nucleiOutputFlagPattern = new RegExp(
  String.raw`\s+(?:(?:-jsonl|-json|-j|-sresp|-store-resp)(?=\s|$)|(?:-o|-output|-jle|-jsonl-export|-je|-json-export|-me|-markdown-export|-se|-sarif-export|-pe|-pdf-export|-rdb|-report-db|-srd|-store-resp-dir)(?:=|\s+)${shellTokenPattern})`,
  "g",
);
const nucleiNoColorFlagPattern = /(?:^|\s)-(?:nc|no-color)(?=\s|$)/;

export function stripNucleiOutputFlags(command: string) {
  return command.replace(nucleiOutputFlagPattern, " ");
}

export function hasNucleiNoColorFlag(command: string) {
  return nucleiNoColorFlagPattern.test(command);
}
