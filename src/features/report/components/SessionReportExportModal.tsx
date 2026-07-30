import { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { theme } from "../../../app/theme/theme";
import { severityConfig } from "../../finding/model/finding-summary.constants";
import { FindingReviewStatus } from "../../finding/model/finding.types";
import { SessionReportFinding } from "../model/session-report.types";
import { createDefaultSessionReportPath } from "../services/session-report-path.helpers";
import { sessionReportService } from "../services/session-report.service.instance";

interface SessionReportExportModalProps {
  sessionId: string;
  width: number;
  height: number;
  onClose: () => void;
}

type ReportExportField = "findings" | "output_path";

export function SessionReportExportModal({
  sessionId,
  width,
  height,
  onClose,
}: SessionReportExportModalProps) {
  const [draft] = useState(() => sessionReportService.createDraft(sessionId));
  const [selectedFindingIds, setSelectedFindingIds] = useState(
    () => new Set(draft?.selectedFindingIds ?? []),
  );
  const [selectedFindingIndex, setSelectedFindingIndex] = useState(0);
  const [selectedField, setSelectedField] = useState<ReportExportField>(
    draft?.findings.length ? "findings" : "output_path",
  );
  const [outputPath, setOutputPath] = useState(() =>
    createDefaultSessionReportPath(sessionId),
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const findingScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const findings = draft?.findings ?? [];
  const findingListHeight = Math.max(3, height - 14);

  const toggleFinding = (finding: SessionReportFinding | undefined) => {
    if (!finding || isExporting) {
      return;
    }

    setSelectedFindingIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(finding.id)) {
        nextIds.delete(finding.id);
      } else {
        nextIds.add(finding.id);
      }
      return nextIds;
    });
    setFeedback(null);
  };

  const exportReport = async () => {
    if (!draft || isExporting) {
      return;
    }

    setIsExporting(true);
    setFeedback(null);
    const result = await sessionReportService.exportMarkdown({
      sessionId,
      selectedFindingIds: [...selectedFindingIds],
      outputPath,
    });
    setIsExporting(false);

    if (result.status === "error") {
      setFeedback(result.message);
      return;
    }

    setFeedback(
      `Exported ${result.findingCount} ${result.findingCount === 1 ? "Finding" : "Findings"} to ${result.outputPath}`,
    );
  };

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }

    if (key.name === "tab") {
      setSelectedField((field) => (field === "findings" ? "output_path" : "findings"));
      return;
    }

    if (key.ctrl && key.name === "s") {
      void exportReport();
      return;
    }

    if (selectedField !== "findings") {
      return;
    }

    if (key.name === "up") {
      findingScrollRef.current?.scrollBy(-1, "step");
      setSelectedFindingIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.name === "down") {
      findingScrollRef.current?.scrollBy(1, "step");
      setSelectedFindingIndex((index) => Math.min(Math.max(0, findings.length - 1), index + 1));
      return;
    }

    if (key.name === "space" || key.name === "return") {
      toggleFinding(findings[selectedFindingIndex]);
    }
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor={theme.bg.overlay}
      justifyContent="center"
      alignItems="center"
    >
      <box
        width={width}
        height={height}
        flexDirection="column"
        border
        borderColor={theme.accent.primary}
        backgroundColor={theme.bg.panel}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        title=" Markdown Report Export "
      >
        <text fg={theme.text.secondary}>
          Confirmed Findings start selected. Needs-review Findings require explicit selection.
        </text>
        <text fg={theme.text.dim}>
          Dismissed Findings start excluded. Space toggles selection.
        </text>

        <box flexDirection="row" marginTop={1}>
          <box flexGrow={1}>
            <text
              fg={selectedField === "findings" ? theme.accent.primary : theme.text.secondary}
            >
              <strong>
                {selectedField === "findings" ? "> " : "  "}Findings ({selectedFindingIds.size}/
                {findings.length})
              </strong>
            </text>
          </box>
          <text fg={theme.text.dim}>Esc close</text>
        </box>

        <scrollbox
          ref={findingScrollRef}
          height={findingListHeight}
          width="100%"
          scrollX={false}
          stickyScroll={false}
          verticalScrollbarOptions={{
            visible: true,
            trackOptions: {
              backgroundColor: theme.border.muted,
              foregroundColor: theme.text.secondary,
            },
          }}
        >
          {findings.length === 0 ? (
            <text fg={theme.text.muted}>No persisted Findings in this session.</text>
          ) : (
            findings.map((finding, index) => {
              const isSelected = selectedFindingIds.has(finding.id);
              const isFocused = selectedField === "findings" && selectedFindingIndex === index;

              return (
                <box
                  key={finding.id}
                  flexDirection="column"
                  marginBottom={1}
                  onMouseDown={() => {
                    setSelectedFindingIndex(index);
                    setSelectedField("findings");
                    toggleFinding(finding);
                  }}
                >
                  <text fg={isFocused ? theme.accent.primary : theme.text.primary}>
                    <strong>{isFocused ? ">" : " "}</strong> [{isSelected ? "x" : " "}]{" "}
                    <span fg={severityConfig[finding.severity].color}>
                      {finding.severity.toUpperCase()}
                    </span>{" "}
                    {finding.title}
                  </text>
                  <text fg={theme.text.dim}>
                    {"    "}
                    {reviewStatusLabels[finding.reviewStatus]} · {getSelectionNote(finding)} ·{" "}
                    {finding.sourceTool}
                  </text>
                </box>
              );
            })
          )}
        </scrollbox>

        <box flexDirection="row" marginTop={1}>
          <box width={14}>
            <text
              fg={selectedField === "output_path" ? theme.accent.primary : theme.text.secondary}
            >
              {selectedField === "output_path" ? "> Output path" : "  Output path"}
            </text>
          </box>
          <box flexGrow={1} minWidth={0}>
            <input
              value={outputPath}
              width="100%"
              onInput={setOutputPath}
              focused={selectedField === "output_path"}
              backgroundColor={theme.bg.input}
              textColor={theme.text.primary}
              cursorColor={theme.accent.primary}
              focusedBackgroundColor={theme.bg.elevated}
              placeholderColor={theme.text.dim}
            />
          </box>
        </box>
        <text fg={theme.text.dim}>Existing file at this location will be replaced.</text>
        <text fg={feedback?.startsWith("Exported") ? theme.accent.primary : theme.accent.warning}>
          {feedback ?? (isExporting ? "Exporting Markdown report..." : "Ctrl+S export · Tab switch")}
        </text>
      </box>
    </box>
  );
}

const reviewStatusLabels: Record<FindingReviewStatus, string> = {
  needs_review: "needs review",
  confirmed: "confirmed",
  dismissed: "dismissed",
};

function getSelectionNote(finding: SessionReportFinding) {
  if (finding.reviewStatus === "confirmed") {
    return "selected by default";
  }

  if (finding.reviewStatus === "needs_review") {
    return "explicit opt-in";
  }

  return "excluded by default";
}
