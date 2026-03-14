export interface EntryScreenProps {
  onStartPentest: (url: string) => void;
}

export interface UseEntryShortcutsProps {
  sessions: { url: string; date: string; vulns: number }[];
  onStartPentest: (targetUrl: string) => void;
}
