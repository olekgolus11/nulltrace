import { sessionReportService } from "./session-report.service.instance";
import { OpenCodeSessionReportDraftProvider } from "./opencode-session-report-draft-provider.service";
import { sessionReportDraftRepository } from "./session-report-draft.repository.instance";
import { SessionReportDraftService } from "./session-report-draft.service";

const sessionReportDraftProvider = new OpenCodeSessionReportDraftProvider();

export const sessionReportDraftService = new SessionReportDraftService(
  sessionReportService,
  sessionReportDraftProvider,
  sessionReportDraftRepository,
);
