import { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import { theme } from "../../../app/theme/theme";
import { SessionSidebarRow } from "../model/session.types";
import { SessionItem } from "./SessionItem";
import { SessionTargetItem } from "./SessionTargetItem";

interface SessionListProps {
  rows: SessionSidebarRow[];
  selectedIndex: number;
  title?: string;
  focused: boolean;
}

function getSummaryCounts(rows: SessionSidebarRow[]) {
  return rows.reduce(
    (summary, row) => {
      if (row.type === "target") {
        summary.targetCount += 1;
      }
      if (row.type === "session") {
        summary.sessionCount += 1;
      }
      return summary;
    },
    { targetCount: 0, sessionCount: 0 },
  );
}

export function SessionList({
  rows,
  selectedIndex,
  title = "Previous Sessions",
  focused,
}: SessionListProps) {
  const summary = getSummaryCounts(rows);
  const rowsScrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    const scrollbox = rowsScrollRef.current;
    const selectedRow = scrollbox?.content.getChildren()[selectedIndex];
    if (!scrollbox || !selectedRow) {
      return;
    }

    const viewportTop = scrollbox.viewport.y;
    const viewportBottom = viewportTop + scrollbox.viewport.height;
    const selectedTop = selectedRow.y;
    const selectedBottom = selectedTop + selectedRow.height;

    if (selectedTop < viewportTop) {
      scrollbox.scrollBy(selectedTop - viewportTop, "step");
    } else if (selectedBottom > viewportBottom) {
      scrollbox.scrollBy(selectedBottom - viewportBottom, "step");
    }
  }, [rows.length, selectedIndex]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box marginBottom={1} flexDirection="column">
        <text fg={theme.accent.primary}>
          <strong>◆ {title}</strong>
        </text>
      </box>

      <scrollbox
        ref={rowsScrollRef}
        flexGrow={1}
        scrollX={false}
        scrollY={true}
        stickyScroll={false}
      >
        {rows.map((row, index) =>
          row.type === "target" ? (
            <SessionTargetItem
              key={row.id}
              target={row.target}
              isExpanded={row.isExpanded}
              isSelected={index === selectedIndex && focused}
            />
          ) : (
            <SessionItem
              key={row.id}
              session={row.session}
              isSelected={index === selectedIndex && focused}
              isCurrent={row.isCurrent}
              isLatest={row.isLatest}
            />
          ),
        )}
      </scrollbox>

      <box>
        <text fg={theme.text.dim}>{summary.targetCount} targets</text>
      </box>
    </box>
  );
}
