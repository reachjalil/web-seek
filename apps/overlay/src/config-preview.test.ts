import { describe, expect, test } from "bun:test";
import { buildGeneratedConfigPreview, draftIssues } from "./config-preview";
import type { OverlayDraft } from "./types";

function baseDraft(overrides: Partial<OverlayDraft> = {}): OverlayDraft {
  return {
    id: "test-workflow",
    name: "Test Workflow",
    startUrl: "https://example.com/search",
    sourceUrl: "https://example.com/results",
    extractionKind: "list",
    itemSelector: ".result",
    fields: [
      {
        id: "field-title",
        name: "title",
        selector: "h2",
        attribute: "text",
        required: true,
        transform: "trim",
      },
    ],
    actions: [],
    lastPreviewRowCount: 2,
    ...overrides,
  };
}

describe("overlay config preview", () => {
  test("generates a direct capture config", () => {
    const config = buildGeneratedConfigPreview(baseDraft(), 2);

    expect(config.schema).toBe("web-seek.site-config.v1");
    expect(config.steps).toHaveLength(2);
    expect(config.steps.at(-1)).toMatchObject({
      type: "extract-list",
      itemSelector: ".result",
    });
    expect(draftIssues(baseDraft(), { previewRows: [{ title: "One" }] })).toEqual([
      { id: "pagination", label: "Pagination is not configured", severity: "warning" },
    ]);
  });

  test("includes search actions before extraction", () => {
    const config = buildGeneratedConfigPreview(
      baseDraft({
        actions: [
          {
            id: "action-fill",
            type: "fill",
            selector: "input[name='q']",
            value: "engineer",
            label: "Fill search",
            observedMutations: 0,
            observedNetwork: 0,
            pointerMoves: 0,
          },
          {
            id: "action-click",
            type: "click",
            selector: "button[type='submit']",
            label: "Submit search",
            observedMutations: 1,
            observedNetwork: 1,
            pointerMoves: 3,
          },
        ],
      }),
      2,
    );

    expect(config.steps.map((step) => step?.type)).toEqual([
      "navigate",
      "fill",
      "click",
      "extract-list",
    ]);
  });

  test("includes bounded pagination", () => {
    const draft = baseDraft({
      pagination: {
        nextSelector: "a[rel='next']",
        maxPages: 3,
        waitAfterMs: 750,
        stopWhenSelectorDisabled: true,
      },
    });
    const config = buildGeneratedConfigPreview(draft, 2);
    const extractStep = config.steps.at(-1);

    expect(extractStep).toMatchObject({
      type: "extract-list",
      pagination: { nextSelector: "a[rel='next']", maxPages: 3 },
    });
    expect(draftIssues(draft, { previewRows: [{ title: "One" }] })).toContainEqual({
      id: "pagination-current-page-preview",
      label: "Preview only checks the current page; extraction will use bounded pagination",
      severity: "warning",
    });
  });

  test("flags missing action selectors", () => {
    const issues = draftIssues(
      baseDraft({
        actions: [
          {
            id: "action-click",
            type: "click",
            label: "Broken click",
            observedMutations: 0,
            observedNetwork: 0,
            pointerMoves: 0,
          },
        ],
      }),
      { previewRows: [{ title: "One" }] },
    );

    expect(issues).toContainEqual({
      id: "action-selector",
      label: "An action is missing a selector",
      severity: "error",
    });
  });

  test("requires preview unless explicitly waived", () => {
    expect(draftIssues(baseDraft({ lastPreviewRowCount: undefined }))).toContainEqual({
      id: "preview-required",
      label: "Run preview before saving, or explicitly save without preview",
      severity: "error",
    });
    expect(
      draftIssues(baseDraft({ lastPreviewRowCount: undefined, previewWaived: true })),
    ).not.toContainEqual({
      id: "preview-required",
      label: "Run preview before saving, or explicitly save without preview",
      severity: "error",
    });
  });
});
