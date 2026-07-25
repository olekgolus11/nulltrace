import { PageInspectionLimits } from "../model/page-inspection.types";

export const defaultPageInspectionLimits: PageInspectionLimits = {
  navigationTimeoutMs: 10_000,
  renderWaitTimeoutMs: 2_000,
  maxVisibleTextCharacters: 12_000,
  maxForms: 25,
  maxFormFields: 20,
  maxLinks: 50,
  maxScripts: 30,
  maxDomOutlineNodes: 80,
  maxMetadataEntries: 30,
  maxSerializedCharacters: 30_000,
};
