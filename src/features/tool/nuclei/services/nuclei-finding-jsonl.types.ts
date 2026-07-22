export interface NucleiRawFinding {
  [key: string]: unknown;
}

export interface NucleiArtifactFinding {
  templateId: string | null;
  name: string | null;
  severity: string | null;
  matchedAt: string | null;
  type: string | null;
  tags: string[];
  description: string | null;
  references: string[];
  raw: NucleiRawFinding;
}

export interface ParsedNucleiJsonl {
  findings: NucleiArtifactFinding[];
  parseErrorCount: number;
}
