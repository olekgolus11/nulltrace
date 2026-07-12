import { useCallback, useEffect, useState } from "react";
import {
  AuthenticatedRequestContextInput,
  AuthenticatedRequestContextMetadata,
} from "../model/authenticated-request-context.types";
import { authenticatedRequestContextService } from "../services/authenticated-request-context.service";

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useSessionAuthenticatedRequestContext(
  sessionId: string | null,
  targetUrl: string,
) {
  const [metadata, setMetadata] =
    useState<AuthenticatedRequestContextMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setMetadata(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      setMetadata(await authenticatedRequestContextService.getMetadata(sessionId));
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
        setMetadata(nextMetadata);
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

  return {
    metadata,
    isLoading,
    isSaving,
    error,
    save,
    clear,
    refresh,
  };
}
