import {
  GenerateSessionReportDraftInput,
  GenerateSessionReportDraftResult,
  SessionReportDraftRecord,
  SessionReportDraftProvider,
  SessionReportDraftReadModel,
  SessionReportDraftStore,
} from "../model/session-report-draft.types";
import { createLlmAssistedSessionReportMarkdown } from "./session-report-draft-markdown.helpers";
import { createSessionReportDraftPrompt } from "./session-report-draft-prompt.helpers";
import { mapSessionReportDraftResponse } from "./session-report-draft-response.mapper";

export class SessionReportDraftService {
  constructor(
    private readonly reports: SessionReportDraftReadModel,
    private readonly provider: SessionReportDraftProvider,
    private readonly drafts: SessionReportDraftStore,
  ) {}

  async generate({
    sessionId,
    selectedFindingIds,
    signal,
  }: GenerateSessionReportDraftInput): Promise<GenerateSessionReportDraftResult> {
    const draft = this.reports.createDraft(sessionId);
    if (!draft) {
      return {
        status: "error",
        message: "Testing session was not found. Deterministic Markdown export remains available.",
      };
    }

    const selectedIds = [...new Set(selectedFindingIds)];
    if (selectedIds.length === 0) {
      return {
        status: "error",
        message: "Select at least one Finding before starting LLM-assisted drafting.",
      };
    }
    const availableFindingIds = new Set(draft.findings.map((finding) => finding.id));
    if (selectedIds.some((findingId) => !availableFindingIds.has(findingId))) {
      return {
        status: "error",
        message:
          "Selected Findings are no longer available. Review the selection before drafting. Deterministic Markdown export remains available.",
      };
    }

    try {
      const prompt = createSessionReportDraftPrompt(draft, selectedIds);
      const response = await this.provider.generate({
        sessionId,
        prompt,
        ...(signal ? { signal } : {}),
      });
      const editorialPlan = mapSessionReportDraftResponse(response, selectedIds);

      return {
        status: "success",
        markdown: createLlmAssistedSessionReportMarkdown(
          draft,
          selectedIds,
          editorialPlan,
        ),
        selectedFindingIds: selectedIds,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const punctuatedDetail = /[.!?]$/.test(detail) ? detail : `${detail}.`;
      return {
        status: "error",
        message: `Unable to generate LLM-assisted report draft: ${punctuatedDetail} Deterministic Markdown export remains available.`,
      };
    }
  }

  load(sessionId: string): SessionReportDraftRecord | null {
    return this.drafts.findBySessionId(sessionId);
  }

  save(
    sessionId: string,
    selectedFindingIds: string[],
    markdown: string,
  ): SessionReportDraftRecord {
    return this.drafts.save({
      sessionId,
      selectedFindingIds,
      markdown,
    });
  }
}
