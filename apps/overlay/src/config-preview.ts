import type {
  DraftAction,
  DraftField,
  OverlayDraft,
  PaginationDraft,
  RecordingState,
} from "./types";

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

function normalizeActionSteps(actions: DraftAction[]) {
  return actions
    .map((action, index) => {
      const base = {
        id: `action-${index + 1}-${action.type}`,
        label: action.label,
        optional: action.optional ?? false,
      };

      if (action.type === "click" && action.selector) {
        return { ...base, type: "click", selector: action.selector, timeoutMs: 15_000 };
      }
      if (action.type === "fill" && action.selector) {
        return {
          ...base,
          type: "fill",
          selector: action.selector,
          value: action.value ?? "",
          timeoutMs: 15_000,
        };
      }
      if (action.type === "select" && action.selector) {
        return {
          ...base,
          type: "select",
          selector: action.selector,
          value: action.value ?? "",
          timeoutMs: 15_000,
        };
      }
      if (action.type === "scroll") {
        return {
          ...base,
          type: "scroll",
          x: action.x ?? 0,
          y: action.y ?? 0,
          behavior: "auto",
          waitAfterMs: 500,
        };
      }
      if (action.type === "wait") {
        return {
          ...base,
          type: "wait",
          durationMs: Math.max(0, Math.round(action.durationMs ?? 1000)),
          reason: action.reason,
        };
      }
      if (action.type === "checkpoint") {
        return {
          ...base,
          type: "human-checkpoint",
          reason: action.reason || action.label || "Confirm the browser is ready to continue.",
        };
      }

      return undefined;
    })
    .filter(Boolean);
}

export interface DraftIssueContext {
  previewRows?: Record<string, string>[];
}

export function draftIssues(draft: OverlayDraft, context: DraftIssueContext = {}): DraftIssue[] {
  const issues: DraftIssue[] = [];
  const previewWasRun = draft.lastPreviewRowCount !== undefined;
  const previewRows = context.previewRows ?? [];

  if (!draft.itemSelector) {
    issues.push({
      id: "item",
      label: "No repeated records/table shape selected",
      severity: "error",
    });
  }
  if (draft.fields.length === 0) {
    issues.push({ id: "fields", label: "No fields selected", severity: "error" });
  }
  if (
    draft.actions.some(
      (action) =>
        action.type !== "scroll" &&
        action.type !== "wait" &&
        action.type !== "checkpoint" &&
        !action.selector,
    )
  ) {
    issues.push({
      id: "action-selector",
      label: "An action is missing a selector",
      severity: "error",
    });
  }
  if (!previewWasRun && !draft.previewWaived) {
    issues.push({
      id: "preview-required",
      label: "Run preview before saving, or explicitly save without preview",
      severity: "error",
    });
  }
  if (previewWasRun && (draft.lastPreviewRowCount ?? 0) === 0) {
    issues.push({
      id: "zero-preview",
      label: "Last preview produced zero rows",
      severity: "warning",
    });
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
  const emptyRequiredFields = draft.fields.filter(
    (field) =>
      field.required &&
      previewRows.length > 0 &&
      previewRows.every((row) => !String(row[field.name] ?? "").trim()),
  );
  if (emptyRequiredFields.length > 0) {
    issues.push({
      id: "required-fields-empty",
      label: `Required field(s) empty in preview: ${emptyRequiredFields
        .map((field) => field.name)
        .join(", ")}`,
      severity: "warning",
    });
  }
  if (draft.actions.some((action) => action.recordedAfterCapture)) {
    issues.push({
      id: "late-actions",
      label: "An action was recorded after capture setup but will run before extraction",
      severity: "warning",
    });
  }
  if (!draft.pagination) {
    issues.push({ id: "pagination", label: "Pagination is not configured", severity: "warning" });
  } else if (previewWasRun) {
    issues.push({
      id: "pagination-current-page-preview",
      label: "Preview only checks the current page; extraction will use bounded pagination",
      severity: "warning",
    });
  }

  return issues;
}

export function draftIsSavable(draft: OverlayDraft, context: DraftIssueContext = {}): boolean {
  return draftIssues(draft, context).every((issue) => issue.severity !== "error");
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
    group: normalizeOptionalText(draft.group ?? draft.jurisdiction),
    startUrl: draft.startUrl,
    description:
      "Authored with the browser overlay. Edit selectors and input variables as the site changes.",
    tags: ["overlay", "interactive", "web-extraction"],
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
      ...normalizeActionSteps(draft.actions),
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
