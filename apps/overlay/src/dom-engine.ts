import type {
  DraftField,
  OverlayDraft,
  PaginationDraft,
  RectSnapshot,
  SelectorMeta,
  SelectorStrategy,
} from "./types";

interface SelectorCandidate {
  selector: string;
  strategy: SelectorStrategy;
  confidence: number;
  sample?: string;
}

export interface RepeatedItemResult {
  extractionKind: "list" | "table";
  itemElement: Element;
  itemSelector: string;
  itemSelectorMeta: SelectorMeta;
  tableSelector?: string;
  rowSelector?: string;
  rects: RectSnapshot[];
}

interface RepeatedSelectorCandidate extends SelectorCandidate {
  matchCount: number;
}

const STABLE_ATTRIBUTES = ["data-testid", "data-test", "data-cy", "name", "aria-label"];
const GENERATED_VALUE_PATTERN =
  /(^[a-f0-9]{12,}$)|([a-f0-9]{8}-[a-f0-9-]{13,})|(\bcss-[a-z0-9]+\b)|(__[a-z0-9]+$)|(\d{5,})/i;

export function textSample(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function isDataShapeCandidateTarget(element: Element): boolean {
  if (
    element.closest(
      [
        "input",
        "textarea",
        "select",
        "option",
        "button",
        "[contenteditable='true']",
        "[role='search']",
        "form",
      ].join(","),
    )
  ) {
    return Boolean(element.closest("table tr, article, li, [role='row'], [role='listitem']"));
  }

  return true;
}

function cssEscape(value: string): string {
  return globalThis.CSS?.escape
    ? globalThis.CSS.escape(value)
    : value.replace(/["\\#.:,[\]>+~*()\s]/g, "\\$&");
}

function quoteAttribute(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isStableValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length < 80 && !GENERATED_VALUE_PATTERN.test(trimmed);
}

function stableClassTokens(element: Element): string[] {
  return Array.from(element.classList)
    .filter(isStableValue)
    .filter((token) => !/^(active|selected|open|disabled|hover|focus|ng-|js-)/i.test(token))
    .slice(0, 2);
}

function elementSignature(element: Element): string {
  const childTags = Array.from(element.children)
    .slice(0, 8)
    .map((child) => child.tagName.toLowerCase())
    .join(",");
  const classes = stableClassTokens(element).join(".");
  const role = element.getAttribute("role") ?? "";
  return `${element.tagName.toLowerCase()}|${classes}|${role}|${childTags}`;
}

function queryAll(scope: ParentNode, selector: string): Element[] {
  try {
    return Array.from(scope.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function scopeContains(scope: ParentNode, element: Element): boolean {
  return scope instanceof Document || scope instanceof DocumentFragment
    ? true
    : scope instanceof Element && scope.contains(element);
}

function selectorMatchesElement(scope: ParentNode, selector: string, element: Element): boolean {
  if (selector === ":scope") {
    return scope === element;
  }
  return queryAll(scope, selector).includes(element);
}

function candidateWithScopeScore(
  scope: ParentNode,
  element: Element,
  candidate: Omit<SelectorCandidate, "sample">,
): SelectorCandidate | undefined {
  if (!scopeContains(scope, element)) {
    return undefined;
  }

  if (candidate.selector === ":scope") {
    return {
      ...candidate,
      confidence: scope === element ? candidate.confidence : 0,
      sample: textSample(element),
    };
  }

  const matches = queryAll(scope, candidate.selector);
  if (!matches.includes(element)) {
    return undefined;
  }

  const uniquenessBonus = matches.length === 1 ? 0.1 : matches.length <= 3 ? 0.03 : -0.12;
  const sampleBonus = textSample(element).length > 0 ? 0.02 : -0.04;
  return {
    ...candidate,
    confidence: Math.max(
      0.05,
      Math.min(0.99, candidate.confidence + uniquenessBonus + sampleBonus),
    ),
    sample: textSample(element),
  };
}

function nthOfTypeSelector(element: Element): string {
  const parent = element.parentElement;
  const tag = element.tagName.toLowerCase();
  if (!parent) {
    return tag;
  }

  const siblings = Array.from(parent.children).filter(
    (sibling) => sibling.tagName === element.tagName,
  );
  const index = siblings.indexOf(element) + 1;
  return siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag;
}

function structuralPath(element: Element, scope?: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement && current !== scope && parts.length < 7) {
    const tag = current.tagName.toLowerCase();
    const classes = stableClassTokens(current);
    const classSelector = classes.length > 0 ? `.${classes.map(cssEscape).join(".")}` : "";
    parts.unshift(classSelector ? `${tag}${classSelector}` : nthOfTypeSelector(current));
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function bestSelectorCandidate(element: Element, scope: ParentNode = document): SelectorCandidate {
  return (
    generateSelectorCandidates(element, scope)[0] ?? {
      selector: structuralPath(element),
      strategy: "structural",
      confidence: 0.35,
      sample: textSample(element),
    }
  );
}

function fieldTableCandidate(element: Element, scope: ParentNode): SelectorCandidate | undefined {
  const cell = element.closest("td, th");
  const scopeElement = scope instanceof Element ? scope : undefined;
  if (!cell || (scopeElement && !scopeElement.contains(cell))) {
    return undefined;
  }

  const selector = nthOfTypeSelector(cell);
  return candidateWithScopeScore(scope, cell, {
    selector,
    strategy: "table-position",
    confidence: 0.84,
  });
}

export function generateSelectorCandidates(
  element: Element,
  scope: ParentNode = document,
): SelectorCandidate[] {
  const candidates: SelectorCandidate[] = [];
  const addCandidate = (candidate: Omit<SelectorCandidate, "sample">): void => {
    const scored = candidateWithScopeScore(scope, element, candidate);
    if (scored && !candidates.some((item) => item.selector === scored.selector)) {
      candidates.push(scored);
    }
  };

  if (scope === element) {
    addCandidate({ selector: ":scope", strategy: "structural", confidence: 0.94 });
  }

  if (element.id && isStableValue(element.id)) {
    addCandidate({ selector: `#${cssEscape(element.id)}`, strategy: "id", confidence: 0.88 });
  }

  for (const attribute of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value || !isStableValue(value)) {
      continue;
    }
    addCandidate({
      selector: `${element.tagName.toLowerCase()}[${attribute}="${quoteAttribute(value)}"]`,
      strategy: "attribute",
      confidence: attribute.startsWith("data-") ? 0.84 : 0.78,
    });
  }

  const role = element.getAttribute("role");
  if (role && isStableValue(role)) {
    addCandidate({
      selector: `${element.tagName.toLowerCase()}[role="${quoteAttribute(role)}"]`,
      strategy: "attribute",
      confidence: 0.58,
    });
  }

  const tableCandidate = fieldTableCandidate(element, scope);
  if (tableCandidate && !candidates.some((item) => item.selector === tableCandidate.selector)) {
    candidates.push(tableCandidate);
  }

  const structural = structuralPath(element, scope instanceof Element ? scope : undefined);
  if (structural) {
    addCandidate({ selector: structural, strategy: "structural", confidence: 0.5 });
  }

  addCandidate({ selector: nthOfTypeSelector(element), strategy: "nth-of-type", confidence: 0.34 });

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

function selectorMetaFromCandidates(candidates: SelectorCandidate[]): SelectorMeta {
  const best = candidates[0] ?? {
    selector: "*",
    strategy: "structural" as const,
    confidence: 0.1,
    sample: "",
  };
  return {
    strategy: best.strategy,
    confidence: Number(best.confidence.toFixed(2)),
    alternates: candidates.slice(1, 6).map((candidate) => candidate.selector),
    sample: best.sample,
  };
}

export function selectorMetaForElement(
  element: Element,
  scope: ParentNode = document,
): { selector: string; selectorMeta: SelectorMeta } {
  const candidates = generateSelectorCandidates(element, scope);
  const best = candidates[0] ?? {
    selector: structuralPath(element, scope instanceof Element ? scope : undefined),
    strategy: "structural" as const,
    confidence: 0.32,
    sample: textSample(element),
  };

  return {
    selector: best.selector,
    selectorMeta: selectorMetaFromCandidates(candidates.length > 0 ? candidates : [best]),
  };
}

export function isPaginationLikeElement(element: Element): boolean {
  const label = textSample(element).toLowerCase();
  const aria = (element.getAttribute("aria-label") ?? "").toLowerCase();
  const title = (element.getAttribute("title") ?? "").toLowerCase();
  const href = (element.getAttribute("href") ?? "").toLowerCase();
  return /\b(next|more|load more|show more|older|›|»|>)\b/i.test(
    `${label} ${aria} ${title} ${href}`,
  );
}

function parentGroupSelector(item: Element): string {
  const tag = item.tagName.toLowerCase();
  const classes = stableClassTokens(item);
  if (classes.length > 0) {
    return `${tag}.${classes.map(cssEscape).join(".")}`;
  }

  const role = item.getAttribute("role");
  if (role && isStableValue(role)) {
    return `${tag}[role="${quoteAttribute(role)}"]`;
  }

  return tag;
}

function selectorForStableAttribute(element: Element): string | undefined {
  for (const attribute of STABLE_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value && isStableValue(value)) {
      return `${element.tagName.toLowerCase()}[${attribute}="${quoteAttribute(value)}"]`;
    }
  }
  return undefined;
}

function directParentSelector(parentSelector: string, childSelector: string): string {
  return parentSelector ? `${parentSelector} > ${childSelector}` : childSelector;
}

function evaluateRepeatedSelector(
  selector: string,
  itemElement: Element,
  strategy: SelectorStrategy,
  baseConfidence: number,
): RepeatedSelectorCandidate | undefined {
  const matches = queryAll(document, selector);
  if (!matches.includes(itemElement)) {
    return undefined;
  }

  const signature = elementSignature(itemElement);
  const sameSignatureCount = matches.filter(
    (match) => elementSignature(match) === signature,
  ).length;
  const signatureCoverage = matches.length > 0 ? sameSignatureCount / matches.length : 0;
  const countScore = matches.length >= 2 ? Math.min(0.14, matches.length * 0.015) : -0.18;
  const broadPenalty = matches.length > 80 ? -0.18 : matches.length > 30 ? -0.08 : 0;
  const confidence = Math.max(
    0.05,
    Math.min(0.96, baseConfidence + countScore + signatureCoverage * 0.12 + broadPenalty),
  );

  return {
    selector,
    strategy,
    confidence,
    sample: textSample(itemElement),
    matchCount: matches.length,
  };
}

function optimizedRepeatedItemCandidates(itemElement: Element): RepeatedSelectorCandidate[] {
  const candidates: RepeatedSelectorCandidate[] = [];
  const add = (
    selector: string | undefined,
    strategy: SelectorStrategy,
    confidence: number,
  ): void => {
    if (!selector || candidates.some((candidate) => candidate.selector === selector)) {
      return;
    }
    const evaluated = evaluateRepeatedSelector(selector, itemElement, strategy, confidence);
    if (evaluated) {
      candidates.push(evaluated);
    }
  };

  const parent = itemElement.parentElement;
  const groupSelector = parentGroupSelector(itemElement);
  const stableAttributeSelector = selectorForStableAttribute(itemElement);
  if (parent) {
    const parentCandidates = generateSelectorCandidates(parent, document).slice(0, 4);
    for (const parentCandidate of parentCandidates) {
      add(
        directParentSelector(parentCandidate.selector, groupSelector),
        groupSelector.includes("[") || groupSelector.includes(".") ? "attribute" : "structural",
        parentCandidate.confidence * 0.72,
      );
      if (stableAttributeSelector) {
        add(
          directParentSelector(parentCandidate.selector, stableAttributeSelector),
          "attribute",
          parentCandidate.confidence * 0.76,
        );
      }
      add(
        directParentSelector(parentCandidate.selector, itemElement.tagName.toLowerCase()),
        "structural",
        parentCandidate.confidence * 0.56,
      );
    }
  }

  add(
    groupSelector,
    groupSelector.includes("[") || groupSelector.includes(".") ? "attribute" : "structural",
    0.48,
  );
  add(stableAttributeSelector, "attribute", 0.66);
  add(structuralPath(itemElement), "structural", 0.34);

  return candidates.sort((a, b) => {
    const confidenceDelta = b.confidence - a.confidence;
    return Math.abs(confidenceDelta) > 0.02 ? confidenceDelta : b.matchCount - a.matchCount;
  });
}

function findRepeatedAncestor(target: Element): Element {
  const tableRow = target.closest("tr");
  if (tableRow?.closest("table")) {
    return tableRow;
  }

  let current: Element | null = target;
  let best: { element: Element; count: number; textLength: number } | undefined;
  let depth = 0;

  while (current && current !== document.body && depth < 8) {
    const parent: Element | null = current.parentElement;
    if (!parent) {
      break;
    }

    const signature = elementSignature(current);
    const siblings = Array.from(parent.children).filter(
      (sibling) => elementSignature(sibling) === signature && textSample(sibling).length > 8,
    );
    const textLength = textSample(current).length;

    if (
      siblings.length >= 2 &&
      (!best || siblings.length * textLength > best.count * best.textLength)
    ) {
      best = { element: current, count: siblings.length, textLength };
    }

    current = parent;
    depth += 1;
  }

  return best?.element ?? target;
}

function tableRepeatedItem(itemElement: Element): RepeatedItemResult | undefined {
  const row = itemElement.closest("tr");
  const table = row?.closest("table");
  if (!row || !table) {
    return undefined;
  }

  const tableCandidates = generateSelectorCandidates(table, document);
  const tableSelector = tableCandidates[0]?.selector ?? "table";
  const rowSelector = row.parentElement?.tagName.toLowerCase() === "tbody" ? "tbody tr" : "tr";
  const itemSelector = `${tableSelector} ${rowSelector}`;
  const itemCandidates: SelectorCandidate[] = [
    {
      selector: itemSelector,
      strategy: "table-position",
      confidence: 0.86,
      sample: textSample(row),
    },
    ...tableCandidates.map((candidate) => ({
      ...candidate,
      selector: `${candidate.selector} ${rowSelector}`,
      strategy: "table-position" as const,
      confidence: Math.min(0.92, candidate.confidence),
    })),
  ];

  return {
    extractionKind: "table",
    itemElement: row,
    itemSelector,
    itemSelectorMeta: selectorMetaFromCandidates(itemCandidates),
    tableSelector,
    rowSelector,
    rects: rectsForSelector(itemSelector),
  };
}

export function detectRepeatedItem(target: Element): RepeatedItemResult {
  const itemElement = findRepeatedAncestor(target);
  const tableResult = tableRepeatedItem(itemElement);
  if (tableResult) {
    return tableResult;
  }

  const candidates = optimizedRepeatedItemCandidates(itemElement);
  const best = candidates[0] ?? bestSelectorCandidate(itemElement, document);

  return {
    extractionKind: "list",
    itemElement,
    itemSelector: best.selector,
    itemSelectorMeta: selectorMetaFromCandidates(candidates.length > 0 ? candidates : [best]),
    rects: rectsForSelector(best.selector),
  };
}

function containingItem(target: Element, itemSelector: string): Element | undefined {
  return queryAll(document, itemSelector).find((item) => item === target || item.contains(target));
}

function fieldNameFromSample(sample: string, fallback: string): string {
  const normalized = sample
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return normalized || fallback;
}

function refineFieldConfidence(
  candidates: SelectorCandidate[],
  itemSelector: string,
  attribute: string,
): SelectorCandidate[] {
  const items = queryAll(document, itemSelector).slice(0, 12);
  if (items.length < 2) {
    return candidates;
  }

  return candidates
    .map((candidate) => {
      const hitCount = items.filter((item) =>
        readValue(item, candidate.selector, attribute),
      ).length;
      const coverage = hitCount / items.length;
      return {
        ...candidate,
        confidence: Math.max(0.05, Math.min(0.99, candidate.confidence + coverage * 0.1)),
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}

export function buildFieldFromElement(
  target: Element,
  draft: OverlayDraft,
): DraftField | undefined {
  if (!draft.itemSelector) {
    return undefined;
  }

  const item = containingItem(target, draft.itemSelector);
  if (!item) {
    return undefined;
  }

  const attribute = "text";
  const candidates = refineFieldConfidence(
    generateSelectorCandidates(target, item),
    draft.itemSelector,
    attribute,
  );
  const best = candidates[0];
  if (!best) {
    return undefined;
  }

  const sample = readValue(item, best.selector, attribute);
  const fieldNumber = draft.fields.length + 1;
  return {
    id: `field-${Date.now()}-${fieldNumber}`,
    name: fieldNameFromSample(sample || textSample(target), `field_${fieldNumber}`),
    selector: best.selector,
    attribute,
    required: false,
    transform: "trim",
    selectorMeta: selectorMetaFromCandidates(candidates),
  };
}

export function buildPaginationFromElement(target: Element): PaginationDraft {
  const candidates = generateSelectorCandidates(target, document);
  const best = candidates[0] ?? {
    selector: structuralPath(target),
    strategy: "structural" as const,
    confidence: 0.4,
    sample: textSample(target),
  };

  return {
    nextSelector: best.selector,
    maxPages: 25,
    waitAfterMs: 750,
    stopWhenSelectorDisabled: true,
    selectorMeta: selectorMetaFromCandidates(candidates),
  };
}

function uniqueFieldName(baseName: string, fields: DraftField[]): string {
  if (!fields.some((field) => field.name === baseName)) {
    return baseName;
  }

  let index = 2;
  while (fields.some((field) => field.name === `${baseName}_${index}`)) {
    index += 1;
  }
  return `${baseName}_${index}`;
}

function buildSuggestedTableFields(result: RepeatedItemResult): DraftField[] {
  const cells = Array.from(result.itemElement.querySelectorAll("td, th")).slice(0, 12);
  if (cells.length === 0) {
    return [];
  }

  const table = result.itemElement.closest("table");
  const headers = table ? Array.from(table.querySelectorAll("thead th, tr:first-child th")) : [];
  return cells.map((cell, index) => {
    const selector = nthOfTypeSelector(cell);
    const headerText = headers[index] ? textSample(headers[index]) : "";
    const sample = textSample(cell);
    return {
      id: `field-${Date.now()}-${index + 1}`,
      name: fieldNameFromSample(headerText || sample, `column_${index + 1}`),
      selector,
      attribute: "text",
      required: false,
      transform: "trim",
      selectorMeta: {
        strategy: "table-position",
        confidence: 0.86,
        alternates: [],
        sample,
      },
    };
  });
}

function suggestedFieldElements(itemElement: Element): Element[] {
  const candidates = Array.from(
    itemElement.querySelectorAll(
      [
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "a[href]",
        "time",
        "[aria-label]",
        "[title]",
        "img[src]",
        "p",
        "dt",
        "dd",
        "span",
      ].join(","),
    ),
  );

  const seen = new Set<Element>();
  return candidates
    .filter((element) => {
      if (seen.has(element)) {
        return false;
      }
      seen.add(element);
      const sample = textSample(element);
      const hasAttributeValue =
        element.hasAttribute("src") ||
        element.hasAttribute("href") ||
        element.hasAttribute("aria-label");
      return sample.length > 0 || hasAttributeValue;
    })
    .filter((element) => {
      const rect = rectForElement(element);
      return Boolean(rect);
    })
    .slice(0, 10);
}

function buildSuggestedListFields(result: RepeatedItemResult): DraftField[] {
  const fields: DraftField[] = [];
  const addField = (element: Element, attribute: string, fallback: string): void => {
    const candidates = generateSelectorCandidates(element, result.itemElement);
    const best = candidates[0];
    if (
      !best ||
      fields.some((field) => field.selector === best.selector && field.attribute === attribute)
    ) {
      return;
    }

    const sample = readValue(result.itemElement, best.selector, attribute);
    const name = uniqueFieldName(
      fieldNameFromSample(sample || textSample(element), fallback),
      fields,
    );
    fields.push({
      id: `field-${Date.now()}-${fields.length + 1}`,
      name,
      selector: best.selector,
      attribute,
      required: false,
      transform: attribute === "text" ? "trim" : undefined,
      selectorMeta: selectorMetaFromCandidates(candidates),
    });
  };

  for (const element of suggestedFieldElements(result.itemElement)) {
    if (fields.length >= 8) {
      break;
    }

    if (element instanceof HTMLImageElement && element.getAttribute("src")) {
      addField(element, "src", "image");
      continue;
    }

    addField(element, "text", fields.length === 0 ? "title" : `field_${fields.length + 1}`);

    if (element instanceof HTMLAnchorElement && element.getAttribute("href") && fields.length < 8) {
      addField(element, "href", "link");
    }
  }

  if (fields.length === 0) {
    fields.push({
      id: `field-${Date.now()}-1`,
      name: "text",
      selector: ":scope",
      attribute: "text",
      required: false,
      transform: "trim",
      selectorMeta: {
        strategy: "structural",
        confidence: 0.72,
        alternates: [],
        sample: textSample(result.itemElement),
      },
    });
  }

  return fields;
}

export function buildSuggestedFields(result: RepeatedItemResult): DraftField[] {
  return result.extractionKind === "table"
    ? buildSuggestedTableFields(result)
    : buildSuggestedListFields(result);
}

export function readValue(root: Element, selector: string, attribute: string): string {
  const target = selector === ":scope" ? root : root.querySelector(selector);
  if (!target) {
    return "";
  }

  if (attribute === "text") {
    return target.textContent ?? "";
  }
  if (attribute === "html") {
    return target.innerHTML;
  }
  if (attribute === "value" && "value" in target) {
    return String((target as HTMLInputElement).value ?? "");
  }
  return target.getAttribute(attribute) ?? "";
}

function normalizePreviewValue(value: string, transform: DraftField["transform"]): string {
  const trimmed = transform === undefined || transform === "trim" ? value.trim() : value;
  if (transform === "uppercase") {
    return trimmed.toUpperCase();
  }
  if (transform === "lowercase") {
    return trimmed.toLowerCase();
  }
  if (transform === "license-status") {
    return trimmed.replace(/\s+/g, " ").toUpperCase();
  }
  return trimmed;
}

export function extractPreviewRows(draft: OverlayDraft): Record<string, string>[] {
  if (!draft.itemSelector || draft.fields.length === 0) {
    return [];
  }

  return queryAll(document, draft.itemSelector)
    .filter((item) => Boolean(rectForElement(item)))
    .slice(0, 50)
    .map((item) => {
      const row: Record<string, string> = {};
      for (const field of draft.fields) {
        row[field.name] = normalizePreviewValue(
          readValue(item, field.selector, field.attribute),
          field.transform,
        );
      }
      return row;
    })
    .filter((row) => Object.values(row).some((value) => value.trim().length > 0));
}

export function rectForElement(element: Element): RectSnapshot | undefined {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

export function rectsForSelector(selector: string | undefined): RectSnapshot[] {
  if (!selector) {
    return [];
  }
  return queryAll(document, selector)
    .map(rectForElement)
    .filter((rect): rect is RectSnapshot => Boolean(rect))
    .slice(0, 80);
}
