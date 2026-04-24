export type PickerMode = "idle" | "item" | "field" | "pagination";

export type SelectorStrategy =
  | "id"
  | "attribute"
  | "text-nearby"
  | "table-position"
  | "structural"
  | "nth-of-type";

export interface SelectorMeta {
  strategy: SelectorStrategy;
  confidence: number;
  alternates: string[];
  sample?: string;
}

export type FieldTransform =
  | "trim"
  | "number"
  | "date"
  | "uppercase"
  | "lowercase"
  | "license-status";

export interface DraftField {
  id: string;
  name: string;
  selector: string;
  attribute: string;
  required: boolean;
  transform?: FieldTransform;
  selectorMeta?: SelectorMeta;
}

export interface PaginationDraft {
  nextSelector: string;
  maxPages: number;
  waitAfterMs: number;
  stopWhenSelectorDisabled: boolean;
  selectorMeta?: SelectorMeta;
}

export interface OverlayDraft {
  id: string;
  name: string;
  jurisdiction?: string;
  startUrl: string;
  sourceUrl: string;
  extractionKind: "list" | "table";
  itemSelector?: string;
  itemSelectorMeta?: SelectorMeta;
  tableSelector?: string;
  rowSelector?: string;
  fields: DraftField[];
  pagination?: PaginationDraft;
  lastPreviewRowCount?: number;
  notes?: string;
}

export interface OverlayInit {
  draft: OverlayDraft;
  recording?: RecordingState;
}

export interface BridgeMessage {
  type: "ready" | "draft-change" | "save-config" | "close-overlay" | "recording-status";
  draft?: OverlayDraft;
}

export interface BridgeResponse {
  ok: boolean;
  path?: string;
  error?: string;
  recording?: RecordingState;
}

export interface RecordingState {
  id: string;
  startedAt: string;
  eventCount: number;
  urlCount: number;
  durationMs: number;
  path?: string;
}

export interface RectSnapshot {
  top: number;
  left: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __WEB_SEEK_OVERLAY_CSS__?: string;
    __WEB_SEEK_OVERLAY_INIT__?: OverlayInit;
    webSeekBridge?: {
      send(message: BridgeMessage): Promise<BridgeResponse | undefined>;
    };
  }
}
