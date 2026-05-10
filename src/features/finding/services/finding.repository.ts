import { UpsertFindingCandidateInput } from "../model/finding.types";

export class FindingRepository {
  upsertCandidates(_inputs: UpsertFindingCandidateInput[]) {
    return [];
  }
}

export const findingRepository = new FindingRepository();
