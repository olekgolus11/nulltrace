import { theme } from "../../../app/theme/theme";
import {
  createSitemapLedgerColumns,
  formatSitemapLedgerPath,
  getSitemapLedgerScopeLabel,
  SitemapLedgerColumns,
} from "../model/sitemap-ledger-read-model";
import { SitemapNode } from "../model/sitemap.types";
import { flattenTree, methodColor, statusColor } from "../model/sitemap.utils";

interface SitemapLedgerProps {
  nodes: SitemapNode[];
  selectedIndex: number;
  isFocused: boolean;
  availableWidth: number;
  emptyMessage?: string;
}

interface SitemapLedgerHeaderProps {
  availableWidth: number;
}

interface SitemapLedgerItemProps {
  node: SitemapNode;
  depth: number;
  isLast: boolean;
  selectedId: string | null;
  isFocused: boolean;
  availableWidth: number;
  columns: SitemapLedgerColumns;
}

interface SitemapLedgerGroupProps {
  node: SitemapNode;
  depth: number;
  availableWidth: number;
  entryCount: number;
}

function createTreePrefix(depth: number, isLast: boolean) {
  const visibleDepth = Math.min(depth, 2);
  return `${"  ".repeat(visibleDepth)}${isLast ? "\u2514\u2500 " : "\u251c\u2500 "}`;
}

function countSitemapEntries(node: SitemapNode): number {
  return (node.entryId ? 1 : 0) +
    (node.children?.reduce(
      (total, child) => total + countSitemapEntries(child),
      0,
    ) ?? 0);
}

function SitemapLedgerGroup({
  node,
  depth,
  availableWidth,
  entryCount,
}: SitemapLedgerGroupProps) {
  const indent = "  ".repeat(Math.min(depth, 2));
  const marker = "\u25c6 ";
  const countLabel = ` \u00b7 ${entryCount} routes`;
  const pathWidth = Math.max(
    1,
    availableWidth -
      Bun.stringWidth(indent) -
      Bun.stringWidth(marker) -
      Bun.stringWidth(countLabel),
  );

  return (
    <box
      flexDirection="row"
      width={availableWidth}
      height={1}
      backgroundColor={theme.bg.panel}
    >
      <text fg={theme.text.dim}>{indent}</text>
      <text fg={theme.accent.primary}>{marker}</text>
      <text fg={theme.text.secondary}>
        <strong>{formatSitemapLedgerPath(`${node.path}/*`, pathWidth)}</strong>
      </text>
      <text fg={theme.text.muted}>{countLabel}</text>
    </box>
  );
}

function SitemapLedgerItem({
  node,
  depth,
  isLast,
  selectedId,
  isFocused,
  availableWidth,
  columns,
}: SitemapLedgerItemProps) {
  const isEntry = Boolean(node.entryId);
  const childBranchCount =
    node.children?.filter((child) => countSitemapEntries(child) > 0).length ?? 0;
  const groupEntryCount =
    node.children?.reduce(
      (total, child) => total + countSitemapEntries(child),
      0,
    ) ?? 0;
  const isGroup = childBranchCount > 1;
  const isSelected = isEntry && node.id === selectedId;
  const isFocusedSelection = isFocused && isSelected;
  const treePrefix = createTreePrefix(depth, isLast);
  const pathWidth = Math.max(1, columns.route - Bun.stringWidth(treePrefix));
  const status = node.status > 0 ? String(node.status) : "\u2014";
  const method = node.method ?? "\u2014";
  const source = node.source ?? "unknown";
  const accessObservation = node.accessObservation
    ? `HTTP ${node.accessObservation.httpStatus}`
    : "none";

  return (
    <box flexDirection="column" width={availableWidth}>
      {isGroup ? (
        <SitemapLedgerGroup
          node={node}
          depth={depth}
          availableWidth={availableWidth}
          entryCount={groupEntryCount}
        />
      ) : null}
      {isEntry ? (
        <>
          <box
            flexDirection="row"
            width={availableWidth}
            height={1}
            backgroundColor={isSelected ? theme.bg.elevated : undefined}
          >
            <box width={columns.method}>
              <text
                fg={
                  isFocusedSelection ? theme.accent.primary : methodColor(method)
                }
              >
                {isFocusedSelection ? <strong>{method}</strong> : method}
              </text>
            </box>
            <text> </text>
            <box width={columns.route} flexDirection="row">
              <text fg={theme.text.dim}>{treePrefix}</text>
              <text fg={theme.accent.secondary}>
                {formatSitemapLedgerPath(node.path, pathWidth)}
              </text>
            </box>
            <text> </text>
            <box width={columns.status}>
              <text fg={statusColor(node.status)}>{status}</text>
            </box>
            <text> </text>
            <box width={columns.scope}>
              <text fg={theme.accent.info}>
                {getSitemapLedgerScopeLabel(node.provenance, columns.scope)}
              </text>
            </box>
          </box>
          {isSelected ? (
            <box
              flexDirection="column"
              width={availableWidth}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.bg.elevated}
            >
              <text fg={theme.text.secondary}>{"\u21b3 "}{node.path}</text>
              <text fg={theme.text.muted}>{`source ${source}`}</text>
              <text fg={theme.text.muted}>
                {`access current session \u00b7 ${accessObservation}`}
              </text>
            </box>
          ) : null}
        </>
      ) : null}
      {node.children?.map((child, index) => (
        <SitemapLedgerItem
          key={child.id}
          node={child}
          depth={depth + 1}
          isLast={index === node.children!.length - 1}
          selectedId={selectedId}
          isFocused={isFocused}
          availableWidth={availableWidth}
          columns={columns}
        />
      ))}
    </box>
  );
}

export function SitemapLedgerHeader({
  availableWidth,
}: SitemapLedgerHeaderProps) {
  const columns = createSitemapLedgerColumns(availableWidth);

  return (
    <box flexDirection="row" width={availableWidth} height={1}>
      <box width={columns.method}>
        <text fg={theme.text.muted}>MTH</text>
      </box>
      <text> </text>
      <box width={columns.route}>
        <text fg={theme.text.muted}>ROUTE</text>
      </box>
      <text> </text>
      <box width={columns.status}>
        <text fg={theme.text.muted}>ST</text>
      </box>
      <text> </text>
      <box width={columns.scope}>
        <text fg={theme.text.muted}>
          {columns.scope <= 4 ? "SCP" : "SCOPE"}
        </text>
      </box>
    </box>
  );
}

export function SitemapLedger({
  nodes,
  selectedIndex,
  isFocused,
  availableWidth,
  emptyMessage = "No routes match current filters.",
}: SitemapLedgerProps) {
  const columns = createSitemapLedgerColumns(availableWidth);
  const entries = flattenTree(nodes).filter((node) => node.entryId);
  const selectedId = entries[selectedIndex]?.id ?? null;

  if (entries.length === 0) {
    return <text fg={theme.text.dim}>{emptyMessage}</text>;
  }

  return (
    <box flexDirection="column" width={availableWidth}>
      {nodes.map((node, index) => (
        <SitemapLedgerItem
          key={node.id}
          node={node}
          depth={0}
          isLast={index === nodes.length - 1}
          selectedId={selectedId}
          isFocused={isFocused}
          availableWidth={availableWidth}
          columns={columns}
        />
      ))}
    </box>
  );
}
