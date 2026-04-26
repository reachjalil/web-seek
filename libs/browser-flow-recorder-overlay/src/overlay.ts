import {
  browserFlowStepDetails,
  browserFlowStepSummary,
  isBrowserFlowCaptureOrAssertionStep,
} from "@web-seek/browser-flow-steps";
import type { BrowserFlow, BrowserFlowStep } from "@web-seek/data-engine";

export type RecorderBridgeMessage =
  | { type: "ready" }
  | { type: "draft-change"; step: BrowserFlowStep }
  | { type: "step-update"; step: BrowserFlowStep }
  | { type: "save-flow"; flow: BrowserFlow };

export function installFlowRecorderOverlay(params: {
  flow: BrowserFlow;
  bridgeName: string;
}): void {
  type Bridge = (message: RecorderBridgeMessage) => Promise<void>;
  type ActiveMode =
    | "record"
    | "keyboard"
    | "pointer-trace"
    | "capture"
    | "assert-text"
    | "capture-region"
    | undefined;
  type PanelView = "timeline" | "details" | "captures" | "json";
  type Rect = { x: number; y: number; width: number; height: number };

  const windowWithBridge = window as unknown as Window & Record<string, Bridge | undefined>;
  const maybeBridge = windowWithBridge[params.bridgeName];
  if (!maybeBridge) {
    return;
  }
  const bridge: Bridge = maybeBridge;

  const existing = document.getElementById("web-seek-flow-recorder");
  if (existing) {
    existing.remove();
  }

  const state: {
    flow: BrowserFlow;
    activeMode: ActiveMode;
    keyboardEvents: Array<{
      key: string;
      code?: string;
      text?: string;
      modifiers: Array<"Alt" | "Control" | "Meta" | "Shift">;
      relativeTimeMs?: number;
    }>;
    keyboardStartedAt: number;
    pointerPoints: Array<{ x: number; y: number; relativeTimeMs: number }>;
    pointerStartedAt: number;
    pointerStartSelector?: string;
    panelView: PanelView;
    activeStepId?: string;
    lastScrollX: number;
    lastScrollY: number;
    scrollTimer?: number;
  } = {
    flow: params.flow,
    activeMode: undefined,
    keyboardEvents: [],
    keyboardStartedAt: 0,
    pointerPoints: [],
    pointerStartedAt: 0,
    panelView: "timeline",
    lastScrollX: window.scrollX,
    lastScrollY: window.scrollY,
  };

  const style = document.createElement("style");
  style.textContent = `
    #web-seek-flow-recorder {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      display: grid;
      grid-template-columns: 52px 340px;
      gap: 8px;
      color: #172033;
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: auto;
    }
    #web-seek-flow-recorder * { box-sizing: border-box; }
    #web-seek-flow-recorder .dock,
    #web-seek-flow-recorder .panel {
      border: 1px solid #b8c7d9;
      border-radius: 8px;
      background: #f9fbfd;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
    }
    #web-seek-flow-recorder .dock {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 6px;
    }
    #web-seek-flow-recorder button {
      min-height: 36px;
      border: 1px solid #aab8c7;
      border-radius: 6px;
      background: #ffffff;
      color: #172033;
      font: inherit;
      cursor: pointer;
    }
    #web-seek-flow-recorder button.active {
      border-color: #0f766e;
      background: #dff7f3;
    }
    #web-seek-flow-recorder button.primary {
      border-color: #0f766e;
      background: #0f766e;
      color: #ffffff;
      font-weight: 700;
    }
    #web-seek-flow-recorder .panel {
      max-height: min(640px, calc(100vh - 32px));
      overflow: hidden;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    #web-seek-flow-recorder header {
      padding: 10px 12px;
      border-bottom: 1px solid #d2dce8;
    }
    #web-seek-flow-recorder h2 {
      margin: 0;
      font-size: 14px;
    }
    #web-seek-flow-recorder .subtle {
      margin-top: 2px;
      color: #52657a;
      font-size: 12px;
    }
    #web-seek-flow-recorder .tabs {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
    }
    #web-seek-flow-recorder .tabs button {
      min-height: 30px;
      font-size: 12px;
    }
    #web-seek-flow-recorder .body {
      overflow: auto;
      padding: 10px 12px;
    }
    #web-seek-flow-recorder .step {
      width: 100%;
      text-align: left;
      padding: 8px;
      border: 1px solid #d2dce8;
      border-radius: 6px;
      background: #ffffff;
      margin-bottom: 6px;
    }
    #web-seek-flow-recorder .step.selected {
      border-color: #0f766e;
      background: #eefdfa;
    }
    #web-seek-flow-recorder .step strong {
      display: block;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
      color: #0f766e;
    }
    #web-seek-flow-recorder code {
      display: block;
      margin-top: 4px;
      color: #334155;
      overflow-wrap: anywhere;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #web-seek-flow-recorder .detail {
      display: grid;
      grid-template-columns: 94px 1fr;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid #e4ebf2;
    }
    #web-seek-flow-recorder .detail span:first-child {
      color: #52657a;
      font-weight: 700;
    }
    #web-seek-flow-recorder pre {
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: #334155;
    }
    #web-seek-flow-recorder footer {
      padding: 10px 12px;
      border-top: 1px solid #d2dce8;
    }
    #web-seek-flow-status {
      min-height: 20px;
      color: #334155;
      font-size: 12px;
    }
    .web-seek-flow-highlight {
      outline: 3px solid #0f766e !important;
      outline-offset: 2px !important;
    }
  `;
  document.documentElement.append(style);

  const root = document.createElement("div");
  root.id = "web-seek-flow-recorder";
  root.innerHTML = `
    <div class="dock" aria-label="Flow recorder tools">
      <button type="button" data-mode="record" title="Record click, fill, select, and scroll steps">Step</button>
      <button type="button" data-action="navigate" title="Add the current page as an explicit navigation step">Nav</button>
      <button type="button" data-mode="pointer-trace" title="Record pointer trace. Press Option+Shift+S to stop.">Trace</button>
      <button type="button" data-mode="keyboard" title="Record keyboard step. Press Option+Shift+S to stop.">Keys</button>
      <button type="button" data-action="wait" title="Add a wait step">Wait</button>
      <button type="button" data-action="checkpoint" title="Add manual checkpoint">Check</button>
      <button type="button" data-mode="capture" title="Capture content from the next selected element">Capture</button>
      <button type="button" data-mode="assert-text" title="Assert text from the next selected element">Assert</button>
      <button type="button" data-mode="capture-region" title="Capture a selected page region for replay review">Region</button>
      <button type="button" class="primary" data-action="save" title="Save browser flow">Save</button>
    </div>
    <section class="panel" aria-label="Flow recorder panel">
      <header>
        <h2>Authorized QA Workflow</h2>
        <div class="subtle">Flow steps timeline</div>
        <div class="tabs" aria-label="Flow recorder views">
          <button type="button" data-panel-view="timeline">Steps</button>
          <button type="button" data-panel-view="details">Details</button>
          <button type="button" data-panel-view="captures">Captures</button>
          <button type="button" data-panel-view="json">Flow JSON</button>
        </div>
      </header>
      <div class="body" data-steps></div>
      <footer>
        <div id="web-seek-flow-status">Select a tool to record a step.</div>
      </footer>
    </section>
  `;
  document.documentElement.append(root);

  const status = root.querySelector<HTMLElement>("#web-seek-flow-status");
  const stepsList = root.querySelector<HTMLElement>("[data-steps]");

  function setStatus(message: string): void {
    if (status) {
      status.textContent = message;
    }
  }

  function nowIso(): string {
    return new Date().toISOString();
  }

  function viewport(): { width: number; height: number } {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }

  function rectFor(element: Element | null): Rect | undefined {
    if (!element) {
      return undefined;
    }
    const rect = element.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function valueForAttribute(element: Element, attribute: string): string {
    if (attribute === "text") {
      return element.textContent?.trim() ?? "";
    }
    if (attribute === "html") {
      return element.innerHTML;
    }
    if (attribute === "value" && "value" in element) {
      return String(element.value ?? "");
    }
    return element.getAttribute(attribute) ?? "";
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

  function render(): void {
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === state.activeMode);
    }

    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-panel-view]")) {
      button.classList.toggle("active", button.dataset.panelView === state.panelView);
    }

    if (!stepsList) {
      return;
    }

    stepsList.innerHTML = "";
    if (state.panelView === "json") {
      const block = document.createElement("pre");
      block.textContent = JSON.stringify(state.flow, null, 2);
      stepsList.append(block);
      return;
    }

    const activeStep =
      state.flow.steps.find((step) => step.id === state.activeStepId) ?? state.flow.steps.at(-1);

    if (state.panelView === "details") {
      if (!activeStep) {
        const empty = document.createElement("div");
        empty.className = "subtle";
        empty.textContent = "No step selected yet.";
        stepsList.append(empty);
        return;
      }
      for (const detail of browserFlowStepDetails(activeStep)) {
        const row = document.createElement("div");
        row.className = "detail";
        const label = document.createElement("span");
        label.textContent = detail.label;
        const value = document.createElement("span");
        value.textContent = detail.value;
        row.append(label, value);
        stepsList.append(row);
      }
      return;
    }

    if (state.panelView === "captures") {
      const captureSteps = state.flow.steps.filter(isBrowserFlowCaptureOrAssertionStep);
      if (captureSteps.length === 0) {
        const empty = document.createElement("div");
        empty.className = "subtle";
        empty.textContent = "No captures or assertions recorded yet.";
        stepsList.append(empty);
        return;
      }
      for (const [index, step] of captureSteps.entries()) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "step";
        item.dataset.stepId = step.id;
        item.classList.toggle("selected", step.id === activeStep?.id);
        const title = document.createElement("strong");
        title.textContent = `${index + 1}. ${step.type}`;
        const code = document.createElement("code");
        code.textContent = browserFlowStepSummary(step);
        item.append(title, code);
        stepsList.append(item);
      }
      return;
    }

    if (state.flow.steps.length === 0) {
      const empty = document.createElement("div");
      empty.className = "subtle";
      empty.textContent = "No steps recorded yet.";
      stepsList.append(empty);
      return;
    }

    for (const [index, step] of state.flow.steps.entries()) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "step";
      item.dataset.stepId = step.id;
      item.classList.toggle("selected", step.id === activeStep?.id);
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${step.type}`;
      const code = document.createElement("code");
      code.textContent = browserFlowStepSummary(step);
      item.append(title, code);
      stepsList.append(item);
    }
  }

  async function appendStep(step: BrowserFlowStep): Promise<void> {
    if (state.flow.steps.length >= state.flow.limits.maxSteps) {
      setStatus(`Step limit reached (${state.flow.limits.maxSteps}). Save or start a new flow.`);
      return;
    }

    state.flow = {
      ...state.flow,
      updatedAt: nowIso(),
      steps: [...state.flow.steps, step],
    };
    state.activeStepId = step.id;
    render();
    await bridge({ type: "draft-change", step });
  }

  async function updateStep(step: BrowserFlowStep): Promise<void> {
    state.flow = {
      ...state.flow,
      updatedAt: nowIso(),
      steps: state.flow.steps.map((existing) => (existing.id === step.id ? step : existing)),
    };
    render();
    await bridge({ type: "step-update", step });
  }

  function stepId(type: string): string {
    return `step-${state.flow.steps.length + 1}-${type}-${Date.now()}`;
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

  function isStopShortcut(event: KeyboardEvent): boolean {
    return event.altKey && event.shiftKey && event.code === "KeyS";
  }

  async function stopKeyboard(): Promise<void> {
    if (state.keyboardEvents.length === 0) {
      setStatus("Keyboard step discarded because no keys were recorded.");
      state.activeMode = undefined;
      render();
      return;
    }
    const focused = document.activeElement;
    await appendStep({
      id: stepId("keyboard"),
      type: "keyboard",
      optional: false,
      timestamp: nowIso(),
      focusedSelector: selectorFor(focused),
      targetRect: rectFor(focused),
      keySequence: state.keyboardEvents,
    });
    state.keyboardEvents = [];
    state.activeMode = undefined;
    setStatus("Keyboard step recorded.");
    render();
  }

  async function stopPointerTrace(): Promise<void> {
    if (state.pointerPoints.length === 0) {
      setStatus("Pointer trace discarded because no points were recorded.");
      state.activeMode = undefined;
      render();
      return;
    }
    const lastPoint = state.pointerPoints.at(-1);
    const target = document.elementFromPoint(
      Math.round((lastPoint?.x ?? 0) * window.innerWidth),
      Math.round((lastPoint?.y ?? 0) * window.innerHeight),
    );
    await appendStep({
      id: stepId("pointer-trace"),
      type: "pointer-trace",
      optional: false,
      timestamp: nowIso(),
      startTargetSelector: state.pointerStartSelector,
      endTargetSelector: selectorFor(target),
      viewport: viewport(),
      points: state.pointerPoints,
      keyboardEvents: state.keyboardEvents,
      lastPointerLocation: lastPoint ? { x: lastPoint.x, y: lastPoint.y } : undefined,
    });
    state.pointerPoints = [];
    state.keyboardEvents = [];
    state.pointerStartSelector = undefined;
    state.activeMode = undefined;
    setStatus("Pointer trace recorded.");
    render();
  }

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const mode = target.dataset.mode as ActiveMode;
    const panelView = target.dataset.panelView as PanelView | undefined;
    const action = target.dataset.action;
    const stepTarget = target.closest<HTMLElement>("[data-step-id]");

    if (panelView) {
      state.panelView = panelView;
      render();
      return;
    }

    if (stepTarget?.dataset.stepId) {
      state.activeStepId = stepTarget.dataset.stepId;
      state.panelView = "details";
      render();
      return;
    }

    if (mode) {
      state.activeMode = state.activeMode === mode ? undefined : mode;
      if (state.activeMode === "keyboard") {
        state.keyboardEvents = [];
        state.keyboardStartedAt = performance.now();
        setStatus("Recording keyboard step. Press Option+Shift+S to stop.");
      } else if (state.activeMode === "pointer-trace") {
        state.pointerPoints = [];
        state.keyboardEvents = [];
        state.pointerStartedAt = performance.now();
        state.pointerStartSelector = undefined;
        setStatus("Recording pointer trace. Press Option+Shift+S to stop.");
      } else if (state.activeMode === "capture") {
        setStatus("Click page content to capture information.");
      } else if (state.activeMode === "assert-text") {
        setStatus("Click page content to add a capture assertion.");
      } else if (state.activeMode === "capture-region") {
        setStatus("Click page content to capture a replay review region.");
      } else if (state.activeMode === "record") {
        setStatus("Recording clicks, fills, selects, and scrolls.");
      } else {
        setStatus("Select a tool to record a step.");
      }
      render();
      return;
    }

    if (action === "navigate") {
      void appendStep({
        id: stepId("navigate"),
        type: "navigate",
        optional: false,
        timestamp: nowIso(),
        url: window.location.href,
        waitUntil: "domcontentloaded",
      }).then(() => setStatus("Navigate step added."));
      return;
    }

    if (action === "wait") {
      const durationText = window.prompt("Wait duration in milliseconds", "1000");
      if (!durationText) {
        return;
      }
      const durationMs = Math.max(0, Math.round(Number(durationText)));
      if (!Number.isFinite(durationMs)) {
        setStatus("Wait step discarded because the duration was invalid.");
        return;
      }
      void appendStep({
        id: stepId("wait"),
        type: "wait",
        optional: false,
        timestamp: nowIso(),
        durationMs,
        reason: "Replay timing",
      }).then(() => setStatus("Wait step added."));
      return;
    }

    if (action === "checkpoint") {
      const label = window.prompt("Checkpoint label", "Manual checkpoint");
      if (!label) {
        return;
      }
      const instruction =
        window.prompt("Instruction for the tester", "Confirm the page is ready.") ?? label;
      void appendStep({
        id: stepId("checkpoint"),
        type: "checkpoint",
        optional: false,
        timestamp: nowIso(),
        label,
        instruction,
      }).then(() => setStatus("Manual checkpoint added."));
      return;
    }

    if (action === "save") {
      setStatus("Saving flow...");
      void bridge({ type: "save-flow", flow: state.flow });
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element) || root.contains(target)) {
        return;
      }

      if (state.activeMode === "capture") {
        event.preventDefault();
        event.stopPropagation();
        const selector = selectorFor(target);
        const requestedAttribute = window.prompt("Capture attribute", "text") ?? "text";
        const attribute = ["text", "html", "value", "href", "src", "aria-label", "title"].includes(
          requestedAttribute,
        )
          ? (requestedAttribute as
              | "text"
              | "html"
              | "value"
              | "href"
              | "src"
              | "aria-label"
              | "title")
          : "text";
        const sampleValue = valueForAttribute(target, attribute).slice(0, 500);
        void appendStep({
          id: stepId("capture-text"),
          type: "capture-text",
          optional: false,
          timestamp: nowIso(),
          selector,
          attribute,
          sampleValue,
          assertionMode: "none",
        }).then(() => {
          state.activeMode = undefined;
          target.classList.remove("web-seek-flow-highlight");
          setStatus("Capture step recorded.");
          render();
        });
        return;
      }

      if (state.activeMode === "assert-text") {
        event.preventDefault();
        event.stopPropagation();
        const selector = selectorFor(target);
        const actual = valueForAttribute(target, "text").slice(0, 500);
        const expectedText = window.prompt("Expected text", actual);
        if (!expectedText) {
          setStatus("Text assertion discarded.");
          return;
        }
        void appendStep({
          id: stepId("assert-text"),
          type: "assert-text",
          optional: false,
          timestamp: nowIso(),
          selector,
          expectedText,
          mode: "contains",
        }).then(() => {
          state.activeMode = undefined;
          target.classList.remove("web-seek-flow-highlight");
          setStatus("Text assertion recorded.");
          render();
        });
        return;
      }

      if (state.activeMode === "capture-region") {
        event.preventDefault();
        event.stopPropagation();
        void appendStep({
          id: stepId("capture-region"),
          type: "capture-region",
          optional: false,
          timestamp: nowIso(),
          selector: selectorFor(target),
          targetRect: rectFor(target),
          assertionMode: "visual-review",
        }).then(() => {
          state.activeMode = undefined;
          target.classList.remove("web-seek-flow-highlight");
          setStatus("Capture region recorded.");
          render();
        });
        return;
      }

      if (state.activeMode !== "record") {
        return;
      }

      const step: BrowserFlowStep = {
        id: stepId("click"),
        type: "click",
        optional: false,
        timestamp: nowIso(),
        selector: selectorFor(target),
        targetRect: rectFor(target),
        viewport: viewport(),
        urlBefore: window.location.href,
      };
      void appendStep(step).then(() => {
        setStatus("Click step recorded.");
        window.setTimeout(() => {
          void updateStep({ ...step, urlAfter: window.location.href });
        }, 250);
      });
    },
    true,
  );

  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;
      if (
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        )
      ) {
        return;
      }
      if (root.contains(target) || state.activeMode !== "record") {
        return;
      }

      const selector = selectorFor(target);
      const targetRect = rectFor(target);
      const inputType =
        target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase();
      const value = target.value;
      const step: BrowserFlowStep =
        target instanceof HTMLSelectElement
          ? {
              id: stepId("select"),
              type: "select",
              optional: false,
              timestamp: nowIso(),
              selector,
              value,
              inputType,
              targetRect,
            }
          : {
              id: stepId("fill"),
              type: "fill",
              optional: false,
              timestamp: nowIso(),
              selector,
              value,
              inputType,
              targetRect,
            };
      void appendStep(step).then(() => setStatus(`${step.type} step recorded.`));
    },
    true,
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (root.contains(event.target instanceof Node ? event.target : null)) {
        return;
      }
      if (state.activeMode === "keyboard") {
        if (isStopShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          void stopKeyboard();
          return;
        }
        state.keyboardEvents.push({
          key: event.key,
          code: event.code,
          text: event.key.length === 1 ? event.key : undefined,
          modifiers: modifiersFor(event),
          relativeTimeMs: Math.round(performance.now() - state.keyboardStartedAt),
        });
      } else if (state.activeMode === "pointer-trace") {
        if (isStopShortcut(event)) {
          event.preventDefault();
          event.stopPropagation();
          void stopPointerTrace();
          return;
        }
        state.keyboardEvents.push({
          key: event.key,
          code: event.code,
          text: event.key.length === 1 ? event.key : undefined,
          modifiers: modifiersFor(event),
          relativeTimeMs: Math.round(performance.now() - state.pointerStartedAt),
        });
      }
    },
    true,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (state.activeMode !== "pointer-trace") {
        return;
      }
      if (!state.pointerStartSelector) {
        state.pointerStartSelector = selectorFor(
          event.target instanceof Element ? event.target : null,
        );
      }
      const x = Math.min(1, Math.max(0, event.clientX / Math.max(1, window.innerWidth)));
      const y = Math.min(1, Math.max(0, event.clientY / Math.max(1, window.innerHeight)));
      state.pointerPoints.push({
        x: Number(x.toFixed(5)),
        y: Number(y.toFixed(5)),
        relativeTimeMs: Math.round(performance.now() - state.pointerStartedAt),
      });
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
      target.classList.toggle(
        "web-seek-flow-highlight",
        state.activeMode === "capture" ||
          state.activeMode === "assert-text" ||
          state.activeMode === "capture-region",
      );
    },
    true,
  );

  document.addEventListener(
    "mouseout",
    (event) => {
      const target = event.target;
      if (target instanceof Element) {
        target.classList.remove("web-seek-flow-highlight");
      }
    },
    true,
  );

  window.addEventListener(
    "scroll",
    () => {
      if (state.activeMode !== "record") {
        return;
      }
      if (state.scrollTimer) {
        window.clearTimeout(state.scrollTimer);
      }
      state.scrollTimer = window.setTimeout(() => {
        const x = Math.round(window.scrollX - state.lastScrollX);
        const y = Math.round(window.scrollY - state.lastScrollY);
        state.lastScrollX = window.scrollX;
        state.lastScrollY = window.scrollY;
        if (x === 0 && y === 0) {
          return;
        }
        void appendStep({
          id: stepId("scroll"),
          type: "scroll",
          optional: false,
          timestamp: nowIso(),
          x,
          y,
          viewport: viewport(),
          waitAfterMs: 250,
        }).then(() => setStatus("Scroll step recorded."));
      }, 250);
    },
    true,
  );

  render();
  void bridge({ type: "ready" });
}
