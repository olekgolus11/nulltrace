import { UpsertSessionFindingCandidateInput } from "../model/session-finding.types";

export class SessionFindingRepository {
  upsertCandidates(_inputs: UpsertSessionFindingCandidateInput[]) {
    return [];
  }
}

export const sessionFindingRepository = new SessionFindingRepository();
