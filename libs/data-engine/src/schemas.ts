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
