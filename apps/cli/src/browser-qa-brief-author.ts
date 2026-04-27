import { note, text } from "@clack/prompts";
import {
  type BrowserQaBrief,
  type BrowserQaBriefStep,
  createBrowserQaBriefId,
  saveBrowserQaBrief,
} from "@web-seek/data-engine";
import type { Page } from "playwright";
import { createContext, gotoWithRecovery, launchChrome } from "./browser";
import { unwrapPrompt } from "./prompt-utils";

const BRIDGE_NAME = "webSeekBrowserQaBriefBridge";
const DEFAULT_START_URL = "http://localhost:3000";

type BrowserQaBriefBridgeMessage =
  | { type: "ready"; brief?: BrowserQaBrief }
  | { type: "draft-change"; brief: BrowserQaBrief }
  | { type: "save-brief"; brief: BrowserQaBrief };

function validateUrl(value: string | undefined): string | undefined {
  if (!value) {
    return "Enter a valid URL.";
  }
  try {
    new URL(value);
    return undefined;
  } catch {
    return "Enter a valid URL.";
  }
}

function uniqueUrls(urls: string[]): string[] {
  return Array.from(new Set(urls.filter((url) => url.trim().length > 0)));
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function stepId(brief: BrowserQaBrief, type: string): string {
  return `step-${brief.steps.length + 1}-${type}-${Date.now()}`;
}

export function appendBrowserQaBriefStep(
  brief: BrowserQaBrief,
  step: BrowserQaBriefStep,
): BrowserQaBrief {
  return {
    ...brief,
    updatedAt: currentTimestamp(),
    visitedUrls: uniqueUrls([...brief.visitedUrls, step.url]),
    steps: [...brief.steps, step],
  };
}

export function recordBrowserQaBriefNavigation(
  brief: BrowserQaBrief,
  url: string,
  reachedFrom?: string,
): BrowserQaBrief {
  const lastStep = brief.steps.at(-1);
  if (lastStep?.type === "navigate" && lastStep.url === url) {
    return {
      ...brief,
      visitedUrls: uniqueUrls([...brief.visitedUrls, url]),
    };
  }

  return appendBrowserQaBriefStep(brief, {
    id: stepId(brief, "navigate"),
    type: "navigate",
    timestamp: currentTimestamp(),
    url,
    reachedFrom,
    scroll: { x: 0, y: 0 },
  });
}

export function prepareBrowserQaBriefForSave(brief: BrowserQaBrief): BrowserQaBrief {
  const now = currentTimestamp();
  return {
    ...brief,
    updatedAt: now,
    visitedUrls: uniqueUrls([brief.startUrl, ...brief.visitedUrls]),
    audit: {
      ...brief.audit,
      createdWith: "web-seek-cli",
      lastSavedAt: now,
    },
  };
}

export function createBrowserQaBriefDraft({
  name,
  summary,
  startUrl,
  viewport,
  userAgent,
  browserVersion,
  date = new Date(),
}: {
  name: string;
  summary: string;
  startUrl: string;
  viewport: { width: number; height: number };
  userAgent?: string;
  browserVersion?: string;
  date?: Date;
}): BrowserQaBrief {
  const now = date.toISOString();
  const brief: BrowserQaBrief = {
    schema: "web-seek.browser-qa-brief.v1",
    id: createBrowserQaBriefId(name, date),
    name: name.trim(),
    summary: summary.trim(),
    startUrl,
    visitedUrls: [startUrl],
    createdAt: now,
    updatedAt: now,
    viewport,
    browser: {
      name: "chromium",
      channel: "chrome",
      userAgent,
      version: browserVersion,
      headed: true,
    },
    guardrails: {
      headedReview: true,
      noCaptchaBypass: true,
      noAccessControlBypass: true,
      noCredentialCapture: true,
    },
    steps: [],
    audit: {
      createdWith: "web-seek-cli",
      lastSavedAt: now,
    },
  };

  return recordBrowserQaBriefNavigation(brief, startUrl);
}

export function installBrowserQaBriefOverlay(params: {
  brief: BrowserQaBrief;
  bridgeName: string;
}): void {
  type Bridge = (message: BrowserQaBriefBridgeMessage) => Promise<void>;
  type Mode = "browse" | "annotate";
  type PanelView = "steps" | "json";
  type Rect = { x: number; y: number; width: number; height: number };
  type ScrollPosition = { x: number; y: number };
  type ElementTarget = {
    selector: string;
    rect?: Rect;
    textSample?: string;
    tagName?: string;
    role?: string;
    ariaLabel?: string;
    name?: string;
    testId?: string;
  };

  const windowWithBridge = window as unknown as Window & Record<string, Bridge | undefined>;
  const maybeBridge = windowWithBridge[params.bridgeName];
  if (!maybeBridge) {
    return;
  }
  const bridge: Bridge = maybeBridge;

  const existing = document.getElementById("web-seek-qa-brief");
  if (existing) {
    existing.remove();
  }
  document.getElementById("web-seek-qa-brief-region")?.remove();

  const state: {
    brief: BrowserQaBrief;
    mode: Mode;
    recording: boolean;
    drawRegion: boolean;
    panelView: PanelView;
    lastScroll: ScrollPosition;
    lastFocusSelector?: string;
    lastPointerDownAt: number;
    scrollTimer?: number;
    dragStart?: { x: number; y: number };
    dragRect?: HTMLDivElement;
  } = {
    brief: params.brief,
    mode: "browse",
    recording: false,
    drawRegion: false,
    panelView: "steps",
    lastScroll: { x: window.scrollX, y: window.scrollY },
    lastPointerDownAt: 0,
  };

  const style = document.createElement("style");
  style.textContent = `
    #web-seek-qa-brief {
      position: fixed;
      top: 14px;
      right: 14px;
      z-index: 2147483647;
      display: grid;
      grid-template-columns: 72px 380px;
      gap: 8px;
      color: #172033;
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
    }
    #web-seek-qa-brief * { box-sizing: border-box; }
    #web-seek-qa-brief .dock,
    #web-seek-qa-brief .panel {
      border: 1px solid #b8c7d9;
      border-radius: 8px;
      background: #f9fbfd;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
    }
    #web-seek-qa-brief .dock {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
    }
    #web-seek-qa-brief button {
      min-height: 34px;
      border: 1px solid #aab8c7;
      border-radius: 6px;
      background: #ffffff;
      color: #172033;
      font: inherit;
      cursor: pointer;
    }
    #web-seek-qa-brief button.active {
      border-color: #0f766e;
      background: #dff7f3;
    }
    #web-seek-qa-brief button.primary {
      border-color: #0f766e;
      background: #0f766e;
      color: #ffffff;
      font-weight: 700;
    }
    #web-seek-qa-brief .panel {
      max-height: min(660px, calc(100vh - 28px));
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    #web-seek-qa-brief header,
    #web-seek-qa-brief footer {
      padding: 10px 12px;
    }
    #web-seek-qa-brief header {
      border-bottom: 1px solid #d2dce8;
    }
    #web-seek-qa-brief h2 {
      margin: 0;
      font-size: 14px;
    }
    #web-seek-qa-brief .subtle {
      margin-top: 2px;
      color: #52657a;
      font-size: 12px;
    }
    #web-seek-qa-brief .body {
      overflow: auto;
      padding: 10px 12px;
    }
    #web-seek-qa-brief .step {
      padding: 8px;
      border: 1px solid #d2dce8;
      border-radius: 6px;
      background: #ffffff;
      margin-bottom: 6px;
    }
    #web-seek-qa-brief .step strong {
      display: block;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      color: #0f766e;
    }
    #web-seek-qa-brief code,
    #web-seek-qa-brief pre {
      overflow-wrap: anywhere;
      white-space: pre-wrap;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #334155;
    }
    #web-seek-qa-brief textarea {
      width: 100%;
      min-height: 52px;
      resize: vertical;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 6px;
      color: #172033;
      font: inherit;
    }
    #web-seek-qa-brief footer {
      border-top: 1px solid #d2dce8;
    }
    .web-seek-qa-highlight {
      outline: 3px solid #0f766e !important;
      outline-offset: 2px !important;
    }
    #web-seek-qa-brief-region {
      position: fixed;
      z-index: 2147483646;
      border: 2px solid #0f766e;
      background: rgba(15, 118, 110, 0.14);
      pointer-events: none;
    }
  `;
  document.documentElement.append(style);

  const root = document.createElement("div");
  root.id = "web-seek-qa-brief";
  root.innerHTML = `
    <div class="dock" aria-label="QA brief tools">
      <button type="button" data-action="toggle-mode" title="Toggle Browse or Annotate. Shift+Tab also toggles outside overlay inputs.">Edit</button>
      <button type="button" data-action="toggle-recording" title="Start or stop capturing demonstration actions.">Record</button>
      <button type="button" data-action="draw-region" title="Draw a visual region annotation.">Region</button>
      <button type="button" data-action="assertion" title="Add an expected behavior or state to verify.">Assert</button>
      <button type="button" data-action="checkpoint" title="Add a human-only or blocked-state checkpoint.">Check</button>
      <button type="button" data-action="comment" title="Add a general QA instruction.">Comment</button>
      <button type="button" data-action="json" title="Preview the exact brief JSON.">JSON</button>
      <button type="button" class="primary" data-action="save" title="Save QA brief">Save</button>
    </div>
    <section class="panel" aria-label="QA brief panel">
      <header>
        <h2>Browser QA Brief</h2>
        <div class="subtle" data-status>Browse mode. Start recording or switch to Annotate.</div>
      </header>
      <div class="body" data-body></div>
      <footer>
        <textarea data-notes placeholder="Optional notes for the QA automation agent"></textarea>
      </footer>
    </section>
  `;
  document.documentElement.append(root);

  const status = root.querySelector<HTMLElement>("[data-status]");
  const body = root.querySelector<HTMLElement>("[data-body]");
  const notes = root.querySelector<HTMLTextAreaElement>("[data-notes]");
  if (notes) {
    notes.value = state.brief.notes ?? "";
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  function scrollPosition(): ScrollPosition {
    return {
      x: Math.max(0, Math.round(window.scrollX)),
      y: Math.max(0, Math.round(window.scrollY)),
    };
  }

  function rectFor(element: Element | null): Rect | undefined {
    if (!element) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return undefined;
    }
    return {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function selectorFor(element: Element | null): string {
    if (!element || element === document.documentElement) {
      return "html";
    }

    const id = element.getAttribute("id");
    if (id && !/\s/.test(id)) {
      return `#${CSS.escape(id)}`;
    }

    for (const attribute of ["data-testid", "data-test", "data-cy", "name", "aria-label"]) {
      const value = element.getAttribute(attribute);
      if (value) {
        return `${element.tagName.toLowerCase()}[${attribute}="${CSS.escape(value)}"]`;
      }
    }

    const parent = element.parentElement;
    if (!parent) {
      return element.tagName.toLowerCase();
    }

    const siblings = Array.from(parent.children).filter(
      (sibling) => sibling.tagName === element.tagName,
    );
    const index = siblings.indexOf(element) + 1;
    return `${selectorFor(parent)} > ${element.tagName.toLowerCase()}:nth-of-type(${index})`;
  }

  function textSampleFor(element: Element | null): string | undefined {
    const sample = element?.textContent?.replace(/\s+/g, " ").trim().slice(0, 300);
    return sample && sample.length > 0 ? sample : undefined;
  }

  function targetFor(element: Element | null): ElementTarget {
    return {
      selector: selectorFor(element),
      rect: rectFor(element),
      textSample: textSampleFor(element),
      tagName: element?.tagName.toLowerCase(),
      role: element?.getAttribute("role") ?? undefined,
      ariaLabel: element?.getAttribute("aria-label") ?? undefined,
      name: element?.getAttribute("name") ?? undefined,
      testId:
        element?.getAttribute("data-testid") ??
        element?.getAttribute("data-test") ??
        element?.getAttribute("data-cy") ??
        undefined,
    };
  }

  function isCredentialInput(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  ): boolean {
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      return false;
    }
    const combined = [
      element.type,
      element.autocomplete,
      element.name,
      element.id,
      element.getAttribute("aria-label") ?? "",
    ].join(" ");
    return /(password|credential|secret|token|api[-_ ]?key|passcode)/i.test(combined);
  }

  function withUpdatedBrief(brief: BrowserQaBrief): BrowserQaBrief {
    const urls = Array.from(new Set([brief.startUrl, ...brief.visitedUrls, window.location.href]));
    return {
      ...brief,
      updatedAt: nowIso(),
      visitedUrls: urls,
      notes: notes?.value.trim() ? notes.value : undefined,
    };
  }

  async function setBrief(brief: BrowserQaBrief): Promise<void> {
    state.brief = withUpdatedBrief(brief);
    render();
    await bridge({ type: "draft-change", brief: state.brief });
  }

  async function appendStep(step: BrowserQaBriefStep): Promise<void> {
    await setBrief({
      ...state.brief,
      steps: [...state.brief.steps, step],
    });
  }

  function makeBase(type: string): {
    id: string;
    timestamp: string;
    url: string;
    scroll: ScrollPosition;
    pageTitle?: string;
    viewport: { width: number; height: number };
  } {
    return {
      id: `step-${state.brief.steps.length + 1}-${type}-${Date.now()}`,
      timestamp: nowIso(),
      url: window.location.href,
      scroll: scrollPosition(),
      pageTitle: document.title || undefined,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }

  function setStatus(message: string): void {
    if (status) {
      status.textContent = message;
    }
  }

  function shortStep(step: BrowserQaBriefStep): string {
    if (step.type === "navigate") {
      return step.url;
    }
    if (step.type === "demo-click" || step.type === "annotate-element") {
      return step.target.selector;
    }
    if (step.type === "demo-input") {
      return `${step.action} ${step.target.selector} = ${step.value}`;
    }
    if (step.type === "demo-focus") {
      return `${step.focusSource} focus on ${step.target.selector}`;
    }
    if (step.type === "demo-keyboard") {
      return step.event.code ?? step.event.key;
    }
    if (step.type === "demo-scroll") {
      return `${step.from.x},${step.from.y} to ${step.to.x},${step.to.y}`;
    }
    if (step.type === "annotate-region") {
      return `${step.rect.x},${step.rect.y} ${step.rect.width}x${step.rect.height}`;
    }
    if (step.type === "assertion-note") {
      return step.assertion;
    }
    if (step.type === "checkpoint") {
      return step.reason;
    }
    return step.comment;
  }

  function render(): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-action]")) {
      const action = button.dataset.action;
      button.classList.toggle(
        "active",
        (action === "toggle-mode" && state.mode === "annotate") ||
          (action === "toggle-recording" && state.recording) ||
          (action === "draw-region" && state.drawRegion) ||
          (action === "json" && state.panelView === "json"),
      );
      if (action === "toggle-mode") {
        button.textContent = state.mode === "annotate" ? "Browse" : "Edit";
      }
      if (action === "toggle-recording") {
        button.textContent = state.recording ? "Stop" : "Record";
      }
    }

    if (!body) {
      return;
    }
    body.innerHTML = "";
    if (state.panelView === "json") {
      const pre = document.createElement("pre");
      pre.textContent = JSON.stringify(withUpdatedBrief(state.brief), null, 2);
      body.append(pre);
      return;
    }

    if (state.brief.steps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "subtle";
      empty.textContent = "No QA guidance recorded yet.";
      body.append(empty);
      return;
    }

    for (const [index, step] of state.brief.steps.entries()) {
      const item = document.createElement("div");
      item.className = "step";
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${step.type}`;
      const code = document.createElement("code");
      code.textContent = shortStep(step);
      item.append(title, code);
      body.append(item);
    }
  }

  function isOverlayTextInput(target: EventTarget | null): boolean {
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return root.contains(target);
    }
    return target instanceof HTMLElement && root.contains(target) && target.isContentEditable;
  }

  function modifiersFor(event: KeyboardEvent): Array<"Alt" | "Control" | "Meta" | "Shift"> {
    const modifiers: Array<"Alt" | "Control" | "Meta" | "Shift"> = [];
    if (event.altKey) {
      modifiers.push("Alt");
    }
    if (event.ctrlKey) {
      modifiers.push("Control");
    }
    if (event.metaKey) {
      modifiers.push("Meta");
    }
    if (event.shiftKey) {
      modifiers.push("Shift");
    }
    return modifiers;
  }

  function recordNavigation(url: string, reachedFrom?: string): void {
    const lastStep = state.brief.steps.at(-1);
    if (lastStep?.type === "navigate" && lastStep.url === url) {
      void setBrief(state.brief);
      return;
    }
    void appendStep({
      ...makeBase("navigate"),
      type: "navigate",
      url,
      reachedFrom,
      scroll: { x: 0, y: 0 },
    });
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function pushState(...args) {
    const from = window.location.href;
    const result = originalPushState.apply(this, args);
    if (window.location.href !== from) {
      recordNavigation(window.location.href, from);
    }
    return result;
  };
  history.replaceState = function replaceState(...args) {
    const from = window.location.href;
    const result = originalReplaceState.apply(this, args);
    if (window.location.href !== from) {
      recordNavigation(window.location.href, from);
    }
    return result;
  };
  window.addEventListener("popstate", () => recordNavigation(window.location.href));

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.dataset.action;
    if (!action) {
      return;
    }

    if (action === "toggle-mode") {
      state.mode = state.mode === "browse" ? "annotate" : "browse";
      state.drawRegion = false;
      setStatus(
        state.mode === "annotate"
          ? "Annotate mode. Click an element or draw a region."
          : "Browse mode. The website is fully usable.",
      );
      render();
      return;
    }

    if (action === "toggle-recording") {
      state.recording = !state.recording;
      setStatus(
        state.recording
          ? "Recording demonstration actions while the site remains usable."
          : "Recording stopped.",
      );
      render();
      return;
    }

    if (action === "draw-region") {
      state.mode = "annotate";
      state.drawRegion = !state.drawRegion;
      setStatus(
        state.drawRegion
          ? "Drag a bounding box around the visual area to verify."
          : "Region drawing stopped.",
      );
      render();
      return;
    }

    if (action === "assertion") {
      const assertion = window.prompt("Expected behavior or state to verify", "");
      if (assertion?.trim()) {
        void appendStep({
          ...makeBase("assertion-note"),
          type: "assertion-note",
          assertion: assertion.trim(),
        }).then(() => setStatus("Assertion note added."));
      }
      return;
    }

    if (action === "comment") {
      const comment = window.prompt("General instruction for the QA automation agent", "");
      if (comment?.trim()) {
        void appendStep({
          ...makeBase("comment"),
          type: "comment",
          comment: comment.trim(),
        }).then(() => setStatus("Comment added."));
      }
      return;
    }

    if (action === "checkpoint") {
      const reason = window.prompt(
        "Human-only or blocked-state checkpoint",
        "Stop if a CAPTCHA, login, terms, or access-control challenge appears.",
      );
      if (reason?.trim()) {
        void appendStep({
          ...makeBase("checkpoint"),
          type: "checkpoint",
          reason: reason.trim(),
        }).then(() => setStatus("Checkpoint added."));
      }
      return;
    }

    if (action === "json") {
      state.panelView = state.panelView === "json" ? "steps" : "json";
      render();
      return;
    }

    if (action === "save") {
      const prepared = withUpdatedBrief({
        ...state.brief,
        updatedAt: nowIso(),
        audit: {
          ...state.brief.audit,
          createdWith: "web-seek-cli",
          lastSavedAt: nowIso(),
        },
      });
      setStatus("Saving QA brief...");
      void bridge({ type: "save-brief", brief: prepared });
    }
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.shiftKey && event.key === "Tab" && !isOverlayTextInput(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        state.mode = state.mode === "browse" ? "annotate" : "browse";
        state.drawRegion = false;
        setStatus(state.mode === "annotate" ? "Annotate mode." : "Browse mode.");
        render();
        return;
      }

      if (!state.recording || root.contains(event.target instanceof Node ? event.target : null)) {
        return;
      }

      void appendStep({
        ...makeBase("demo-keyboard"),
        type: "demo-keyboard",
        event: {
          key: event.key,
          code: event.code,
          text: event.key.length === 1 ? event.key : undefined,
          modifiers: modifiersFor(event),
        },
        focusedSelector: selectorFor(document.activeElement),
        targetRect: rectFor(document.activeElement),
      });
    },
    true,
  );

  document.addEventListener(
    "focusin",
    (event) => {
      const target = event.target;
      if (!state.recording || !(target instanceof Element) || root.contains(target)) {
        return;
      }

      const selector = selectorFor(target);
      if (selector === state.lastFocusSelector) {
        return;
      }
      state.lastFocusSelector = selector;
      const focusSource =
        performance.now() - state.lastPointerDownAt < 500 ? "pointer" : "keyboard";

      void appendStep({
        ...makeBase("demo-focus"),
        type: "demo-focus",
        target: targetFor(target),
        focusSource,
      }).then(() => setStatus("Focus demonstration recorded."));
    },
    true,
  );

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || root.contains(target)) {
        return;
      }

      if (state.mode === "annotate" && !state.drawRegion) {
        event.preventDefault();
        event.stopPropagation();
        const instruction = window.prompt("What should QA automation verify for this element?", "");
        if (!instruction?.trim()) {
          setStatus("Element annotation discarded.");
          return;
        }
        void appendStep({
          ...makeBase("annotate-element"),
          type: "annotate-element",
          target: targetFor(target),
          instruction: instruction.trim(),
        }).then(() => setStatus("Element annotation added."));
        return;
      }

      if (!state.recording) {
        return;
      }

      void appendStep({
        ...makeBase("demo-click"),
        type: "demo-click",
        target: targetFor(target),
      }).then(() => setStatus("Click demonstration recorded."));
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (
        !state.recording ||
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        ) ||
        root.contains(target)
      ) {
        return;
      }

      void appendStep({
        ...makeBase("demo-input"),
        type: "demo-input",
        target: targetFor(target),
        action: target instanceof HTMLSelectElement ? "select" : "fill",
        value: isCredentialInput(target) ? "[credential value not captured]" : target.value,
        inputType: target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase(),
      }).then(() => setStatus("Input demonstration recorded."));
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || root.contains(target)) {
        return;
      }
      state.lastPointerDownAt = performance.now();
      if (state.mode !== "annotate" || !state.drawRegion) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      state.dragStart = { x: event.clientX, y: event.clientY };
      state.dragRect = document.createElement("div");
      state.dragRect.id = "web-seek-qa-brief-region";
      document.documentElement.append(state.dragRect);
    },
    true,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (!state.dragStart || !state.dragRect) {
        return;
      }
      const left = Math.min(state.dragStart.x, event.clientX);
      const top = Math.min(state.dragStart.y, event.clientY);
      const width = Math.abs(event.clientX - state.dragStart.x);
      const height = Math.abs(event.clientY - state.dragStart.y);
      Object.assign(state.dragRect.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
      });
    },
    true,
  );

  document.addEventListener(
    "pointerup",
    (event) => {
      if (!state.dragStart || !state.dragRect) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const rect = state.dragRect.getBoundingClientRect();
      state.dragRect.remove();
      state.dragRect = undefined;
      state.dragStart = undefined;
      if (rect.width < 4 || rect.height < 4) {
        setStatus("Region annotation discarded because the box was too small.");
        return;
      }
      const instruction = window.prompt("What visual expectation should QA verify here?", "");
      if (!instruction?.trim()) {
        setStatus("Region annotation discarded.");
        return;
      }
      void appendStep({
        ...makeBase("annotate-region"),
        type: "annotate-region",
        rect: {
          x: Math.max(0, Math.round(rect.x)),
          y: Math.max(0, Math.round(rect.y)),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        instruction: instruction.trim(),
      }).then(() => setStatus("Region annotation added."));
    },
    true,
  );

  document.addEventListener(
    "mouseover",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || root.contains(target)) {
        return;
      }
      target.classList.toggle("web-seek-qa-highlight", state.mode === "annotate");
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (event) => {
      const target = event.target;
      if (target instanceof Element) {
        target.classList.remove("web-seek-qa-highlight");
      }
    },
    true,
  );

  window.addEventListener(
    "scroll",
    () => {
      if (!state.recording) {
        state.lastScroll = scrollPosition();
        return;
      }
      if (state.scrollTimer) {
        window.clearTimeout(state.scrollTimer);
      }
      state.scrollTimer = window.setTimeout(() => {
        const from = state.lastScroll;
        const to = scrollPosition();
        const deltaX = to.x - from.x;
        const deltaY = to.y - from.y;
        state.lastScroll = to;
        if (deltaX === 0 && deltaY === 0) {
          return;
        }
        void appendStep({
          ...makeBase("demo-scroll"),
          type: "demo-scroll",
          from,
          to,
          deltaX,
          deltaY,
        }).then(() => setStatus("Scroll demonstration recorded."));
      }, 250);
    },
    true,
  );

  render();
  void bridge({ type: "ready", brief: state.brief });
}

async function injectQaBriefOverlay(page: Page, brief: BrowserQaBrief): Promise<void> {
  await page
    .evaluate(installBrowserQaBriefOverlay, { brief, bridgeName: BRIDGE_NAME })
    .catch(() => undefined);
}

export async function authorBrowserQaBrief(): Promise<string> {
  const name = await unwrapPrompt(
    text({
      message: "QA brief name",
      placeholder: "Checkout smoke QA brief",
      validate(value) {
        return value?.trim().length ? undefined : "Enter a QA brief name.";
      },
    }),
  );

  const summary = await unwrapPrompt(
    text({
      message: "Brief summary",
      placeholder: "Verify search, filters, and result states for the public lookup.",
      validate(value) {
        return value?.trim().length ? undefined : "Enter a summary.";
      },
    }),
  );

  const startUrl = await unwrapPrompt(
    text({
      message: "Start URL",
      defaultValue: DEFAULT_START_URL,
      validate: validateUrl,
    }),
  );

  let resolveSaved!: (path: string) => void;
  let rejectSaved!: (error: Error) => void;
  const saved = new Promise<string>((resolve, reject) => {
    resolveSaved = resolve;
    rejectSaved = reject;
  });

  const browser = await launchChrome({ headless: false });
  const context = await createContext(browser, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  let brief: BrowserQaBrief | undefined;

  await page.exposeBinding(BRIDGE_NAME, async (_source, message: BrowserQaBriefBridgeMessage) => {
    if (message.brief) {
      brief = message.brief;
    }

    if (message.type !== "save-brief") {
      return;
    }

    try {
      const prepared = prepareBrowserQaBriefForSave(message.brief);
      brief = prepared;
      const path = await saveBrowserQaBrief(prepared);
      resolveSaved(path);
    } catch (error) {
      rejectSaved(error instanceof Error ? error : new Error(String(error)));
    }
  });

  page.on("domcontentloaded", () => {
    if (brief) {
      void injectQaBriefOverlay(page, brief);
    }
  });
  page.on("framenavigated", (frame) => {
    if (!brief || frame !== page.mainFrame()) {
      return;
    }
    brief = recordBrowserQaBriefNavigation(brief, page.url());
  });
  page.on("close", () => {
    rejectSaved(new Error("Browser QA brief authoring closed before saving."));
  });
  browser.on("disconnected", () => {
    rejectSaved(new Error("Browser QA brief authoring ended before saving."));
  });

  const navigation = await gotoWithRecovery(page, startUrl, { waitUntil: "domcontentloaded" });
  if (navigation.warning) {
    note(navigation.warning, "Navigation");
  }

  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
  const viewport = page.viewportSize() ?? { width: 1440, height: 1000 };
  const authoredStartUrl = navigation.failed ? startUrl : navigation.finalUrl;
  brief = createBrowserQaBriefDraft({
    name,
    summary,
    startUrl: authoredStartUrl,
    viewport,
    userAgent,
    browserVersion: browser.version(),
  });

  await injectQaBriefOverlay(page, brief);

  note(
    "Use Chrome to browse, record demonstration actions, annotate expected behavior, preview JSON, then Save.",
    "Create browser QA brief",
  );

  try {
    const path = await saved;
    await browser.close();
    return path;
  } catch (error) {
    await browser.close();
    throw error;
  }
}
