import { nmapFieldOrder } from "../../nmap/config/nmap.config";
import { nucleiFieldOrder } from "../../nuclei/config/nuclei.config";

export const fieldOrder = {
  nmap: nmapFieldOrder,
  nuclei: nucleiFieldOrder,
  ffuf: [""],
  sqlmap: [""],
  zap: [""],
  nikto: [""],
};
