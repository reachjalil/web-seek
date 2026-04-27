import { afterEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import {
  browserQaBriefPathForId,
  listBrowserQaBriefs,
  readBrowserQaBrief,
  saveBrowserQaBrief,
} from "./browser-qa-brief-store";
import type { BrowserQaBrief } from "./schemas";
import { browserQaBriefSchema } from "./schemas";

const savedPaths = new Set<string>();

function validBrief(overrides: Partial<BrowserQaBrief> = {}): BrowserQaBrief {
  return {
    schema: "web-seek.browser-qa-brief.v1",
    id: "qa-brief-test-20260101T000000Z",
    name: "QA Brief Test",
    summary: "Verify the public search form and result states.",
    startUrl: "https://example.com/search",
    visitedUrls: ["https://example.com/search", "https://example.com/results"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
    viewport: { width: 1440, height: 1000 },
    browser: {
      name: "chromium",
      channel: "chrome",
      userAgent: "test-agent",
      version: "1.0.0",
      headed: true,
    },
    guardrails: {
      headedReview: true,
      noCaptchaBypass: true,
      noAccessControlBypass: true,
      noCredentialCapture: true,
    },
    steps: [
      {
        id: "step-1-navigate",
        type: "navigate",
        timestamp: "2026-01-01T00:00:01.000Z",
        url: "https://example.com/search",
        scroll: { x: 0, y: 0 },
      },
      {
        id: "step-2-click",
        type: "demo-click",
        timestamp: "2026-01-01T00:00:02.000Z",
        url: "https://example.com/search",
        scroll: { x: 0, y: 0 },
        target: {
          selector: 'button[name="search"]',
          rect: { x: 20, y: 40, width: 120, height: 36 },
          textSample: "Search",
        },
      },
      {
        id: "step-3-focus",
        type: "demo-focus",
        timestamp: "2026-01-01T00:00:02.500Z",
        url: "https://example.com/search",
        scroll: { x: 0, y: 0 },
        pageTitle: "Example Search",
        viewport: { width: 1440, height: 1000 },
        target: {
          selector: 'input[name="q"]',
          rect: { x: 20, y: 80, width: 240, height: 36 },
          tagName: "input",
          ariaLabel: "Search",
          name: "q",
        },
        focusSource: "pointer",
      },
      {
        id: "step-4-input",
        type: "demo-input",
        timestamp: "2026-01-01T00:00:03.000Z",
        url: "https://example.com/search",
        scroll: { x: 0, y: 0 },
        pageTitle: "Example Search",
        viewport: { width: 1440, height: 1000 },
        target: {
          selector: 'input[name="q"]',
          rect: { x: 20, y: 80, width: 240, height: 36 },
          tagName: "input",
          ariaLabel: "Search",
          name: "q",
        },
        action: "fill",
        value: "engineer",
        inputType: "text",
      },
      {
        id: "step-5-element",
        type: "annotate-element",
        timestamp: "2026-01-01T00:00:04.000Z",
        url: "https://example.com/results",
        scroll: { x: 0, y: 320 },
        target: {
          selector: '[data-testid="result-card"]',
          rect: { x: 20, y: 120, width: 600, height: 180 },
          textSample: "Result card",
          tagName: "section",
          testId: "result-card",
        },
        instruction: "Verify each result shows a name and status.",
      },
      {
        id: "step-6-region",
        type: "annotate-region",
        timestamp: "2026-01-01T00:00:05.000Z",
        url: "https://example.com/results",
        scroll: { x: 0, y: 320 },
        rect: { x: 10, y: 10, width: 300, height: 160 },
        instruction: "Verify the summary count remains visible above results.",
      },
      {
        id: "step-7-assertion",
        type: "assertion-note",
        timestamp: "2026-01-01T00:00:06.000Z",
        url: "https://example.com/results",
        scroll: { x: 0, y: 320 },
        assertion: "Results should update after search without a full page error.",
      },
      {
        id: "step-8-checkpoint",
        type: "checkpoint",
        timestamp: "2026-01-01T00:00:07.000Z",
        url: "https://example.com/results",
        scroll: { x: 0, y: 320 },
        reason: "Stop if a CAPTCHA or access-control challenge appears.",
      },
    ],
    notes: "Selectors are hints for later Playwright automation.",
    audit: {
      createdWith: "web-seek-cli",
      lastSavedAt: "2026-01-01T00:01:00.000Z",
    },
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    Array.from(savedPaths).map((path) => rm(path, { force: true }).catch(() => undefined)),
  );
  savedPaths.clear();
});

describe("browser QA brief schema", () => {
  test("accepts navigation, demo actions, annotations, assertions, and checkpoints", () => {
    const parsed = browserQaBriefSchema.parse(validBrief());

    expect(parsed.schema).toBe("web-seek.browser-qa-brief.v1");
    expect(parsed.steps.map((step) => step.type)).toContain("annotate-region");
    expect(parsed.guardrails.noCredentialCapture).toBe(true);
  });

  test("rejects missing startUrl", () => {
    const brief = validBrief() as unknown as Record<string, unknown>;
    brief.startUrl = undefined;

    expect(() => browserQaBriefSchema.parse(brief)).toThrow();
  });

  test("rejects invalid step type", () => {
    const brief = validBrief({
      steps: [
        {
          id: "bad-step",
          type: "unknown-step",
          timestamp: "2026-01-01T00:00:00.000Z",
          url: "https://example.com/search",
          scroll: { x: 0, y: 0 },
        } as never,
      ],
    });

    expect(() => browserQaBriefSchema.parse(brief)).toThrow();
  });

  test("rejects invalid rect", () => {
    const brief = validBrief({
      steps: [
        {
          id: "bad-region",
          type: "annotate-region",
          timestamp: "2026-01-01T00:00:00.000Z",
          url: "https://example.com/search",
          scroll: { x: 0, y: 0 },
          rect: { x: 0, y: 0, width: -1, height: 10 },
          instruction: "Verify region.",
        },
      ],
    });

    expect(() => browserQaBriefSchema.parse(brief)).toThrow();
  });

  test("rejects empty assertion and comment text", () => {
    expect(() =>
      browserQaBriefSchema.parse(
        validBrief({
          steps: [
            {
              id: "empty-assertion",
              type: "assertion-note",
              timestamp: "2026-01-01T00:00:00.000Z",
              url: "https://example.com/search",
              scroll: { x: 0, y: 0 },
              assertion: "",
            },
          ],
        }),
      ),
    ).toThrow();

    expect(() =>
      browserQaBriefSchema.parse(
        validBrief({
          steps: [
            {
              id: "empty-comment",
              type: "comment",
              timestamp: "2026-01-01T00:00:00.000Z",
              url: "https://example.com/search",
              scroll: { x: 0, y: 0 },
              comment: "",
            },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe("browser QA brief store", () => {
  test("saves, reads, and lists a brief", async () => {
    const brief = validBrief({
      id: "qa-brief-store-test-20260101T000000Z",
      name: "QA Brief Store Test",
    });
    const path = await saveBrowserQaBrief(brief);
    savedPaths.add(path);

    expect(path).toBe(browserQaBriefPathForId(brief.id));
    await expect(readBrowserQaBrief(path)).resolves.toMatchObject({
      id: brief.id,
      schema: "web-seek.browser-qa-brief.v1",
    });

    const briefs = await listBrowserQaBriefs();
    expect(briefs).toContainEqual(
      expect.objectContaining({
        id: brief.id,
        path,
        stepCount: brief.steps.length,
        visitedUrlCount: brief.visitedUrls.length,
      }),
    );
  });
});
