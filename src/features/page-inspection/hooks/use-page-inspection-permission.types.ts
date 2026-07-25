import { PageInspectionPermissionStatus } from "../model/page-inspection.types";

export interface UsePageInspectionPermissionResult {
  status: PageInspectionPermissionStatus | null;
  allowPublic: () => Promise<void>;
  allowAuthenticated: () => Promise<void>;
  revoke: () => Promise<void>;
  refresh: () => void;
}
