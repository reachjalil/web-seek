import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const rrwebEventSchema = z
  .object({
    type: z.number(),
    timestamp: z.number(),
    data: z.unknown(),
  })
  .passthrough();

export type RrwebEvent = z.infer<typeof rrwebEventSchema>;

export const recordingFileSchema = z.object({
  schema: z.literal("web-seek.recording.v1"),
  id: z.string(),
  targetUrl: z.string().url(),
  startedAt: z.string(),
  stoppedAt: z.string(),
  durationMs: z.number().nonnegative(),
  eventCount: z.number().int().nonnegative(),
  userAgent: z.string().optional(),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .optional(),
  urls: z.array(z.string()),
  events: z.array(rrwebEventSchema),
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type RecordingFile = z.infer<typeof recordingFileSchema>;

export const selectorAttributeSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/)
  .or(z.enum(["text", "href", "src", "value", "html", "aria-label", "title"]));

export type SelectorAttribute = z.infer<typeof selectorAttributeSchema>;

export const selectorMetaSchema = z.object({
  strategy: z.enum([
    "id",
    "attribute",
    "text-nearby",
    "table-position",
    "structural",
    "nth-of-type",
  ]),
  confidence: z.number().min(0).max(1),
  alternates: z.array(z.string().min(1)).default([]),
  sample: z.string().optional(),
});

export type SelectorMeta = z.infer<typeof selectorMetaSchema>;

export const fieldTransformSchema = z.enum([
  "trim",
  "number",
  "date",
  "uppercase",
  "lowercase",
  "license-status",
]);

export type FieldTransform = z.infer<typeof fieldTransformSchema>;

export const fieldSelectorSchema = z.object({
  name: z.string().min(1),
  selector: z.string().min(1),
  attribute: selectorAttributeSchema.default("text"),
  required: z.boolean().default(false),
  transform: fieldTransformSchema.optional(),
  selectorMeta: selectorMetaSchema.optional(),
});

export type FieldSelector = z.infer<typeof fieldSelectorSchema>;

export const paginationConfigSchema = z.object({
  nextSelector: z.string().min(1),
  maxPages: z.number().int().positive().default(25),
  waitAfterMs: z.number().int().nonnegative().default(750),
  stopWhenSelectorDisabled: z.boolean().default(true),
});

export type PaginationConfig = z.infer<typeof paginationConfigSchema>;

export const browserProfileSchema = z.object({
  headless: z.boolean().default(false),
  userAgent: z.string().optional(),
  viewport: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
    .default({ width: 1440, height: 1000 }),
  slowMoMs: z.number().int().nonnegative().default(0),
});

export type BrowserProfile = z.infer<typeof browserProfileSchema>;

export const browserFlowPolicySchema = z.object({
  requiresAuthorization: z.literal(true).default(true),
  noBypass: z.literal(true).default(true),
  allowHeadlessReplay: z.literal(false).default(false),
  allowCredentialCapture: z.literal(false).default(false),
  allowNetworkPayloadCapture: z.literal(false).default(false),
});

export type BrowserFlowPolicy = z.infer<typeof browserFlowPolicySchema>;

export const browserFlowLimitsSchema = z.object({
  maxSteps: z.number().int().positive().default(200),
  maxDurationMs: z
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),
  maxReplaySpeed: z.number().positive().max(4).default(1),
  stepTimeoutMs: z.number().int().positive().default(15_000),
});

export type BrowserFlowLimits = z.infer<typeof browserFlowLimitsSchema>;

export const browserFlowViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type BrowserFlowViewport = z.infer<typeof browserFlowViewportSchema>;

export const browserFlowTargetRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export type BrowserFlowTargetRect = z.infer<typeof browserFlowTargetRectSchema>;

export const browserQaBriefRectSchema = z.object({
  x: z.number().nonnegative(),
  y: z.number().nonnegative(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export type BrowserQaBriefRect = z.infer<typeof browserQaBriefRectSchema>;

export const browserQaBriefViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type BrowserQaBriefViewport = z.infer<typeof browserQaBriefViewportSchema>;

export const browserQaBriefScrollPositionSchema = z.object({
  x: z.number().nonnegative().default(0),
  y: z.number().nonnegative().default(0),
});

export type BrowserQaBriefScrollPosition = z.infer<typeof browserQaBriefScrollPositionSchema>;

export const browserQaBriefBrowserMetadataSchema = z.object({
  name: z.string().default("chromium"),
  channel: z.string().optional(),
  userAgent: z.string().optional(),
  version: z.string().optional(),
  headed: z.literal(true).default(true),
});

export type BrowserQaBriefBrowserMetadata = z.infer<typeof browserQaBriefBrowserMetadataSchema>;

export const browserQaBriefGuardrailPolicySchema = z.object({
  headedReview: z.literal(true).default(true),
  noCaptchaBypass: z.literal(true).default(true),
  noAccessControlBypass: z.literal(true).default(true),
  noCredentialCapture: z.literal(true).default(true),
});

export type BrowserQaBriefGuardrailPolicy = z.infer<typeof browserQaBriefGuardrailPolicySchema>;

export const browserQaBriefElementTargetSchema = z.object({
  selector: z.string().min(1),
  rect: browserQaBriefRectSchema.optional(),
  textSample: z.string().optional(),
  tagName: z.string().optional(),
  role: z.string().optional(),
  ariaLabel: z.string().optional(),
  name: z.string().optional(),
  testId: z.string().optional(),
});

export type BrowserQaBriefElementTarget = z.infer<typeof browserQaBriefElementTargetSchema>;

export const browserQaBriefStepBaseSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  url: z.string().min(1),
  scroll: browserQaBriefScrollPositionSchema.default({ x: 0, y: 0 }),
  pageTitle: z.string().optional(),
  viewport: browserQaBriefViewportSchema.optional(),
});

export const browserQaBriefNavigateStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("navigate"),
  url: z.string().url(),
  reachedFrom: z.string().min(1).optional(),
});

export const browserQaBriefDemoClickStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("demo-click"),
  target: browserQaBriefElementTargetSchema,
});

export const browserQaBriefDemoInputStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("demo-input"),
  target: browserQaBriefElementTargetSchema,
  action: z.enum(["fill", "select"]),
  value: z.string(),
  inputType: z.string().optional(),
});

export const browserQaBriefDemoFocusStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("demo-focus"),
  target: browserQaBriefElementTargetSchema,
  focusSource: z.enum(["keyboard", "pointer", "programmatic", "unknown"]).default("unknown"),
});

export const browserQaBriefKeyboardEventSchema = z.object({
  key: z.string().min(1),
  code: z.string().optional(),
  text: z.string().optional(),
  modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).default([]),
});

export type BrowserQaBriefKeyboardEvent = z.infer<typeof browserQaBriefKeyboardEventSchema>;

export const browserQaBriefDemoKeyboardStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("demo-keyboard"),
  event: browserQaBriefKeyboardEventSchema,
  focusedSelector: z.string().min(1).optional(),
  targetRect: browserQaBriefRectSchema.optional(),
});

export const browserQaBriefDemoScrollStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("demo-scroll"),
  from: browserQaBriefScrollPositionSchema,
  to: browserQaBriefScrollPositionSchema,
  deltaX: z.number(),
  deltaY: z.number(),
});

export const browserQaBriefAnnotateElementStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("annotate-element"),
  target: browserQaBriefElementTargetSchema,
  instruction: z.string().trim().min(1),
});

export const browserQaBriefAnnotateRegionStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("annotate-region"),
  rect: browserQaBriefRectSchema,
  instruction: z.string().trim().min(1),
});

export const browserQaBriefAssertionNoteStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("assertion-note"),
  assertion: z.string().trim().min(1),
});

export const browserQaBriefCheckpointStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("checkpoint"),
  reason: z.string().trim().min(1),
});

export const browserQaBriefCommentStepSchema = browserQaBriefStepBaseSchema.extend({
  type: z.literal("comment"),
  comment: z.string().trim().min(1),
});

export const browserQaBriefStepSchema = z.discriminatedUnion("type", [
  browserQaBriefNavigateStepSchema,
  browserQaBriefDemoClickStepSchema,
  browserQaBriefDemoInputStepSchema,
  browserQaBriefDemoFocusStepSchema,
  browserQaBriefDemoKeyboardStepSchema,
  browserQaBriefDemoScrollStepSchema,
  browserQaBriefAnnotateElementStepSchema,
  browserQaBriefAnnotateRegionStepSchema,
  browserQaBriefAssertionNoteStepSchema,
  browserQaBriefCheckpointStepSchema,
  browserQaBriefCommentStepSchema,
]);

export type BrowserQaBriefStep = z.infer<typeof browserQaBriefStepSchema>;

export const browserQaBriefAuditSchema = z
  .object({
    createdBy: z.string().optional(),
    createdWith: z.literal("web-seek-cli").default("web-seek-cli"),
    lastSavedAt: z.string().optional(),
  })
  .default({ createdWith: "web-seek-cli" });

export type BrowserQaBriefAudit = z.infer<typeof browserQaBriefAuditSchema>;

export const browserQaBriefSchema = z.object({
  schema: z.literal("web-seek.browser-qa-brief.v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().trim().min(1),
  startUrl: z.string().url(),
  visitedUrls: z.array(z.string().min(1)).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  viewport: browserQaBriefViewportSchema,
  browser: browserQaBriefBrowserMetadataSchema.default({ name: "chromium", headed: true }),
  guardrails: browserQaBriefGuardrailPolicySchema.default({
    headedReview: true,
    noCaptchaBypass: true,
    noAccessControlBypass: true,
    noCredentialCapture: true,
  }),
  steps: z.array(browserQaBriefStepSchema).default([]),
  notes: z.string().optional(),
  audit: browserQaBriefAuditSchema,
});

export type BrowserQaBrief = z.infer<typeof browserQaBriefSchema>;

const browserFlowStepBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  timestamp: z.string().optional(),
  optional: z.boolean().default(false),
});

export const browserFlowNavigateStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("navigate"),
  url: z.string().url(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("domcontentloaded"),
});

export const browserFlowClickStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("click"),
  selector: z.string().min(1),
  targetRect: browserFlowTargetRectSchema.optional(),
  viewport: browserFlowViewportSchema.optional(),
  urlBefore: z.string().url().optional(),
  urlAfter: z.string().url().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const browserFlowFillStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("fill"),
  selector: z.string().min(1),
  value: z.string(),
  inputType: z.string().optional(),
  targetRect: browserFlowTargetRectSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const browserFlowSelectStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("select"),
  selector: z.string().min(1),
  value: z.string(),
  inputType: z.string().optional(),
  targetRect: browserFlowTargetRectSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const browserFlowKeyboardEventSchema = z.object({
  key: z.string().min(1),
  code: z.string().optional(),
  text: z.string().optional(),
  modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).default([]),
  relativeTimeMs: z.number().int().nonnegative().optional(),
});

export type BrowserFlowKeyboardEvent = z.infer<typeof browserFlowKeyboardEventSchema>;

export const browserFlowKeyboardStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("keyboard"),
  keySequence: z.array(browserFlowKeyboardEventSchema).min(1),
  focusedSelector: z.string().min(1).optional(),
  targetRect: browserFlowTargetRectSchema.optional(),
});

export const browserFlowScrollStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("scroll"),
  x: z.number().default(0),
  y: z.number().default(0),
  scrollContainer: z.string().min(1).optional(),
  viewport: browserFlowViewportSchema.optional(),
  waitAfterMs: z.number().int().nonnegative().default(250),
});

export const browserFlowPointerPointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  relativeTimeMs: z.number().int().nonnegative(),
});

export type BrowserFlowPointerPoint = z.infer<typeof browserFlowPointerPointSchema>;

export const browserFlowPointerTraceStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("pointer-trace"),
  startTargetSelector: z.string().min(1).optional(),
  endTargetSelector: z.string().min(1).optional(),
  viewport: browserFlowViewportSchema,
  points: z.array(browserFlowPointerPointSchema).min(1),
  keyboardEvents: z.array(browserFlowKeyboardEventSchema).default([]),
  lastPointerLocation: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
    })
    .optional(),
});

export const browserFlowWaitStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("wait"),
  durationMs: z.number().int().nonnegative().default(1000),
  reason: z.string().optional(),
});

export const browserFlowCheckpointStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("checkpoint"),
  label: z.string().min(1),
  instruction: z.string().min(1),
  screenshot: z.string().optional(),
});

export const browserFlowCaptureTextStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("capture-text"),
  selector: z.string().min(1),
  attribute: z
    .enum(["text", "html", "value", "href", "src", "aria-label", "title"])
    .default("text"),
  sampleValue: z.string().optional(),
  assertionMode: z.enum(["none", "contains", "equals", "matches"]).default("none"),
});

export const browserFlowCaptureRegionStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("capture-region"),
  selector: z.string().min(1).optional(),
  targetRect: browserFlowTargetRectSchema.optional(),
  screenshot: z.string().optional(),
  assertionMode: z.enum(["none", "visual-review"]).default("visual-review"),
});

export const browserFlowAssertTextStepSchema = browserFlowStepBaseSchema.extend({
  type: z.literal("assert-text"),
  selector: z.string().min(1),
  expectedText: z.string(),
  mode: z.enum(["contains", "equals", "matches"]).default("contains"),
  timeoutMs: z.number().int().positive().optional(),
});

export const browserFlowStepSchema = z.discriminatedUnion("type", [
  browserFlowNavigateStepSchema,
  browserFlowClickStepSchema,
  browserFlowFillStepSchema,
  browserFlowSelectStepSchema,
  browserFlowKeyboardStepSchema,
  browserFlowScrollStepSchema,
  browserFlowPointerTraceStepSchema,
  browserFlowWaitStepSchema,
  browserFlowCheckpointStepSchema,
  browserFlowCaptureTextStepSchema,
  browserFlowCaptureRegionStepSchema,
  browserFlowAssertTextStepSchema,
]);

export type BrowserFlowStep = z.infer<typeof browserFlowStepSchema>;
export type BrowserFlowPointerTraceStep = z.infer<typeof browserFlowPointerTraceStepSchema>;

export const browserFlowArtifactsSchema = z
  .object({
    screenshots: z.array(z.string()).default([]),
    captures: z.array(z.string()).default([]),
    replayLogs: z.array(z.string()).default([]),
  })
  .default({ screenshots: [], captures: [], replayLogs: [] });

export type BrowserFlowArtifacts = z.infer<typeof browserFlowArtifactsSchema>;

export const browserFlowAuditSchema = z
  .object({
    createdBy: z.string().optional(),
    createdWith: z.literal("web-seek-cli").default("web-seek-cli"),
    authorizationNote: z.string().default("Authorized QA workflow"),
    lastSavedAt: z.string().optional(),
  })
  .default({ createdWith: "web-seek-cli", authorizationNote: "Authorized QA workflow" });

export type BrowserFlowAudit = z.infer<typeof browserFlowAuditSchema>;

export const browserFlowSchema = z.object({
  schema: z.literal("web-seek.browser-flow.v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  startUrl: z.string().url(),
  allowedOrigins: z.array(z.string().url()).min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  browser: browserProfileSchema.default({
    headless: false,
    viewport: { width: 1440, height: 1000 },
    slowMoMs: 0,
  }),
  policy: browserFlowPolicySchema.default({
    requiresAuthorization: true,
    noBypass: true,
    allowHeadlessReplay: false,
    allowCredentialCapture: false,
    allowNetworkPayloadCapture: false,
  }),
  limits: browserFlowLimitsSchema.default({
    maxSteps: 200,
    maxDurationMs: 30 * 60 * 1000,
    maxReplaySpeed: 1,
    stepTimeoutMs: 15_000,
  }),
  steps: z.array(browserFlowStepSchema).default([]),
  artifacts: browserFlowArtifactsSchema,
  audit: browserFlowAuditSchema,
});

export type BrowserFlow = z.infer<typeof browserFlowSchema>;

export const browserFlowReplayLogSchema = z.object({
  stepId: z.string().optional(),
  stepType: z.string().optional(),
  status: z.enum(["pass", "fail", "warn", "info"]),
  message: z.string(),
  timestamp: z.string(),
});

export type BrowserFlowReplayLog = z.infer<typeof browserFlowReplayLogSchema>;

export const browserFlowCaptureResultSchema = z.object({
  stepId: z.string(),
  stepType: z.enum(["capture-text", "capture-region", "assert-text"]),
  selector: z.string().optional(),
  attribute: z.string().optional(),
  value: z.string().optional(),
  screenshot: z.string().optional(),
  assertionMode: z.string().optional(),
  passed: z.boolean().optional(),
  capturedAt: z.string(),
});

export type BrowserFlowCaptureResult = z.infer<typeof browserFlowCaptureResultSchema>;

export const browserFlowReplayResultSchema = z.object({
  schema: z.literal("web-seek.browser-flow-replay.v1"),
  id: z.string().min(1),
  flowId: z.string().min(1),
  flowName: z.string().min(1),
  startedAt: z.string(),
  stoppedAt: z.string(),
  status: z.enum(["passed", "failed", "stopped"]),
  startUrl: z.string().url(),
  finalUrl: z.string(),
  allowedOrigins: z.array(z.string().url()),
  captures: z.array(browserFlowCaptureResultSchema).default([]),
  logs: z.array(browserFlowReplayLogSchema).default([]),
});

export type BrowserFlowReplayResult = z.infer<typeof browserFlowReplayResultSchema>;

export const humanInLoopSchema = z.object({
  enabled: z.boolean().default(true),
  pauseBeforeRun: z.boolean().default(false),
  challengeDetection: z.boolean().default(true),
  instructions: z.string().optional(),
});

export type HumanInLoop = z.infer<typeof humanInLoopSchema>;

export const authoringMetadataSchema = z.object({
  sourceUrl: z.string().url().optional(),
  createdWith: z.literal("overlay").optional(),
  lastPreviewRowCount: z.number().int().nonnegative().optional(),
  recordingId: z.string().optional(),
  recordingPath: z.string().optional(),
  recordingEventCount: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

export type AuthoringMetadata = z.infer<typeof authoringMetadataSchema>;

const stepBaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  optional: z.boolean().default(false),
});

export const navigateStepSchema = stepBaseSchema.extend({
  type: z.literal("navigate"),
  url: z.string().url(),
  waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).default("domcontentloaded"),
});

export const waitForSelectorStepSchema = stepBaseSchema.extend({
  type: z.literal("wait-for-selector"),
  selector: z.string().min(1),
  timeoutMs: z.number().int().positive().default(15_000),
});

export const waitStepSchema = stepBaseSchema.extend({
  type: z.literal("wait"),
  durationMs: z.number().int().nonnegative().default(1000),
  reason: z.string().optional(),
});

export const clickStepSchema = stepBaseSchema.extend({
  type: z.literal("click"),
  selector: z.string().min(1),
  timeoutMs: z.number().int().positive().default(15_000),
});

export const fillStepSchema = stepBaseSchema.extend({
  type: z.literal("fill"),
  selector: z.string().min(1),
  value: z.string(),
  timeoutMs: z.number().int().positive().default(15_000),
});

export const selectStepSchema = stepBaseSchema.extend({
  type: z.literal("select"),
  selector: z.string().min(1),
  value: z.string(),
  timeoutMs: z.number().int().positive().default(15_000),
});

export const humanCheckpointStepSchema = stepBaseSchema.extend({
  type: z.literal("human-checkpoint"),
  reason: z.string().min(1),
});

export const screenshotStepSchema = stepBaseSchema.extend({
  type: z.literal("screenshot"),
  name: z.string().min(1),
  fullPage: z.boolean().default(true),
});

export const scrollStepSchema = stepBaseSchema.extend({
  type: z.literal("scroll"),
  x: z.number().default(0),
  y: z.number().default(0),
  behavior: z.enum(["auto", "smooth"]).default("auto"),
  waitAfterMs: z.number().int().nonnegative().default(500),
});

export const extractTableStepSchema = stepBaseSchema.extend({
  type: z.literal("extract-table"),
  selector: z.string().min(1),
  rowSelector: z.string().default("tbody tr"),
  fields: z.array(fieldSelectorSchema).min(1),
  pagination: paginationConfigSchema.optional(),
  outputKey: z.string().default("rows"),
});

export const extractListStepSchema = stepBaseSchema.extend({
  type: z.literal("extract-list"),
  itemSelector: z.string().min(1),
  fields: z.array(fieldSelectorSchema).min(1),
  pagination: paginationConfigSchema.optional(),
  outputKey: z.string().default("items"),
});

export const downloadStepSchema = stepBaseSchema.extend({
  type: z.literal("download"),
  selector: z.string().min(1),
  outputName: z.string().optional(),
  timeoutMs: z.number().int().positive().default(30_000),
});

export const extractionStepSchema = z.discriminatedUnion("type", [
  navigateStepSchema,
  waitForSelectorStepSchema,
  waitStepSchema,
  clickStepSchema,
  fillStepSchema,
  selectStepSchema,
  humanCheckpointStepSchema,
  screenshotStepSchema,
  scrollStepSchema,
  extractTableStepSchema,
  extractListStepSchema,
  downloadStepSchema,
]);

export type ExtractionStep = z.infer<typeof extractionStepSchema>;
export type ExtractTableStep = z.infer<typeof extractTableStepSchema>;
export type ExtractListStep = z.infer<typeof extractListStepSchema>;

export const siteExtractionConfigSchema = z.object({
  schema: z.literal("web-seek.site-config.v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  group: z.string().optional(),
  jurisdiction: z.string().optional(),
  startUrl: z.string().url(),
  description: z.string().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  browser: browserProfileSchema.default({
    headless: false,
    viewport: { width: 1440, height: 1000 },
    slowMoMs: 0,
  }),
  humanInLoop: humanInLoopSchema.default({
    enabled: true,
    pauseBeforeRun: false,
    challengeDetection: true,
  }),
  authoring: authoringMetadataSchema.optional(),
  steps: z.array(extractionStepSchema).min(1),
  output: z
    .object({
      format: z.enum(["json", "csv", "both"]).default("both"),
      directory: z.string().default("exports"),
    })
    .default({ format: "both", directory: "exports" }),
});

export type SiteExtractionConfig = z.infer<typeof siteExtractionConfigSchema>;

export const extractionRunResultSchema = z.object({
  schema: z.literal("web-seek.extraction-run.v1"),
  configId: z.string(),
  configName: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())),
  downloads: z.array(z.string()),
  screenshots: z.array(z.string()),
  pageCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export type ExtractionRow = Record<string, unknown>;
export type ExtractionRunResult = z.infer<typeof extractionRunResultSchema>;
