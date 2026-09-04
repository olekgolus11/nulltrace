import { KeyEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useRef, useState } from "react";
import { theme } from "../../../app/theme/theme";
import { severityConfig } from "../../finding/model/finding-summary.constants";
import { FindingReviewStatus } from "../../finding/model/finding.types";
import { SessionReportFinding } from "../model/session-report.types";
import { createDefaultSessionReportPath } from "../services/session-report-path.helpers";
import { sessionReportDraftService } from "../services/session-report-draft.service.instance";
import { sessionReportService } from "../services/session-report.service.instance";
import { standardScrollbarTrackOptions } from "../../../shared/ui/scrollbar.config";

interface SessionReportExportModalProps {
  sessionId: string;
  width: number;
  height: number;
  onClose: () => void;
}

type ReportExportField = "findings" | "output_path";
type ReportModalMode = "selection" | "editor";

export function SessionReportExportModal({
  sessionId,
  width,
  height,
  onClose,
}: SessionReportExportModalProps) {
  const [draft] = useState(() => sessionReportService.createDraft(sessionId));
  const [savedDraft] = useState(() => sessionReportDraftService.load(sessionId));
  const [selectedFindingIds, setSelectedFindingIds] = useState(
    () =>
      new Set(
        (savedDraft?.selectedFindingIds ?? draft?.selectedFindingIds ?? []).filter((findingId) =>
          draft?.findings.some((finding) => finding.id === findingId),
        ),
      ),
  );
  const [mode, setMode] = useState<ReportModalMode>(savedDraft ? "editor" : "selection");
  const [draftMarkdown, setDraftMarkdown] = useState(savedDraft?.markdown ?? "");
  const [draftFindingIds, setDraftFindingIds] = useState(
    savedDraft?.selectedFindingIds ?? [],
  );
  const [editorRevision, setEditorRevision] = useState(0);
  const [selectedFindingIndex, setSelectedFindingIndex] = useState(0);
  const [selectedField, setSelectedField] = useState<ReportExportField>(
    draft?.findings.length ? "findings" : "output_path",
  );
  const [outputPath, setOutputPath] = useState(() =>
    createDefaultSessionReportPath(sessionId),
  );
  const [feedback, setFeedback] = useState<string | null>(
    savedDraft ? "Loaded saved editable report draft." : null,
  );
  const [isWorking, setIsWorking] = useState(false);
  const findingScrollRef = useRef<ScrollBoxRenderable | null>(null);
  const editorRef = useRef<TextareaRenderable | null>(null);
  const generationAbortRef = useRef<AbortController | null>(null);
  const findings = draft?.findings ?? [];
  const findingListHeight = Math.max(3, height - 15);
  const editorHeight = Math.max(4, height - 10);

  const toggleFinding = (finding: SessionReportFinding | undefined) => {
    if (!finding || isWorking) {
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

  const exportDeterministicReport = async () => {
    if (!draft || isWorking) {
      return;
    }

    setIsWorking(true);
    setFeedback(null);
    const result = await sessionReportService.exportMarkdown({
      sessionId,
      selectedFindingIds: [...selectedFindingIds],
      outputPath,
    });
    setIsWorking(false);
    setFeedback(
      result.status === "error"
        ? result.message
        : `Exported deterministic report with ${result.findingCount} ${result.findingCount === 1 ? "Finding" : "Findings"} to ${result.outputPath}`,
    );
  };

  const generateLlmDraft = async () => {
    if (!draft || isWorking) {
      return;
    }

    const abortController = new AbortController();
    generationAbortRef.current = abortController;
    setIsWorking(true);
    setFeedback("Generating bounded LLM-assisted draft... Esc cancels.");
    const result = await sessionReportDraftService.generate({
      sessionId,
      selectedFindingIds: [...selectedFindingIds],
      signal: abortController.signal,
    });
    generationAbortRef.current = null;
    setIsWorking(false);

    if (result.status === "error") {
      setFeedback(result.message);
      return;
    }

    setDraftMarkdown(result.markdown);
    setDraftFindingIds(result.selectedFindingIds);
    setEditorRevision((revision) => revision + 1);
    setMode("editor");
    setFeedback("Generated editable draft. Verify all LLM-authored prose before use.");
  };

  const saveDraft = () => {
    if (isWorking) {
      return;
    }

    const currentMarkdown = editorRef.current?.plainText ?? draftMarkdown;
    if (!currentMarkdown.trim()) {
      setFeedback("Report draft is empty. Add Markdown content before saving.");
      return;
    }

    try {
      sessionReportDraftService.save(
        sessionId,
        draftFindingIds,
        currentMarkdown,
      );
      setDraftMarkdown(currentMarkdown);
      setFeedback("Saved operator-edited report draft.");
    } catch (error) {
      setFeedback(
        `Unable to save report draft: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const exportEditedDraft = async () => {
    if (isWorking) {
      return;
    }

    const currentMarkdown = editorRef.current?.plainText ?? draftMarkdown;
    setIsWorking(true);
    const result = await sessionReportService.exportMarkdownContent({
      markdown: currentMarkdown,
      selectedFindingIds: draftFindingIds,
      outputPath,
    });
    setIsWorking(false);
    if (result.status === "error") {
      setFeedback(result.message);
      return;
    }

    setDraftMarkdown(currentMarkdown);
    setFeedback(`Exported edited Markdown draft to ${result.outputPath}`);
  };

  const handleEditorKey = (key: KeyEvent) => {
    if (key.ctrl && key.name === "s") {
      key.preventDefault();
      saveDraft();
      return;
    }
    if (key.ctrl && key.name === "e") {
      key.preventDefault();
      void exportEditedDraft();
      return;
    }
    if (key.name === "escape") {
      key.preventDefault();
      setDraftMarkdown(editorRef.current?.plainText ?? draftMarkdown);
      setMode("selection");
      setFeedback("Editable draft preserved. Ctrl+D returns to editor.");
    }
  };

  useKeyboard((key) => {
    if (generationAbortRef.current && key.name === "escape") {
      generationAbortRef.current?.abort();
      setFeedback("Cancelling LLM-assisted drafting. Current selection and edits are preserved.");
      return;
    }

    if (isWorking) {
      return;
    }

    if (mode === "editor") {
      handleEditorKey(key);
      return;
    }

    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.ctrl && key.name === "g") {
      void generateLlmDraft();
      return;
    }
    if (key.ctrl && key.name === "d" && draftMarkdown) {
      setEditorRevision((revision) => revision + 1);
      setMode("editor");
      setFeedback("Editable draft reopened.");
      return;
    }
    if (key.name === "tab") {
      setSelectedField((field) => (field === "findings" ? "output_path" : "findings"));
      return;
    }
    if (key.ctrl && key.name === "s") {
      void exportDeterministicReport();
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
      setSelectedFindingIndex((index) =>
        Math.min(Math.max(0, findings.length - 1), index + 1),
      );
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
        title={mode === "editor" ? " Editable Markdown Report Draft " : " Report Draft & Export "}
      >
        {mode === "editor" ? (
          <>
            <text fg={theme.accent.warning}>
              LLM-authored sections are editable draft content. Verify before use.
            </text>
            <text fg={theme.text.dim}>
              Deterministic scanner facts and Source Context remain labeled below generated prose.
            </text>
            <box height={editorHeight} marginTop={1}>
              <textarea
                key={editorRevision}
                ref={editorRef}
                initialValue={draftMarkdown}
                width="100%"
                height="100%"
                focused
                wrapMode="word"
                backgroundColor={theme.bg.input}
                focusedBackgroundColor={theme.bg.input}
                textColor={theme.text.primary}
                focusedTextColor={theme.text.primary}
                cursorColor={theme.accent.primary}
                onKeyDown={handleEditorKey}
                onContentChange={() => {
                  if (editorRef.current) {
                    setDraftMarkdown(editorRef.current.plainText);
                  }
                }}
              />
            </box>
            <text fg={feedbackColor(feedback)}>
              {feedback ??
                (isWorking
                  ? "Exporting edited Markdown draft..."
                  : "Ctrl+S save · Ctrl+E export · Esc selections")}
            </text>
          </>
        ) : (
          <>
            <text fg={theme.text.secondary}>
              Confirmed Findings start selected. Needs-review Findings require explicit selection.
            </text>
            <text fg={theme.text.dim}>
              Dismissed Findings start excluded. Space toggles selection. Drafting never starts automatically.
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
                trackOptions: standardScrollbarTrackOptions,
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
            <text fg={feedbackColor(feedback)}>
              {feedback ??
                (isWorking
                  ? "Working..."
                  : `Ctrl+G generate draft · Ctrl+S deterministic export${draftMarkdown ? " · Ctrl+D edit draft" : ""}`)}
            </text>
          </>
        )}
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

function feedbackColor(feedback: string | null) {
  if (
    feedback?.startsWith("Saved") ||
    feedback?.startsWith("Loaded") ||
    feedback?.startsWith("Generated") ||
    feedback?.startsWith("Exported") ||
    feedback?.startsWith("Editable")
  ) {
    return theme.accent.primary;
  }

  return feedback ? theme.accent.warning : theme.text.dim;
}
