import { theme } from "../../app/theme/theme.js";
import { VulnerabilityCounts } from "../../features/vulnerability/components/VulnerabilityCounts.js";

interface HeaderProps {
  title?: string;
  subtitle?: string;
  targetUrl?: string;
}

export function Header({
  title = "Nulltrace",
  subtitle,
  targetUrl,
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
        <VulnerabilityCounts
          critical={2}
          high={5}
          medium={8}
          low={12}
          info={15}
          total={30}
        />
      </box>
    </box>
  );
}
