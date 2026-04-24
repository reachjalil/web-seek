import {
  BadgeCheck,
  Braces,
  Check,
  ChevronRight,
  CircleAlert,
  Columns3,
  Database,
  FileJson,
  Gauge,
  ListTree,
  MousePointer2,
  Play,
  Radio,
  Route,
  Save,
  Settings2,
  Sparkles,
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
  rectForElement,
  rectsForSelector,
} from "./dom-engine";
import type { RepeatedItemResult } from "./dom-engine";
import type {
  DraftField,
  FieldTransform,
  OverlayDraft,
  PickerMode,
  RecordingState,
  RectSnapshot,
} from "./types";

const ATTRIBUTE_OPTIONS = ["text", "href", "src", "value", "html", "aria-label", "title"];
const TRANSFORM_OPTIONS: Array<{ value: FieldTransform | ""; label: string }> = [
  { value: "trim", label: "trim" },
  { value: "number", label: "number" },
  { value: "date", label: "date" },
  { value: "uppercase", label: "uppercase" },
  { value: "lowercase", label: "lowercase" },
  { value: "license-status", label: "license-status" },
  { value: "", label: "none" },
];

type PanelTab = "shape" | "fields" | "preview" | "json" | "diagnostics";

interface AppProps {
  host: HTMLElement;
}

interface DataShapeSuggestion {
  result: RepeatedItemResult;
  fields: DraftField[];
  anchorRect: RectSnapshot;
}

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
  return "Inspect";
}

function rowKey(row: Record<string, string>): string {
  return Object.entries(row)
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
}

function toolbarClass(active: boolean): string {
  return [
    "flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
    active
      ? "border-signal bg-signal text-white"
      : "border-slate-200 bg-white text-ink hover:border-slate-400",
  ].join(" ");
}

function IconButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} title={label} className={toolbarClass(Boolean(active))}>
      {children}
      <span>{label}</span>
    </button>
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
    <div className="grid grid-cols-4 gap-2">
      {steps.map((step) => (
        <button
          key={step.id}
          type="button"
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

function ShapePanel({ draft }: { draft: OverlayDraft }) {
  return (
    <section className="space-y-3">
      <div>
        <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
          <span>Repeated item</span>
          <span>{draft.extractionKind}</span>
        </div>
        <div className="break-all rounded-md border border-slate-200 bg-white p-3 font-mono text-xs text-slate-700">
          {draft.itemSelector ?? "No shape selected"}
        </div>
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
}: {
  field: DraftField;
  onChange: (field: DraftField) => void;
  onRemove: () => void;
}) {
  const knownAttribute = ATTRIBUTE_OPTIONS.includes(field.attribute);

  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2">
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
          title="Remove field"
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
      {field.selectorMeta?.alternates.length ? (
        <details className="mt-2 text-[11px] text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">Alternates</summary>
          <div className="mt-1 space-y-1">
            {field.selectorMeta.alternates.slice(0, 3).map((selector) => (
              <div key={selector} className="break-all rounded bg-slate-50 px-2 py-1 font-mono">
                {selector}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function FieldsPanel({
  draft,
  onChange,
  onRemove,
}: {
  draft: OverlayDraft;
  onChange: (field: DraftField) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section>
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
        {draft.fields.map((field) => (
          <FieldEditor
            key={field.id}
            field={field}
            onChange={onChange}
            onRemove={() => onRemove(field.id)}
          />
        ))}
      </div>
    </section>
  );
}

function PreviewTable({ rows }: { rows: Record<string, string>[] }) {
  const columns = useMemo(() => Object.keys(rows[0] ?? {}).slice(0, 8), [rows]);
  if (rows.length === 0 || columns.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-500">
        No preview rows.
      </div>
    );
  }

  return (
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
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Pagination
      </div>
      {draft.pagination ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          <div className="break-all rounded-md bg-slate-50 px-2 py-1.5 font-mono text-[11px]">
            {draft.pagination.nextSelector}
          </div>
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
  json,
  onCopy,
}: {
  json: string;
  onCopy: () => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Generated JSON
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:border-slate-400"
        >
          Copy
        </button>
      </div>
      <pre className="max-h-[420px] overflow-auto rounded-md border border-slate-200 bg-slate-950 p-3 text-[11px] leading-4 text-slate-100">
        {json}
      </pre>
    </section>
  );
}

function DiagnosticsPanel({ draft }: { draft: OverlayDraft }) {
  const issues = draftIssues(draft);
  return (
    <section className="space-y-2">
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
        </div>
      ))}
    </section>
  );
}

export function App({ host }: AppProps) {
  const initialDraft = window.__WEB_SEEK_OVERLAY_INIT__?.draft;
  const [draft, setDraft] = useState<OverlayDraft>(
    initialDraft ?? {
      id: "overlay-config",
      name: "Overlay Config",
      startUrl: location.href,
      sourceUrl: location.href,
      extractionKind: "list",
      fields: [],
    },
  );
  const [mode, setMode] = useState<PickerMode>("idle");
  const [activeTab, setActiveTab] = useState<PanelTab>("shape");
  const [hoverRect, setHoverRect] = useState<RectSnapshot>();
  const [itemRects, setItemRects] = useState<RectSnapshot[]>([]);
  const [smartSuggestion, setSmartSuggestion] = useState<DataShapeSuggestion>();
  const [previewRows, setPreviewRows] = useState<Record<string, string>[]>([]);
  const [recording, setRecording] = useState<RecordingState | undefined>(
    window.__WEB_SEEK_OVERLAY_INIT__?.recording,
  );
  const [status, setStatus] = useState("Ready");
  const [saving, setSaving] = useState(false);
  const readyDraftRef = useRef(draft);
  const deferredPreviewRows = useDeferredValue(previewRows);

  const generatedConfig = useMemo(
    () => buildGeneratedConfigPreview(draft, previewRows.length, recording),
    [draft, previewRows.length, recording],
  );
  const generatedJson = useDeferredValue(JSON.stringify(generatedConfig, null, 2));
  const issues = useMemo(() => draftIssues(draft), [draft]);
  const quality = averageSelectorConfidence(draft);

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

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (mode === "item") {
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

  const removeField = (id: string) => {
    setDraft((current) => ({
      ...current,
      fields: current.fields.filter((item) => item.id !== id),
    }));
  };

  const runPreview = () => {
    const rows = extractPreviewRows(draft);
    setPreviewRows(rows);
    setDraft((current) => ({
      ...current,
      lastPreviewRowCount: rows.length,
      sourceUrl: location.href,
    }));
    setStatus(`${rows.length} rows in preview`);
    setActiveTab("preview");
  };

  const copyJson = async () => {
    await navigator.clipboard?.writeText(generatedJson);
    setStatus("JSON copied");
  };

  const saveConfig = async () => {
    if (!draftIsSavable(draft)) {
      setActiveTab("diagnostics");
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
      <div className="pointer-events-none fixed inset-0 z-[2147483647] font-sans text-ink">
        <SuggestionPopover
          suggestion={mode === "item" ? smartSuggestion : undefined}
          onAccept={acceptSmartSuggestion}
        />

        <div className="pointer-events-auto fixed left-4 top-4 flex items-center gap-2 rounded-md border border-slate-200 bg-panel p-2 shadow-overlay">
          <IconButton
            active={mode === "item"}
            label="Shape"
            onClick={() => {
              setMode("item");
              setActiveTab("shape");
            }}
          >
            <Sparkles size={16} />
          </IconButton>
          <IconButton
            active={mode === "field"}
            label="Field"
            onClick={() => {
              setMode("field");
              setActiveTab("fields");
            }}
          >
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton
            active={mode === "pagination"}
            label="Next"
            onClick={() => {
              setMode("pagination");
              setActiveTab("shape");
            }}
          >
            <ChevronRight size={16} />
          </IconButton>
          <IconButton label="Preview" onClick={runPreview}>
            <Play size={16} />
          </IconButton>
          <IconButton label={saving ? "Saving" : "Save"} onClick={saveConfig}>
            <Save size={16} />
          </IconButton>
          <button
            type="button"
            title="Close overlay"
            onClick={() => {
              void Promise.resolve(bridgeSend("close-overlay", draft)).finally(() => host.remove());
            }}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:border-slate-400"
          >
            <X size={16} />
          </button>
        </div>

        <aside className="pointer-events-auto fixed right-4 top-4 flex max-h-[calc(100vh-2rem)] w-[520px] flex-col overflow-hidden rounded-md border border-slate-200 bg-panel shadow-overlay">
          <div className="border-b border-slate-200 bg-white px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Columns3 size={16} />
                  <span className="truncate">{draft.name}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <Route size={13} />
                  <span className="truncate">{modeLabel(mode)}</span>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span className="truncate">{status}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab("diagnostics")}
                className={[
                  "flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-semibold",
                  issues.some((issue) => issue.severity === "error")
                    ? "border-red-200 bg-red-50 text-red-700"
                    : "border-teal-200 bg-teal-50 text-teal-700",
                ].join(" ")}
              >
                {issues.some((issue) => issue.severity === "error") ? (
                  <CircleAlert size={14} />
                ) : (
                  <BadgeCheck size={14} />
                )}
                {issues.length}
              </button>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              <Metric
                label="Records"
                value={itemRects.length || "-"}
                icon={<ListTree size={14} />}
              />
              <Metric label="Fields" value={draft.fields.length} icon={<Braces size={14} />} />
              <Metric
                label="Rows"
                value={deferredPreviewRows.length}
                icon={<Database size={14} />}
              />
              <Metric
                label="Events"
                value={recording?.eventCount ?? "-"}
                icon={<Radio size={14} />}
              />
            </div>
            <div className="mt-3">
              <QualityMeter value={quality} />
            </div>
          </div>

          <div className="border-b border-slate-200 bg-panel p-3">
            <WorkflowRail
              draft={draft}
              previewCount={deferredPreviewRows.length}
              activeTab={activeTab}
              onTab={setActiveTab}
              onMode={setMode}
            />
            <div className="mt-3 flex gap-2 overflow-auto">
              {(["shape", "fields", "preview", "json", "diagnostics"] as PanelTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={[
                    "rounded-md border px-3 py-1.5 text-xs font-semibold capitalize",
                    activeTab === tab
                      ? "border-ink bg-ink text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-400",
                  ].join(" ")}
                >
                  {tab === "json" ? "JSON" : tab}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-4 overflow-auto p-4">
            {activeTab === "shape" ? (
              <>
                <ShapePanel draft={draft} />
                <PaginationPanel draft={draft} setDraft={setDraft} />
              </>
            ) : null}
            {activeTab === "fields" ? (
              <FieldsPanel draft={draft} onChange={updateField} onRemove={removeField} />
            ) : null}
            {activeTab === "preview" ? <PreviewTable rows={deferredPreviewRows} /> : null}
            {activeTab === "json" ? <JsonPanel json={generatedJson} onCopy={copyJson} /> : null}
            {activeTab === "diagnostics" ? <DiagnosticsPanel draft={draft} /> : null}
          </div>

          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Gauge size={14} />
              <span>{percent(quality)}% selector average</span>
              {recording ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>REC {recording.id}</span>
                </>
              ) : null}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setActiveTab("json")}
                className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400"
              >
                <Settings2 size={14} />
                JSON
              </button>
              <button
                type="button"
                onClick={saveConfig}
                className="flex items-center gap-2 rounded-md border border-signal bg-signal px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
              >
                <Save size={14} />
                {saving ? "Saving" : "Save"}
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
