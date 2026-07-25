import { type Page, type Response } from "playwright";
import {
  PageInspectionInput,
  PageInspectionLimits,
  PageInspectionSnapshot,
  PageInspectionTruncatedSection,
} from "../model/page-inspection.types";
import { toBoundedPageInspectionHeader } from "./playwright-page-inspection-browser.helpers";

interface ExtractedPageContent {
  title: string;
  visibleText: string;
  forms: PageInspectionSnapshot["forms"];
  links: PageInspectionSnapshot["links"];
  scripts: PageInspectionSnapshot["scripts"];
  domOutline: PageInspectionSnapshot["domOutline"];
  metadata: PageInspectionSnapshot["metadata"];
  hasPasswordFields: boolean;
  truncatedSections: PageInspectionTruncatedSection[];
}

export async function extractPlaywrightPageInspectionSnapshot(
  page: Page,
  response: Response | null,
  input: PageInspectionInput,
  limits: PageInspectionLimits,
  isRenderWaitPartial: boolean,
): Promise<PageInspectionSnapshot> {
  const extracted = await page.evaluate<
    ExtractedPageContent,
    PageInspectionExtractionLimits
  >(({
    maxDomOutlineNodes,
    maxForms,
    maxFormFields,
    maxLinks,
    maxMetadataEntries,
    maxScripts,
    maxVisibleTextCharacters,
  }) => {
    const toUrl = (value: string | null) => {
      if (!value) {
        return null;
      }
      try {
        const url = new URL(value, document.baseURI);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          return null;
        }
        url.hash = "";
        return url.toString().slice(0, 2_048);
      } catch {
        return null;
      }
    };
    const compactText = (value: string | null | undefined, limit = 500) =>
      (value?.replace(/\s+/g, " ").trim() ?? "").slice(0, limit);
    const getDepth = (element: Element) => {
      let depth = 0;
      let parent = element.parentElement;
      while (parent) {
        depth += 1;
        parent = parent.parentElement;
      }
      return depth;
    };
    const truncatedSections = new Set<PageInspectionTruncatedSection>();
    const forms: PageInspectionSnapshot["forms"] = [];
    let hasTruncatedFormFields = false;
    for (let formIndex = 0; formIndex < document.forms.length && forms.length < maxForms; formIndex += 1) {
      const form = document.forms.item(formIndex);
      if (!form) {
        continue;
      }

      const fields: PageInspectionSnapshot["forms"][number]["fields"] = [];
      for (let fieldIndex = 0; fieldIndex < form.elements.length; fieldIndex += 1) {
        const element = form.elements.item(fieldIndex);
        if (
          !(
            element instanceof HTMLInputElement ||
            element instanceof HTMLSelectElement ||
            element instanceof HTMLTextAreaElement
          )
        ) {
          continue;
        }
        const type =
          element instanceof HTMLInputElement ? element.type.toLowerCase() : element.tagName.toLowerCase();
        if (type === "hidden" || type === "password") {
          continue;
        }
        if (fields.length === maxFormFields) {
          hasTruncatedFormFields = true;
          break;
        }
        fields.push({
          name: element.getAttribute("name"),
          type,
          isRequired: element.required,
        });
      }
      forms.push({
        method: (form.method || "GET").toUpperCase(),
        action: toUrl(form.getAttribute("action") || document.location.href),
        fields,
      });
    }
    if (forms.length < document.forms.length) {
      truncatedSections.add("forms");
    }
    if (hasTruncatedFormFields) {
      truncatedSections.add("form_fields");
    }

    const links: PageInspectionSnapshot["links"] = [];
    const linkElements = document.querySelectorAll("a[href]");
    for (let linkIndex = 0; linkIndex < linkElements.length && links.length < maxLinks; linkIndex += 1) {
      const element = linkElements.item(linkIndex);
      const url = toUrl(element.getAttribute("href"));
      if (url) {
        links.push({ url, text: compactText(element.textContent, 200) });
      }
    }
    if (links.length === maxLinks && linkElements.length > maxLinks) {
      truncatedSections.add("links");
    }

    const scripts: PageInspectionSnapshot["scripts"] = [];
    for (let scriptIndex = 0; scriptIndex < document.scripts.length && scripts.length < maxScripts; scriptIndex += 1) {
      const script = document.scripts.item(scriptIndex);
      if (script) {
        scripts.push({
          src: toUrl(script.getAttribute("src")),
          type: script.getAttribute("type"),
        });
      }
    }
    if (scripts.length < document.scripts.length) {
      truncatedSections.add("scripts");
    }

    const metadata: PageInspectionSnapshot["metadata"] = [];
    const metadataElements = document.querySelectorAll("meta[name], meta[property], meta[http-equiv]");
    for (
      let metadataIndex = 0;
      metadataIndex < metadataElements.length && metadata.length < maxMetadataEntries;
      metadataIndex += 1
    ) {
      const meta = metadataElements.item(metadataIndex);
      metadata.push({
        name: meta.getAttribute("name") || meta.getAttribute("property") || meta.getAttribute("http-equiv") || "meta",
        content: compactText(meta.getAttribute("content")),
      });
    }
    if (metadata.length < metadataElements.length) {
      truncatedSections.add("metadata");
    }

    const domOutline: PageInspectionSnapshot["domOutline"] = [];
    const outlineSelector = "main, header, nav, footer, section, article, form, h1, h2, h3, button, input, textarea, select";
    const root = document.body || document.documentElement;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let currentNode: Node | null = walker.currentNode;
    while (currentNode && domOutline.length < maxDomOutlineNodes) {
      if (currentNode instanceof Element && currentNode.matches(outlineSelector)) {
        domOutline.push({
          tag: currentNode.tagName.toLowerCase(),
          id: currentNode.id || null,
          role: currentNode.getAttribute("role"),
          name: currentNode.getAttribute("aria-label") || currentNode.getAttribute("name"),
          heading: /^h[1-6]$/i.test(currentNode.tagName)
            ? compactText(currentNode.textContent, 300)
            : null,
          depth: getDepth(currentNode),
        });
      }
      currentNode = walker.nextNode();
    }
    if (domOutline.length === maxDomOutlineNodes && currentNode) {
      truncatedSections.add("dom_outline");
    }

    return {
      title: compactText(document.title),
      visibleText: compactText(document.body?.innerText, maxVisibleTextCharacters),
      forms,
      links,
      scripts,
      domOutline,
      metadata,
      hasPasswordFields: Boolean(document.querySelector('input[type="password"]')),
      truncatedSections: [...truncatedSections],
    };
  }, {
    maxDomOutlineNodes: limits.maxDomOutlineNodes,
    maxForms: limits.maxForms,
    maxFormFields: limits.maxFormFields,
    maxLinks: limits.maxLinks,
    maxMetadataEntries: limits.maxMetadataEntries,
    maxScripts: limits.maxScripts,
    maxVisibleTextCharacters: limits.maxVisibleTextCharacters,
  });

  const headers = response?.headers() ?? {};
  return {
    requestedUrl: input.requestedUrl,
    finalUrl: page.url().slice(0, 2_048),
    status: response?.status() ?? null,
    contentType: headers["content-type"] ?? null,
    title: extracted.title,
    visibleText: extracted.visibleText,
    forms: extracted.forms,
    links: extracted.links,
    scripts: extracted.scripts,
    domOutline: extracted.domOutline,
    metadata: extracted.metadata,
    securitySignals: {
      contentSecurityPolicy: toBoundedPageInspectionHeader(headers["content-security-policy"]),
      frameOptions: toBoundedPageInspectionHeader(headers["x-frame-options"]),
      referrerPolicy: toBoundedPageInspectionHeader(headers["referrer-policy"]),
      permissionsPolicy: toBoundedPageInspectionHeader(headers["permissions-policy"]),
      hasPasswordFields: extracted.hasPasswordFields,
    },
    isPartial: isRenderWaitPartial || extracted.truncatedSections.length > 0,
    truncatedSections: [
      ...new Set([
        ...extracted.truncatedSections,
        ...(isRenderWaitPartial ? ["render_wait" as const] : []),
      ]),
    ],
  };
}

interface PageInspectionExtractionLimits {
  maxDomOutlineNodes: number;
  maxForms: number;
  maxFormFields: number;
  maxLinks: number;
  maxMetadataEntries: number;
  maxScripts: number;
  maxVisibleTextCharacters: number;
}
