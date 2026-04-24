import type { DraftField, OverlayDraft, PaginationDraft, RecordingState } from "./types";

export interface DraftIssue {
  id: string;
  label: string;
  severity: "error" | "warning";
}

function normalizeFieldName(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeFields(fields: DraftField[]) {
  return fields.map((field, index) => ({
    name: normalizeFieldName(field.name, `field_${index + 1}`),
    selector: field.selector,
    attribute: field.attribute || "text",
    required: field.required,
    transform: field.transform,
    selectorMeta: field.selectorMeta,
  }));
}

function normalizePagination(pagination: PaginationDraft | undefined) {
  if (!pagination?.nextSelector) {
    return undefined;
  }

  return {
    nextSelector: pagination.nextSelector,
    maxPages:
      Number.isInteger(pagination.maxPages) && pagination.maxPages > 0 ? pagination.maxPages : 25,
    waitAfterMs:
      Number.isInteger(pagination.waitAfterMs) && pagination.waitAfterMs >= 0
        ? pagination.waitAfterMs
        : 750,
    stopWhenSelectorDisabled: pagination.stopWhenSelectorDisabled ?? true,
  };
}

export function draftIssues(draft: OverlayDraft): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (!draft.itemSelector) {
    issues.push({ id: "item", label: "No repeated data shape selected", severity: "error" });
  }
  if (draft.fields.length === 0) {
    issues.push({ id: "fields", label: "No fields selected", severity: "error" });
  }
  if (draft.fields.some((field) => !field.name.trim())) {
    issues.push({ id: "field-name", label: "A field is missing a name", severity: "error" });
  }
  if (
    draft.fields.some(
      (field) =>
        field.selectorMeta &&
        field.selectorMeta.confidence > 0 &&
        field.selectorMeta.confidence < 0.45,
    )
  ) {
    issues.push({
      id: "confidence",
      label: "One or more selectors have low confidence",
      severity: "warning",
    });
  }
  if (!draft.pagination) {
    issues.push({ id: "pagination", label: "Pagination is not configured", severity: "warning" });
  }

  return issues;
}

export function draftIsSavable(draft: OverlayDraft): boolean {
  return draftIssues(draft).every((issue) => issue.severity !== "error");
}

export function buildGeneratedConfigPreview(
  draft: OverlayDraft,
  previewRowCount: number,
  recording?: RecordingState,
) {
  const now = new Date().toISOString();
  const fields = normalizeFields(draft.fields);
  const pagination = normalizePagination(draft.pagination);
  const sourceUrl = draft.sourceUrl || location.href;

  const extractionStep =
    draft.extractionKind === "table" && draft.tableSelector && draft.rowSelector
      ? {
          id: "extract-overlay-table",
          type: "extract-table",
          label: "Overlay table extraction",
          optional: false,
          selector: draft.tableSelector,
          rowSelector: draft.rowSelector,
          fields,
          pagination,
          outputKey: "rows",
        }
      : {
          id: "extract-overlay-list",
          type: "extract-list",
          label: "Overlay list extraction",
          optional: false,
          itemSelector: draft.itemSelector ?? "",
          fields,
          pagination,
          outputKey: "items",
        };

  return {
    schema: "web-seek.site-config.v1",
    id: draft.id,
    name: draft.name,
    jurisdiction: normalizeOptionalText(draft.jurisdiction),
    startUrl: draft.startUrl,
    description:
      "Authored with the browser overlay. Edit selectors and input variables as the site changes.",
    tags: ["overlay", "interactive", "government-data"],
    createdAt: now,
    updatedAt: now,
    browser: {
      headless: false,
      viewport: { width: 1440, height: 1000 },
      slowMoMs: 0,
    },
    humanInLoop: {
      enabled: true,
      pauseBeforeRun: false,
      challengeDetection: true,
      instructions: "Use the browser when the CLI requests human action.",
    },
    authoring: {
      sourceUrl,
      createdWith: "overlay",
      lastPreviewRowCount: previewRowCount || draft.lastPreviewRowCount,
      recordingId: recording?.id,
      recordingPath: recording?.path,
      recordingEventCount: recording?.eventCount,
      notes: normalizeOptionalText(draft.notes),
    },
    steps: [
      {
        id: "open-authored-page",
        type: "navigate",
        label: "Open authored page",
        optional: false,
        url: sourceUrl,
        waitUntil: "domcontentloaded",
      },
      {
        id: "human-review",
        type: "human-checkpoint",
        label: "Human review",
        optional: false,
        reason: "Review the page, solve CAPTCHA if present, and confirm the data page is ready.",
      },
      extractionStep,
    ],
    output: {
      format: "both",
      directory: "exports",
    },
  };
}

export function averageSelectorConfidence(draft: OverlayDraft): number {
  const values = [
    draft.itemSelectorMeta?.confidence,
    draft.pagination?.selectorMeta?.confidence,
    ...draft.fields.map((field) => field.selectorMeta?.confidence),
  ].filter((value): value is number => typeof value === "number");

  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}
