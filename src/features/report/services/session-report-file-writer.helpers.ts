import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeSessionReportFile(
  outputPath: string,
  markdown: string,
) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf8");
}
