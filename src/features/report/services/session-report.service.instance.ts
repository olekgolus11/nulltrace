import { findingRepository } from "../../finding/services/finding.repository";
import { sessionRepository } from "../../session/services/session.repository";
import { SessionReportFileWriter } from "../model/session-report.types";
import { writeSessionReportFile } from "./session-report-file-writer.helpers";
import { SessionReportService } from "./session-report.service";

const sessionReportFileWriter: SessionReportFileWriter = {
  write: writeSessionReportFile,
};

export const sessionReportService = new SessionReportService(
  sessionRepository,
  findingRepository,
  sessionReportFileWriter,
);
