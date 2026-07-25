import { PageInspectionAuthenticationMode } from "../../page-inspection/model/page-inspection.types";

export interface InspectPageArgs {
  url: string;
  authenticationMode?: PageInspectionAuthenticationMode;
}
