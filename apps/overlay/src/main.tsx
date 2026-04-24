import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const HOST_ID = "web-seek-overlay-root";

function mountOverlay(): void {
  document.getElementById(HOST_ID)?.remove();

  const host = document.createElement("web-seek-overlay");
  host.id = HOST_ID;
  document.documentElement.append(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = window.__WEB_SEEK_OVERLAY_CSS__ ?? "";
  shadow.append(style);

  const rootElement = document.createElement("div");
  shadow.append(rootElement);

  createRoot(rootElement).render(<App host={host} />);
}

mountOverlay();
