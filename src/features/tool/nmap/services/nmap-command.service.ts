import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import { ToolPrepareCommand, ToolRunCompleted } from "../../shared/types/tool-screen.types";
import { nmapBooleanFields, nmapTimingOptions } from "../config/nmap.config";
import { NmapFieldId, NmapFormState, NmapTiming, NmapToolData } from "../types/nmap.types";
import { getAppDataDirectory } from "../../../session/services/session-database";
import { ToolRunArtifactInput } from "../../../session/model/session.repository.types";

interface NmapXmlNode {
  [key: string]: unknown;
}

interface NmapScriptElement {
  key: string | null;
  value: string | null;
}

interface NmapScriptTable {
  key: string | null;
  elements: NmapScriptElement[];
  tables: NmapScriptTable[];
}

const nmapOutputFlagPattern = /\s*-o[XANGS](?:\s+\S+)?/g;
const nmapXmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getAttribute(node: unknown, key: string) {
  if (!node || typeof node !== "object") {
    return null;
  }

  const value = (node as NmapXmlNode)[`@_${key}`];
  if (value === undefined || value === null) {
    return null;
  }

  return String(value);
}

function getNode(node: unknown, key: string) {
  if (!node || typeof node !== "object") {
    return undefined;
  }

  return (node as NmapXmlNode)[key];
}

class NmapCommandService {
  private getXmlOutputPath(sessionId: string, toolRunId: string) {
    return join(
      getAppDataDirectory(),
      "artifacts",
      "sessions",
      sessionId,
      "tool-runs",
      toolRunId,
      "nmap.xml",
    );
  }

  private shellQuotePath(path: string): string {
    return `'${path.split("'").join("'\\''")}'`;
  }

  private extractHostname(targetUrl: string) {
    try {
      return new URL(targetUrl).hostname;
    } catch {
      return targetUrl
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .trim();
    }
  }

  createInitialToolData(targetUrl: string): NmapToolData {
    return {
      selectedField: 0,
      form: {
        target: this.extractHostname(targetUrl),
        ports: "",
        timing: "T3",
        serviceDetection: true,
        osDetection: false,
        defaultScripts: false,
        aggressive: false,
        extraArgs: "",
      },
    };
  }

  buildCommand(toolData: NmapToolData) {
    const form = toolData.form;
    const cmd: string[] = ["nmap"];

    if (form.aggressive) {
      cmd.push("-A");
    } else {
      if (form.serviceDetection) {
        cmd.push("-sV");
      }
      if (form.osDetection) {
        cmd.push("-O");
      }
      if (form.defaultScripts) {
        cmd.push("-sC");
      }
    }

    cmd.push(`-${form.timing}`);

    if (form.ports.trim()) {
      cmd.push("-p", form.ports.trim());
    }

    if (form.extraArgs.trim()) {
      cmd.push(form.extraArgs.trim());
    }

    if (form.target.trim()) {
      cmd.push(form.target.trim());
    }

    return cmd.join(" ").trim();
  }

  setField(
    toolData: NmapToolData,
    field: keyof NmapFormState,
    value: string | boolean | NmapTiming,
  ): NmapToolData {
    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: value,
      },
    };
  }

  moveSelection(toolData: NmapToolData, delta: -1 | 1, max: number): NmapToolData {
    return {
      ...toolData,
      selectedField: Math.max(0, Math.min(toolData.selectedField + delta, max)),
    };
  }

  toggleBooleanField(toolData: NmapToolData, field: NmapFieldId): NmapToolData {
    if (!nmapBooleanFields.includes(field)) {
      return toolData;
    }

    return {
      ...toolData,
      form: {
        ...toolData.form,
        [field]: !toolData.form[field],
      },
    };
  }

  cycleTiming(toolData: NmapToolData, delta: -1 | 1): NmapToolData {
    const currentIndex = nmapTimingOptions.indexOf(toolData.form.timing);
    const nextIndex = (currentIndex + delta + nmapTimingOptions.length) % nmapTimingOptions.length;

    return {
      ...toolData,
      form: {
        ...toolData.form,
        timing: nmapTimingOptions[nextIndex]!,
      },
    };
  }

  prepareCommandForRun(options: ToolPrepareCommand): string {
    const { command, sessionId, toolRunId } = options;

    if (!sessionId || !toolRunId) {
      return command;
    }

    const xmlOutputPath = this.getXmlOutputPath(sessionId, toolRunId);
    const outputDirectory = dirname(xmlOutputPath);
    mkdirSync(outputDirectory, { recursive: true });

    const strippedCommand = command.replace(nmapOutputFlagPattern, " ");
    const xmlOutputFlag = ` -oX ${this.shellQuotePath(xmlOutputPath)}`;
    return strippedCommand + xmlOutputFlag;
  }

  async collectArtifacts(options: ToolRunCompleted): Promise<ToolRunArtifactInput[]> {
    const { sessionId, toolRunId, status, exitCode } = options;

    if (!sessionId || !toolRunId || status === "cancelled") {
      return [];
    }

    const xmlOutputPath = this.getXmlOutputPath(sessionId, toolRunId);
    if (!existsSync(xmlOutputPath)) {
      return [];
    }

    const xml = readFileSync(xmlOutputPath, "utf8");
    if (!xml.trim()) {
      return [];
    }

    const parsed = nmapXmlParser.parse(xml) as NmapXmlNode;
    const nmapRun = getNode(parsed, "nmaprun");

    return [
      {
        artifactType: "nmap_scan",
        label: "Nmap scan",
        source: "nmap.xml",
        payload: {
          source: this.buildXmlSourceMetadata(xmlOutputPath, xml),
          scanner: this.parseScanner(nmapRun, status, exitCode),
          hosts: this.parseHosts(nmapRun),
        },
      },
    ];
  }

  private buildXmlSourceMetadata(path: string, xml: string) {
    return {
      format: "nmap_xml",
      path,
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(xml).digest("hex"),
    };
  }

  private parseScanner(nmapRun: unknown, status: string, exitCode: number | null) {
    const runstats = getNode(nmapRun, "runstats");
    const finished = getNode(runstats, "finished");
    const hosts = getNode(runstats, "hosts");

    return {
      name: getAttribute(nmapRun, "scanner"),
      version: getAttribute(nmapRun, "version"),
      args: getAttribute(nmapRun, "args"),
      startedAt: getAttribute(nmapRun, "startstr"),
      finishedAt: getAttribute(finished, "timestr"),
      elapsedSeconds: getAttribute(finished, "elapsed"),
      exit: getAttribute(finished, "exit"),
      status,
      exitCode,
      hosts: {
        up: getAttribute(hosts, "up"),
        down: getAttribute(hosts, "down"),
        total: getAttribute(hosts, "total"),
      },
    };
  }

  private parseHosts(nmapRun: unknown) {
    return toArray(getNode(nmapRun, "host")).map((host) => ({
      status: {
        state: getAttribute(getNode(host, "status"), "state"),
        reason: getAttribute(getNode(host, "status"), "reason"),
      },
      addresses: toArray(getNode(host, "address")).map((address) => ({
        address: getAttribute(address, "addr"),
        type: getAttribute(address, "addrtype"),
      })),
      hostnames: toArray(getNode(getNode(host, "hostnames"), "hostname")).map((hostname) => ({
        name: getAttribute(hostname, "name"),
        type: getAttribute(hostname, "type"),
      })),
      ports: this.parsePorts(getNode(host, "ports")),
      os: this.parseOs(getNode(host, "os")),
      scripts: this.parseScripts(host),
      times: {
        srtt: getAttribute(getNode(host, "times"), "srtt"),
        rttvar: getAttribute(getNode(host, "times"), "rttvar"),
        timeout: getAttribute(getNode(host, "times"), "to"),
      },
    }));
  }

  private parsePorts(portsNode: unknown) {
    return toArray(getNode(portsNode, "port")).map((port) => {
      const service = getNode(port, "service");

      return {
        protocol: getAttribute(port, "protocol"),
        port: getAttribute(port, "portid"),
        state: {
          state: getAttribute(getNode(port, "state"), "state"),
          reason: getAttribute(getNode(port, "state"), "reason"),
        },
        service: {
          name: getAttribute(service, "name"),
          product: getAttribute(service, "product"),
          version: getAttribute(service, "version"),
          extraInfo: getAttribute(service, "extrainfo"),
          osType: getAttribute(service, "ostype"),
          method: getAttribute(service, "method"),
          confidence: getAttribute(service, "conf"),
          cpes: toArray(getNode(service, "cpe")).map((cpe) => String(cpe)),
        },
        scripts: this.parseScripts(port),
      };
    });
  }

  private parseOs(osNode: unknown) {
    return {
      portsUsed: toArray(getNode(osNode, "portused")).map((port) => ({
        state: getAttribute(port, "state"),
        protocol: getAttribute(port, "proto"),
        port: getAttribute(port, "portid"),
      })),
      matches: toArray(getNode(osNode, "osmatch")).map((match) => ({
        name: getAttribute(match, "name"),
        accuracy: getAttribute(match, "accuracy"),
        line: getAttribute(match, "line"),
        classes: toArray(getNode(match, "osclass")).map((osClass) => ({
          type: getAttribute(osClass, "type"),
          vendor: getAttribute(osClass, "vendor"),
          family: getAttribute(osClass, "osfamily"),
          generation: getAttribute(osClass, "osgen"),
          accuracy: getAttribute(osClass, "accuracy"),
          cpes: toArray(getNode(osClass, "cpe")).map((cpe) => String(cpe)),
        })),
      })),
    };
  }

  private parseScripts(node: unknown) {
    return toArray(getNode(node, "script")).map((script) => ({
      id: getAttribute(script, "id"),
      output: getAttribute(script, "output"),
      tables: toArray(getNode(script, "table")).map((table) => this.parseScriptTable(table)),
      elements: toArray(getNode(script, "elem")).map((element) => this.parseScriptElement(element)),
    }));
  }

  private parseScriptTable(table: unknown): NmapScriptTable {
    return {
      key: getAttribute(table, "key"),
      elements: toArray(getNode(table, "elem")).map((element) => this.parseScriptElement(element)),
      tables: toArray(getNode(table, "table")).map((childTable) =>
        this.parseScriptTable(childTable),
      ),
    };
  }

  private parseScriptElement(element: unknown): NmapScriptElement {
    const value = element && typeof element === "object" ? getNode(element, "#text") : element;

    return {
      key: getAttribute(element, "key"),
      value: value === undefined || value === null ? null : String(value),
    };
  }
}

export const nmapCommandService = new NmapCommandService();
