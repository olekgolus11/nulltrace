import { theme } from "../../app/theme/theme.js";
import { VulnerabilityCounts } from "../../features/vulnerability/components/VulnerabilityCounts.js";
import { VulnerabilitySummaryProps } from "../../features/vulnerability/model/vulnerability.types.js";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  targetUrl?: string;
  counts?: VulnerabilitySummaryProps;
}

const emptyCounts: VulnerabilitySummaryProps = {
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
}: HeaderProps) {
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
        </text>
      </box>

      <box marginBottom={1}>
        <VulnerabilityCounts {...counts} />
      </box>
    </box>
  );
}
