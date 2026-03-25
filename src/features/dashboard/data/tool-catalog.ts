import { ToolCatalogItem } from "../../tool/shared/types/tool-screen.types";

export const tools: ToolCatalogItem[] = [
  { id: "nmap", name: "Nmap", description: "Port scan", icon: "🔍" },
  { id: "nuclei", name: "Nuclei", description: "Vuln scan", icon: "🎯" },
  { id: "ffuf", name: "FFUF", description: "Fuzzing", icon: "🌪️" },
  { id: "sqlmap", name: "SQLMap", description: "SQL Inject", icon: "💉" },
  { id: "zap", name: "ZAP", description: "Web scan", icon: "⚡" },
  { id: "nikto", name: "Nikto", description: "Server scan", icon: "🛡️" },
];
