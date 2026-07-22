import { useEffect, useState } from "react";
import { FindingReviewStatus, SessionFindingRecord } from "../model/finding.types";
import { findingRepository } from "../services/finding.repository";
import { FindingSummaryProps } from "../model/finding-summary.types";

function createEmptyCounts(): FindingSummaryProps {
  return {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: 0,
  };
}

function countFindings(findings: SessionFindingRecord[]): FindingSummaryProps {
  return findings.reduce<FindingSummaryProps>((counts, finding) => {
    counts[finding.severity] += 1;
    counts.total += 1;
    return counts;
  }, createEmptyCounts());
}

export function useSessionFindings(sessionId: string | null, refreshKey = "") {
  const [findings, setFindings] = useState<SessionFindingRecord[]>([]);

  useEffect(() => {
    if (!sessionId) {
      setFindings([]);
      return;
    }

    setFindings(findingRepository.listBySessionId(sessionId));
  }, [refreshKey, sessionId]);

  const setReviewStatus = (findingId: string, reviewStatus: FindingReviewStatus) => {
    const updatedFinding = findingRepository.setReviewStatus({
      findingId,
      reviewStatus,
    });

    if (!updatedFinding) {
      return;
    }

    setFindings((currentFindings) =>
      currentFindings.map((finding) => (finding.id === findingId ? updatedFinding : finding)),
    );
  };

  return {
    findings,
    counts: countFindings(findings),
    setReviewStatus,
  };
}
