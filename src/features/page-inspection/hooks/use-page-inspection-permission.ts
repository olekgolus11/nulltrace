import { useCallback, useEffect, useState } from "react";
import { PageInspectionPermissionStatus } from "../model/page-inspection.types";
import { pageInspectionPermissionService } from "../services/page-inspection-permission.service";
import { authenticatedRequestContextService } from "../../authentication/services/authenticated-request-context.service";
import { pageInspectionAuthenticationSelectionService } from "../services/page-inspection-authentication-selection.service";
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
  const [isAuthenticationContextSelected, setIsAuthenticationContextSelected] = useState(false);

  const refresh = useCallback(() => {
    setStatus(readStatus());
  }, [readStatus]);

  useEffect(() => {
    refresh();
    setIsAuthenticationContextSelected(false);
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
    pageInspectionAuthenticationSelectionService.clear(sessionId);
    setIsAuthenticationContextSelected(false);
    refresh();
    await openCodeChatRuntimeService.refreshPageInspectionTools();
  }, [refresh, sessionId]);

  const selectAuthenticationContext = useCallback(async () => {
    if (!sessionId || status?.status !== "ready") {
      return;
    }
    pageInspectionAuthenticationSelectionService.select(
      sessionId,
      authenticatedRequestContextService.getAuthStateVersion(sessionId),
    );
    setIsAuthenticationContextSelected(true);
    await openCodeChatRuntimeService.refreshPageInspectionTools();
  }, [sessionId, status?.status]);

  const clearAuthenticationContextSelection = useCallback(() => {
    if (!sessionId) {
      return;
    }
    pageInspectionAuthenticationSelectionService.clear(sessionId);
    setIsAuthenticationContextSelected(false);
  }, [sessionId]);

  return {
    status,
    grant,
    revoke,
    isAuthenticationContextSelected,
    selectAuthenticationContext,
    clearAuthenticationContextSelection,
    refresh,
  };
}
