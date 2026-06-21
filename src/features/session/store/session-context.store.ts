import { create } from "zustand";
import { sessionConversationService } from "../../chat/services/session-conversation.service";
import { sessionRepository } from "../services/session.repository";
import { normalizeTargetUrl } from "../services/session-url";

interface SessionContextState {
  sessionId: string | null;
  targetId: string | null;
  targetUrl: string;
  activeConversationId: string | null;
  activeConversationTitle: string;
  conversationError: string | null;
  createSessionForTarget: (target: {
    id: string;
    normalizedUrl: string;
  }) => Promise<void>;
  createSessionForNewTarget: (url: string) => Promise<void>;
  openExistingSession: (sessionId: string) => Promise<boolean>;
}

const initialSessionContextState = {
  sessionId: null,
  targetId: null,
  targetUrl: "",
  activeConversationId: null,
  activeConversationTitle: "",
  conversationError: null,
};

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

let sessionOpenRequestToken = 0;

export const useSessionContextStore = create<SessionContextState>((set) => {
  const prepareActiveConversation = async (
    requestToken: number,
    sessionId: string,
  ) => {
    try {
      const conversation =
        await sessionConversationService.ensureActiveConversation(sessionId);

      if (requestToken !== sessionOpenRequestToken) {
        return;
      }

      set({
        activeConversationId: conversation.attachment.opencodeConversationId,
        activeConversationTitle: conversation.title,
        conversationError: null,
      });
    } catch (error) {
      if (requestToken !== sessionOpenRequestToken) {
        return;
      }

      set({
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: getReadableError(error),
      });
    }
  };

  return {
    ...initialSessionContextState,

    createSessionForTarget: async (target: {
      id: string;
      normalizedUrl: string;
    }) => {
      const session = sessionRepository.createSession(target.id);
      const requestToken = ++sessionOpenRequestToken;
      set({
        sessionId: session.id,
        targetId: target.id,
        targetUrl: target.normalizedUrl,
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: null,
      });
      void prepareActiveConversation(requestToken, session.id);
    },

    createSessionForNewTarget: async (url: string) => {
      const normalizedUrl = normalizeTargetUrl(url);
      const target = sessionRepository.findOrCreateTarget(normalizedUrl, url);
      const session = sessionRepository.createSession(target.id);
      const requestToken = ++sessionOpenRequestToken;
      set({
        sessionId: session.id,
        targetId: target.id,
        targetUrl: normalizedUrl,
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: null,
      });
      void prepareActiveConversation(requestToken, session.id);
    },

    openExistingSession: async (sessionId: string) => {
      const session = sessionRepository.getSessionById(sessionId);
      if (!session) {
        return false;
      }

      sessionRepository.touchSessionActivity(session.id);

      const requestToken = ++sessionOpenRequestToken;
      set({
        sessionId: session.id,
        targetId: session.targetId,
        targetUrl: session.normalizedUrl,
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: null,
      });
      void prepareActiveConversation(requestToken, session.id);
      return true;
    },
  };
});
