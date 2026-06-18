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

export const useSessionContextStore = create<SessionContextState>((set) => ({
  ...initialSessionContextState,

  createSessionForTarget: async (target: {
    id: string;
    normalizedUrl: string;
  }) => {
    const session = sessionRepository.createSession(target.id);

    try {
      const conversation =
        await sessionConversationService.ensureActiveConversation(session.id);

      set({
        sessionId: session.id,
        targetId: target.id,
        targetUrl: target.normalizedUrl,
        activeConversationId: conversation.attachment.opencodeConversationId,
        activeConversationTitle: conversation.title,
        conversationError: null,
      });
    } catch (error) {
      set({
        sessionId: session.id,
        targetId: target.id,
        targetUrl: target.normalizedUrl,
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: getReadableError(error),
      });
    }
  },

  createSessionForNewTarget: async (url: string) => {
    const normalizedUrl = normalizeTargetUrl(url);
    const target = sessionRepository.findOrCreateTarget(normalizedUrl, url);
    const session = sessionRepository.createSession(target.id);
    const requestToken = ++sessionOpenRequestToken;

    try {
      const conversation =
        await sessionConversationService.ensureActiveConversation(session.id);

      if (requestToken !== sessionOpenRequestToken) {
        return;
      }

      set({
        sessionId: session.id,
        targetId: target.id,
        targetUrl: normalizedUrl,
        activeConversationId: conversation.attachment.opencodeConversationId,
        activeConversationTitle: conversation.title,
        conversationError: null,
      });
    } catch (error) {
      if (requestToken !== sessionOpenRequestToken) {
        return;
      }

      set({
        sessionId: session.id,
        targetId: target.id,
        targetUrl: normalizedUrl,
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: getReadableError(error),
      });
    }
  },

  openExistingSession: async (sessionId: string) => {
    const session = sessionRepository.getSessionById(sessionId);
    if (!session) {
      return false;
    }

    sessionRepository.touchSessionActivity(session.id);

    try {
      const conversation =
        await sessionConversationService.ensureActiveConversation(session.id);

      set({
        sessionId: session.id,
        targetId: session.targetId,
        targetUrl: session.normalizedUrl,
        activeConversationId: conversation.attachment.opencodeConversationId,
        activeConversationTitle: conversation.title,
        conversationError: null,
      });
      return true;
    } catch (error) {
      set({
        sessionId: session.id,
        targetId: session.targetId,
        targetUrl: session.normalizedUrl,
        activeConversationId: null,
        activeConversationTitle: "",
        conversationError: getReadableError(error),
      });
      return true;
    }
  },
}));
