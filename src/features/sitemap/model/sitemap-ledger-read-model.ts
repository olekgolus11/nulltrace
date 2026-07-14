import { TargetSitemapDiscoveryProvenance } from "./sitemap.types";

export interface SitemapLedgerColumns {
  method: number;
  route: number;
  status: number;
  scope: number;
}

const methodColumnWidth = 4;
const statusColumnWidth = 3;
const narrowScopeColumnWidth = 4;
const wideScopeColumnWidth = 6;
const columnGapCount = 3;

function splitGraphemes(value: string) {
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: "grapheme",
  });
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

function takeByWidth(
  graphemes: string[],
  maxWidth: number,
  direction: "start" | "end",
) {
  const result: string[] = [];
  let width = 0;
  let index = direction === "start" ? 0 : graphemes.length - 1;

  while (index >= 0 && index < graphemes.length) {
    const grapheme = graphemes[index]!;
    const graphemeWidth = Bun.stringWidth(grapheme);
    if (width + graphemeWidth > maxWidth) {
      break;
    }

    if (direction === "start") {
      result.push(grapheme);
      index += 1;
    } else {
      result.unshift(grapheme);
      index -= 1;
    }
    width += graphemeWidth;
  }

  return result.join("");
}

function findPathSegmentSuffix(path: string, maxWidth: number) {
  let slashIndex = path.indexOf("/");

  while (slashIndex >= 0) {
    const suffix = path.slice(slashIndex);
    if (Bun.stringWidth(suffix) <= maxWidth) {
      return suffix;
    }
    slashIndex = path.indexOf("/", slashIndex + 1);
  }

  return null;
}

export function createSitemapLedgerColumns(
  availableWidth: number,
): SitemapLedgerColumns {
  const scope = availableWidth >= 48
    ? wideScopeColumnWidth
    : narrowScopeColumnWidth;
  const route = Math.max(
    1,
    availableWidth -
      methodColumnWidth -
      statusColumnWidth -
      scope -
      columnGapCount,
  );

  return {
    method: methodColumnWidth,
    route,
    status: statusColumnWidth,
    scope,
  };
}

export function formatSitemapLedgerPath(path: string, maxWidth: number) {
  if (maxWidth <= 0) {
    return "";
  }
  if (Bun.stringWidth(path) <= maxWidth) {
    return path;
  }
  if (maxWidth === 1) {
    return "\u2026";
  }

  const graphemes = splitGraphemes(path);
  const contentWidth = maxWidth - 1;
  const minimumPrefixWidth = Math.max(1, Math.floor(contentWidth * 0.25));
  const segmentSuffix = findPathSegmentSuffix(
    path,
    contentWidth - minimumPrefixWidth,
  );
  if (segmentSuffix) {
    const prefixWidth = contentWidth - Bun.stringWidth(segmentSuffix);
    return `${takeByWidth(graphemes, prefixWidth, "start")}\u2026${segmentSuffix}`;
  }

  const prefixWidth = Math.floor(contentWidth * 0.45);
  const suffixWidth = contentWidth - prefixWidth;

  return `${takeByWidth(graphemes, prefixWidth, "start")}\u2026${takeByWidth(
    graphemes,
    suffixWidth,
    "end",
  )}`;
}

export function getSitemapLedgerScopeLabel(
  provenance: TargetSitemapDiscoveryProvenance | undefined,
  scopeWidth: number,
) {
  if (!provenance) {
    return "\u2014";
  }
  if (scopeWidth <= narrowScopeColumnWidth) {
    return provenance === "public"
      ? "PUB"
      : provenance === "authenticated"
        ? "AUTH"
        : "BOTH";
  }

  return provenance === "authenticated" ? "AUTH" : provenance.toUpperCase();
}
