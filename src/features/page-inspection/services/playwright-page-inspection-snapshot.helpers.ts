import { type Page, type Response } from "playwright";
import { PageInspectionInput, PageInspectionLimits, PageInspectionSnapshot } from "../model/page-inspection.types";
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
    { maxDomOutlineNodes: number; maxVisibleTextCharacters: number }
  >(({ maxDomOutlineNodes, maxVisibleTextCharacters }) => {
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
    const forms = Array.from(document.forms).map((form) => ({
      method: (form.method || "GET").toUpperCase(),
      action: toUrl(form.getAttribute("action") || document.location.href),
      fields: Array.from(form.elements)
        .filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
          element instanceof HTMLInputElement ||
          element instanceof HTMLSelectElement ||
          element instanceof HTMLTextAreaElement,
        )
        .filter((element) => {
          const type =
            element instanceof HTMLInputElement ? element.type.toLowerCase() : element.tagName.toLowerCase();
          return type !== "hidden" && type !== "password";
        })
        .map((element) => ({
          name: element.getAttribute("name"),
          type: element instanceof HTMLInputElement ? element.type.toLowerCase() : element.tagName.toLowerCase(),
          isRequired: element.required,
        })),
    }));
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((element) => ({
        url: toUrl(element.getAttribute("href")),
        text: compactText(element.textContent, 200),
      }))
      .filter((link): link is { url: string; text: string } => link.url !== null);
    const scripts = Array.from(document.scripts).map((script) => ({
      src: toUrl(script.getAttribute("src")),
      type: script.getAttribute("type"),
    }));
    const metadata = Array.from(
      document.querySelectorAll("meta[name], meta[property], meta[http-equiv]"),
    ).map((meta) => ({
      name: meta.getAttribute("name") || meta.getAttribute("property") || meta.getAttribute("http-equiv") || "meta",
      content: compactText(meta.getAttribute("content")),
    }));
    const domOutline = Array.from(
      document.querySelectorAll(
        "main, header, nav, footer, section, article, form, h1, h2, h3, button, input, textarea, select",
      ),
    )
      .slice(0, maxDomOutlineNodes)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        role: element.getAttribute("role"),
        name: element.getAttribute("aria-label") || element.getAttribute("name"),
        heading: /^h[1-6]$/i.test(element.tagName)
          ? compactText(element.textContent, 300)
          : null,
        depth: getDepth(element),
      }));

    return {
      title: compactText(document.title),
      visibleText: compactText(document.body?.innerText, maxVisibleTextCharacters),
      forms,
      links,
      scripts,
      domOutline,
      metadata,
      hasPasswordFields: Boolean(document.querySelector('input[type="password"]')),
    };
  }, {
    maxDomOutlineNodes: limits.maxDomOutlineNodes,
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
    isPartial: isRenderWaitPartial,
    truncatedSections: isRenderWaitPartial ? ["render_wait"] : [],
  };
}
