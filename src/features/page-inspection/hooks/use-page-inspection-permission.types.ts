import { PageInspectionPermissionStatus } from "../model/page-inspection.types";

export interface UsePageInspectionPermissionResult {
  status: PageInspectionPermissionStatus | null;
  grant: () => Promise<void>;
  revoke: () => Promise<void>;
  refresh: () => void;
}
