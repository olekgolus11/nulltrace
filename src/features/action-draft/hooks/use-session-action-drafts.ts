import { useCallback, useEffect, useState } from "react";
import { ActionDraftRecord } from "../model/action-draft.types";
import { actionDraftRepository } from "../services/action-draft.repository.instance";

export function useSessionActionDrafts(sessionId: string | null) {
  const [drafts, setDrafts] = useState<ActionDraftRecord[]>([]);

  const refreshDrafts = useCallback(() => {
    if (!sessionId) {
      setDrafts([]);
      return;
    }

    setDrafts(actionDraftRepository.listBySessionId(sessionId));
  }, [sessionId]);

  useEffect(() => {
    refreshDrafts();
  }, [refreshDrafts]);

  return {
    drafts,
    refreshDrafts,
  };
}
