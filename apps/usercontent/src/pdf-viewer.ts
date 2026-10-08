import { readFileSync } from "node:fs"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)

const readPdfjsBuild = (filename: string): string =>
	readFileSync(require.resolve(`pdfjs-dist/build/${filename}`), "utf8")

export const PDFJS_SOURCE = readPdfjsBuild("pdf.min.mjs")
export const PDFJS_WORKER_SOURCE = readPdfjsBuild("pdf.worker.min.mjs")

const jsonStringLiteral = (value: string): string => JSON.stringify(value).replace(/</g, "\\u003c")
const PDFJS_SOURCE_LITERAL = jsonStringLiteral(PDFJS_SOURCE)
const PDFJS_WORKER_SOURCE_LITERAL = jsonStringLiteral(PDFJS_WORKER_SOURCE)

export interface PdfViewerHtmlOptions {
	dataBase64: string
}

export const buildPdfViewerHtml = ({ dataBase64 }: PdfViewerHtmlOptions): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html, body { margin: 0; min-height: 100%; }
body { background: #e5e7eb; }
#pages { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; box-sizing: border-box; width: max-content; min-width: 100%; }
.page { position: relative; flex: none; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 20%); }
canvas { position: absolute; inset: 0; display: block; }
#error { margin: 24px; font: 16px sans-serif; color: #111827; }
</style>
</head>
<body>
<main id="pages"></main>
<p id="error" hidden>This PDF couldn't be displayed.</p>
<script>
const dataBase64 = ${jsonStringLiteral(dataBase64)};
const pdfjsSource = ${PDFJS_SOURCE_LITERAL};
const pdfjsWorkerSource = ${PDFJS_WORKER_SOURCE_LITERAL};
const pages = document.getElementById("pages");
const error = document.getElementById("error");
const pageByElement = new WeakMap();
const entries = [];
let nearObserver;
let farObserver;
let resizeTimer;

const showError = () => {
  nearObserver?.disconnect();
  farObserver?.disconnect();
  for (const entry of entries) {
    entry.near = false;
    entry.task?.cancel();
    releaseCanvas(entry);
  }
  pages.replaceChildren();
  error.hidden = false;
};

const releaseCanvas = (entry) => {
  if (entry.canvas !== null) {
    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas.remove();
    entry.canvas = null;
  }
  if (entry.task === null) entry.page.cleanup();
};

const renderPage = (entry) => {
  if (!entry.near || entry.task !== null || entry.canvas !== null || !error.hidden) return;
  const viewport = entry.page.getViewport({ scale: entry.width / entry.baseWidth });
  const devicePixelRatio = globalThis.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  const maxPixels = 16_777_216;
  const maxDimension = 16_384;
  let pixelWidth = Math.ceil(viewport.width * devicePixelRatio);
  let pixelHeight = Math.ceil(viewport.height * devicePixelRatio);
  if (pixelWidth * pixelHeight > maxPixels || pixelWidth > maxDimension || pixelHeight > maxDimension) {
    const scale = Math.min(
      Math.sqrt(maxPixels / (pixelWidth * pixelHeight)),
      maxDimension / pixelWidth,
      maxDimension / pixelHeight,
    );
    pixelWidth = Math.max(1, Math.floor(pixelWidth * scale));
    pixelHeight = Math.max(1, Math.floor(pixelHeight * scale));
  }
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  canvas.style.width = entry.width + "px";
  canvas.style.height = entry.height + "px";
  const context = canvas.getContext("2d", { alpha: false });
  if (context === null) {
    showError();
    return;
  }
  entry.canvas = canvas;
  entry.element.append(canvas);
  let task;
  try {
    task = entry.page.render({
      canvasContext: context,
      viewport,
      transform: [pixelWidth / viewport.width, 0, 0, pixelHeight / viewport.height, 0, 0],
    });
  } catch {
    showError();
    return;
  }
  entry.task = task;
  void task.promise.catch((reason) => {
    if (reason?.name === "RenderingCancelledException") releaseCanvas(entry);
    else showError();
  }).finally(() => {
    if (entry.task === task) entry.task = null;
    if (!entry.far || entry.canvas === null) releaseCanvas(entry);
    if (entry.near) renderPage(entry);
  });
};

const zoomPercent = () => {
  const raw = new URLSearchParams(location.hash.slice(1)).get("zoom");
  const value = raw === null || raw.trim() === "" ? 100 : Number(raw);
  return Number.isFinite(value) ? Math.max(25, Math.min(400, value)) : 100;
};

const sizeEntry = (entry, zoom) => {
  entry.width = Math.max(1, Math.min(globalThis.innerWidth - 32, entry.baseWidth)) * zoom;
  entry.height = entry.baseHeight * entry.width / entry.baseWidth;
  entry.element.style.width = entry.width + "px";
  entry.element.style.height = entry.height + "px";
};

const layout = () => {
  const previousRange = Math.max(0, document.documentElement.scrollHeight - globalThis.innerHeight);
  const scrollFraction = previousRange === 0 ? 0 : globalThis.scrollY / previousRange;
  nearObserver?.disconnect();
  farObserver?.disconnect();
  const zoom = zoomPercent() / 100;
  for (const entry of entries) {
    entry.near = false;
    entry.far = true;
    entry.task?.cancel();
    releaseCanvas(entry);
    sizeEntry(entry, zoom);
  }
  const nextRange = Math.max(0, document.documentElement.scrollHeight - globalThis.innerHeight);
  globalThis.scrollTo(globalThis.scrollX, nextRange * scrollFraction);
  for (const entry of entries) {
    nearObserver.observe(entry.element);
    farObserver.observe(entry.element);
  }
};

const load = async () => {
  const pdfjs = await import(URL.createObjectURL(new Blob([pdfjsSource], { type: "text/javascript" })));
  globalThis.pdfjsWorker = await import(
    URL.createObjectURL(new Blob([pdfjsWorkerSource], { type: "text/javascript" })),
  );
  const bytes = Uint8Array.from(atob(dataBase64), (character) => character.charCodeAt(0));
  const pdf = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false }).promise;
  // Cross-origin frames ignore rootMargin with an implicit root.
  nearObserver = new IntersectionObserver((observed) => {
    for (const item of observed) {
      const entry = pageByElement.get(item.target);
      entry.near = item.isIntersecting;
      if (entry.near) {
        entry.far = true;
        renderPage(entry);
      } else entry.task?.cancel();
    }
  }, { root: document, rootMargin: Math.ceil(globalThis.innerHeight) + "px 0px" });
  farObserver = new IntersectionObserver((observed) => {
    for (const item of observed) {
      const entry = pageByElement.get(item.target);
      entry.far = item.isIntersecting || entry.near;
      if (!entry.far) {
        entry.task?.cancel();
        if (entry.task === null) releaseCanvas(entry);
      }
    }
  }, { root: document, rootMargin: Math.ceil(globalThis.innerHeight * 3) + "px 0px" });
  globalThis.addEventListener("hashchange", layout);
  globalThis.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layout, 150);
  });
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    if (!error.hidden) return;
    const baseViewport = page.getViewport({ scale: 1 });
    const element = document.createElement("div");
    element.className = "page";
    const entry = {
      page, element, baseWidth: baseViewport.width, baseHeight: baseViewport.height,
      width: 0, height: 0, near: false, far: true, canvas: null, task: null,
    };
    entries.push(entry);
    pageByElement.set(element, entry);
    sizeEntry(entry, zoomPercent() / 100);
    pages.append(element);
    nearObserver.observe(element);
    farObserver.observe(element);
    // Give observers and painting a turn while later pages load.
    if (pageNumber === 1 || pageNumber % 8 === 0) {
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
};

void load().catch(showError);
</script>
</body>
</html>`
