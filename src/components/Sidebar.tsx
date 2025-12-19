import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import * as os from "os";

interface SidebarSectionProps {
  title: string;
  children: React.ReactNode;
}

function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="#FFFFFF">
        {title}
      </Text>
      <Box flexDirection="column" paddingLeft={0}>
        {children}
      </Box>
    </Box>
  );
}

interface SidebarItemProps {
  label: string;
  value: string;
  valueColor?: string;
}

function SidebarItem({ label, value, valueColor = "#6B7280" }: SidebarItemProps) {
  return (
    <Box>
      <Text color="#9CA3AF">{label}: </Text>
      <Text color={valueColor}>{value}</Text>
    </Box>
  );
}

interface SidebarListItemProps {
  label: string;
  status?: string;
  statusColor?: string;
}

function SidebarListItem({
  label,
  status,
  statusColor = "#22C55E",
}: SidebarListItemProps) {
  return (
    <Box>
      <Text color="#22C55E">• </Text>
      <Text color="#E5E7EB">{label}</Text>
      {status && <Text color={statusColor}> {status}</Text>}
    </Box>
  );
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return `${gb.toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function Sidebar() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [memInfo, setMemInfo] = useState({
    total: os.totalmem(),
    free: os.freemem(),
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
      setMemInfo({
        total: os.totalmem(),
        free: os.freemem(),
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const usedMem = memInfo.total - memInfo.free;
  const memPercent = Math.round((usedMem / memInfo.total) * 100);

  const systemInfo = {
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    cpus: os.cpus().length,
  };

  const timeString = currentTime.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const dateString = currentTime.toLocaleDateString("pl-PL", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <Box
      flexDirection="column"
      width={32}
      backgroundColor="#111827"
      paddingX={2}
      paddingY={1}
      height="100%"
    >
      {/* Time Section */}
      <SidebarSection title="Time">
        <Text color="#60A5FA" bold>
          {timeString}
        </Text>
        <Text color="#6B7280">{dateString}</Text>
      </SidebarSection>

      {/* System Section */}
      <SidebarSection title="System">
        <SidebarItem
          label="OS"
          value={`${systemInfo.platform} ${systemInfo.arch}`}
        />
        <SidebarItem label="Host" value={systemInfo.hostname} />
        <SidebarItem label="CPUs" value={`${systemInfo.cpus} cores`} />
        <SidebarItem label="Uptime" value={formatUptime(systemInfo.uptime)} />
      </SidebarSection>

      {/* Memory Section */}
      <SidebarSection title="Memory">
        <SidebarItem
          label="Used"
          value={`${formatBytes(usedMem)} (${memPercent}%)`}
          valueColor={memPercent > 80 ? "#EF4444" : "#22C55E"}
        />
        <SidebarItem label="Total" value={formatBytes(memInfo.total)} />
      </SidebarSection>

      {/* Runtime Section */}
      <SidebarSection title="Runtime">
        <SidebarListItem label="Bun" status={Bun.version} statusColor="#6B7280" />
        <SidebarListItem label="React" status="19.x" statusColor="#6B7280" />
        <SidebarListItem label="Ink" status="6.x" statusColor="#6B7280" />
      </SidebarSection>

      {/* Project Section - at bottom */}
      <Box flexGrow={1} />
      <Box flexDirection="column">
        <Text color="#6B7280" dimColor>
          ~/Workspace/pentest-ai-opencode
        </Text>
        <Box>
          <Text color="#22C55E">• </Text>
          <Text color="#A78BFA" bold>
            TUI
          </Text>
          <Text color="#6B7280" bold>
            Demo
          </Text>
          <Text color="#4B5563"> 1.0.0</Text>
        </Box>
      </Box>
    </Box>
  );
}
