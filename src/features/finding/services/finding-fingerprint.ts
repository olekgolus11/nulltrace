import { createHash } from "node:crypto";

export function createFindingFingerprint(sourceTool: string, kind: string, keyParts: string[]) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceTool,
        kind,
        keyParts,
      }),
    )
    .digest("hex");
}
