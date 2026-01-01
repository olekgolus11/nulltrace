import { useState, useEffect } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { theme } from "../theme.ts";
import { Panel } from "../components/Panel.tsx";

interface ToolScreenProps {
  toolId: string;
  toolName: string;
  onBack: () => void;
}

// Mock tool outputs
const toolOutputs: Record<string, string[]> = {
  nmap: [
    "Starting Nmap 7.94 ( https://nmap.org )",
    "Nmap scan report for example.com (93.184.216.34)",
    "Host is up (0.012s latency).",
    "",
    "PORT     STATE SERVICE     VERSION",
    "22/tcp   open  ssh         OpenSSH 8.9p1",
    "80/tcp   open  http        nginx 1.18.0",
    "443/tcp  open  ssl/http    nginx 1.18.0",
    "3306/tcp open  mysql       MySQL 8.0.32",
    "",
    "Service detection performed.",
    "Nmap done: 1 IP address (1 host up) scanned in 12.34 seconds",
  ],
  nuclei: [
    "[INF] nuclei v3.1.0",
    "[INF] Templates loaded: 7842",
    "[INF] Targets loaded: 1",
    "",
    "[critical] [cve-2021-44228] [http] example.com/api/log4j",
    "[high] [git-config] [http] example.com/.git/config",
    "[medium] [directory-listing] [http] example.com/uploads/",
    "[info] [tech-detect:nginx] [http] example.com",
    "[info] [tech-detect:mysql] [http] example.com",
    "",
    "[INF] Scan completed in 45.23s",
  ],
  ffuf: [
    "        /'___\\  /'___\\           /'___\\",
    "       /\\ \\__/ /\\ \\__/  __  __  /\\ \\__/",
    "       \\ \\ ,__\\\\ \\ ,__\\/\\ \\/\\ \\ \\ \\ ,__\\",
    "        \\ \\ \\_/ \\ \\ \\_/\\ \\ \\_\\ \\ \\ \\ \\_/",
    "         \\ \\_\\   \\ \\_\\  \\ \\____/  \\ \\_\\",
    "          \\/_/    \\/_/   \\/___/    \\/_/",
    "",
    "[Status: 200, Size: 1234, Words: 56, Lines: 23] /admin",
    "[Status: 200, Size: 5678, Words: 89, Lines: 45] /api",
    "[Status: 301, Size: 162, Words: 5, Lines: 8] /shop",
    "[Status: 403, Size: 153, Words: 3, Lines: 8] /.git",
    "[Status: 200, Size: 324, Words: 12, Lines: 6] /robots.txt",
    "",
    ":: Progress: [4714/4714] :: Job [1/1] :: 245 req/sec",
  ],
  sqlmap: [
    "[*] starting sqlmap",
    "[INFO] testing connection to target URL",
    "[INFO] testing 'AND boolean-based blind'",
    "[INFO] testing 'MySQL >= 5.0 AND error-based'",
    "[CRITICAL] parameter 'id' is vulnerable",
    "",
    "Parameter: id (GET)",
    "    Type: boolean-based blind",
    "    Payload: id=1 AND 1=1",
    "",
    "    Type: error-based",
    "    Payload: id=1 AND (SELECT 1 FROM(SELECT COUNT(*)",
    "",
    "[INFO] the back-end DBMS is MySQL",
    "[INFO] fetching database names",
    "available databases [3]:",
    "[*] information_schema",
    "[*] mysql",
    "[*] webapp_db",
  ],
  zap: [
    "ZAP Baseline Scan",
    "Target: https://example.com",
    "",
    "PASS: Cookie Without Secure Flag [10011]",
    "WARN: X-Frame-Options Header Not Set [10020] x 5",
    "WARN: Missing Anti-clickjacking Header [10027] x 3",
    "FAIL: SQL Injection [40018] x 2",
    "FAIL: Cross Site Scripting (Reflected) [40012] x 1",
    "",
    "WARN-NEW: 2   WARN-INPROG: 0   FAIL-NEW: 3   PASS: 1",
  ],
  nikto: [
    "- Nikto v2.5.0",
    "---------------------------------------------------------------------------",
    "+ Target IP:          93.184.216.34",
    "+ Target Hostname:    example.com",
    "+ Target Port:        443",
    "---------------------------------------------------------------------------",
    "+ Server: nginx/1.18.0",
    "+ /admin/: Admin login page/section found.",
    "+ /.git/HEAD: Git repository found.",
    "+ /phpinfo.php: PHP info file found.",
    "+ /backup.zip: Backup file found.",
    "",
    "+ 7890 requests: 0 error(s) and 4 item(s) reported",
  ],
};

const toolDescriptions: Record<string, string> = {
  nmap: "Network exploration and security auditing tool",
  nuclei: "Fast and customizable vulnerability scanner",
  ffuf: "Fast web fuzzer for directory and parameter discovery",
  sqlmap: "Automatic SQL injection and database takeover tool",
  zap: "OWASP ZAP - Web application security scanner",
  nikto: "Web server scanner for dangerous files and outdated software",
};

export function ToolScreen({ toolId, toolName, onBack }: ToolScreenProps) {
  const { stdout } = useStdout();
  const [dimensions, setDimensions] = useState({
    width: stdout.columns || 80,
    height: stdout.rows || 24,
  });
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout.columns || 80,
        height: stdout.rows || 24,
      });
    };

    stdout.on("resize", handleResize);
    return () => {
      stdout.off("resize", handleResize);
    };
  }, [stdout]);

  // Simulate tool output streaming
  useEffect(() => {
    const lines = toolOutputs[toolId] || ["No output available for this tool."];
    let currentLine = 0;

    const interval = setInterval(() => {
      if (currentLine < lines.length) {
        setOutputLines((prev) => [...prev, lines[currentLine]]);
        currentLine++;
      } else {
        setIsRunning(false);
        clearInterval(interval);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [toolId]);

  useInput((input, key) => {
    if (key.escape || input === "b") {
      onBack();
    }
  });

  return (
    <Box
      flexDirection="column"
      width={dimensions.width}
      height={dimensions.height}
      backgroundColor={theme.bg.primary}
      padding={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={theme.accent.primary} bold>
          {"◆ "}
        </Text>
        <Text color={theme.text.primary} bold>
          {toolName.toUpperCase()}
        </Text>
        <Text color={theme.text.muted}>
          {" - "}
          {toolDescriptions[toolId] || "Security tool"}
        </Text>
      </Box>

      {/* Tool output panel */}
      <Panel title={`Output ${isRunning ? "(running...)" : "(complete)"}`} focused>
        <Box flexDirection="column" height={dimensions.height - 8}>
          {outputLines.map((line, idx) => {
            // Color code certain output patterns
            let color = theme.text.primary;
            if (line.includes("[critical]") || line.includes("[CRITICAL]") || line.includes("FAIL:")) {
              color = theme.severity.critical;
            } else if (line.includes("[high]") || line.includes("WARN:")) {
              color = theme.severity.high;
            } else if (line.includes("[medium]")) {
              color = theme.severity.medium;
            } else if (line.includes("[info]") || line.includes("[INFO]") || line.includes("[INF]")) {
              color = theme.accent.info;
            } else if (line.includes("PASS:")) {
              color = theme.severity.low;
            } else if (line.startsWith("+") || line.startsWith("[Status:")) {
              color = theme.accent.secondary;
            }

            return (
              <Text key={idx} color={color}>
                {line}
              </Text>
            );
          })}
          {isRunning && (
            <Text color={theme.accent.primary}>▌</Text>
          )}
        </Box>
      </Panel>

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={theme.text.dim}>
          Press <Text color={theme.text.secondary}>ESC</Text> or{" "}
          <Text color={theme.text.secondary}>b</Text> to go back
        </Text>
      </Box>
    </Box>
  );
}

