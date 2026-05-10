import { create } from "zustand";
import { SessionContextState } from "../model/session.types";
import { sessionRepository } from "../services/session.repository";
import { normalizeTargetUrl } from "../services/session-url";

const initialSessionContextState = {
  sessionId: null,
  targetId: null,
  targetUrl: "",
};

export const useSessionContextStore = create<SessionContextState>((set) => ({
  ...initialSessionContextState,

  createSessionForTarget: (target: { id: string; normalizedUrl: string }) => {
    const session = sessionRepository.createSession(target.id);
    set({
      sessionId: session.id,
      targetId: target.id,
      targetUrl: target.normalizedUrl,
    });
  },

  createSessionForNewTarget: (url: string) => {
    const normalizedUrl = normalizeTargetUrl(url);
    const target = sessionRepository.findOrCreateTarget(normalizedUrl, url);
    const session = sessionRepository.createSession(target.id);
    set({
      sessionId: session.id,
      targetId: target.id,
      targetUrl: normalizedUrl,
    });
  },

  openExistingSession: (sessionId: string) => {
    const session = sessionRepository.getSessionById(sessionId);
    if (!session) {
      return false;
    }

    sessionRepository.touchSessionActivity(session.id);

    set({
      sessionId: session.id,
      targetId: session.targetId,
      targetUrl: session.normalizedUrl,
    });
    return true;
  },
}));
