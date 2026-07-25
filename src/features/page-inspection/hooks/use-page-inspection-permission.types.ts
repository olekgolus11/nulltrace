import { PageInspectionPermissionStatus } from "../model/page-inspection.types";

export interface UsePageInspectionPermissionResult {
  status: PageInspectionPermissionStatus | null;
  grant: () => Promise<void>;
  revoke: () => Promise<void>;
  isAuthenticationContextSelected: boolean;
  selectAuthenticationContext: () => Promise<void>;
  clearAuthenticationContextSelection: () => void;
  refresh: () => void;
}
