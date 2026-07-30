import { join } from "node:path";
import { getAppDataDirectory } from "../../session/services/session-database";

export function createDefaultSessionReportPath(sessionId: string) {
  return join(getAppDataDirectory(), "reports", `session-${sessionId}.md`);
}
