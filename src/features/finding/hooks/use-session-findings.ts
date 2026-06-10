import { useEffect, useState } from "react";
import { SessionFindingRecord } from "../model/finding.types";
import { findingRepository } from "../services/finding.repository";
import { VulnerabilitySummaryProps } from "../../vulnerability/model/vulnerability.types";

function createEmptyCounts(): VulnerabilitySummaryProps {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: 0,
  };
}

function countFindings(
  findings: SessionFindingRecord[],
): VulnerabilitySummaryProps {
  return findings.reduce<VulnerabilitySummaryProps>((counts, finding) => {
    counts[finding.severity] += 1;
    counts.total += 1;
    return counts;
  }, createEmptyCounts());
}

export function useSessionFindings(
  sessionId: string | null,
  refreshKey = "",
) {
  const [findings, setFindings] = useState<SessionFindingRecord[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setFindings([]);
      return;
    }

    setFindings(findingRepository.listBySessionId(sessionId));
  }, [refreshKey, sessionId]);

  return {
    findings,
    counts: countFindings(findings),
  };
}
