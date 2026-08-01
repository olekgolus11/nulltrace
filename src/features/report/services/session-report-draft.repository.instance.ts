import { sessionDatabase } from "../../session/services/session-database";
import { SessionReportDraftRepository } from "./session-report-draft.repository";

export const sessionReportDraftRepository = new SessionReportDraftRepository(sessionDatabase);
