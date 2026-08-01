import { afterEach, describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { act } from "react";
import { sessionRepository } from "../../../session/services/session.repository";
import { sessionReportDraftRepository } from "../../services/session-report-draft.repository.instance";
import { SessionReportExportModal } from "../SessionReportExportModal";

let testSetup: Awaited<ReturnType<typeof testRender>> | null = null;

afterEach(async () => {
  await act(async () => {
    testSetup?.renderer.destroy();
  });
  testSetup = null;
});

describe("SessionReportExportModal", () => {
  test("keeps selection actions and deterministic fallback visible at dashboard modal size", async () => {
    const targetUrl = `https://report-selection-${crypto.randomUUID()}.example.test`;
    const target = sessionRepository.findOrCreateTarget(targetUrl, targetUrl);
    const session = sessionRepository.createSession(target.id);

    testSetup = await testRender(
      <SessionReportExportModal
        sessionId={session.id}
        width={88}
        height={28}
        onClose={() => {}}
      />,
      { width: 96, height: 34 },
    );
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain("Output path");
    expect(frame).toContain("Ctrl+G generate draft");
    expect(frame).toContain("Ctrl+S deterministic export");
  });

  test("reopens and persists operator edits through focused textarea interactions", async () => {
    const targetUrl = `https://report-modal-${crypto.randomUUID()}.example.test`;
    const target = sessionRepository.findOrCreateTarget(targetUrl, targetUrl);
    const session = sessionRepository.createSession(target.id);
    sessionReportDraftRepository.save({
      sessionId: session.id,
      selectedFindingIds: [],
      markdown: "# Saved editable draft",
    });
    let closeCount = 0;

    testSetup = await testRender(
      <SessionReportExportModal
        sessionId={session.id}
        width={88}
        height={28}
        onClose={() => {
          closeCount += 1;
        }}
      />,
      { width: 96, height: 34 },
    );
    await testSetup.renderOnce();

    expect(testSetup.captureCharFrame()).toContain("# Saved editable draft");
    expect(testSetup.captureCharFrame()).toContain("LLM-authored sections are editable");

    await act(async () => {
      await testSetup!.mockInput.typeText("\n\nOperator verified wording.");
      testSetup!.mockInput.pressKey("s", { ctrl: true });
    });
    await testSetup.renderOnce();

    expect(sessionReportDraftRepository.findBySessionId(session.id)?.markdown).toContain(
      "Operator verified wording.",
    );
    expect(testSetup.captureCharFrame()).toContain("Saved operator-edited report draft.");

    await act(async () => {
      testSetup!.mockInput.pressEscape();
      await Bun.sleep(40);
    });
    await testSetup.renderOnce();
    await testSetup.renderOnce();
    expect(closeCount).toBe(0);
    expect(testSetup.captureCharFrame()).toContain("Report Draft & Export");

    await act(async () => {
      testSetup!.mockInput.pressKey("d", { ctrl: true });
    });
    await testSetup.renderOnce();
    expect(testSetup.captureCharFrame()).toContain("Operator verified wording.");
  });
});
