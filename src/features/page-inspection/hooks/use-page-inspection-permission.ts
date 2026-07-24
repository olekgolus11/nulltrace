import { useCallback, useEffect, useState } from "react";
import { PageInspectionPermissionStatus } from "../model/page-inspection.types";
import { pageInspectionPermissionService } from "../services/page-inspection-permission.service";
import { openCodeChatRuntimeService } from "../../chat/services/opencode-chat-runtime.service";
import { UsePageInspectionPermissionResult } from "./use-page-inspection-permission.types";

export function usePageInspectionPermission(
  sessionId: string | null,
): UsePageInspectionPermissionResult {
  const readStatus = useCallback(
    () => (sessionId ? pageInspectionPermissionService.getStatus(sessionId) : null),
    [sessionId],
  );
  const [status, setStatus] = useState<PageInspectionPermissionStatus | null>(readStatus);

  const refresh = useCallback(() => {
    setStatus(readStatus());
  }, [readStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const grant = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    pageInspectionPermissionService.grant(sessionId);
    refresh();
    await openCodeChatRuntimeService.refreshPageInspectionTools();
  }, [refresh, sessionId]);

  const revoke = useCallback(async () => {
    if (!sessionId) {
      return;
    }
    pageInspectionPermissionService.revoke(sessionId);
    refresh();
    await openCodeChatRuntimeService.refreshPageInspectionTools();
  }, [refresh, sessionId]);

  return { status, grant, revoke, refresh };
}
