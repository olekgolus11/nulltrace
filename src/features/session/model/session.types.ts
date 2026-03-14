export interface Session {
  url: string;
  date: string;
  vulns: number;
}

export interface SessionItemProps {
  session: Session;
  isSelected: boolean;
}

export interface SessionListProps {
  sessions: Session[];
  selectedIndex: number;
  title?: string;
  focused: boolean;
}
