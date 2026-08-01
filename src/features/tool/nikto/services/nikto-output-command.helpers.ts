import { quoteNiktoShellValue } from "./nikto-command.helpers";

const niktoOutputPattern =
  /\s+(?:-o|-output|-Format|-format)(?:\s+|=)(?:"[^"]*"|'[^']*'|\S+)/gi;

export function replaceNiktoOutputPath(command: string, outputPath: string) {
  const stripped = command.replace(niktoOutputPattern, " ").replace(/\s+/g, " ").trim();
  return `${stripped} -Format json -output ${quoteNiktoShellValue(outputPath)}`;
}
