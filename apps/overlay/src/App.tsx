import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BadgeCheck,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Code2,
  Columns3,
  Copy,
  Database,
  Eye,
  FileJson,
  Gauge,
  GripVertical,
  Layers3,
  ListTree,
  MoreHorizontal,
  MousePointer2,
  PencilLine,
  Play,
  Radio,
  Route,
  Save,
  Settings2,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  averageSelectorConfidence,
  buildGeneratedConfigPreview,
  draftIsSavable,
  draftIssues,
} from "./config-preview";
import {
  buildFieldFromElement,
  buildPaginationFromElement,
  buildSuggestedFields,
  detectRepeatedItem,
  extractPreviewRows,
  isDataShapeCandidateTarget,
  isPaginationLikeElement,
  rectForElement,
  rectsForSelector,
  selectorMetaForElement,
} from "./dom-engine";
import type { RepeatedItemResult } from "./dom-engine";
import type {
  DraftAction,
  DraftField,
  FieldTransform,
  OverlayDraft,
  PaginationDraft,
  PickerMode,
  RecordingState,
  RectSnapshot,
  SelectorMeta,
  SelectorStrategy,
} from "./types";

const ATTRIBUTE_OPTIONS = ["text", "href", "src", "value", "html", "aria-label", "title"];
const TRANSFORM_OPTIONS: Array<{ value: FieldTransform | ""; label: string }> = [
  { value: "trim", label: "trim" },
  { value: "number", label: "number" },
  { value: "date", label: "date" },
  { value: "uppercase", label: "uppercase" },
  { value: "lowercase", label: "lowercase" },
  { value: "", label: "none" },
];
const FIELD_TRANSFORMS = new Set<FieldTransform>(
  TRANSFORM_OPTIONS.map((option) => option.value).filter((value): value is FieldTransform =>
    Boolean(value),
  ),
);
const SELECTOR_STRATEGIES = new Set<SelectorStrategy>([
  "id",
  "attribute",
  "text-nearby",
  "table-position",
  "structural",
  "nth-of-type",
]);
const ACTION_TYPES = new Set<DraftAction["type"]>([
  "click",
  "fill",
  "select",
  "scroll",
  "wait",
  "checkpoint",
]);

type PanelTab = "shape" | "actions" | "fields" | "preview" | "json" | "guide" | "diagnostics";
type ToolPalette = "capture" | "record" | "output";

interface AppProps {
  host: HTMLElement;
}

interface DataShapeSuggestion {
  result: RepeatedItemResult;
  fields: DraftField[];
  anchorRect: RectSnapshot;
}

interface ActionStats {
  startedAt: number;
  mutations: number;
  network: number;
  pointerMoves: number;
}

interface ActionSession extends ActionStats {
  actions: DraftAction[];
  startScrollX: number;
  startScrollY: number;
}

interface PanelPosition {
  x: number;
  y: number;
}

interface PanelSize {
  width: number;
  height: number;
}

const PANEL_MIN_WIDTH = 390;
const PANEL_MIN_HEIGHT = 360;
const PANEL_MAX_WIDTH = 820;
const PANEL_MARGIN = 12;

function bridgeSend(
  type: "ready" | "draft-change" | "save-config" | "close-overlay" | "recording-status",
  draft?: OverlayDraft,
) {
  return window.webSeekBridge?.send({ type, draft });
}

function isOverlayEvent(event: Event, host: HTMLElement): boolean {
  return event.composedPath().includes(host);
}

function targetElement(event: Event): Element | undefined {
  const target = event.target;
  return target instanceof Element ? target : undefined;
}

function percent(value: number | undefined): number {
  return Math.round((value ?? 0) * 100);
}

function modeLabel(mode: PickerMode): string {
  if (mode === "item") {
    return "Smart shape";
  }
  if (mode === "field") {
    return "Field picker";
  }
  if (mode === "pagination") {
    return "Paging picker";
  }
  if (mode === "action") {
    return "Action recorder";
  }
  return "Inspect";
}

function panelTabTitle(tab: PanelTab): string {
  if (tab === "shape") {
    return "Shape editor";
  }
  if (tab === "actions") {
    return "Action flow";
  }
  if (tab === "fields") {
    return "Field selectors";
  }
  if (tab === "preview") {
    return "Data preview";
  }
  if (tab === "json") {
    return "JSON editor";
  }
  if (tab === "guide") {
    return "Agent guide";
  }
  return "Diagnostics";
}

function panelTabDescription(tab: PanelTab): string {
  if (tab === "shape") {
    return "Pick the repeated record and optional pagination control.";
  }
  if (tab === "actions") {
    return "Recorded clicks, fills, selects, and scrolls before extraction.";
  }
  if (tab === "fields") {
    return "Relative selectors and output attributes for each row.";
  }
  if (tab === "preview") {
    return "Rows extracted from the current page with the draft selectors.";
  }
  if (tab === "json") {
    return "Generated config preview plus editable draft JSON.";
  }
  if (tab === "guide") {
    return "Plain-language workflow contract an agent can follow.";
  }
  return "Missing required pieces and save readiness.";
}

function actionLabel(action: DraftAction): string {
  if (action.label) {
    return action.label;
  }
  if (action.type === "scroll") {
    return `Scroll to ${action.x ?? 0}, ${action.y ?? 0}`;
  }
  return `${action.type} ${action.selector ?? ""}`.trim();
}

function actionStepText(action: DraftAction): string {
  if (action.type === "fill" || action.type === "select") {
    return `${action.type} ${action.selector} = ${action.value ?? ""}`;
  }
  if (action.type === "scroll") {
    return `scroll x:${action.x ?? 0} y:${action.y ?? 0}`;
  }
  if (action.type === "wait") {
    return `wait ${action.durationMs ?? 1000}ms`;
  }
  if (action.type === "checkpoint") {
    return `checkpoint ${action.reason ?? action.label ?? ""}`.trim();
  }
  return `${action.type} ${action.selector ?? ""}`;
}

function selectorMatchCount(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function confidenceLabel(value: number | undefined): string {
  return `${percent(value)}%`;
}

function inferredScenarioLabel(draft: OverlayDraft, previewCount: number): string {
  if (draft.actions.length > 0 && draft.pagination) {
    return "Search or setup flow with pagination";
  }
  if (draft.actions.length > 0) {
    return "Search or setup flow before capture";
  }
  if (draft.pagination) {
    return "Paginated results capture";
  }
  if (previewCount > 0 || draft.fields.length > 0) {
    return "Current-page data capture";
  }
  return "Undecided authoring flow";
}

function suggestedNextStep(draft: OverlayDraft, previewCount: number): string {
  if (draft.actions.length === 0 && !draft.itemSelector) {
    return "If the page needs search/filtering, record navigation actions first; otherwise select the repeated records/table shape.";
  }
  if (!draft.itemSelector) {
    return "Select one repeated row, card, or table record.";
  }
  if (draft.fields.length === 0) {
    return "Add the fields that should appear in each extracted row.";
  }
  if (previewCount === 0) {
    return "Run preview and compare the rows against the visible page.";
  }
  if (!draft.pagination) {
    return "Add pagination only if the data continues onto another page.";
  }
  return "Review the agent guide, then save the validated config.";
}

function buildAgentGuideMarkdown(
  draft: OverlayDraft,
  previewCount: number,
  recording: RecordingState | undefined,
  issues: ReturnType<typeof draftIssues>,
): string {
  const lines = [
    `# Web Seek Agent Guide: ${draft.name}`,
    "",
    "Use this as the workflow contract for reproducing the browser task. Keep the run bounded, respect access controls, and pause for any human-only decision.",
    "",
    "## Scenario",
    `- Inferred scenario: ${inferredScenarioLabel(draft, previewCount)}`,
    `- Next recommended step: ${suggestedNextStep(draft, previewCount)}`,
    "",
    "## 1. Navigate",
    `- Start URL: ${draft.startUrl}`,
    `- Authoring URL: ${draft.sourceUrl}`,
    `- Recorded setup actions: ${draft.actions.length}`,
  ];

  if (draft.actions.length > 0) {
    draft.actions.forEach((action, index) => {
      lines.push(`  ${index + 1}. ${actionStepText(action)}`);
    });
  } else {
    lines.push("  - No setup actions recorded. Start from the source URL and capture directly.");
  }

  lines.push("", "## 2. Capture");
  lines.push(`- Repeated record selector: ${draft.itemSelector ?? "not selected"}`);
  lines.push(`- Extraction kind: ${draft.extractionKind}`);
  if (draft.fields.length > 0) {
    draft.fields.forEach((field, index) => {
      lines.push(
        `  ${index + 1}. ${field.name}: ${field.selector} -> ${field.attribute} (${confidenceLabel(field.selectorMeta?.confidence)})`,
      );
    });
  } else {
    lines.push("  - No fields selected yet.");
  }

  lines.push("", "## 3. Loop");
  if (draft.pagination) {
    lines.push(`- Next control selector: ${draft.pagination.nextSelector}`);
    lines.push(`- Max pages: ${draft.pagination.maxPages}`);
    lines.push(`- Wait after page change: ${draft.pagination.waitAfterMs}ms`);
    lines.push(`- Stop when disabled: ${draft.pagination.stopWhenSelectorDisabled ? "yes" : "no"}`);
  } else {
    lines.push(
      "- No pagination configured. Treat extraction as current-page only unless the operator records a loop.",
    );
  }

  lines.push("", "## 4. Verify");
  lines.push(`- Last preview row count: ${previewCount || draft.lastPreviewRowCount || 0}`);
  lines.push(`- Selector confidence average: ${confidenceLabel(averageSelectorConfidence(draft))}`);
  lines.push(
    `- Recording: ${recording ? `${recording.id} (${recording.eventCount} events)` : "none"}`,
  );
  lines.push(`- Save readiness: ${issues.length === 0 ? "ready" : `${issues.length} issue(s)`}`);
  for (const issue of issues) {
    lines.push(`  - ${issue.severity.toUpperCase()}: ${issue.label}`);
  }

  lines.push("", "## Agent Notes");
  lines.push(
    "- Navigate first, then capture the repeated records/table shape, then fields, then configure loop/pagination only when needed.",
  );
  lines.push(
    "- Use selectors as hypotheses; verify visible row counts against the page before a full run.",
  );
  lines.push(
    "- Do not bypass access controls, paywalls, authentication, rate limits, anti-bot checks, or terms screens.",
  );

  return lines.join("\n");
}

function textForAction(element: Element): string {
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("name") ||
    element.getAttribute("title") ||
    element.textContent ||
    element.tagName.toLowerCase();
  return label.replace(/\s+/g, " ").trim().slice(0, 80);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeSelectorMeta(value: unknown): SelectorMeta | undefined {
  const record = asRecord(value);
  if (!record || !SELECTOR_STRATEGIES.has(record.strategy as SelectorStrategy)) {
    return undefined;
  }

  return {
    strategy: record.strategy as SelectorStrategy,
    confidence: Math.max(0, Math.min(1, numberValue(record.confidence, 0))),
    alternates: stringArray(record.alternates),
    sample: optionalString(record.sample),
  };
}

function normalizeDraftField(value: unknown, index: number): DraftField | undefined {
  const record = asRecord(value);
  const selector = optionalString(record?.selector);
  if (!record || !selector) {
    return undefined;
  }

  const transform =
    typeof record.transform === "string" && FIELD_TRANSFORMS.has(record.transform as FieldTransform)
      ? (record.transform as FieldTransform)
      : undefined;

  return {
    id: stringValue(record.id, `field-${index + 1}`),
    name: stringValue(record.name, `field_${index + 1}`),
    selector,
    attribute: stringValue(record.attribute, "text"),
    required: booleanValue(record.required, false),
    transform,
    selectorMeta: normalizeSelectorMeta(record.selectorMeta),
  };
}

function normalizeDraftAction(value: unknown, index: number): DraftAction | undefined {
  const record = asRecord(value);
  if (!record || !ACTION_TYPES.has(record.type as DraftAction["type"])) {
    return undefined;
  }

  return {
    id: stringValue(record.id, `action-${index + 1}`),
    type: record.type as DraftAction["type"],
    selector: optionalString(record.selector),
    value: optionalString(record.value),
    x: typeof record.x === "number" ? record.x : undefined,
    y: typeof record.y === "number" ? record.y : undefined,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
    reason: optionalString(record.reason),
    optional: booleanValue(record.optional, false),
    recordedAfterCapture: booleanValue(record.recordedAfterCapture, false),
    label: optionalString(record.label),
    selectorMeta: normalizeSelectorMeta(record.selectorMeta),
    observedMutations: numberValue(record.observedMutations, 0),
    observedNetwork: numberValue(record.observedNetwork, 0),
    pointerMoves: numberValue(record.pointerMoves, 0),
    paginationHint: booleanValue(record.paginationHint, false),
  };
}

function normalizePagination(value: unknown): PaginationDraft | undefined {
  const record = asRecord(value);
  const nextSelector = optionalString(record?.nextSelector);
  if (!record || !nextSelector) {
    return undefined;
  }

  return {
    nextSelector,
    maxPages: Math.max(1, Math.round(numberValue(record.maxPages, 25))),
    waitAfterMs: Math.max(0, Math.round(numberValue(record.waitAfterMs, 750))),
    stopWhenSelectorDisabled: booleanValue(record.stopWhenSelectorDisabled, true),
    selectorMeta: normalizeSelectorMeta(record.selectorMeta),
  };
}

function normalizeDraftFromJson(value: unknown, previous: OverlayDraft): OverlayDraft {
  const record = asRecord(value);
  if (!record) {
    throw new Error("Draft JSON must be an object.");
  }

  const fields = Array.isArray(record.fields)
    ? record.fields
        .map((field, index) => normalizeDraftField(field, index))
        .filter((field): field is DraftField => Boolean(field))
    : previous.fields;
  const actions = Array.isArray(record.actions)
    ? record.actions
        .map((action, index) => normalizeDraftAction(action, index))
        .filter((action): action is DraftAction => Boolean(action))
    : previous.actions;

  return {
    id: stringValue(record.id, previous.id),
    name: stringValue(record.name, previous.name),
    group: optionalString(record.group) ?? optionalString(record.jurisdiction),
    startUrl: stringValue(record.startUrl, previous.startUrl),
    sourceUrl: stringValue(record.sourceUrl, previous.sourceUrl),
    extractionKind: record.extractionKind === "table" ? "table" : "list",
    itemSelector: optionalString(record.itemSelector),
    itemSelectorMeta: normalizeSelectorMeta(record.itemSelectorMeta),
    tableSelector: optionalString(record.tableSelector),
    rowSelector: optionalString(record.rowSelector),
    fields,
    actions,
    pagination: normalizePagination(record.pagination),
    lastPreviewRowCount:
      typeof record.lastPreviewRowCount === "number" ? record.lastPreviewRowCount : undefined,
    previewWaived: booleanValue(record.previewWaived, false),
    notes: optionalString(record.notes),
  };
}

function rowKey(row: Record<string, string>): string {
  return Object.entries(row)
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampPanelSize(size: PanelSize): PanelSize {
  return {
    width: clampNumber(
      size.width,
      PANEL_MIN_WIDTH,
      Math.min(PANEL_MAX_WIDTH, window.innerWidth - 24),
    ),
    height: clampNumber(size.height, PANEL_MIN_HEIGHT, window.innerHeight - 24),
  };
}

function clampPanelPosition(position: PanelPosition, size: PanelSize): PanelPosition {
  return {
    x: clampNumber(
      position.x,
      PANEL_MARGIN,
      Math.max(PANEL_MARGIN, window.innerWidth - size.width - PANEL_MARGIN),
    ),
    y: clampNumber(
      position.y,
      PANEL_MARGIN,
      Math.max(PANEL_MARGIN, window.innerHeight - size.height - PANEL_MARGIN),
    ),
  };
}

function initialPanelSize(): PanelSize {
  return clampPanelSize({
    width: Math.min(500, window.innerWidth - 32),
    height: Math.min(680, window.innerHeight - 32),
  });
}

function initialPanelPosition(size: PanelSize): PanelPosition {
  return clampPanelPosition(
    {
      x: window.innerWidth - size.width - 18,
      y: 18,
    },
    size,
  );
}

function toolbarClass(active: boolean): string {
  return [
    "flex h-8 items-center gap-1.5 rounded-[4px] border px-2 text-xs font-semibold leading-none transition",
    active
      ? "border-teal-700 bg-teal-700 text-white shadow-sm"
      : "border-slate-950/20 bg-white/95 text-slate-800 shadow-sm hover:border-slate-950/40 hover:bg-slate-50",
  ].join(" ");
}

function IconButton({
  active,
  label,
  tooltip,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  tooltip?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const hint = tooltip ?? label;
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        title={hint}
        aria-label={hint}
        className={toolbarClass(Boolean(active))}
      >
        {children}
        <span className="max-w-20 truncate">{label}</span>
      </button>
      <span className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-[2147483647] hidden w-max max-w-64 -translate-x-1/2 rounded-[3px] border border-slate-950/20 bg-slate-950 px-2 py-1 text-[11px] font-semibold leading-4 text-white shadow-lg group-hover:block">
        {hint}
      </span>
    </span>
  );
}

function DragHandle({
  listeners,
  attributes,
}: {
  listeners?: object;
  attributes?: object;
}) {
  return (
    <button
      type="button"
      title="Reorder"
      className="mt-0.5 flex h-8 w-8 shrink-0 cursor-grab items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 active:cursor-grabbing"
      {...(attributes ?? {})}
      {...(listeners ?? {})}
    >
      <GripVertical size={15} />
    </button>
  );
}

function DetailPanelShell({
  position,
  size,
  title,
  status,
  issueCount,
  hasErrors,
  recording,
  quality,
  children,
  onClose,
  onDiagnostics,
  onResize,
}: {
  position: PanelPosition;
  size: PanelSize;
  title: string;
  status: string;
  issueCount: number;
  hasErrors: boolean;
  recording?: RecordingState;
  quality: number;
  children: React.ReactNode;
  onClose: () => void;
  onDiagnostics: () => void;
  onResize: (size: PanelSize) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: "detail-panel",
  });
  const translate = transform ? CSS.Translate.toString(transform) : undefined;

  const startResize = (event: React.PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = size;

    const move = (moveEvent: PointerEvent): void => {
      onResize(
        clampPanelSize({
          width: startSize.width + moveEvent.clientX - startX,
          height: startSize.height + moveEvent.clientY - startY,
        }),
      );
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      ref={setNodeRef}
      className={[
        "pointer-events-auto fixed flex flex-col overflow-hidden rounded-[4px] border border-slate-950/30 bg-[#f6f8fb] text-slate-900 shadow-[0_18px_60px_rgba(15,23,42,0.32)] ring-1 ring-white/60",
        isDragging ? "opacity-95" : "",
      ].join(" ")}
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        transform: translate,
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-950/15 bg-slate-100 px-2">
        <button
          type="button"
          title="Move panel"
          className="flex h-6 w-6 cursor-grab items-center justify-center rounded-[3px] border border-slate-950/15 bg-white text-slate-600 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold">{title}</div>
          <div className="truncate text-[10px] leading-3 text-slate-500">{status}</div>
        </div>
        <button
          type="button"
          onClick={onDiagnostics}
          className={[
            "flex h-6 items-center gap-1 rounded-[3px] border px-1.5 text-[11px] font-bold",
            hasErrors
              ? "border-red-300 bg-red-50 text-red-700"
              : "border-teal-300 bg-teal-50 text-teal-700",
          ].join(" ")}
        >
          {hasErrors ? <CircleAlert size={13} /> : <BadgeCheck size={13} />}
          {issueCount}
        </button>
        <button
          type="button"
          title="Close panel"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-[3px] border border-slate-950/15 bg-white text-slate-600 hover:bg-slate-200"
        >
          <X size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

      <div className="flex h-8 shrink-0 items-center justify-between border-t border-slate-950/15 bg-white px-2 text-[11px] text-slate-500">
        <div className="flex min-w-0 items-center gap-2">
          <Gauge size={13} />
          <span>{percent(quality)}%</span>
          {recording ? (
            <>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span className="truncate">REC {recording.id}</span>
            </>
          ) : null}
        </div>
        <button
          type="button"
          title="Resize panel"
          aria-label="Resize panel"
          onPointerDown={startResize}
          className="h-5 w-5 cursor-nwse-resize rounded-[3px] border border-slate-950/15 bg-slate-50 text-slate-500"
        >
          <span className="ml-auto mr-1 mt-1 block h-2 w-2 border-b border-r border-slate-500" />
        </button>
      </div>
    </aside>
  );
}

function DraggableDetailPanel({
  position,
  size,
  title,
  status,
  issueCount,
  hasErrors,
  recording,
  quality,
  children,
  onPositionChange,
  onSizeChange,
  onClose,
  onDiagnostics,
}: {
  position: PanelPosition;
  size: PanelSize;
  title: string;
  status: string;
  issueCount: number;
  hasErrors: boolean;
  recording?: RecordingState;
  quality: number;
  children: React.ReactNode;
  onPositionChange: (position: PanelPosition) => void;
  onSizeChange: (size: PanelSize) => void;
  onClose: () => void;
  onDiagnostics: () => void;
}) {
  return (
    <DndContext
      onDragEnd={(event) => {
        onPositionChange(
          clampPanelPosition(
            {
              x: position.x + event.delta.x,
              y: position.y + event.delta.y,
            },
            size,
          ),
        );
      }}
    >
      <DetailPanelShell
        position={position}
        size={size}
        title={title}
        status={status}
        issueCount={issueCount}
        hasErrors={hasErrors}
        recording={recording}
        quality={quality}
        onClose={onClose}
        onDiagnostics={onDiagnostics}
        onResize={(nextSize) => {
          onSizeChange(nextSize);
          onPositionChange(clampPanelPosition(position, nextSize));
        }}
      >
        {children}
      </DetailPanelShell>
    </DndContext>
  );
}

function ToolPalettePopover({
  palette,
  onClose,
  onMode,
  onTab,
  onPreview,
  onSave,
  recording,
  onStartRecording,
  onStopRecording,
}: {
  palette?: ToolPalette;
  onClose: () => void;
  onMode: (mode: PickerMode) => void;
  onTab: (tab: PanelTab) => void;
  onPreview: () => void;
  onSave: () => void;
  recording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
}) {
  if (!palette) {
    return null;
  }

  const itemClass =
    "flex w-full items-center gap-2 rounded-[3px] px-2.5 py-2 text-left text-xs font-semibold text-slate-100 hover:bg-white/10";

  return (
    <div className="pointer-events-auto fixed left-4 top-12 w-64 overflow-hidden rounded-[4px] border border-slate-950/40 bg-slate-950 shadow-[0_18px_50px_rgba(2,6,23,0.45)] ring-1 ring-white/10">
      <div className="flex items-center justify-between border-b border-white/10 bg-slate-900 px-2.5 py-2">
        <div className="flex items-center gap-2 text-xs font-bold text-white">
          <Layers3 size={15} />
          <span>
            {palette === "capture" ? "Capture" : palette === "record" ? "Record" : "Output"}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[3px] p-1 text-slate-300 hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-1 p-2">
        {palette === "capture" ? (
          <>
            <button
              type="button"
              title="Find repeated records or a table on the current page."
              aria-label="Find repeated records or a table on the current page"
              className={itemClass}
              onClick={() => {
                onMode("item");
                onTab("shape");
                onClose();
              }}
            >
              <Sparkles size={16} />
              Repeated records
            </button>
            <button
              type="button"
              title="Select a field inside the repeated record to include in each output row."
              aria-label="Add a field selector to the extraction workflow"
              className={itemClass}
              onClick={() => {
                onMode("field");
                onTab("fields");
                onClose();
              }}
            >
              <MousePointer2 size={16} />
              Add field
            </button>
            <button
              type="button"
              title="Select the Next or load-more control for bounded pagination."
              aria-label="Pick a bounded pagination control"
              className={itemClass}
              onClick={() => {
                onMode("pagination");
                onTab("shape");
                onClose();
              }}
            >
              <ChevronRight size={16} />
              Pick pagination
            </button>
          </>
        ) : null}

        {palette === "record" ? (
          <>
            <button
              type="button"
              title="Record setup actions such as search fields, filter controls, clicks, and scrolling."
              aria-label="Start or stop setup action recording"
              className={itemClass}
              onClick={() => {
                recording ? onStopRecording() : onStartRecording();
                onClose();
              }}
            >
              {recording ? <Square size={16} /> : <Radio size={16} />}
              {recording ? "Stop action recording" : "Start action recording"}
            </button>
            <button
              type="button"
              title="Open the ordered action list to edit, reorder, or delete setup actions."
              aria-label="Open recorded action layers"
              className={itemClass}
              onClick={() => {
                onTab("actions");
                onClose();
              }}
            >
              <Layers3 size={16} />
              Open action layers
            </button>
          </>
        ) : null}

        {palette === "output" ? (
          <>
            <button
              type="button"
              title="Extract rows from the current page with the draft selectors."
              aria-label="Run current-page preview"
              className={itemClass}
              onClick={() => {
                onPreview();
                onClose();
              }}
            >
              <Play size={16} />
              Run preview
            </button>
            <button
              type="button"
              title="Inspect the generated site config JSON and edit the overlay draft."
              aria-label="Inspect generated JSON"
              className={itemClass}
              onClick={() => {
                onTab("json");
                onClose();
              }}
            >
              <FileJson size={16} />
              Inspect JSON
            </button>
            <button
              type="button"
              title="Open a step-by-step handoff guide for this workflow."
              aria-label="Open workflow guide"
              className={itemClass}
              onClick={() => {
                onTab("guide");
                onClose();
              }}
            >
              <Route size={16} />
              Agent guide
            </button>
            <button
              type="button"
              title="Validate and save the extraction workflow config."
              aria-label="Save extraction workflow config"
              className={itemClass}
              onClick={() => {
                onSave();
                onClose();
              }}
            >
              <Save size={16} />
              Save config
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function HighlightLayer({
  hoverRect,
  itemRects,
  suggestionRects,
}: {
  hoverRect?: RectSnapshot;
  itemRects: RectSnapshot[];
  suggestionRects: RectSnapshot[];
}) {
  return (
    <div className="pointer-events-none fixed inset-0 z-[2147483646]">
      {suggestionRects.map((rect, index) => (
        <div
          key={`suggestion-${rect.left}-${rect.top}-${index}`}
          className="fixed rounded-md border-2 border-dashed border-amber-500 bg-amber-400/10"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      {itemRects.map((rect, index) => (
        <div
          key={`item-${rect.left}-${rect.top}-${index}`}
          className="fixed rounded-md border-2 border-signal bg-teal-500/10"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      {hoverRect ? (
        <div
          className="fixed rounded-md border-2 border-red-600 bg-red-500/10"
          style={{
            left: hoverRect.left,
            top: hoverRect.top,
            width: hoverRect.width,
            height: hoverRect.height,
          }}
        />
      ) : null}
    </div>
  );
}

function SuggestionPopover({
  suggestion,
  onAccept,
}: {
  suggestion?: DataShapeSuggestion;
  onAccept: () => void;
}) {
  if (!suggestion) {
    return null;
  }

  const left = Math.max(
    12,
    Math.min(
      window.innerWidth - 292,
      suggestion.anchorRect.left + suggestion.anchorRect.width + 10,
    ),
  );
  const top = Math.max(12, Math.min(window.innerHeight - 154, suggestion.anchorRect.top));
  const confidence = percent(suggestion.result.itemSelectorMeta.confidence);

  return (
    <div
      className="pointer-events-auto fixed w-[280px] overflow-hidden rounded-md border border-amber-300 bg-white shadow-overlay"
      style={{ left, top }}
    >
      <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-ink">
          <WandSparkles size={16} />
          <span className="truncate">Suggested shape</span>
        </div>
        <button
          type="button"
          title="Accept suggestion"
          aria-label="Accept suggestion"
          onClick={onAccept}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-ink hover:bg-amber-300"
        >
          <Check size={18} strokeWidth={3} />
        </button>
      </div>
      <div className="grid grid-cols-3 border-b border-slate-100 text-center text-xs">
        <div className="px-2 py-2">
          <div className="font-bold text-ink">{suggestion.result.rects.length}</div>
          <div className="text-slate-500">records</div>
        </div>
        <div className="border-x border-slate-100 px-2 py-2">
          <div className="font-bold text-ink">{suggestion.fields.length}</div>
          <div className="text-slate-500">fields</div>
        </div>
        <div className="px-2 py-2">
          <div className="font-bold text-ink">{confidence}%</div>
          <div className="text-slate-500">score</div>
        </div>
      </div>
      <div className="max-h-24 overflow-auto px-3 py-2">
        <div className="break-all font-mono text-[11px] leading-4 text-slate-700">
          {suggestion.result.itemSelector}
        </div>
      </div>
    </div>
  );
}

function WorkflowRail({
  draft,
  previewCount,
  activeTab,
  onTab,
  onMode,
}: {
  draft: OverlayDraft;
  previewCount: number;
  activeTab: PanelTab;
  onTab: (tab: PanelTab) => void;
  onMode: (mode: PickerMode) => void;
}) {
  const steps: Array<{
    id: PanelTab;
    label: string;
    done: boolean;
    icon: React.ReactNode;
    action: () => void;
  }> = [
    {
      id: "shape",
      label: "Shape",
      done: Boolean(draft.itemSelector),
      icon: <ListTree size={16} />,
      action: () => {
        onTab("shape");
        onMode("item");
      },
    },
    {
      id: "fields",
      label: "Fields",
      done: draft.fields.length > 0,
      icon: <Database size={16} />,
      action: () => {
        onTab("fields");
        onMode("field");
      },
    },
    {
      id: "actions",
      label: "Actions",
      done: draft.actions.length > 0,
      icon: <Radio size={16} />,
      action: () => {
        onTab("actions");
        onMode("action");
      },
    },
    {
      id: "preview",
      label: "Preview",
      done: previewCount > 0,
      icon: <Play size={16} />,
      action: () => onTab("preview"),
    },
    {
      id: "json",
      label: "JSON",
      done: draftIsSavable(draft),
      icon: <FileJson size={16} />,
      action: () => onTab("json"),
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-2">
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
          title={`Open ${step.label}: ${step.done ? "configured" : "needs attention"}.`}
          aria-label={`Open ${step.label} step`}
          onClick={step.action}
          className={[
            "flex min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left text-xs transition",
            activeTab === step.id
              ? "border-signal bg-teal-50 text-ink"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
          ].join(" ")}
        >
          <span
            className={[
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              step.done ? "bg-signal text-white" : "bg-slate-100 text-slate-500",
            ].join(" ")}
          >
            {step.done ? <Check size={15} /> : step.icon}
          </span>
          <span className="truncate font-semibold">{step.label}</span>
        </button>
      ))}
    </div>
  );
}

interface TimelineLayerIntent {
  id: string;
  tab: PanelTab;
  mode?: PickerMode;
  selector?: string;
  status: string;
}

function InspectorSection({
  title,
  subtitle,
  count,
  defaultOpen = true,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: string | number;
  defaultOpen?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={[
        "overflow-hidden rounded-[4px] border border-slate-950/15 bg-white",
        className ?? "",
      ].join(" ")}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 border-b border-slate-950/10 bg-slate-50 px-2.5 py-2">
        <ChevronRight
          size={13}
          className={["shrink-0 text-slate-500 transition", open ? "rotate-90" : ""].join(" ")}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold text-slate-900">{title}</span>
          {subtitle ? (
            <span className="block truncate text-[10px] leading-3 text-slate-500">{subtitle}</span>
          ) : null}
        </span>
        {count !== undefined ? (
          <span className="rounded-[3px] border border-slate-950/10 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
            {count}
          </span>
        ) : null}
      </summary>
      <div className={["p-2", bodyClassName ?? ""].join(" ")}>{children}</div>
    </details>
  );
}

function LayerStatusBadge({
  status,
}: {
  status: "ready" | "missing" | "output" | "optional";
}) {
  if (status === "ready") {
    return (
      <span
        title="Ready: this layer is configured and will be included in the saved draft."
        className="flex h-5 min-w-12 items-center justify-center gap-1 rounded-[3px] border border-teal-700/30 bg-teal-50 px-1.5 text-[10px] font-bold uppercase text-teal-800"
      >
        <Check size={11} />
        ready
      </span>
    );
  }

  if (status === "missing") {
    return (
      <span
        title="Missing: this layer needs input before the config is complete."
        className="flex h-5 min-w-12 items-center justify-center gap-1 rounded-[3px] border border-amber-500/40 bg-amber-50 px-1.5 text-[10px] font-bold uppercase text-amber-800"
      >
        <CircleAlert size={11} />
        todo
      </span>
    );
  }

  if (status === "optional") {
    return (
      <span
        title="Optional: this phase is useful only when the site requires it."
        className="flex h-5 min-w-12 items-center justify-center gap-1 rounded-[3px] border border-sky-500/30 bg-sky-50 px-1.5 text-[10px] font-bold uppercase text-sky-800"
      >
        <ChevronRight size={11} />
        optional
      </span>
    );
  }

  return (
    <span
      title="Output: this layer previews or inspects the generated result."
      className="flex h-5 min-w-12 items-center justify-center gap-1 rounded-[3px] border border-slate-950/10 bg-slate-100 px-1.5 text-[10px] font-bold uppercase text-slate-600"
    >
      <Eye size={11} />
      view
    </span>
  );
}

function TimelineLayerItem({
  id,
  active,
  status,
  icon,
  label,
  meta,
  intent,
  onSelect,
  children,
}: {
  id: string;
  active: boolean;
  status: "ready" | "missing" | "output" | "optional";
  icon: React.ReactNode;
  label: string;
  meta: string;
  intent: TimelineLayerIntent;
  onSelect: (intent: TimelineLayerIntent) => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={`${label}: ${meta}. ${intent.status}`}
      aria-label={`${label}: ${meta}. ${intent.status}`}
      onClick={() => onSelect(intent)}
      className={[
        "flex w-full items-center gap-2 rounded-[3px] border px-2 py-1.5 text-left transition",
        active
          ? "border-teal-700 bg-teal-50 ring-1 ring-teal-200"
          : "border-transparent bg-white hover:border-slate-950/15 hover:bg-slate-50",
      ].join(" ")}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-slate-100 text-slate-600">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold text-slate-900">{label}</span>
        <span className="block truncate text-[10px] leading-3 text-slate-500">{meta}</span>
        {active && children ? (
          <span className="mt-1 block truncate font-mono text-[10px] leading-3 text-slate-500">
            {children}
          </span>
        ) : null}
      </span>
      <LayerStatusBadge status={status} />
      <span className="w-10 shrink-0 text-right font-mono text-[10px] uppercase text-slate-400">
        {id}
      </span>
    </button>
  );
}

function TimelineGroup({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) {
    return null;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 pt-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        <span>{count}</span>
      </div>
      {children}
    </div>
  );
}

function DefinitionFlowCard({
  step,
  label,
  description,
  status,
  active,
  icon,
  onClick,
}: {
  step: number;
  label: string;
  description: string;
  status: "ready" | "missing" | "output" | "optional";
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label}: ${description}`}
      aria-label={`${label}: ${description}`}
      onClick={onClick}
      className={[
        "flex min-w-0 items-start gap-2 rounded-[3px] border px-2 py-2 text-left",
        active
          ? "border-teal-700 bg-teal-50"
          : "border-slate-950/10 bg-white hover:border-slate-950/30",
      ].join(" ")}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-slate-100 text-[11px] font-bold text-slate-700">
        {step}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
          {icon}
          <span className="truncate">{label}</span>
        </span>
        <span className="mt-0.5 block text-[10px] leading-3 text-slate-500">{description}</span>
        <span className="mt-1 inline-flex">
          <LayerStatusBadge status={status} />
        </span>
      </span>
    </button>
  );
}

function DefinitionFlow({
  draft,
  previewCount,
  activeTab,
  onSelect,
}: {
  draft: OverlayDraft;
  previewCount: number;
  activeTab: PanelTab;
  onSelect: (tab: PanelTab, mode?: PickerMode, layer?: string) => void;
}) {
  const captureReady = Boolean(draft.itemSelector && draft.fields.length > 0);

  return (
    <div className="grid grid-cols-2 gap-2">
      <DefinitionFlowCard
        step={1}
        label="Navigate"
        description={`${draft.actions.length} recorded action${draft.actions.length === 1 ? "" : "s"} before extraction`}
        status="ready"
        active={activeTab === "actions"}
        icon={<Route size={12} />}
        onClick={() => onSelect("actions", "action", "actions")}
      />
      <DefinitionFlowCard
        step={2}
        label="Capture"
        description={
          captureReady
            ? `${draft.fields.length} field${draft.fields.length === 1 ? "" : "s"} from repeated records`
            : "Choose repeated records and fields"
        }
        status={captureReady ? "ready" : "missing"}
        active={activeTab === "shape" || activeTab === "fields"}
        icon={<MousePointer2 size={12} />}
        onClick={() => onSelect(draft.itemSelector ? "fields" : "shape", "item", "shape")}
      />
      <DefinitionFlowCard
        step={3}
        label="Loop"
        description={
          draft.pagination
            ? `${draft.pagination.maxPages} pages via next selector`
            : "Optional pagination or load-more step"
        }
        status={draft.pagination ? "ready" : "optional"}
        active={activeTab === "shape" && draft.pagination !== undefined}
        icon={<ChevronRight size={12} />}
        onClick={() => onSelect("shape", "pagination", "pagination")}
      />
      <DefinitionFlowCard
        step={4}
        label="Verify"
        description={`${previewCount || draft.lastPreviewRowCount || 0} preview rows; export JSON or agent guide`}
        status={previewCount > 0 || draftIsSavable(draft) ? "ready" : "output"}
        active={activeTab === "preview" || activeTab === "json" || activeTab === "guide"}
        icon={<Eye size={12} />}
        onClick={() => onSelect("guide", undefined, "guide")}
      />
    </div>
  );
}

function ScenarioCard({
  label,
  description,
  status,
  active,
  onClick,
}: {
  label: string;
  description: string;
  status: "ready" | "missing" | "output" | "optional";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={`${label}: ${description}`}
      aria-label={`${label}: ${description}`}
      onClick={onClick}
      className={[
        "flex min-w-0 flex-col gap-1 rounded-[3px] border px-2 py-2 text-left",
        active
          ? "border-teal-700 bg-teal-50"
          : "border-slate-950/10 bg-white hover:border-slate-950/30",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-xs font-bold text-slate-900">{label}</span>
        <LayerStatusBadge status={status} />
      </span>
      <span className="text-[10px] leading-4 text-slate-500">{description}</span>
    </button>
  );
}

function ScenarioPlaybook({
  draft,
  previewCount,
  onSelect,
}: {
  draft: OverlayDraft;
  previewCount: number;
  onSelect: (tab: PanelTab, mode?: PickerMode, layer?: string) => void;
}) {
  const captureReady = Boolean(draft.itemSelector && draft.fields.length > 0);
  const inferred = inferredScenarioLabel(draft, previewCount);

  return (
    <div className="space-y-2">
      <div className="rounded-[3px] border border-slate-950/10 bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-600">
        <span className="font-bold text-slate-700">Current fit:</span> {inferred}.{" "}
        {suggestedNextStep(draft, previewCount)}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ScenarioCard
          label="Direct capture"
          description="The current page already shows the records. Pick shape, fields, then preview."
          status={captureReady && draft.actions.length === 0 ? "ready" : "optional"}
          active={draft.actions.length === 0 && !draft.pagination}
          onClick={() => onSelect(draft.itemSelector ? "fields" : "shape", "item", "shape")}
        />
        <ScenarioCard
          label="Search first"
          description="Record search, filters, login renewal, or setup clicks before extraction."
          status={draft.actions.length > 0 ? "ready" : "optional"}
          active={draft.actions.length > 0}
          onClick={() => onSelect("actions", "action", "actions")}
        />
        <ScenarioCard
          label="Loop results"
          description="Use when Next, load-more, or pagination must repeat bounded pages."
          status={draft.pagination ? "ready" : "optional"}
          active={Boolean(draft.pagination)}
          onClick={() => onSelect("shape", "pagination", "pagination")}
        />
        <ScenarioCard
          label="Agent handoff"
          description="Generate instructions for another agent to reproduce and verify the run."
          status={draftIsSavable(draft) ? "ready" : "missing"}
          active={previewCount > 0 || draftIsSavable(draft)}
          onClick={() => onSelect("guide", undefined, "guide")}
        />
      </div>
    </div>
  );
}

function TimelineLayers({
  draft,
  previewCount,
  recording,
  activeLayer,
  onSelect,
}: {
  draft: OverlayDraft;
  previewCount: number;
  recording?: RecordingState;
  activeLayer: string;
  onSelect: (intent: TimelineLayerIntent) => void;
}) {
  const shapeSelector = draft.itemSelector ?? draft.rowSelector ?? draft.tableSelector;

  return (
    <div className="space-y-2">
      <div className="rounded-[3px] border border-slate-950/10 bg-slate-50 px-2 py-1.5 text-[10px] leading-4 text-slate-600">
        <span className="font-bold text-slate-700">Status:</span> ready means saved in the draft;
        todo means required setup is missing; optional is site-dependent; view is
        preview/inspection.
      </div>

      <TimelineGroup label="Structure" count={1 + (draft.pagination ? 1 : 0)}>
        <TimelineLayerItem
          id="shape"
          active={activeLayer === "shape"}
          status={shapeSelector ? "ready" : "missing"}
          icon={<ListTree size={14} />}
          label="Repeated shape"
          meta={shapeSelector ?? "No selector"}
          intent={{
            id: "shape",
            tab: "shape",
            mode: "item",
            selector: shapeSelector,
            status: shapeSelector ? "Focused repeated shape" : "Select repeated shape",
          }}
          onSelect={onSelect}
        >
          {shapeSelector ?? "No selector"}
        </TimelineLayerItem>

        {draft.pagination ? (
          <TimelineLayerItem
            id="page"
            active={activeLayer === "pagination"}
            status="ready"
            icon={<ChevronRight size={14} />}
            label="Pagination"
            meta={`${draft.pagination.maxPages} pages / ${draft.pagination.waitAfterMs}ms wait`}
            intent={{
              id: "pagination",
              tab: "shape",
              mode: "pagination",
              selector: draft.pagination.nextSelector,
              status: "Focused pagination",
            }}
            onSelect={onSelect}
          >
            {draft.pagination.nextSelector}
          </TimelineLayerItem>
        ) : null}
      </TimelineGroup>

      <TimelineGroup label="Fields" count={draft.fields.length}>
        {draft.fields.map((field, index) => {
          const scopedSelector =
            draft.itemSelector && !field.selector.startsWith(draft.itemSelector)
              ? `${draft.itemSelector} ${field.selector}`
              : field.selector;
          return (
            <TimelineLayerItem
              key={field.id}
              id={`F${index + 1}`}
              active={activeLayer === field.id}
              status={field.selector ? "ready" : "missing"}
              icon={<Braces size={14} />}
              label={field.name}
              meta={`${field.attribute} ${percent(field.selectorMeta?.confidence)}%`}
              intent={{
                id: field.id,
                tab: "fields",
                mode: "field",
                selector: scopedSelector,
                status: `Focused field ${field.name}`,
              }}
              onSelect={onSelect}
            >
              {field.selectorMeta?.sample ?? field.selector}
            </TimelineLayerItem>
          );
        })}
      </TimelineGroup>

      <TimelineGroup label="Recorded actions" count={draft.actions.length}>
        {draft.actions.map((action, index) => (
          <TimelineLayerItem
            key={action.id}
            id={`A${index + 1}`}
            active={activeLayer === action.id}
            status="ready"
            icon={<Radio size={14} />}
            label={actionLabel(action)}
            meta={`${action.type} / ${action.observedMutations} DOM / ${action.observedNetwork} network`}
            intent={{
              id: action.id,
              tab: "actions",
              mode: "action",
              selector: action.selector,
              status: `Focused action ${index + 1}`,
            }}
            onSelect={onSelect}
          >
            {actionStepText(action)}
          </TimelineLayerItem>
        ))}
      </TimelineGroup>

      <TimelineGroup label="Outputs" count={3}>
        <TimelineLayerItem
          id="view"
          active={activeLayer === "preview"}
          status="output"
          icon={<Eye size={14} />}
          label="Preview"
          meta={`${previewCount} rows`}
          intent={{ id: "preview", tab: "preview", status: "Focused preview" }}
          onSelect={onSelect}
        />
        <TimelineLayerItem
          id="json"
          active={activeLayer === "json"}
          status={draftIsSavable(draft) ? "ready" : "missing"}
          icon={<Code2 size={14} />}
          label="JSON"
          meta={recording ? `${recording.eventCount} recorded events` : "Generated config"}
          intent={{ id: "json", tab: "json", status: "Focused JSON" }}
          onSelect={onSelect}
        />
        <TimelineLayerItem
          id="guide"
          active={activeLayer === "guide"}
          status="output"
          icon={<Route size={14} />}
          label="Agent guide"
          meta="Navigate, capture, loop, verify"
          intent={{ id: "guide", tab: "guide", status: "Focused agent guide" }}
          onSelect={onSelect}
        />
      </TimelineGroup>
    </div>
  );
}

function QualityMeter({ value }: { value: number }) {
  const score = percent(value);
  const tone =
    score >= 75
      ? "bg-signal"
      : score >= 45
        ? "bg-amber-500"
        : score > 0
          ? "bg-red-500"
          : "bg-slate-300";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
        <span>Selector quality</span>
        <span className="font-semibold text-ink">{score}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full ${tone}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-lg font-bold text-ink">{value}</div>
    </div>
  );
}

function HelpNote({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[4px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-slate-700">
      <div className="font-bold text-slate-900">{title}</div>
      <div>{children}</div>
    </div>
  );
}

function DataLocationPanel({
  draft,
  recording,
}: {
  draft: OverlayDraft;
  recording?: RecordingState;
}) {
  return (
    <div className="grid gap-2 text-xs leading-5 text-slate-700">
      <HelpNote title="Draft">
        Current selections live only in this browser overlay until you press Save. Preview rows are
        temporary and are not written to disk.
      </HelpNote>
      <HelpNote title="Saved workflow">
        Save writes a validated config to <code>configs/sites/{draft.id || "workflow"}.json</code>.
        That config is the reusable artifact to review, commit, and run later.
      </HelpNote>
      <HelpNote title="Run output">
        Running the workflow writes JSON/CSV results to <code>exports/</code> by default. Downloads
        and screenshots, when configured, are also stored under <code>exports/</code>.
      </HelpNote>
      <HelpNote title="Authoring recording">
        The authoring session is tracked separately for review under <code>recordings/</code>
        {recording ? ` as ${recording.id}` : " after save"}. Do not commit generated recordings.
      </HelpNote>
    </div>
  );
}

function SelectorRepairList({
  selector,
  alternates,
  onSelect,
}: {
  selector?: string;
  alternates?: string[];
  onSelect: (selector: string) => void;
}) {
  const options = Array.from(
    new Set([selector, ...(alternates ?? [])].filter(Boolean)),
  ) as string[];
  if (options.length === 0) {
    return null;
  }

  return (
    <details className="mt-2 rounded-md border border-slate-200 bg-white text-[11px] text-slate-600">
      <summary className="cursor-pointer px-2 py-1.5 font-semibold text-slate-700">
        Selector options
      </summary>
      <div className="space-y-1 border-t border-slate-100 p-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            title={`Use selector with ${selectorMatchCount(option)} current-page matches: ${option}`}
            aria-label={`Use selector with ${selectorMatchCount(option)} current-page matches`}
            onClick={() => onSelect(option)}
            className={[
              "flex w-full items-start gap-2 rounded-[3px] border px-2 py-1.5 text-left hover:border-slate-400",
              option === selector ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-slate-50",
            ].join(" ")}
          >
            <span className="mt-0.5 shrink-0 rounded bg-white px-1.5 py-0.5 font-bold text-slate-500">
              {selectorMatchCount(option)}
            </span>
            <span className="break-all font-mono text-[10px] leading-4 text-slate-700">
              {option}
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}

function ShapePanel({
  draft,
  onSelectorChange,
}: {
  draft: OverlayDraft;
  onSelectorChange: (selector: string) => void;
}) {
  return (
    <section className="space-y-3">
      <HelpNote title="What shape means">
        Pick the element that represents one output row, such as one result card, one list item, or
        one table row. The extractor repeats your field selectors inside every matching visible
        record.
      </HelpNote>
      <div>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Repeated item</span>
          <span>{draft.extractionKind}</span>
        </div>
        <div className="break-all rounded-md border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700">
          {draft.itemSelector ?? "No shape selected"}
        </div>
        <SelectorRepairList
          selector={draft.itemSelector}
          alternates={draft.itemSelectorMeta?.alternates}
          onSelect={onSelectorChange}
        />
      </div>
      {draft.itemSelectorMeta ? (
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <QualityMeter value={draft.itemSelectorMeta.confidence} />
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Strategy</div>
              <div className="font-semibold text-ink">{draft.itemSelectorMeta.strategy}</div>
            </div>
            <div>
              <div className="text-slate-500">Alternates</div>
              <div className="font-semibold text-ink">
                {draft.itemSelectorMeta.alternates.length}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FieldEditor({
  field,
  onChange,
  onRemove,
  dragHandle,
}: {
  field: DraftField;
  onChange: (field: DraftField) => void;
  onRemove: () => void;
  dragHandle?: React.ReactNode;
}) {
  const knownAttribute = ATTRIBUTE_OPTIONS.includes(field.attribute);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2">
        {dragHandle}
        <input
          aria-label="Field name"
          value={field.name}
          onChange={(event) => onChange({ ...field, name: event.target.value })}
          className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
        <div className="flex h-8 min-w-12 items-center justify-center rounded-md bg-slate-100 px-2 text-xs font-bold text-ink">
          {percent(field.selectorMeta?.confidence)}%
        </div>
        <button
          type="button"
          title="Remove this field from the output rows."
          aria-label="Remove field"
          onClick={onRemove}
          className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:border-red-300 hover:text-red-700"
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select
          aria-label="Field attribute"
          value={knownAttribute ? field.attribute : "custom"}
          onChange={(event) => {
            const value = event.target.value;
            onChange({ ...field, attribute: value === "custom" ? field.attribute : value });
          }}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          {ATTRIBUTE_OPTIONS.map((attribute) => (
            <option key={attribute} value={attribute}>
              {attribute}
            </option>
          ))}
          <option value="custom">custom</option>
        </select>
        <input
          aria-label="Custom attribute"
          value={field.attribute}
          onChange={(event) => onChange({ ...field, attribute: event.target.value })}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
        <select
          aria-label="Transform"
          value={field.transform ?? ""}
          onChange={(event) =>
            onChange({
              ...field,
              transform: event.target.value ? (event.target.value as FieldTransform) : undefined,
            })
          }
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        >
          {TRANSFORM_OPTIONS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs">
          <input
            type="checkbox"
            checked={field.required}
            onChange={(event) => onChange({ ...field, required: event.target.checked })}
          />
          required
        </label>
      </div>
      <div className="mt-2 break-all rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px] text-slate-700">
        {field.selector}
      </div>
      <SelectorRepairList
        selector={field.selector}
        alternates={field.selectorMeta?.alternates}
        onSelect={(selector) => onChange({ ...field, selector })}
      />
    </div>
  );
}

function SortableFieldEditor({
  field,
  onChange,
  onRemove,
}: {
  field: DraftField;
  onChange: (field: DraftField) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: field.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-70" : undefined}>
      <FieldEditor
        field={field}
        onChange={onChange}
        onRemove={onRemove}
        dragHandle={<DragHandle attributes={attributes} listeners={listeners} />}
      />
    </div>
  );
}

function FieldsPanel({
  draft,
  onChange,
  onRemove,
  onReorder,
}: {
  draft: OverlayDraft;
  onChange: (field: DraftField) => void;
  onRemove: (id: string) => void;
  onReorder: (event: DragEndEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <section>
      <HelpNote title="What fields become">
        Each field becomes a column in JSON/CSV output. Selectors are relative to the repeated
        record; use <code>text</code> for visible text, <code>href</code> for links, and{" "}
        <code>value</code> for form values.
      </HelpNote>
      <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>Fields</span>
        <span>{draft.fields.length}</span>
      </div>
      <div className="space-y-2">
        {draft.fields.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
            No fields selected.
          </div>
        ) : null}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
          <SortableContext
            items={draft.fields.map((field) => field.id)}
            strategy={verticalListSortingStrategy}
          >
            {draft.fields.map((field) => (
              <SortableFieldEditor
                key={field.id}
                field={field}
                onChange={onChange}
                onRemove={() => onRemove(field.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}

function ActionsPanel({
  actions,
  pendingActions,
  recording,
  stats,
  onStart,
  onStop,
  onChange,
  onInsertAfter,
  onRemove,
  onReorder,
}: {
  actions: DraftAction[];
  pendingActions: DraftAction[];
  recording: boolean;
  stats: ActionStats | undefined;
  onStart: () => void;
  onStop: () => void;
  onChange: (action: DraftAction) => void;
  onInsertAfter: (id: string, type: "wait" | "checkpoint") => void;
  onRemove: (id: string) => void;
  onReorder: (event: DragEndEvent) => void;
}) {
  const visible = recording ? pendingActions : actions;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  return (
    <section className="space-y-3">
      <HelpNote title="What actions do">
        Actions run after navigation and before extraction. Use them for search/filter setup. Mark
        an action optional only if the workflow should continue when that action is missing.
      </HelpNote>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Action flow
        </div>
        <button
          type="button"
          onClick={recording ? onStop : onStart}
          className={[
            "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold",
            recording
              ? "border-red-200 bg-red-50 text-red-700 hover:border-red-300"
              : "border-signal bg-signal text-white hover:bg-teal-700",
          ].join(" ")}
        >
          {recording ? <Square size={14} /> : <Radio size={14} />}
          {recording ? "Stop" : "Start"}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Metric label="DOM" value={stats?.mutations ?? "-"} icon={<Database size={14} />} />
        <Metric label="Network" value={stats?.network ?? "-"} icon={<Route size={14} />} />
        <Metric
          label="Moves"
          value={stats?.pointerMoves ?? "-"}
          icon={<MousePointer2 size={14} />}
        />
      </div>

      <div className="space-y-2">
        {visible.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
            {recording
              ? "Interact with the page, then stop to append actions."
              : "No actions recorded."}
          </div>
        ) : null}
        {recording ? (
          visible.map((action) => <ActionCard key={action.id} action={action} recording />)
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
            <SortableContext
              items={actions.map((action) => action.id)}
              strategy={verticalListSortingStrategy}
            >
              {actions.map((action) => (
                <SortableActionCard
                  key={action.id}
                  action={action}
                  onChange={onChange}
                  onInsertAfter={onInsertAfter}
                  onRemove={() => onRemove(action.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </section>
  );
}

function ActionCard({
  action,
  recording,
  onChange,
  onInsertAfter,
  onRemove,
  dragHandle,
}: {
  action: DraftAction;
  recording?: boolean;
  onChange?: (action: DraftAction) => void;
  onInsertAfter?: (id: string, type: "wait" | "checkpoint") => void;
  onRemove?: () => void;
  dragHandle?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          {dragHandle}
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] uppercase text-slate-600">
                {action.type}
              </span>
              {action.paginationHint ? (
                <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] text-amber-800">
                  pagination
                </span>
              ) : null}
              <span className="truncate text-xs text-slate-500">{actionLabel(action)}</span>
            </div>
            <div className="mt-2 break-all font-mono text-[11px] text-slate-700">
              {actionStepText(action)}
            </div>
          </div>
        </div>
        {!recording && onRemove ? (
          <button
            type="button"
            title="Remove action"
            onClick={onRemove}
            className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:border-red-300 hover:text-red-700"
          >
            <Trash2 size={15} />
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex gap-2 text-[11px] text-slate-500">
        <span>{action.observedMutations} DOM</span>
        <span>{action.observedNetwork} network</span>
        <span>{action.pointerMoves} moves</span>
      </div>
      {!recording && onChange ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-2">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={action.optional ?? false}
              onChange={(event) => onChange({ ...action, optional: event.target.checked })}
            />
            optional
          </label>
          {action.selector ? (
            <SelectorRepairList
              selector={action.selector}
              alternates={action.selectorMeta?.alternates}
              onSelect={(selector) => onChange({ ...action, selector })}
            />
          ) : null}
          {action.type === "fill" || action.type === "select" ? (
            <label className="block text-xs text-slate-600">
              Value
              <input
                value={action.value ?? ""}
                onChange={(event) => onChange({ ...action, value: event.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
          ) : null}
          {action.type === "wait" ? (
            <label className="block text-xs text-slate-600">
              Wait ms
              <input
                type="number"
                min={0}
                value={action.durationMs ?? 1000}
                onChange={(event) =>
                  onChange({ ...action, durationMs: Number(event.target.value) })
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
          ) : null}
          {action.type === "wait" || action.type === "checkpoint" ? (
            <label className="block text-xs text-slate-600">
              Reason
              <input
                value={action.reason ?? ""}
                onChange={(event) => onChange({ ...action, reason: event.target.value })}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
              />
            </label>
          ) : null}
          {onInsertAfter ? (
            <div className="flex gap-2">
              <button
                type="button"
                title="Insert a timed wait after this action."
                aria-label="Insert wait after this action"
                onClick={() => onInsertAfter(action.id, "wait")}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                Insert wait
              </button>
              <button
                type="button"
                title="Insert a manual checkpoint after this action."
                aria-label="Insert manual checkpoint after this action"
                onClick={() => onInsertAfter(action.id, "checkpoint")}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                Insert checkpoint
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SortableActionCard({
  action,
  onChange,
  onInsertAfter,
  onRemove,
}: {
  action: DraftAction;
  onChange: (action: DraftAction) => void;
  onInsertAfter: (id: string, type: "wait" | "checkpoint") => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: action.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={isDragging ? "opacity-70" : undefined}>
      <ActionCard
        action={action}
        onChange={onChange}
        onInsertAfter={onInsertAfter}
        onRemove={onRemove}
        dragHandle={<DragHandle attributes={attributes} listeners={listeners} />}
      />
    </div>
  );
}

function PreviewTable({ rows }: { rows: Record<string, string>[] }) {
  const columns = useMemo(() => Object.keys(rows[0] ?? {}).slice(0, 8), [rows]);
  if (rows.length === 0 || columns.length === 0) {
    return (
      <section className="space-y-2">
        <HelpNote title="What preview checks">
          Preview reads the current visible page only. It does not click pagination and does not
          save output files.
        </HelpNote>
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No preview rows.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <HelpNote title="What preview checks">
        Preview reads visible rows on the current page with the draft selectors. Full extraction
        later writes files and handles bounded pagination.
      </HelpNote>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <div className="max-h-80 overflow-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-700">
              <tr>
                {columns.map((column) => (
                  <th key={column} className="border-b border-slate-200 px-2 py-1.5 font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((row) => (
                <tr key={rowKey(row)} className="odd:bg-white even:bg-slate-50">
                  {columns.map((column) => (
                    <td
                      key={column}
                      className="max-w-48 truncate border-b border-slate-100 px-2 py-1.5"
                    >
                      {row[column]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PaginationPanel({
  draft,
  setDraft,
}: {
  draft: OverlayDraft;
  setDraft: React.Dispatch<React.SetStateAction<OverlayDraft>>;
}) {
  return (
    <section>
      <HelpNote title="What loop means">
        Pagination runs only after extracting the current page. <code>Max pages</code> bounds the
        run, <code>Wait ms</code> gives the page time to update, and stop-when-disabled prevents
        clicking a disabled Next control.
      </HelpNote>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Pagination
      </div>
      {draft.pagination ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="break-all rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px]">
            {draft.pagination.nextSelector}
          </div>
          <SelectorRepairList
            selector={draft.pagination.nextSelector}
            alternates={draft.pagination.selectorMeta?.alternates}
            onSelect={(selector) =>
              setDraft((current) => ({
                ...current,
                pagination: current.pagination
                  ? { ...current.pagination, nextSelector: selector }
                  : undefined,
              }))
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">
              Max pages
              <input
                type="number"
                min={1}
                max={100}
                value={draft.pagination.maxPages}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    pagination: current.pagination
                      ? {
                          ...current.pagination,
                          maxPages: Number(event.target.value),
                        }
                      : undefined,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
            <label className="text-xs text-slate-600">
              Wait ms
              <input
                type="number"
                min={0}
                max={10000}
                value={draft.pagination.waitAfterMs}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    pagination: current.pagination
                      ? {
                          ...current.pagination,
                          waitAfterMs: Number(event.target.value),
                        }
                      : undefined,
                  }))
                }
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={draft.pagination.stopWhenSelectorDisabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pagination: current.pagination
                    ? {
                        ...current.pagination,
                        stopWhenSelectorDisabled: event.target.checked,
                      }
                    : undefined,
                }))
              }
            />
            stop when disabled
          </label>
        </div>
      ) : (
        <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
          No pagination.
        </div>
      )}
    </section>
  );
}

function JsonPanel({
  generatedJson,
  draftJson,
  draftDirty,
  draftError,
  fieldCount,
  actionCount,
  onDraftJsonChange,
  onApplyDraftJson,
  onResetDraftJson,
  onCopyGenerated,
  onCopyDraft,
}: {
  generatedJson: string;
  draftJson: string;
  draftDirty: boolean;
  draftError?: string;
  fieldCount: number;
  actionCount: number;
  onDraftJsonChange: (value: string) => void;
  onApplyDraftJson: () => void;
  onResetDraftJson: () => void;
  onCopyGenerated: () => void;
  onCopyDraft: () => void;
}) {
  const [view, setView] = useState<"preview" | "editor">("preview");
  const generatedLineCount = generatedJson.split("\n").length;
  const draftLineCount = draftJson.split("\n").length;

  return (
    <section className="space-y-3">
      <HelpNote title="Generated vs draft JSON">
        Generated JSON is the validated site config preview that will be saved. Draft JSON is the
        editable overlay state; apply draft edits only when you need advanced selector repair.
      </HelpNote>
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Generated JSON
        </div>
        <div className="flex rounded-md border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setView("preview")}
            className={[
              "flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold",
              view === "preview" ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            <Eye size={13} />
            Preview
          </button>
          <button
            type="button"
            onClick={() => setView("editor")}
            className={[
              "flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold",
              view === "editor" ? "bg-ink text-white" : "text-slate-600 hover:bg-slate-100",
            ].join(" ")}
          >
            <PencilLine size={13} />
            Editor
          </button>
        </div>
      </div>

      {view === "preview" ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Lines" value={generatedLineCount} icon={<Code2 size={14} />} />
            <Metric label="Fields" value={fieldCount} icon={<Braces size={14} />} />
            <Metric label="Actions" value={actionCount} icon={<Radio size={14} />} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              title="Copy the generated site config JSON to the clipboard."
              aria-label="Copy generated site config JSON"
              onClick={onCopyGenerated}
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
            >
              <Copy size={13} />
              Copy
            </button>
          </div>
          <pre className="max-h-[520px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-[11px] leading-4 text-slate-100">
            {generatedJson}
          </pre>
        </>
      ) : null}

      {view === "editor" ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Metric label="Draft lines" value={draftLineCount} icon={<PencilLine size={14} />} />
            <Metric label="Fields" value={fieldCount} icon={<Braces size={14} />} />
            <Metric label="Actions" value={actionCount} icon={<Radio size={14} />} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-500">
              {draftDirty ? "Unsaved draft edits" : "Draft synced"}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                title="Copy the editable overlay draft JSON to the clipboard."
                aria-label="Copy overlay draft JSON"
                onClick={onCopyDraft}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                <Copy size={13} />
                Copy
              </button>
              <button
                type="button"
                title="Reset the draft editor to the current overlay state."
                aria-label="Reset draft JSON editor"
                onClick={onResetDraftJson}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                Reset
              </button>
              <button
                type="button"
                title="Apply the edited draft JSON to the overlay."
                aria-label="Apply edited draft JSON"
                onClick={onApplyDraftJson}
                className="rounded-md border border-signal bg-signal px-2 py-1 text-xs font-semibold text-white hover:bg-teal-700"
              >
                Apply
              </button>
            </div>
          </div>
          {draftError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
              {draftError}
            </div>
          ) : null}
          <textarea
            aria-label="Draft JSON editor"
            value={draftJson}
            spellCheck={false}
            onChange={(event) => onDraftJsonChange(event.target.value)}
            className="min-h-[520px] w-full resize-y rounded-md border border-slate-200 bg-slate-950 p-3 font-mono text-[11px] leading-4 text-slate-100 outline-none focus:border-signal"
          />
        </>
      ) : null}
    </section>
  );
}

function AgentGuidePanel({
  guide,
  onCopy,
}: {
  guide: string;
  onCopy: () => void;
}) {
  return (
    <section className="space-y-3">
      <HelpNote title="What this guide is for">
        The guide is a human-readable handoff for another operator or agent. It explains the start
        URL, setup actions, capture selectors, pagination, and verification checks.
      </HelpNote>
      <div className="rounded-[4px] border border-slate-950/10 bg-white p-3">
        <div className="flex items-start gap-2">
          <Route size={16} className="mt-0.5 shrink-0 text-teal-700" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-slate-900">Agent handoff</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              This is the compact contract for another agent or operator: where to go, what to do
              before capture, which records and fields to extract, how to loop, and how to verify.
            </p>
          </div>
          <button
            type="button"
            title="Copy the workflow handoff guide to the clipboard."
            aria-label="Copy workflow handoff guide"
            onClick={onCopy}
            className="flex items-center gap-1.5 rounded-[3px] border border-slate-950/15 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-950/35"
          >
            <Copy size={13} />
            Copy
          </button>
        </div>
      </div>

      <pre className="max-h-[520px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-[11px] leading-4 text-slate-100">
        {guide}
      </pre>
    </section>
  );
}

function DiagnosticsPanel({
  draft,
  previewRows,
  onWaivePreview,
}: {
  draft: OverlayDraft;
  previewRows: Record<string, string>[];
  onWaivePreview: () => void;
}) {
  const issues = draftIssues(draft, { previewRows });
  return (
    <section className="space-y-2">
      <HelpNote title="How to read diagnostics">
        Errors block save because the workflow cannot run reliably. Warnings do not block save, but
        they point to selector, preview, pagination, or action-order risks to review first.
      </HelpNote>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Validation</div>
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 p-3 text-sm font-semibold text-teal-800">
          <BadgeCheck size={16} />
          Ready to save
        </div>
      ) : null}
      {issues.map((issue) => (
        <div
          key={issue.id}
          className={[
            "flex items-center gap-2 rounded-md border p-3 text-sm",
            issue.severity === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-amber-200 bg-amber-50 text-amber-800",
          ].join(" ")}
        >
          <CircleAlert size={16} />
          <span>{issue.label}</span>
          {issue.id === "preview-required" ? (
            <button
              type="button"
              title="Allow saving this workflow without a current-page preview."
              aria-label="Save without running preview"
              onClick={onWaivePreview}
              className="ml-auto shrink-0 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-bold text-amber-800 hover:border-amber-500"
            >
              Save without preview
            </button>
          ) : null}
        </div>
      ))}
    </section>
  );
}

export function App({ host }: AppProps) {
  const initialDraft = window.__WEB_SEEK_OVERLAY_INIT__?.draft;
  const startingDraft: OverlayDraft = initialDraft
    ? {
        ...initialDraft,
        group: initialDraft.group ?? initialDraft.jurisdiction,
        jurisdiction: undefined,
        actions: initialDraft.actions ?? [],
      }
    : {
        id: "overlay-config",
        name: "Overlay Config",
        startUrl: location.href,
        sourceUrl: location.href,
        extractionKind: "list",
        fields: [],
        actions: [],
      };
  const [draft, setDraft] = useState<OverlayDraft>(startingDraft);
  const [mode, setMode] = useState<PickerMode>("idle");
  const [activeTab, setActiveTab] = useState<PanelTab>("shape");
  const [activeLayer, setActiveLayer] = useState("shape");
  const [detailOpen, setDetailOpen] = useState(true);
  const [panelSize, setPanelSize] = useState<PanelSize>(() => initialPanelSize());
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(() =>
    initialPanelPosition(initialPanelSize()),
  );
  const [openPalette, setOpenPalette] = useState<ToolPalette>();
  const [hoverRect, setHoverRect] = useState<RectSnapshot>();
  const [itemRects, setItemRects] = useState<RectSnapshot[]>([]);
  const [smartSuggestion, setSmartSuggestion] = useState<DataShapeSuggestion>();
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [actionRecording, setActionRecording] = useState(false);
  const [pendingActions, setPendingActions] = useState<DraftAction[]>([]);
  const [actionStats, setActionStats] = useState<ActionStats>();
  const [recording, setRecording] = useState<RecordingState | undefined>(
    window.__WEB_SEEK_OVERLAY_INIT__?.recording,
  );
  const [status, setStatus] = useState(startingDraft.notes ?? "Ready");
  const [saving, setSaving] = useState(false);
  const [draftJson, setDraftJson] = useState(() => JSON.stringify(startingDraft, null, 2));
  const [draftJsonDirty, setDraftJsonDirty] = useState(false);
  const [draftJsonError, setDraftJsonError] = useState<string>();
  const readyDraftRef = useRef(draft);
  const actionSessionRef = useRef<ActionSession | undefined>(undefined);
  const deferredPreviewRows = useDeferredValue(previewRows);

  const generatedConfig = useMemo(
    () => buildGeneratedConfigPreview(draft, previewRows.length, recording),
    [draft, previewRows.length, recording],
  );
  const generatedJson = useDeferredValue(JSON.stringify(generatedConfig, null, 2));
  const issues = useMemo(() => draftIssues(draft, { previewRows }), [draft, previewRows]);
  const agentGuide = useDeferredValue(
    buildAgentGuideMarkdown(draft, previewRows.length, recording, issues),
  );
  const quality = averageSelectorConfidence(draft);
  const layerCount = 4 + draft.fields.length + draft.actions.length + (draft.pagination ? 1 : 0);

  useEffect(() => {
    if (!draftJsonDirty) {
      setDraftJson(JSON.stringify(draft, null, 2));
    }
  }, [draft, draftJsonDirty]);

  useEffect(() => {
    const updatePanelBounds = (): void => {
      setPanelSize((current) => {
        const nextSize = clampPanelSize(current);
        setPanelPosition((position) => clampPanelPosition(position, nextSize));
        return nextSize;
      });
    };

    window.addEventListener("resize", updatePanelBounds);
    return () => window.removeEventListener("resize", updatePanelBounds);
  }, []);

  useEffect(() => {
    void bridgeSend("ready", readyDraftRef.current);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void bridgeSend("draft-change", draft);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft]);

  useEffect(() => {
    const refreshRecording = () => {
      void bridgeSend("recording-status")?.then((response) => {
        if (response?.recording) {
          setRecording(response.recording);
        }
      });
    };

    refreshRecording();
    const interval = window.setInterval(refreshRecording, 1500);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateRects = () => setItemRects(rectsForSelector(draft.itemSelector));
    updateRects();
    window.addEventListener("scroll", updateRects, true);
    window.addEventListener("resize", updateRects);
    return () => {
      window.removeEventListener("scroll", updateRects, true);
      window.removeEventListener("resize", updateRects);
    };
  }, [draft.itemSelector]);

  useEffect(() => {
    if (!draft.itemSelector || draft.fields.length === 0) {
      setPreviewRows([]);
      return;
    }

    const timeout = window.setTimeout(() => {
      setPreviewRows(extractPreviewRows(draft));
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [draft]);

  useEffect(() => {
    if (!actionRecording) {
      return;
    }

    const session: ActionSession = {
      startedAt: Date.now(),
      mutations: 0,
      network: 0,
      pointerMoves: 0,
      actions: [],
      startScrollX: window.scrollX,
      startScrollY: window.scrollY,
    };
    actionSessionRef.current = session;
    setPendingActions([]);
    setActionStats(session);

    const publish = () => {
      setActionStats({ ...session });
      setPendingActions([...session.actions]);
    };

    const addAction = (action: DraftAction): void => {
      if (action.type === "fill" || action.type === "select") {
        const index = session.actions.findIndex(
          (item) => item.type === action.type && item.selector === action.selector,
        );
        if (index >= 0) {
          session.actions[index] = action;
          publish();
          return;
        }
      }

      session.actions.push(action);
      publish();
    };

    const actionBase = (element: Element | undefined) => {
      const selector = element ? selectorMetaForElement(element) : undefined;
      return {
        id: `action-${Date.now()}-${session.actions.length + 1}`,
        selector: selector?.selector,
        selectorMeta: selector?.selectorMeta,
        observedMutations: session.mutations,
        observedNetwork: session.network,
        pointerMoves: session.pointerMoves,
      };
    };

    const click = (event: MouseEvent): void => {
      if (isOverlayEvent(event, host)) {
        return;
      }
      const element = targetElement(event);
      if (!element) {
        return;
      }
      addAction({
        ...actionBase(element),
        type: "click",
        label: `Click ${textForAction(element)}`,
        paginationHint: isPaginationLikeElement(element),
      });
    };

    const input = (event: Event): void => {
      if (isOverlayEvent(event, host)) {
        return;
      }
      const element = targetElement(event);
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement) &&
        !(element instanceof HTMLSelectElement)
      ) {
        return;
      }

      addAction({
        ...actionBase(element),
        type: element instanceof HTMLSelectElement ? "select" : "fill",
        value: element.value,
        label: `${element instanceof HTMLSelectElement ? "Select" : "Fill"} ${textForAction(element)}`,
        paginationHint: false,
      });
    };

    const pointerMove = (): void => {
      session.pointerMoves += 1;
      if (session.pointerMoves % 20 === 0) {
        publish();
      }
    };

    const scroll = (): void => {
      publish();
    };

    const mutationObserver = new MutationObserver((mutations) => {
      session.mutations += mutations.length;
      publish();
    });
    mutationObserver.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    let performanceObserver: PerformanceObserver | undefined;
    try {
      performanceObserver = new PerformanceObserver((entries) => {
        session.network += entries.getEntries().length;
        publish();
      });
      performanceObserver.observe({ entryTypes: ["resource"] });
    } catch {
      performanceObserver = undefined;
    }

    document.addEventListener("click", click, true);
    document.addEventListener("input", input, true);
    document.addEventListener("change", input, true);
    document.addEventListener("pointermove", pointerMove, true);
    window.addEventListener("scroll", scroll, true);

    return () => {
      document.removeEventListener("click", click, true);
      document.removeEventListener("input", input, true);
      document.removeEventListener("change", input, true);
      document.removeEventListener("pointermove", pointerMove, true);
      window.removeEventListener("scroll", scroll, true);
      mutationObserver.disconnect();
      performanceObserver?.disconnect();
    };
  }, [actionRecording, host]);

  const startActionRecording = useCallback(() => {
    setMode("action");
    setActiveTab("actions");
    setActiveLayer("actions");
    setDetailOpen(true);
    setActionRecording(true);
    setStatus("Recording browser actions");
  }, []);

  const stopActionRecording = useCallback(() => {
    const session = actionSessionRef.current;
    if (!session) {
      setActionRecording(false);
      return;
    }

    const actions = session.actions.map((action) => ({
      ...action,
      observedMutations: session.mutations,
      observedNetwork: session.network,
      pointerMoves: session.pointerMoves,
    }));

    if (window.scrollX !== session.startScrollX || window.scrollY !== session.startScrollY) {
      actions.push({
        id: `action-${Date.now()}-scroll`,
        type: "scroll",
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY),
        label: `Scroll to ${Math.round(window.scrollY)}`,
        observedMutations: session.mutations,
        observedNetwork: session.network,
        pointerMoves: session.pointerMoves,
      });
    }

    const paginationAction = [...actions].reverse().find((action) => action.paginationHint);
    setDraft((current) => ({
      ...current,
      actions: [
        ...current.actions,
        ...actions.map((action) => ({
          ...action,
          recordedAfterCapture: Boolean(current.itemSelector || current.fields.length > 0),
        })),
      ],
      pagination:
        !current.pagination && paginationAction?.selector
          ? {
              nextSelector: paginationAction.selector,
              maxPages: 25,
              waitAfterMs: 750,
              stopWhenSelectorDisabled: true,
              selectorMeta: paginationAction.selectorMeta,
            }
          : current.pagination,
    }));
    setPendingActions([]);
    setActionStats({ ...session });
    actionSessionRef.current = undefined;
    setActionRecording(false);
    setMode("idle");
    setActiveLayer(actions.at(-1)?.id ?? "actions");
    setStatus(`Added ${actions.length} actions`);
  }, []);

  const acceptShape = useCallback(
    (result: RepeatedItemResult, fields: DraftField[]) => {
      const nextDraft = {
        ...draft,
        extractionKind: result.extractionKind,
        itemSelector: result.itemSelector,
        itemSelectorMeta: result.itemSelectorMeta,
        tableSelector: result.tableSelector,
        rowSelector: result.rowSelector,
        fields,
        sourceUrl: location.href,
      };

      setDraft(nextDraft);
      setItemRects(result.rects);
      setPreviewRows(extractPreviewRows(nextDraft));
      setStatus(`Accepted ${result.rects.length} items, ${fields.length} fields`);
      setActiveTab(fields.length > 0 ? "preview" : "fields");
      setActiveLayer(fields.length > 0 ? "preview" : "shape");
      setDetailOpen(true);
      setMode("idle");
      setHoverRect(undefined);
      setSmartSuggestion(undefined);
    },
    [draft],
  );

  useEffect(() => {
    if (mode === "idle") {
      setHoverRect(undefined);
      setSmartSuggestion(undefined);
      return;
    }

    let suggestionFrame = 0;
    let pendingSuggestionElement: Element | undefined;

    const scheduleSmartSuggestion = (element: Element): void => {
      pendingSuggestionElement = element;
      if (suggestionFrame) {
        return;
      }

      suggestionFrame = window.requestAnimationFrame(() => {
        suggestionFrame = 0;
        if (!pendingSuggestionElement) {
          return;
        }

        const result = detectRepeatedItem(pendingSuggestionElement);
        const anchorRect =
          rectForElement(result.itemElement) ?? rectForElement(pendingSuggestionElement);
        if (!anchorRect) {
          setSmartSuggestion(undefined);
          return;
        }

        const fields = buildSuggestedFields(result);
        setHoverRect(undefined);
        setSmartSuggestion({ result, fields, anchorRect });
        setStatus(
          `Suggested ${result.rects.length} ${result.extractionKind} items, ${fields.length} fields`,
        );
      });
    };

    const mouseMove = (event: MouseEvent): void => {
      if (isOverlayEvent(event, host)) {
        setHoverRect(undefined);
        setSmartSuggestion(undefined);
        return;
      }
      const element = targetElement(event);
      if (!element) {
        setHoverRect(undefined);
        setSmartSuggestion(undefined);
        return;
      }

      if (mode === "item") {
        if (!isDataShapeCandidateTarget(element)) {
          setSmartSuggestion(undefined);
          setHoverRect(rectForElement(element));
          setStatus("Use Actions for search inputs and form controls");
          return;
        }
        scheduleSmartSuggestion(element);
        return;
      }

      setSmartSuggestion(undefined);
      setHoverRect(rectForElement(element));
    };

    const click = (event: MouseEvent): void => {
      if (isOverlayEvent(event, host)) {
        return;
      }

      const element = targetElement(event);
      if (!element) {
        return;
      }

      if (mode === "action") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (mode === "item") {
        if (!isDataShapeCandidateTarget(element)) {
          setStatus("Form controls are actions, not capture records");
          setMode("idle");
          return;
        }
        const result = detectRepeatedItem(element);
        acceptShape(result, buildSuggestedFields(result));
      }

      if (mode === "field") {
        setDraft((current) => {
          let next = current;
          if (!next.itemSelector) {
            const result = detectRepeatedItem(element);
            next = {
              ...next,
              extractionKind: result.extractionKind,
              itemSelector: result.itemSelector,
              itemSelectorMeta: result.itemSelectorMeta,
              tableSelector: result.tableSelector,
              rowSelector: result.rowSelector,
            };
            setItemRects(result.rects);
          }

          const field = buildFieldFromElement(element, next);
          if (!field) {
            setStatus("Click inside a selected item");
            return next;
          }

          setStatus(`Added ${field.name}`);
          setActiveTab("fields");
          setActiveLayer(field.id);
          setDetailOpen(true);
          return {
            ...next,
            fields: [...next.fields, field],
            sourceUrl: location.href,
          };
        });
      }

      if (mode === "pagination") {
        const pagination = buildPaginationFromElement(element);
        setDraft((current) => ({
          ...current,
          pagination,
          sourceUrl: location.href,
        }));
        setStatus("Pagination selector captured");
        setActiveTab("shape");
        setActiveLayer("pagination");
        setDetailOpen(true);
      }

      setMode("idle");
      setHoverRect(undefined);
    };

    document.addEventListener("mousemove", mouseMove, true);
    document.addEventListener("click", click, true);
    return () => {
      if (suggestionFrame) {
        window.cancelAnimationFrame(suggestionFrame);
      }
      document.removeEventListener("mousemove", mouseMove, true);
      document.removeEventListener("click", click, true);
    };
  }, [acceptShape, host, mode]);

  const acceptSmartSuggestion = useCallback(() => {
    if (!smartSuggestion) {
      return;
    }
    acceptShape(smartSuggestion.result, smartSuggestion.fields);
  }, [acceptShape, smartSuggestion]);

  const updateField = (field: DraftField) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.map((item) => (item.id === field.id ? field : item)),
    }));
  };

  const updateShapeSelector = (selector: string) => {
    setDraft((current) => ({
      ...current,
      itemSelector: selector,
    }));
    setItemRects(rectsForSelector(selector));
    setStatus(`Shape selector updated: ${selectorMatchCount(selector)} matches`);
  };

  const updateAction = (action: DraftAction) => {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((item) => (item.id === action.id ? action : item)),
    }));
  };

  const insertActionAfter = (id: string, type: "wait" | "checkpoint") => {
    setDraft((current) => {
      const index = current.actions.findIndex((action) => action.id === id);
      if (index < 0) {
        return current;
      }
      const inserted: DraftAction =
        type === "wait"
          ? {
              id: `action-${Date.now()}-wait`,
              type: "wait",
              durationMs: 1000,
              reason: "Wait for page update",
              label: "Wait for page update",
              observedMutations: 0,
              observedNetwork: 0,
              pointerMoves: 0,
            }
          : {
              id: `action-${Date.now()}-checkpoint`,
              type: "checkpoint",
              reason: "Confirm the browser is ready to continue.",
              label: "Manual checkpoint",
              observedMutations: 0,
              observedNetwork: 0,
              pointerMoves: 0,
            };
      return {
        ...current,
        actions: [
          ...current.actions.slice(0, index + 1),
          inserted,
          ...current.actions.slice(index + 1),
        ],
      };
    });
  };

  const removeField = (id: string) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.filter((item) => item.id !== id),
    }));
  };

  const reorderFields = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setDraft((current) => {
      const oldIndex = current.fields.findIndex((field) => field.id === active.id);
      const newIndex = current.fields.findIndex((field) => field.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return { ...current, fields: arrayMove(current.fields, oldIndex, newIndex) };
    });
  };

  const reorderActions = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setDraft((current) => {
      const oldIndex = current.actions.findIndex((action) => action.id === active.id);
      const newIndex = current.actions.findIndex((action) => action.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return current;
      }
      return { ...current, actions: arrayMove(current.actions, oldIndex, newIndex) };
    });
  };

  const runPreview = () => {
    const rows = extractPreviewRows(draft);
    setPreviewRows(rows);
    setDraft((current) => ({
      ...current,
      lastPreviewRowCount: rows.length,
      previewWaived: false,
      sourceUrl: location.href,
    }));
    setStatus(`${rows.length} rows in preview`);
    setActiveTab("preview");
    setActiveLayer("preview");
    setDetailOpen(true);
  };

  const focusTimelineLayer = useCallback((intent: TimelineLayerIntent) => {
    setActiveLayer(intent.id);
    setActiveTab(intent.tab);
    setDetailOpen(true);
    if (intent.mode) {
      setMode(intent.mode);
    }

    if (intent.selector) {
      const [rect] = rectsForSelector(intent.selector);
      setHoverRect(rect);
    } else {
      setHoverRect(undefined);
    }

    setStatus(intent.status);
  }, []);

  const updateDraftJson = (value: string) => {
    setDraftJson(value);
    setDraftJsonDirty(true);
    setDraftJsonError(undefined);
  };

  const applyDraftJson = () => {
    try {
      const parsed = JSON.parse(draftJson) as unknown;
      const nextDraft = normalizeDraftFromJson(parsed, draft);
      setDraft(nextDraft);
      setDraftJson(JSON.stringify(nextDraft, null, 2));
      setDraftJsonDirty(false);
      setDraftJsonError(undefined);
      setStatus("Draft JSON applied");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid draft JSON.";
      setDraftJsonError(message);
      setStatus("Draft JSON invalid");
    }
  };

  const resetDraftJson = () => {
    setDraftJson(JSON.stringify(draft, null, 2));
    setDraftJsonDirty(false);
    setDraftJsonError(undefined);
    setStatus("Draft editor reset");
  };

  const copyGeneratedJson = async () => {
    await navigator.clipboard?.writeText(generatedJson);
    setStatus("JSON copied");
  };

  const copyDraftJson = async () => {
    await navigator.clipboard?.writeText(draftJson);
    setStatus("Draft JSON copied");
  };

  const copyAgentGuide = async () => {
    await navigator.clipboard?.writeText(agentGuide);
    setStatus("Agent guide copied");
  };

  const saveConfig = async () => {
    if (!draftIsSavable(draft, { previewRows })) {
      setActiveTab("diagnostics");
      setActiveLayer("diagnostics");
      setDetailOpen(true);
      setStatus("Resolve required items before saving");
      return;
    }

    setSaving(true);
    setStatus("Saving...");
    try {
      const response = await bridgeSend("save-config", {
        ...draft,
        sourceUrl: location.href,
        lastPreviewRowCount: previewRows.length || draft.lastPreviewRowCount,
      });
      if (response?.ok) {
        if (response.recording) {
          setRecording(response.recording);
        }
        setStatus(response.path ? `Saved ${response.path}` : "Saved");
      } else {
        setStatus(response?.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <HighlightLayer
        hoverRect={hoverRect}
        itemRects={itemRects}
        suggestionRects={mode === "item" ? (smartSuggestion?.result.rects ?? []) : []}
      />
      <div className="pointer-events-none fixed inset-0 z-[2147483647] select-none font-sans text-ink">
        <SuggestionPopover
          suggestion={mode === "item" ? smartSuggestion : undefined}
          onAccept={acceptSmartSuggestion}
        />
        <ToolPalettePopover
          palette={openPalette}
          onClose={() => setOpenPalette(undefined)}
          onMode={setMode}
          onTab={(tab) => {
            setActiveTab(tab);
            setActiveLayer(tab);
            setDetailOpen(true);
          }}
          onPreview={runPreview}
          onSave={saveConfig}
          recording={actionRecording}
          onStartRecording={startActionRecording}
          onStopRecording={stopActionRecording}
        />

        <div className="pointer-events-auto fixed left-4 top-4 flex items-center gap-1 rounded-[4px] border border-slate-950/30 bg-slate-100/95 p-1 shadow-[0_12px_38px_rgba(15,23,42,0.28)] ring-1 ring-white/70 backdrop-blur">
          <IconButton
            active={detailOpen}
            label="Panel"
            tooltip="Show or hide the workflow editor panel."
            onClick={() => setDetailOpen((open) => !open)}
          >
            <Columns3 size={15} />
          </IconButton>
          <IconButton
            active={openPalette === "capture"}
            label="Capture"
            tooltip="Open tools for repeated records, fields, and bounded pagination."
            onClick={() => setOpenPalette(openPalette === "capture" ? undefined : "capture")}
          >
            <MoreHorizontal size={16} />
          </IconButton>
          <IconButton
            active={openPalette === "record"}
            label="Record"
            tooltip="Open tools for recording setup actions before extraction."
            onClick={() => setOpenPalette(openPalette === "record" ? undefined : "record")}
          >
            <Radio size={16} />
          </IconButton>
          <IconButton
            active={openPalette === "output"}
            label="Output"
            tooltip="Open preview, generated JSON, workflow guide, and save actions."
            onClick={() => setOpenPalette(openPalette === "output" ? undefined : "output")}
          >
            <FileJson size={16} />
          </IconButton>
          <IconButton
            active={mode === "item"}
            label="Shape"
            tooltip="Pick the repeated records or table rows that become output rows."
            onClick={() => {
              setMode("item");
              setActiveTab("shape");
              setActiveLayer("shape");
              setDetailOpen(true);
            }}
          >
            <Sparkles size={16} />
          </IconButton>
          <IconButton
            active={mode === "field"}
            label="Field"
            tooltip="Add a field from inside the selected repeated record."
            onClick={() => {
              setMode("field");
              setActiveTab("fields");
              setActiveLayer("fields");
              setDetailOpen(true);
            }}
          >
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton
            active={mode === "pagination"}
            label="Next"
            tooltip="Choose the Next or load-more control for bounded pagination."
            onClick={() => {
              setMode("pagination");
              setActiveTab("shape");
              setActiveLayer("pagination");
              setDetailOpen(true);
            }}
          >
            <ChevronRight size={16} />
          </IconButton>
          <IconButton
            active={mode === "action"}
            label={actionRecording ? "Stop" : "Actions"}
            tooltip={
              actionRecording
                ? "Stop recording setup actions and append them to the workflow."
                : "Record setup actions such as search, filter, click, and scroll."
            }
            onClick={actionRecording ? stopActionRecording : startActionRecording}
          >
            {actionRecording ? <Square size={16} /> : <Radio size={16} />}
          </IconButton>
          <IconButton
            label="Preview"
            tooltip="Extract current-page rows with the draft selectors."
            onClick={runPreview}
          >
            <Play size={16} />
          </IconButton>
          <IconButton
            label={saving ? "Saving" : "Save"}
            tooltip="Validate and save the extraction workflow config."
            onClick={saveConfig}
          >
            <Save size={16} />
          </IconButton>
          <button
            type="button"
            title="Close overlay"
            onClick={() => {
              void Promise.resolve(bridgeSend("close-overlay", draft)).finally(() => host.remove());
            }}
            className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-slate-950/20 bg-white/95 text-slate-600 shadow-sm hover:border-slate-950/40 hover:bg-slate-50"
          >
            <X size={15} />
          </button>
        </div>

        {detailOpen ? (
          <DraggableDetailPanel
            position={panelPosition}
            size={panelSize}
            title={draft.name}
            status={`${modeLabel(mode)} / ${status}`}
            issueCount={issues.length}
            hasErrors={issues.some((issue) => issue.severity === "error")}
            recording={recording}
            quality={quality}
            onPositionChange={setPanelPosition}
            onSizeChange={setPanelSize}
            onClose={() => setDetailOpen(false)}
            onDiagnostics={() => {
              setActiveTab("diagnostics");
              setActiveLayer("diagnostics");
            }}
          >
            <div className="flex h-full min-h-0 flex-col gap-2 bg-[#eef2f7] p-2">
              <InspectorSection
                title="Workflow steps"
                subtitle="1 Navigate, 2 Capture, 3 Loop, 4 Verify."
                count="4"
              >
                <DefinitionFlow
                  draft={draft}
                  previewCount={deferredPreviewRows.length}
                  activeTab={activeTab}
                  onSelect={(tab, nextMode, layer) => {
                    setActiveTab(tab);
                    setActiveLayer(layer ?? tab);
                    if (nextMode) {
                      setMode(nextMode);
                    }
                  }}
                />
              </InspectorSection>

              <InspectorSection
                title="Scenario playbook"
                subtitle="Pick the workflow pattern that matches the site."
                count={inferredScenarioLabel(draft, deferredPreviewRows.length)}
                defaultOpen={false}
              >
                <ScenarioPlaybook
                  draft={draft}
                  previewCount={deferredPreviewRows.length}
                  onSelect={(tab, nextMode, layer) => {
                    setActiveTab(tab);
                    setActiveLayer(layer ?? tab);
                    if (nextMode) {
                      setMode(nextMode);
                    }
                  }}
                />
              </InspectorSection>

              <InspectorSection
                title="Where data goes"
                subtitle="Draft, saved config, exports, and recordings."
                count="paths"
                defaultOpen={false}
              >
                <DataLocationPanel draft={draft} recording={recording} />
              </InspectorSection>

              <InspectorSection
                title="Layers"
                subtitle="Ordered authoring stack; click a row to focus it."
                count={layerCount}
                defaultOpen={false}
                bodyClassName="max-h-56 overflow-auto"
              >
                <TimelineLayers
                  draft={draft}
                  previewCount={deferredPreviewRows.length}
                  recording={recording}
                  activeLayer={activeLayer}
                  onSelect={focusTimelineLayer}
                />
              </InspectorSection>

              <InspectorSection
                title={panelTabTitle(activeTab)}
                subtitle={panelTabDescription(activeTab)}
                className="flex min-h-0 flex-1 flex-col"
                bodyClassName="min-h-0 flex-1 overflow-auto"
              >
                <div className="mb-2 flex gap-1 overflow-auto border-b border-slate-950/10 pb-2">
                  {(
                    [
                      "shape",
                      "actions",
                      "fields",
                      "preview",
                      "json",
                      "guide",
                      "diagnostics",
                    ] as PanelTab[]
                  ).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab);
                        setActiveLayer(tab);
                      }}
                      className={[
                        "rounded-[3px] border px-2 py-1 text-[11px] font-semibold capitalize",
                        activeTab === tab
                          ? "border-slate-950 bg-slate-900 text-white"
                          : "border-slate-950/15 bg-white text-slate-700 hover:border-slate-950/35",
                      ].join(" ")}
                    >
                      {tab === "json" ? "JSON" : tab}
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {activeTab === "shape" ? (
                    <>
                      <ShapePanel draft={draft} onSelectorChange={updateShapeSelector} />
                      <PaginationPanel draft={draft} setDraft={setDraft} />
                    </>
                  ) : null}
                  {activeTab === "actions" ? (
                    <ActionsPanel
                      actions={draft.actions}
                      pendingActions={pendingActions}
                      recording={actionRecording}
                      stats={actionStats}
                      onStart={startActionRecording}
                      onStop={stopActionRecording}
                      onChange={updateAction}
                      onInsertAfter={insertActionAfter}
                      onRemove={(id) =>
                        setDraft((current) => ({
                          ...current,
                          actions: current.actions.filter((action) => action.id !== id),
                        }))
                      }
                      onReorder={reorderActions}
                    />
                  ) : null}
                  {activeTab === "fields" ? (
                    <FieldsPanel
                      draft={draft}
                      onChange={updateField}
                      onRemove={removeField}
                      onReorder={reorderFields}
                    />
                  ) : null}
                  {activeTab === "preview" ? <PreviewTable rows={deferredPreviewRows} /> : null}
                  {activeTab === "json" ? (
                    <JsonPanel
                      generatedJson={generatedJson}
                      draftJson={draftJson}
                      draftDirty={draftJsonDirty}
                      draftError={draftJsonError}
                      fieldCount={draft.fields.length}
                      actionCount={draft.actions.length}
                      onDraftJsonChange={updateDraftJson}
                      onApplyDraftJson={applyDraftJson}
                      onResetDraftJson={resetDraftJson}
                      onCopyGenerated={copyGeneratedJson}
                      onCopyDraft={copyDraftJson}
                    />
                  ) : null}
                  {activeTab === "guide" ? (
                    <AgentGuidePanel guide={agentGuide} onCopy={copyAgentGuide} />
                  ) : null}
                  {activeTab === "diagnostics" ? (
                    <DiagnosticsPanel
                      draft={draft}
                      previewRows={deferredPreviewRows}
                      onWaivePreview={() => {
                        setDraft((current) => ({ ...current, previewWaived: true }));
                        setStatus("Preview requirement waived for this save");
                      }}
                    />
                  ) : null}
                </div>
              </InspectorSection>
            </div>
          </DraggableDetailPanel>
        ) : null}
      </div>
    </>
  );
}
