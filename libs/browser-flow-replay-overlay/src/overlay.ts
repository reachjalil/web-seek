import type {
  ReplayBridgeMessage,
  ReplayCommand,
  ReplayState,
} from "@web-seek/browser-flow-replay-state";
import { browserFlowStepSummary, selectorForBrowserFlowStep } from "@web-seek/browser-flow-steps";

export function installReplayControllerOverlay(params: {
  flowName: string;
  bridgeName: string;
  state: ReplayState;
}): void {
  type Bridge = (message: ReplayBridgeMessage) => Promise<void>;

  const windowWithBridge = window as unknown as Window & Record<string, Bridge | undefined>;
  const maybeBridge = windowWithBridge[params.bridgeName];
  if (!maybeBridge) {
    return;
  }
  const bridge: Bridge = maybeBridge;

  document.getElementById("web-seek-replay-controller")?.remove();
  document.getElementById("web-seek-replay-highlight")?.remove();
  document.getElementById("web-seek-pointer-marker")?.remove();

  const style = document.createElement("style");
  style.textContent = `
    #web-seek-replay-controller {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647;
      width: 380px;
      max-height: min(680px, calc(100vh - 32px));
      display: grid;
      grid-template-rows: auto auto 1fr;
      border: 1px solid #b8c7d9;
      border-radius: 8px;
      background: #f9fbfd;
      box-shadow: 0 18px 50px rgba(15, 23, 42, 0.18);
      color: #172033;
      font: 13px/1.4 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #web-seek-replay-controller * { box-sizing: border-box; }
    #web-seek-replay-controller header {
      padding: 10px 12px;
      border-bottom: 1px solid #d2dce8;
    }
    #web-seek-replay-controller h2 {
      margin: 0;
      font-size: 14px;
    }
    #web-seek-replay-controller .subtle {
      color: #52657a;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    #web-seek-replay-controller .controls {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid #d2dce8;
    }
    #web-seek-replay-controller button {
      min-height: 32px;
      border: 1px solid #aab8c7;
      border-radius: 6px;
      background: #ffffff;
      color: #172033;
      font: inherit;
      cursor: pointer;
    }
    #web-seek-replay-controller button.active {
      border-color: #0f766e;
      background: #dff7f3;
    }
    #web-seek-replay-controller .body {
      overflow: auto;
      padding: 10px 12px;
    }
    #web-seek-replay-controller .block {
      border: 1px solid #d2dce8;
      border-radius: 6px;
      background: #ffffff;
      padding: 8px;
      margin-bottom: 8px;
    }
    #web-seek-replay-controller strong {
      display: block;
      color: #0f766e;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }
    #web-seek-replay-controller code {
      display: block;
      margin-top: 4px;
      overflow-wrap: anywhere;
      color: #334155;
      font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    #web-seek-replay-controller .log-pass { color: #166534; }
    #web-seek-replay-controller .log-fail { color: #b91c1c; }
    #web-seek-replay-controller .log-warn { color: #92400e; }
    #web-seek-replay-highlight {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      border: 3px solid #0f766e;
      border-radius: 4px;
      box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.08);
      display: none;
    }
    #web-seek-pointer-marker {
      position: fixed;
      z-index: 2147483646;
      width: 14px;
      height: 14px;
      margin: -7px 0 0 -7px;
      border: 2px solid #ffffff;
      border-radius: 50%;
      background: #0f766e;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.32);
      pointer-events: none;
      display: none;
    }
  `;
  document.documentElement.append(style);

  const root = document.createElement("section");
  root.id = "web-seek-replay-controller";
  root.innerHTML = `
    <header>
      <h2>Debug Replay</h2>
      <div class="subtle"></div>
    </header>
    <div class="controls">
      <button type="button" data-command="run-all">Run all</button>
      <button type="button" data-command="step-next">Step next</button>
      <button type="button" data-command="pause">Pause</button>
      <button type="button" data-command="resume">Resume</button>
      <button type="button" data-command="restart">Restart</button>
      <button type="button" data-command="skip-step">Skip</button>
      <button type="button" data-command="toggle-keep-open">Keep open</button>
      <button type="button" data-command="stop">Stop</button>
    </div>
    <div class="body"></div>
  `;
  document.documentElement.append(root);

  const highlight = document.createElement("div");
  highlight.id = "web-seek-replay-highlight";
  document.documentElement.append(highlight);

  const marker = document.createElement("div");
  marker.id = "web-seek-pointer-marker";
  document.documentElement.append(marker);

  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const command = target.dataset.command as ReplayCommand | undefined;
    if (command) {
      void bridge({ type: "command", command });
    }
  });

  function render(state: ReplayState): void {
    const subtitle = root.querySelector<HTMLElement>(".subtle");
    if (subtitle) {
      const stateLabel = state.stopped
        ? "Stopped"
        : state.paused
          ? "Paused"
          : state.running
            ? "Running"
            : "Ready";
      subtitle.textContent = `${params.flowName} · ${stateLabel} · Step ${state.index + 1}`;
    }

    root
      .querySelector<HTMLButtonElement>('[data-command="toggle-keep-open"]')
      ?.classList.toggle("active", state.keepOpen);

    const body = root.querySelector<HTMLElement>(".body");
    if (!body) {
      return;
    }
    body.innerHTML = "";

    const blocks = [
      [
        "Current step",
        state.currentStep
          ? `${state.currentStep.type}\n${browserFlowStepSummary(state.currentStep)}`
          : "None",
      ],
      [
        "Next step",
        state.nextStep
          ? `${state.nextStep.type}\n${browserFlowStepSummary(state.nextStep)}`
          : "None",
      ],
      ["Selector", selectorForBrowserFlowStep(state.currentStep) ?? "None"],
    ];

    if (state.countdown !== undefined) {
      blocks.push(["Pointer trace countdown", `${state.countdown}`]);
    }

    for (const [title, value] of blocks) {
      const block = document.createElement("div");
      block.className = "block";
      const strong = document.createElement("strong");
      strong.textContent = title;
      const code = document.createElement("code");
      code.textContent = value;
      block.append(strong, code);
      body.append(block);
    }

    const logBlock = document.createElement("div");
    logBlock.className = "block";
    const logTitle = document.createElement("strong");
    logTitle.textContent = "Replay log";
    logBlock.append(logTitle);
    for (const entry of state.logs.slice(-12)) {
      const line = document.createElement("div");
      line.className = `log-${entry.status}`;
      line.textContent = `${entry.status.toUpperCase()} ${entry.message}`;
      logBlock.append(line);
    }
    body.append(logBlock);

    const selector = selectorForBrowserFlowStep(state.currentStep);
    const target = selector ? document.querySelector(selector) : null;
    if (target) {
      const rect = target.getBoundingClientRect();
      highlight.style.display = "block";
      highlight.style.left = `${Math.max(0, rect.left)}px`;
      highlight.style.top = `${Math.max(0, rect.top)}px`;
      highlight.style.width = `${Math.max(0, rect.width)}px`;
      highlight.style.height = `${Math.max(0, rect.height)}px`;
    } else {
      highlight.style.display = "none";
    }

    const pointer =
      state.currentStep?.type === "pointer-trace"
        ? state.currentStep.lastPointerLocation
        : undefined;
    if (pointer) {
      marker.style.display = "block";
      marker.style.left = `${Math.round(pointer.x * window.innerWidth)}px`;
      marker.style.top = `${Math.round(pointer.y * window.innerHeight)}px`;
    } else {
      marker.style.display = "none";
    }
  }

  (window as Window & { webSeekReplayRender?: (state: ReplayState) => void }).webSeekReplayRender =
    render;
  render(params.state);
}
