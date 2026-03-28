import { create } from "zustand";
import { SessionContextState } from "../model/session.types";

const initialSessionContextState = {
  sessionId: null,
  targetId: null,
  targetUrl: "",
};

export const useSessionContextStore = create<SessionContextState>((set) => ({
  ...initialSessionContextState,

  setCurrentSession: (context) =>
    set({
      sessionId: context.sessionId,
      targetId: context.targetId,
      targetUrl: context.targetUrl,
    }),

  clearCurrentSession: () => set(initialSessionContextState),
}));
