import { useCallback, useEffect, useState } from "react";
import {
  AuthenticatedRequestContextInput,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { authenticatedRequestContextService } from "../services/authenticated-request-context.service";
import { authCheckService } from "../services/auth-check.service";
import { authenticatedSitemapCrawlCoordinator } from "../../sitemap/services/authenticated-sitemap-crawl-coordinator.instance";

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function withAuthCheckMetadata(
  sessionId: string,
  metadata: AuthenticatedRequestContextMetadata | null,
) {
  return metadata
    ? {
        ...metadata,
        authCheck: authCheckService.getMetadata(sessionId),
      }
    : null;
}

export function useSessionAuthenticatedRequestContext(
  sessionId: string | null,
  targetId: string | null,
  targetUrl: string,
) {
  const [metadata, setMetadata] =
    useState<AuthenticatedRequestContextMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setMetadata(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      setMetadata(await authCheckService.getAuthContextMetadata(sessionId));
      setError(null);
    } catch (nextError) {
      setMetadata(null);
      setError(getReadableError(nextError));
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (input: AuthenticatedRequestContextInput) => {
      if (!sessionId) {
        return false;
      }

      setIsSaving(true);
      try {
        const nextMetadata = await authenticatedRequestContextService.save(
          sessionId,
          targetUrl,
          input,
        );
        setMetadata(withAuthCheckMetadata(sessionId, nextMetadata));
        setError(null);
        return true;
      } catch (nextError) {
        setError(getReadableError(nextError));
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [sessionId, targetUrl],
  );

  const clear = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setIsSaving(true);
    try {
      await authenticatedRequestContextService.clear(sessionId);
      setMetadata(null);
      setError(null);
    } catch (nextError) {
      setError(getReadableError(nextError));
    } finally {
      setIsSaving(false);
    }
  }, [sessionId]);

  const runAuthCheck = useCallback(
    async (verificationUrl: string) => {
      if (!sessionId || !metadata) {
        setError("Save an authentication context before running Auth Check.");
        return false;
      }

      setIsChecking(true);
      try {
        const authCheck = await authCheckService.run(
          sessionId,
          targetUrl,
          verificationUrl,
        );
        setMetadata((current) =>
          current ? { ...current, authCheck } : current,
        );
        if (authCheck.isProceedAllowed && targetId) {
          await authenticatedSitemapCrawlCoordinator.startAfterAcceptedAuthCheck({
            sessionId,
            targetId,
            rootUrl: targetUrl,
          });
        }
        setError(null);
        return true;
      } catch (nextError) {
        setMetadata((current) =>
          current
            ? {
                ...current,
                authCheck: authCheckService.getMetadata(sessionId),
              }
            : current,
        );
        setError(getReadableError(nextError));
        return false;
      } finally {
        setIsChecking(false);
      }
    },
    [metadata, sessionId, targetId, targetUrl],
  );

  const acknowledgeInconclusive = useCallback(() => {
    if (!sessionId || !metadata) {
      return false;
    }

    try {
      const authCheck = authCheckService.acknowledgeInconclusive(sessionId);
      setMetadata((current) =>
        current ? { ...current, authCheck } : current,
      );
      setError(null);
      if (targetId) {
        void authenticatedSitemapCrawlCoordinator.startAfterAcceptedAuthCheck({
          sessionId,
          targetId,
          rootUrl: targetUrl,
        });
      }
      return true;
    } catch (nextError) {
      setError(getReadableError(nextError));
      return false;
    }
  }, [metadata, sessionId, targetId, targetUrl]);

  return {
    metadata,
    isLoading,
    isSaving,
    isChecking,
    error,
    save,
    clear,
    runAuthCheck,
    acknowledgeInconclusive,
    refresh,
  };
}
