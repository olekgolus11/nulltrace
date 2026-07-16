import { theme } from "../../../app/theme/theme";
import { ActionDraftRecord } from "../model/action-draft.types";

interface ActionDraftListProps {
  drafts: ActionDraftRecord[];
  emptyLabel: string;
  focused?: boolean;
  selectedDraftId?: string | null;
  onApplyDraft?: (draft: ActionDraftRecord) => void;
}

function getStatusColor(status: ActionDraftRecord["status"]) {
  switch (status) {
    case "draft":
      return theme.accent.primary;
    case "applied":
      return theme.accent.low;
    case "dismissed":
      return theme.text.dim;
    case "superseded":
      return theme.accent.warning;
  }
}

export function ActionDraftList({
  drafts,
  emptyLabel,
  focused = false,
  selectedDraftId = null,
  onApplyDraft,
}: ActionDraftListProps) {
  if (drafts.length === 0) {
    return (
      <box flexDirection="column">
        <text fg={theme.text.dim}>{emptyLabel}</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" gap={0}>
      {drafts.map((draft, index) => {
        const isSelected = draft.id === selectedDraftId;

        return (
          <box
            key={draft.id}
            flexDirection="column"
            marginBottom={1}
            onMouseDown={() => onApplyDraft?.(draft)}
          >
            <box flexDirection="row">
              <box width={4}>
                <text fg={focused && isSelected ? theme.accent.primary : theme.text.dim}>
                  {focused && isSelected ? ">" : `${index + 1}.`}
                </text>
              </box>
              <box flexGrow={1}>
                <text fg={focused && isSelected ? theme.accent.primary : theme.text.primary}>
                  {draft.title}
                </text>
              </box>
              <text fg={getStatusColor(draft.status)}>{draft.status}</text>
            </box>
          </box>
        );
      })}
    </box>
  );
}
