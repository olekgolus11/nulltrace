import { create } from "zustand";
import {
  ActiveSessionConversation,
  sessionConversationService,
} from "../../chat/services/session-conversation.service";
import { sessionRepository } from "../services/session.repository";
import { normalizeTargetUrl } from "../services/session-url";
import { sitemapCrawlCoordinator } from "../../sitemap/services/sitemap-crawl-coordinator.instance";

interface SessionContextState {
  sessionId: string | null;
  targetId: string | null;
  targetUrl: string;
  activeConversationId: string | null;
  activeConversationTitle: string;
  conversations: ActiveSessionConversation[];
  isLoadingConversations: boolean;
  isCreatingConversation: boolean;
  isArchivingConversation: boolean;
  conversationError: string | null;
  selectConversation: (conversationId: string) => void;
  createConversation: () => Promise<void>;
  archiveActiveConversation: () => Promise<void>;
  refreshConversationTitles: () => Promise<void>;
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
  conversations: [],
  isLoadingConversations: false,
  isCreatingConversation: false,
  isArchivingConversation: false,
  conversationError: null,
};

function getReadableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

let sessionOpenRequestToken = 0;

export const useSessionContextStore = create<SessionContextState>((set, get) => {
  const ensureTargetSitemapCrawl = (targetId: string, rootUrl: string) => {
    sitemapCrawlCoordinator.ensureTargetCrawl({
      targetId,
      rootUrl,
    });
  };

  const prepareActiveConversation = async (
    requestToken: number,
    sessionId: string,
  ) => {
    try {
      const conversations =
        await sessionConversationService.prepareSessionConversations(sessionId);

      if (requestToken !== sessionOpenRequestToken) {
        return;
      }

      const [conversation] = conversations;
      set({
        activeConversationId:
          conversation?.attachment.opencodeConversationId ?? null,
        activeConversationTitle: conversation?.title ?? "",
        conversations,
        isLoadingConversations: false,
        conversationError: null,
      });
    } catch (error) {
      if (requestToken !== sessionOpenRequestToken) {
        return;
      }

      set({
        activeConversationId: null,
        activeConversationTitle: "",
        conversations: [],
        isLoadingConversations: false,
        conversationError: getReadableError(error),
      });
    }
  };

  return {
    ...initialSessionContextState,

    selectConversation: (conversationId: string) => {
      const conversation = get().conversations.find(
        (candidate) =>
          candidate.attachment.opencodeConversationId === conversationId,
      );
      if (!conversation) {
        return;
      }

      set({
        activeConversationId: conversationId,
        activeConversationTitle: conversation.title,
      });
    },

    createConversation: async () => {
      const { sessionId } = get();
      if (!sessionId || get().isCreatingConversation) {
        return;
      }

      const requestToken = sessionOpenRequestToken;
      set({ isCreatingConversation: true, conversationError: null });
      try {
        const conversation =
          await sessionConversationService.createConversation(sessionId);
        if (requestToken !== sessionOpenRequestToken) {
          return;
        }

        set((state) => ({
          conversations: [...state.conversations, conversation],
          activeConversationId:
            conversation.attachment.opencodeConversationId,
          activeConversationTitle: conversation.title,
        }));
      } catch (error) {
        if (requestToken === sessionOpenRequestToken) {
          set({ conversationError: getReadableError(error) });
        }
      } finally {
        if (requestToken === sessionOpenRequestToken) {
          set({ isCreatingConversation: false });
        }
      }
    },

    archiveActiveConversation: async () => {
      const {
        conversations: currentConversations,
        sessionId,
        activeConversationId,
      } = get();
      if (
        !sessionId ||
        !activeConversationId ||
        get().isArchivingConversation
      ) {
        return;
      }

      const archivedIndex = currentConversations.findIndex(
        (conversation) =>
          conversation.attachment.opencodeConversationId ===
          activeConversationId,
      );
      const requestToken = sessionOpenRequestToken;
      set({ isArchivingConversation: true, conversationError: null });
      try {
        const conversations =
          await sessionConversationService.archiveConversation(
            sessionId,
            activeConversationId,
          );
        if (requestToken !== sessionOpenRequestToken) {
          return;
        }

        const fallbackIndex =
          archivedIndex === -1
            ? 0
            : Math.min(archivedIndex, Math.max(0, conversations.length - 1));
        const fallbackConversation = conversations[fallbackIndex];
        set({
          conversations,
          activeConversationId:
            fallbackConversation?.attachment.opencodeConversationId ?? null,
          activeConversationTitle: fallbackConversation?.title ?? "",
        });
      } catch (error) {
        if (requestToken === sessionOpenRequestToken) {
          set({ conversationError: getReadableError(error) });
        }
      } finally {
        if (requestToken === sessionOpenRequestToken) {
          set({ isArchivingConversation: false });
        }
      }
    },

    refreshConversationTitles: async () => {
      const { sessionId, activeConversationId } = get();
      if (!sessionId || get().isLoadingConversations) {
        return;
      }

      const requestToken = sessionOpenRequestToken;
      set({ isLoadingConversations: true });
      try {
        const conversations =
          await sessionConversationService.prepareSessionConversations(sessionId);
        if (requestToken !== sessionOpenRequestToken) {
          return;
        }

        const activeConversation = conversations.find(
          (conversation) =>
            conversation.attachment.opencodeConversationId ===
            activeConversationId,
        );
        const fallbackConversation = activeConversation ?? conversations[0];
        set({
          conversations,
          activeConversationId:
            fallbackConversation?.attachment.opencodeConversationId ?? null,
          activeConversationTitle: fallbackConversation?.title ?? "",
          isLoadingConversations: false,
          conversationError: null,
        });
      } catch (error) {
        if (requestToken === sessionOpenRequestToken) {
          set({
            isLoadingConversations: false,
            conversationError: getReadableError(error),
          });
        }
      }
    },

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
        conversations: [],
        isLoadingConversations: true,
        isCreatingConversation: false,
        isArchivingConversation: false,
        conversationError: null,
      });
      ensureTargetSitemapCrawl(target.id, target.normalizedUrl);
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
        conversations: [],
        isLoadingConversations: true,
        isCreatingConversation: false,
        isArchivingConversation: false,
        conversationError: null,
      });
      ensureTargetSitemapCrawl(target.id, normalizedUrl);
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
        conversations: [],
        isLoadingConversations: true,
        isCreatingConversation: false,
        isArchivingConversation: false,
        conversationError: null,
      });
      ensureTargetSitemapCrawl(session.targetId, session.normalizedUrl);
      void prepareActiveConversation(requestToken, session.id);
      return true;
    },
  };
});
