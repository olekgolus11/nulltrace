import { ToolName } from "../../tool/shared/types/tool-screen.types";

interface ToolCatalogItem {
  id: ToolName;
  name: string;
  description: string;
  icon: string;
}

export const tools: ToolCatalogItem[] = [
  { id: "nmap", name: "Nmap", description: "Port scan", icon: "🔍" },
  { id: "nuclei", name: "Nuclei", description: "Template scan", icon: "🎯" },
  { id: "ffuf", name: "FFUF", description: "Fuzzing", icon: "🌪️" },
  { id: "sqlmap", name: "SQLMap", description: "SQL Inject", icon: "💉" },
  { id: "nikto", name: "Nikto", description: "Server scan", icon: "🛡️" },
];
