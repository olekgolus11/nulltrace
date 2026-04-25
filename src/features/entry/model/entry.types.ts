import { TargetSummary } from "../../session/model/session.types";

export interface EntryScreenProps {
  onStartPentest: (url: string) => void;
  onOpenSession: (sessionId: string) => void;
  onCreateSessionFromTarget: (target: TargetSummary) => void;
}

export interface UseEntryShortcutsProps {
  targets: TargetSummary[];
  onStartPentest: (targetUrl: string) => void;
  onOpenSession: (sessionId: string) => void;
  onCreateSessionFromTarget: (target: TargetSummary) => void;
}
