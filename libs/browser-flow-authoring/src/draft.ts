import {
  type BrowserFlow,
  type BrowserFlowStep,
  browserFlowSchema,
  createBrowserFlowId,
} from "@web-seek/data-engine";

export function validateBrowserFlowStartUrl(value: string | undefined): string | undefined {
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

export function allowedOriginForUrl(url: string): string {
  return new URL(url).origin;
}

export function createBrowserFlowDraft({
  name,
  startUrl,
  date = new Date(),
}: {
  name: string;
  startUrl: string;
  date?: Date;
}): BrowserFlow {
  const now = date.toISOString();
  return browserFlowSchema.parse({
    schema: "web-seek.browser-flow.v1",
    id: createBrowserFlowId(name, date),
    name,
    startUrl,
    allowedOrigins: [allowedOriginForUrl(startUrl)],
    createdAt: now,
    updatedAt: now,
    browser: {
      headless: false,
      viewport: { width: 1440, height: 1000 },
      slowMoMs: 0,
    },
    policy: {
      requiresAuthorization: true,
      noBypass: true,
      allowHeadlessReplay: false,
      allowCredentialCapture: false,
      allowNetworkPayloadCapture: false,
    },
    limits: {
      maxSteps: 200,
      maxDurationMs: 30 * 60 * 1000,
      maxReplaySpeed: 1,
      stepTimeoutMs: 15_000,
    },
    steps: [],
    artifacts: {
      screenshots: [],
      captures: [],
      replayLogs: [],
    },
    audit: {
      createdWith: "web-seek-cli",
      authorizationNote: "Authorized QA workflow",
      lastSavedAt: now,
    },
  });
}

export function appendBrowserFlowStep(flow: BrowserFlow, step: BrowserFlowStep): BrowserFlow {
  return browserFlowSchema.parse({
    ...flow,
    updatedAt: new Date().toISOString(),
    steps: [...flow.steps, step],
  });
}

export function mergeStepUpdates(
  overlaySteps: BrowserFlowStep[],
  currentSteps: BrowserFlowStep[],
): BrowserFlowStep[] {
  const currentById = new Map(currentSteps.map((step) => [step.id, step]));
  return overlaySteps.map((step) => currentById.get(step.id) ?? step);
}

export function updateStepById(
  flow: BrowserFlow,
  stepId: string,
  updater: (step: BrowserFlowStep) => BrowserFlowStep,
): BrowserFlow {
  return browserFlowSchema.parse({
    ...flow,
    updatedAt: new Date().toISOString(),
    steps: flow.steps.map((step) => (step.id === stepId ? updater(step) : step)),
  });
}

export function prepareFlowForSave({
  overlayFlow,
  currentFlow,
}: {
  overlayFlow: BrowserFlow;
  currentFlow: BrowserFlow;
}): BrowserFlow {
  const now = new Date().toISOString();
  return browserFlowSchema.parse({
    ...overlayFlow,
    id: currentFlow.id,
    name: currentFlow.name,
    startUrl: currentFlow.startUrl,
    allowedOrigins: currentFlow.allowedOrigins,
    createdAt: currentFlow.createdAt,
    updatedAt: now,
    steps: mergeStepUpdates(overlayFlow.steps, currentFlow.steps),
    audit: {
      ...overlayFlow.audit,
      createdWith: "web-seek-cli",
      authorizationNote: "Authorized QA workflow",
      lastSavedAt: now,
    },
  });
}
