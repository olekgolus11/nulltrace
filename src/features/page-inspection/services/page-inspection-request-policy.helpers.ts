import { PageInspectionRequestPolicyInput } from "../model/page-inspection.types";

const allowedCrossOriginResourceTypes = new Set(["script", "stylesheet", "font", "image"]);

export function getPageInspectionRequestDecision(input: PageInspectionRequestPolicyInput) {
  if (input.method !== "GET" && input.method !== "HEAD") {
    return "block";
  }

  if (input.resourceType === "document" && !input.isMainFrame) {
    return "block";
  }

  if (new URL(input.url).origin === input.targetOrigin) {
    return "allow";
  }

  return allowedCrossOriginResourceTypes.has(input.resourceType) ? "allow" : "block";
}
