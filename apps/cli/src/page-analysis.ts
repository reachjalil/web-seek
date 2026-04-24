import type { Page } from "playwright";

export type CandidateType = "table" | "list" | "pagination" | "export" | "search";

export interface PageCandidate {
  id: string;
  type: CandidateType;
  selector: string;
  label: string;
  score: number;
  details: Record<string, string | number | boolean | string[] | undefined>;
}

export interface SelectionResult {
  selector: string;
  tagName: string;
  text: string;
  attributes: Record<string, string>;
}

export interface PageAnalysis {
  url: string;
  title: string;
  candidates: PageCandidate[];
}

const HIGHLIGHT_STYLE_ID = "web-seek-highlight-style";
const HIGHLIGHT_ROOT_ID = "web-seek-highlight-root";

export async function analyzeCurrentPage(page: Page): Promise<PageAnalysis> {
  return page.evaluate(() => {
    type CandidateType = "table" | "list" | "pagination" | "export" | "search";

    interface Candidate {
      id: string;
      type: CandidateType;
      selector: string;
      label: string;
      score: number;
      details: Record<string, string | number | boolean | string[] | undefined>;
    }

    const candidates: Candidate[] = [];

    const textOf = (element: Element): string =>
      (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

    const cssEscape = (value: string): string => {
      const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
      return css?.escape ? css.escape(value) : value.replace(/["\\#.:,[\]>+~*]/g, "\\$&");
    };

    const cssPath = (element: Element): string => {
      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }

      const dataStable = ["data-testid", "data-test", "data-cy", "name", "aria-label"];
      for (const attribute of dataStable) {
        const value = element.getAttribute(attribute);
        if (value) {
          const selector = `${element.tagName.toLowerCase()}[${attribute}="${value.replaceAll('"', '\\"')}"]`;
          if (document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        }
      }

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 5) {
        const tag = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (!parent) {
          break;
        }

        const currentTag = current.tagName;
        const siblings = Array.from(parent.children).filter(
          (sibling): sibling is Element =>
            sibling instanceof Element && sibling.tagName === currentTag,
        );
        const index = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
        current = parent;
      }

      return parts.length > 0 ? parts.join(" > ") : element.tagName.toLowerCase();
    };

    const pushCandidate = (
      type: CandidateType,
      selector: string,
      label: string,
      score: number,
      details: Candidate["details"] = {},
    ): void => {
      candidates.push({
        id: `${type}-${candidates.length + 1}`,
        type,
        selector,
        label,
        score,
        details,
      });
    };

    document.querySelectorAll("table").forEach((table, index) => {
      const rows = table.querySelectorAll("tr").length;
      const headers = Array.from(table.querySelectorAll("th")).map(textOf).filter(Boolean);
      const columns =
        headers.length > 0
          ? headers.length
          : Math.max(
              ...Array.from(table.querySelectorAll("tr")).map((row) => row.children.length),
              0,
            );

      if (rows >= 2 && columns >= 2) {
        pushCandidate(
          "table",
          cssPath(table),
          headers.length > 0 ? `Table: ${headers.slice(0, 4).join(", ")}` : `Table ${index + 1}`,
          rows * columns,
          {
            rows,
            columns,
            headers,
            rowSelector: table.querySelector("tbody tr") ? "tbody tr" : "tr",
          },
        );
      }
    });

    const parentCandidates = Array.from(
      document.querySelectorAll(
        "main, section, article, ul, ol, [role='list'], [class*='result'], [id*='result']",
      ),
    );
    for (const parent of parentCandidates) {
      const children = Array.from(parent.children).filter((child) => textOf(child).length > 12);
      if (children.length < 3) {
        continue;
      }

      const signatureCounts = new Map<string, Element[]>();
      for (const child of children) {
        const signature = `${child.tagName}.${Array.from(child.classList).slice(0, 2).join(".")}`;
        signatureCounts.set(signature, [...(signatureCounts.get(signature) ?? []), child]);
      }

      const best = Array.from(signatureCounts.values()).sort((a, b) => b.length - a.length)[0];
      if (best && best.length >= 3) {
        const first = best[0];
        const tag = first?.tagName.toLowerCase() ?? "*";
        const classSelector =
          first && first.classList.length > 0
            ? `.${Array.from(first.classList).slice(0, 2).map(cssEscape).join(".")}`
            : "";
        pushCandidate(
          "list",
          cssPath(parent),
          `Repeated list (${best.length} items)`,
          best.length * 10,
          {
            itemCount: best.length,
            itemSelector: `${tag}${classSelector}`,
          },
        );
      }
    }

    for (const element of Array.from(document.querySelectorAll("a, button"))) {
      const label = textOf(element).toLowerCase();
      const aria = (element.getAttribute("aria-label") ?? "").toLowerCase();
      const href = element.getAttribute("href") ?? "";
      const combined = `${label} ${aria} ${href}`.trim();

      if (/\b(next|more|load more|›|»|>)\b/i.test(combined)) {
        pushCandidate("pagination", cssPath(element), textOf(element) || "Next page", 20, {
          text: textOf(element),
        });
      }

      if (/\b(csv|excel|xlsx|xls|download|export|json|api)\b/i.test(combined)) {
        pushCandidate("export", cssPath(element), textOf(element) || href || "Export link", 40, {
          href,
          text: textOf(element),
        });
      }
    }

    for (const element of Array.from(document.querySelectorAll("input, select, textarea"))) {
      const input = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const name = input.getAttribute("name") ?? "";
      const placeholder = input.getAttribute("placeholder") ?? "";
      const aria = input.getAttribute("aria-label") ?? "";
      const type = input.getAttribute("type") ?? input.tagName.toLowerCase();
      const label = `${placeholder || aria || name || type}`.trim();

      if (
        /(search|license|last|name|profession|city|county|status|number)/i.test(
          `${name} ${placeholder} ${aria} ${type}`,
        )
      ) {
        pushCandidate("search", cssPath(input), `Search field: ${label}`, 25, {
          name,
          placeholder,
          type,
        });
      }
    }

    return {
      url: location.href,
      title: document.title,
      candidates: candidates.sort((a, b) => b.score - a.score).slice(0, 30),
    };
  });
}

export async function highlightCandidates(page: Page, candidates: PageCandidate[]): Promise<void> {
  await page.evaluate(
    ({ candidatesToHighlight, styleId, rootId }) => {
      document.getElementById(styleId)?.remove();
      document.getElementById(rootId)?.remove();

      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .web-seek-highlighted {
          outline: 3px solid #0f766e !important;
          outline-offset: 3px !important;
        }
        #${rootId} {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2147483647;
          font-family: ui-sans-serif, system-ui, sans-serif;
        }
        #${rootId} .web-seek-label {
          position: fixed;
          max-width: 260px;
          padding: 5px 7px;
          color: white;
          background: #0f766e;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 700;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
        }
      `;
      document.head.append(style);

      const root = document.createElement("div");
      root.id = rootId;
      document.body.append(root);

      for (const candidate of candidatesToHighlight) {
        const element = document.querySelector(candidate.selector);
        if (!element) {
          continue;
        }

        element.classList.add("web-seek-highlighted");
        const rect = element.getBoundingClientRect();
        const label = document.createElement("div");
        label.className = "web-seek-label";
        label.textContent = `${candidate.id}: ${candidate.label}`;
        label.style.left = `${Math.max(8, rect.left)}px`;
        label.style.top = `${Math.max(8, rect.top - 30)}px`;
        root.append(label);
      }
    },
    { candidatesToHighlight: candidates, styleId: HIGHLIGHT_STYLE_ID, rootId: HIGHLIGHT_ROOT_ID },
  );
}

export async function clearCandidateHighlights(page: Page): Promise<void> {
  await page.evaluate(
    ({ styleId, rootId }) => {
      for (const element of Array.from(document.querySelectorAll(".web-seek-highlighted"))) {
        element.classList.remove("web-seek-highlighted");
      }
      document.getElementById(styleId)?.remove();
      document.getElementById(rootId)?.remove();
    },
    { styleId: HIGHLIGHT_STYLE_ID, rootId: HIGHLIGHT_ROOT_ID },
  );
}

export async function captureElementSelection(page: Page): Promise<SelectionResult> {
  const bindingName = `webSeekSelect${Date.now()}${Math.floor(Math.random() * 1000)}`;

  let resolveSelection: (value: SelectionResult) => void = () => undefined;
  const selection = new Promise<SelectionResult>((resolve) => {
    resolveSelection = resolve;
  });

  await page.exposeBinding(bindingName, (_source, payload: SelectionResult) => {
    resolveSelection(payload);
  });

  await page.evaluate((name) => {
    const cssEscape = (value: string): string => {
      const css = globalThis.CSS as { escape?: (input: string) => string } | undefined;
      return css?.escape ? css.escape(value) : value.replace(/["\\#.:,[\]>+~*]/g, "\\$&");
    };

    const cssPath = (element: Element): string => {
      if (element.id) {
        return `#${cssEscape(element.id)}`;
      }

      for (const attribute of ["data-testid", "data-test", "data-cy", "name", "aria-label"]) {
        const value = element.getAttribute(attribute);
        if (value) {
          const selector = `${element.tagName.toLowerCase()}[${attribute}="${value.replaceAll('"', '\\"')}"]`;
          if (document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        }
      }

      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.documentElement && parts.length < 6) {
        const parent: Element | null = current.parentElement;
        if (!parent) {
          break;
        }

        const currentTag = current.tagName;
        const siblings = Array.from(parent.children).filter(
          (sibling): sibling is Element =>
            sibling instanceof Element && sibling.tagName === currentTag,
        );
        const index = siblings.indexOf(current) + 1;
        const tag = current.tagName.toLowerCase();
        parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
        current = parent;
      }

      return parts.join(" > ");
    };

    const overlay = document.createElement("div");
    overlay.textContent = "Click the element to capture";
    overlay.style.cssText = [
      "position:fixed",
      "top:12px",
      "left:12px",
      "z-index:2147483647",
      "background:#111827",
      "color:white",
      "padding:8px 10px",
      "border-radius:5px",
      "font:700 13px ui-sans-serif,system-ui,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.25)",
    ].join(";");
    document.body.append(overlay);

    let active: Element | undefined;
    const mouseover = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || target === overlay) {
        return;
      }
      active?.classList.remove("web-seek-pick-hover");
      active = target;
      active.classList.add("web-seek-pick-hover");
    };

    const style = document.createElement("style");
    style.textContent =
      ".web-seek-pick-hover{outline:3px solid #dc2626!important;outline-offset:2px!important}";
    document.head.append(style);

    const click = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Element) || target === overlay) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const attributes: Record<string, string> = {};
      for (const attribute of Array.from(target.attributes)) {
        attributes[attribute.name] = attribute.value;
      }

      const payload = {
        selector: cssPath(target),
        tagName: target.tagName.toLowerCase(),
        text: (target.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
        attributes,
      };

      document.removeEventListener("mouseover", mouseover, true);
      document.removeEventListener("click", click, true);
      active?.classList.remove("web-seek-pick-hover");
      overlay.remove();
      style.remove();

      const caller = (window as unknown as Record<string, (result: typeof payload) => void>)[name];
      caller(payload);
    };

    document.addEventListener("mouseover", mouseover, true);
    document.addEventListener("click", click, true);
  }, bindingName);

  return selection;
}
