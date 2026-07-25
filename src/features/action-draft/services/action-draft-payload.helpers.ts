import { ActionDraftRecord } from "../model/action-draft.types";

interface ActionDraftPayload {
  command?: unknown;
  formState?: unknown;
}

export function getActionDraftPayload(draft: ActionDraftRecord): ActionDraftPayload {
  return isRecord(draft.payload) ? draft.payload : {};
}

export function getActionDraftCommand(payload: ActionDraftPayload) {
  return typeof payload.command === "string" && payload.command.trim()
    ? payload.command.trim()
    : null;
}

export function getActionDraftFormState(payload: ActionDraftPayload) {
  return isRecord(payload.formState) ? payload.formState : null;
}

export function getActionDraftStringField(formState: Record<string, unknown>, field: string) {
  const value = formState[field];
  return typeof value === "string" ? value : undefined;
}

export function getActionDraftBooleanField(formState: Record<string, unknown>, field: string) {
  const value = formState[field];
  return typeof value === "boolean" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
