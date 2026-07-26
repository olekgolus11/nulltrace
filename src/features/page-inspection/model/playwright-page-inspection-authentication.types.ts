export interface PlaywrightPageInspectionCookie {
  name: string;
  value: string;
  url: string;
}

export interface PlaywrightPageInspectionAuthentication {
  cookies: PlaywrightPageInspectionCookie[];
  headers: Record<string, string>;
}
