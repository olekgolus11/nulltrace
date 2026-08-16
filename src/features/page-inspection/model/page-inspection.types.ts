export type PageInspectionStatus = "blocked" | "ready" | "browser_missing";
export type PageInspectionAllowedMode = "public" | "authenticated";
export type PageInspectionPermissionMode = "none" | PageInspectionAllowedMode;
export type PageInspectionAuthenticationOutcome =
  | "unauthorized"
  | "forbidden"
  | "login_redirect"
  | null;

export interface PageInspectionPermissionStatus {
  isAllowed: boolean;
  mode: PageInspectionPermissionMode;
  status: PageInspectionStatus;
}

export interface PageInspectionPermissionDependencies {
  isChromiumAvailable: () => boolean;
}

export interface PageInspectionLimits {
  navigationTimeoutMs: number;
  renderWaitTimeoutMs: number;
  maxVisibleTextCharacters: number;
  maxForms: number;
  maxFormFields: number;
  maxLinks: number;
  maxScripts: number;
  maxDomOutlineNodes: number;
  maxMetadataEntries: number;
  maxSerializedCharacters: number;
}

export interface PageInspectionRequestPolicyInput {
  isMainFrame: boolean;
  method: string;
  resourceType: string;
  targetOrigin: string;
  url: string;
}

export interface PageInspectionInput {
  requestedUrl: string;
  targetOrigin: string;
  authentication?: PageInspectionAuthentication;
}

export interface PageInspectionRequest {
  sessionId: string;
  requestedUrl: string;
  targetOrigin: string;
  protectedPaths?: string[];
}

export interface PageInspectionAuthentication {
  origin: string;
  cookies: string;
  headers: string;
  browserStorage?: {
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
  };
}

export interface PageInspectionFormField {
  name: string | null;
  type: string;
  isRequired: boolean;
}

export interface PageInspectionForm {
  method: string;
  action: string | null;
  fields: PageInspectionFormField[];
}

export interface PageInspectionLink {
  url: string;
  text: string;
}

export interface PageInspectionScript {
  src: string | null;
  type: string | null;
}

export interface PageInspectionDomNode {
  tag: string;
  id: string | null;
  role: string | null;
  name: string | null;
  heading: string | null;
  depth: number;
}

export interface PageInspectionMetadataEntry {
  name: string;
  content: string;
}

export interface PageInspectionSecuritySignals {
  contentSecurityPolicy: string | null;
  frameOptions: string | null;
  referrerPolicy: string | null;
  permissionsPolicy: string | null;
  hasPasswordFields: boolean;
}

export type PageInspectionTruncatedSection =
  | "visible_text"
  | "forms"
  | "form_fields"
  | "links"
  | "scripts"
  | "dom_outline"
  | "metadata"
  | "serialized_result"
  | "render_wait"
  | "protected_paths";

export interface PageInspectionSnapshot {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  contentType: string | null;
  title: string;
  visibleText: string;
  forms: PageInspectionForm[];
  links: PageInspectionLink[];
  scripts: PageInspectionScript[];
  domOutline: PageInspectionDomNode[];
  metadata: PageInspectionMetadataEntry[];
  securitySignals: PageInspectionSecuritySignals;
  isPartial: boolean;
  truncatedSections: PageInspectionTruncatedSection[];
}

export interface PageInspectionBrowser {
  inspect(input: PageInspectionInput, limits: PageInspectionLimits): Promise<PageInspectionSnapshot>;
}
