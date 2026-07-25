import {
  PageInspectionLimits,
  PageInspectionSnapshot,
  PageInspectionTruncatedSection,
} from "../model/page-inspection.types";
import { isPageInspectionProtectedUrl } from "./page-inspection-protected-path.helpers";

export function excludePageInspectionProtectedPaths(
  snapshot: PageInspectionSnapshot,
  targetOrigin: string,
  protectedPaths: string[],
): PageInspectionSnapshot {
  if (protectedPaths.length === 0) {
    return snapshot;
  }

  const forms = snapshot.forms.filter(
    (form) =>
      !form.action || !isPageInspectionProtectedUrl(form.action, targetOrigin, protectedPaths),
  );
  const links = snapshot.links.filter(
    (link) => !isPageInspectionProtectedUrl(link.url, targetOrigin, protectedPaths),
  );
  const scripts = snapshot.scripts.filter(
    (script) =>
      !script.src || !isPageInspectionProtectedUrl(script.src, targetOrigin, protectedPaths),
  );
  const hasExcludedPaths =
    forms.length !== snapshot.forms.length ||
    links.length !== snapshot.links.length ||
    scripts.length !== snapshot.scripts.length;
  if (!hasExcludedPaths) {
    return snapshot;
  }

  return {
    ...snapshot,
    forms,
    links,
    scripts,
    isPartial: true,
    truncatedSections: [
      ...new Set<PageInspectionTruncatedSection>([
        ...snapshot.truncatedSections,
        "protected_paths",
      ]),
    ],
  };
}

export function applyPageInspectionBounds(
  snapshot: PageInspectionSnapshot,
  limits: PageInspectionLimits,
): PageInspectionSnapshot {
  const truncatedSections = new Set<PageInspectionTruncatedSection>(snapshot.truncatedSections);
  const visibleText = truncateText(
    snapshot.visibleText,
    limits.maxVisibleTextCharacters,
    "visible_text",
    truncatedSections,
  );
  const forms = snapshot.forms.slice(0, limits.maxForms).map((form) => ({
    ...form,
    fields: form.fields.slice(0, limits.maxFormFields),
  }));
  if (snapshot.forms.length > forms.length) {
    truncatedSections.add("forms");
  }
  if (snapshot.forms.some((form) => form.fields.length > limits.maxFormFields)) {
    truncatedSections.add("form_fields");
  }

  const bounded = {
    ...snapshot,
    visibleText,
    forms,
    links: snapshot.links.slice(0, limits.maxLinks),
    scripts: snapshot.scripts.slice(0, limits.maxScripts),
    domOutline: snapshot.domOutline.slice(0, limits.maxDomOutlineNodes),
    metadata: snapshot.metadata.slice(0, limits.maxMetadataEntries),
    isPartial: false,
    truncatedSections: [],
  };
  if (snapshot.links.length > bounded.links.length) {
    truncatedSections.add("links");
  }
  if (snapshot.scripts.length > bounded.scripts.length) {
    truncatedSections.add("scripts");
  }
  if (snapshot.domOutline.length > bounded.domOutline.length) {
    truncatedSections.add("dom_outline");
  }
  if (snapshot.metadata.length > bounded.metadata.length) {
    truncatedSections.add("metadata");
  }

  let result = {
    ...bounded,
    isPartial: truncatedSections.size > 0,
    truncatedSections: [...truncatedSections],
  };
  if (JSON.stringify(result).length > limits.maxSerializedCharacters) {
    truncatedSections.add("serialized_result");
    result = {
      ...result,
      requestedUrl: result.requestedUrl.slice(0, 2_048),
      finalUrl: result.finalUrl.slice(0, 2_048),
      contentType: result.contentType?.slice(0, 256) ?? null,
      title: result.title.slice(0, 500),
      visibleText: "",
      forms: [],
      links: [],
      scripts: [],
      domOutline: [],
      metadata: [],
      securitySignals: {
        contentSecurityPolicy: result.securitySignals.contentSecurityPolicy?.slice(0, 500) ?? null,
        frameOptions: result.securitySignals.frameOptions?.slice(0, 500) ?? null,
        referrerPolicy: result.securitySignals.referrerPolicy?.slice(0, 500) ?? null,
        permissionsPolicy: result.securitySignals.permissionsPolicy?.slice(0, 500) ?? null,
        hasPasswordFields: result.securitySignals.hasPasswordFields,
      },
      isPartial: true,
      truncatedSections: [...truncatedSections],
    };
  }

  return result;
}

function truncateText(
  value: string,
  limit: number,
  section: PageInspectionTruncatedSection,
  truncatedSections: Set<PageInspectionTruncatedSection>,
) {
  if (value.length <= limit) {
    return value;
  }

  truncatedSections.add(section);
  return value.slice(0, limit);
}
