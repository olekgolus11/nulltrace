import { sessionDatabase } from "../../session/services/session-database";
import { ActionDraftRepository } from "./action-draft.repository";

export const actionDraftRepository = new ActionDraftRepository(sessionDatabase);
