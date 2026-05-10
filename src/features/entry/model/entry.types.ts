import { TargetSummary } from "../../session/model/session.types";

export interface EntryScreenProps {
  onStartPentestForNewTarget: (url: string) => void;
  onStartPentestForExistingTarget: (target: TargetSummary) => void;
  onOpenSession: (sessionId: string) => void;
}

export interface UseEntryShortcutsProps {
  targets: TargetSummary[];
  onStartPentestForNewTarget: (targetUrl: string) => void;
  onOpenSession: (sessionId: string) => void;
  onStartPentestForExistingTarget: (target: TargetSummary) => void;
}
