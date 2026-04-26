import type { BrowserFlow, BrowserFlowCaptureResult, BrowserFlowStep } from "@web-seek/data-engine";

export type ReplayCommand =
  | "run-all"
  | "step-next"
  | "pause"
  | "resume"
  | "restart"
  | "skip-step"
  | "stop"
  | "toggle-keep-open";

export interface ReplayBridgeMessage {
  type: "command";
  command: ReplayCommand;
}

export interface ReplayLogEntry {
  stepId?: string;
  stepType?: string;
  status: "pass" | "fail" | "warn" | "info";
  message: string;
  timestamp?: string;
}

export interface ReplayState {
  index: number;
  running: boolean;
  paused: boolean;
  stopped: boolean;
  keepOpen: boolean;
  currentStep?: BrowserFlowStep;
  nextStep?: BrowserFlowStep;
  logs: ReplayLogEntry[];
  countdown?: number;
}

export interface ReplayRunGuard {
  startedAt: number;
  captures: BrowserFlowCaptureResult[];
  lastPointerLocation?: { x: number; y: number };
}

export function replayLog(
  status: ReplayLogEntry["status"],
  message: string,
  step?: BrowserFlowStep,
): ReplayLogEntry {
  return {
    stepId: step?.id,
    stepType: step?.type,
    status,
    message,
    timestamp: new Date().toISOString(),
  };
}

export function executableStepsForFlow(flow: BrowserFlow): BrowserFlowStep[] {
  return flow.steps.slice(0, flow.limits.maxSteps);
}

export function createReplayState(
  flow: BrowserFlow,
  steps = executableStepsForFlow(flow),
): ReplayState {
  return {
    index: 0,
    running: false,
    paused: true,
    stopped: false,
    keepOpen: true,
    currentStep: steps[0],
    nextStep: steps[1],
    logs: [
      replayLog("info", "Replay ready. Browser will stay open by default."),
      ...(flow.steps.length > steps.length
        ? [replayLog("warn", `Replay limited to ${flow.limits.maxSteps} steps by flow policy.`)]
        : []),
    ],
  };
}

export function syncReplayStatePointers(state: ReplayState, steps: BrowserFlowStep[]): void {
  state.currentStep = steps[state.index];
  state.nextStep = steps[state.index + 1];
}
