import { theme } from "../../app/theme/theme.js";
import { FindingCounts } from "../../features/finding/components/FindingCounts.js";
import { FindingSummaryProps } from "../../features/finding/model/finding-summary.types.js";
import { AuthenticatedRequestContextMetadata } from "../../features/authentication/model/authenticated-request-context.types.js";
import { getAuthenticationHeaderPresentation } from "../../features/authentication/components/auth-check-presentation.js";
import { AuthenticatedSitemapCrawlStatusRecord } from "../../features/sitemap/model/sitemap.types.js";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  targetUrl?: string;
  counts?: FindingSummaryProps;
  authenticationContext?: AuthenticatedRequestContextMetadata | null;
  authenticatedSitemapStatus?: AuthenticatedSitemapCrawlStatusRecord | null;
}

const emptyCounts: FindingSummaryProps = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
  total: 0,
};

export function Header({
  title = "Nulltrace",
  subtitle,
  targetUrl,
  counts = emptyCounts,
  authenticationContext,
  authenticatedSitemapStatus,
}: HeaderProps) {
  const authenticationPosture = getAuthenticationHeaderPresentation(
    authenticationContext ?? null,
    authenticatedSitemapStatus?.status === "authentication_required",
  );

  return (
    <box
      height={3}
      flexDirection="row"
      alignItems="center"
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={theme.bg.panel}
    >
      <box flexGrow={1}>
        <text>
          <span fg={theme.accent.primary}>
            <strong>◆ {title}</strong>
          </span>
          {subtitle && (
            <>
              <span fg={theme.text.dim}> | </span>
              <span fg={theme.text.secondary}>{subtitle}</span>
            </>
          )}
          {targetUrl && (
            <>
              <span fg={theme.text.dim}> | </span>
              <span fg={theme.text.primary}>Target: </span>
              <span fg={theme.accent.secondary}>{targetUrl}</span>
            </>
          )}
          <span fg={theme.text.dim}> | </span>
          <span fg={theme.text.primary}>Auth: </span>
          <span fg={authenticationPosture?.color ?? theme.text.muted}>
            {authenticationPosture?.headerLabel ?? "none"}
            {authenticationContext?.storageMode === "memory"
              ? " / memory-only"
              : ""}
          </span>
        </text>
      </box>

      <box marginBottom={1}>
        <FindingCounts {...counts} />
      </box>
    </box>
  );
}
