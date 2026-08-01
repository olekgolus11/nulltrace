import {
  ParsedSqlmapOutput,
  SqlmapOutputParseContext,
  SqlmapTechniqueObservation,
} from "../types/sqlmap-artifact.types";

const negativeOutputPattern =
  /(?:all tested parameters do not appear to be injectable|parameter ['"].+?['"] does not seem to be injectable)/i;

export function parseSqlmapOutput(
  content: string,
  context: SqlmapOutputParseContext,
): ParsedSqlmapOutput {
  const lines = content.slice(0, 250_000).split(/\r?\n/);
  const databaseManagementSystem = getDatabaseManagementSystem(lines);
  const techniques: SqlmapTechniqueObservation[] = [];
  let isRequestedParameterBlock = false;
  let didSeeRequestedParameter = false;
  let pendingType: string | null = null;
  let pendingTitle: string | null = null;

  const flushTechnique = () => {
    if (isRequestedParameterBlock && pendingType && pendingTitle) {
      const key = `${pendingType}\0${pendingTitle}`;
      if (!techniques.some((technique) => `${technique.type}\0${technique.title}` === key)) {
        techniques.push({ type: pendingType, title: pendingTitle });
      }
    }
    pendingType = null;
    pendingTitle = null;
  };

  lines.forEach((line) => {
    const parameterMatch = line.trim().match(/^Parameter:\s*(.+?)\s*\((GET|POST)\)\s*$/i);
    if (parameterMatch) {
      flushTechnique();
      const parameter = parameterMatch[1]?.trim();
      const place = parameterMatch[2]?.toUpperCase();
      isRequestedParameterBlock = parameter === context.parameter && place === context.method;
      didSeeRequestedParameter ||= isRequestedParameterBlock;
      return;
    }

    const typeMatch = line.trim().match(/^Type:\s*(.+)$/i);
    if (typeMatch) {
      flushTechnique();
      pendingType = typeMatch[1]?.trim() ?? null;
      return;
    }
    const titleMatch = line.trim().match(/^Title:\s*(.+)$/i);
    if (titleMatch) {
      pendingTitle = titleMatch[1]?.trim() ?? null;
    }
  });
  flushTechnique();

  if (techniques.length > 0) {
    return {
      outcome: "positive",
      observations: [
        {
          ...context,
          place: context.method,
          databaseManagementSystem,
          techniques,
        },
      ],
      parseWarning: null,
    };
  }
  if (negativeOutputPattern.test(content)) {
    return {
      outcome: "negative",
      observations: [],
      parseWarning: null,
    };
  }
  return {
    outcome: "inconclusive",
    observations: [],
    parseWarning: didSeeRequestedParameter
      ? "sqlmap output contained an incomplete observation for the selected parameter."
      : "sqlmap output did not contain a complete targeted verification result.",
  };
}

function getDatabaseManagementSystem(lines: string[]) {
  for (const line of lines) {
    const match = line.trim().match(/^back-end DBMS:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}
