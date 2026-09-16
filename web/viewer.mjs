import "./viewer-base.mjs";

const INVERT_STORAGE_KEY = "florilegium-reader-invert-colors";
const BOOK_MODE_STORAGE_KEY = "florilegium-reader-book-mode";
const BOOK_SENSITIVITY_STORAGE_KEY = "florilegium-reader-book-sensitivity";
const INVERT_CLASS = "florilegiumInvertColors";
const BOOK_MODE_CLASS = "florilegiumBookMode";
const DEFAULT_SENSITIVITY = 180;
const INK_STORAGE_PREFIX = "florilegium-reader-ink:";
const INK_HIDDEN_CLASS = "florilegiumInkHidden";
const INK_DRAWING_CLASS = "florilegiumInkDrawing";
const INK_COLOR = "#8451cf";
const INK_OPACITY = 0.92;
const INK_WIDTH = 4;

let inkDocument = createEmptyInkDocument();
let inkDocumentId = "";
let inkDrawingEnabled = false;

function createEmptyInkDocument(documentId = "") {
  return {
    version: 1,
    documentId,
    hidden: false,
    pages: {},
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getCurrentDocumentId() {
  const fileParameter = new URL(window.location.href).searchParams.get("file");
  const applicationUrl = window.PDFViewerApplication?.url;
  return String(applicationUrl || fileParameter || document.title || "document")
    .split("#", 1)[0]
    .trim();
}

function getInkStorageKey(documentId = inkDocumentId) {
  return `${INK_STORAGE_PREFIX}${hashString(documentId)}`;
}

function loadInkDocument(documentId) {
  try {
    const saved = JSON.parse(localStorage.getItem(getInkStorageKey(documentId)));
    if (
      saved?.version === 1 &&
      saved.documentId === documentId &&
      saved.pages &&
      typeof saved.pages === "object" &&
      Object.values(saved.pages).every(Array.isArray)
    ) {
      return saved;
    }
  } catch {
    // Start with an empty layer if local storage is unavailable or invalid.
  }
  return createEmptyInkDocument(documentId);
}

function saveInkDocument() {
  try {
    localStorage.setItem(getInkStorageKey(), JSON.stringify(inkDocument));
  } catch {
    const alert = document.getElementById("viewer-alert");
    if (alert) {
      alert.textContent = "This browser could not save the drawing layer.";
    }
  }
}

function getPageStrokes(pageNumber) {
  return (inkDocument.pages[pageNumber] ||= []);
}

function strokePath(points) {
  if (points.length < 2) {
    return "";
  }

  let path = `M ${points[0]} ${points[1]}`;
  for (let index = 2; index < points.length; index += 2) {
    path += ` L ${points[index]} ${points[index + 1]}`;
  }
  return path;
}

function createStrokePath(stroke) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.classList.add("florilegiumInkStroke");
  path.dataset.strokeId = stroke.id;
  path.setAttribute("d", strokePath(stroke.points));
  path.setAttribute("stroke", stroke.color || INK_COLOR);
  path.setAttribute("stroke-opacity", String(stroke.opacity ?? INK_OPACITY));
  path.setAttribute("stroke-width", String(stroke.width || INK_WIDTH));
  return path;
}

function renderPageStrokes(layer, pageNumber) {
  layer.replaceChildren();
  for (const stroke of getPageStrokes(pageNumber)) {
    layer.append(createStrokePath(stroke));
  }
}

function pointInLayer(event, layer) {
  const bounds = layer.getBoundingClientRect();
  return [
    Math.round(((event.clientX - bounds.left) / bounds.width) * 1000),
    Math.round(((event.clientY - bounds.top) / bounds.height) * 1000),
  ];
}

function beginInkStroke(event, layer, pageNumber) {
  if (!inkDrawingEnabled || (event.pointerType === "mouse" && event.button !== 0)) {
    return;
  }

  event.preventDefault();
  layer.setPointerCapture(event.pointerId);

  const stroke = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    color: INK_COLOR,
    opacity: INK_OPACITY,
    width: INK_WIDTH,
    points: pointInLayer(event, layer),
  };
  const path = createStrokePath(stroke);
  layer.append(path);

  const addPoints = pointerEvent => {
    for (const sample of pointerEvent.getCoalescedEvents?.() || [pointerEvent]) {
      stroke.points.push(...pointInLayer(sample, layer));
    }
    path.setAttribute("d", strokePath(stroke.points));
  };

  const finishStroke = pointerEvent => {
    layer.removeEventListener("pointermove", addPoints);
    layer.removeEventListener("pointerup", finishStroke);
    layer.removeEventListener("pointercancel", cancelStroke);

    if (layer.hasPointerCapture(pointerEvent.pointerId)) {
      layer.releasePointerCapture(pointerEvent.pointerId);
    }

    if (stroke.points.length < 4) {
      path.remove();
      return;
    }

    getPageStrokes(pageNumber).push(stroke);
    saveInkDocument();
    updateInkButtons();
  };

  const cancelStroke = pointerEvent => {
    layer.removeEventListener("pointermove", addPoints);
    layer.removeEventListener("pointerup", finishStroke);
    layer.removeEventListener("pointercancel", cancelStroke);
    path.remove();
    if (layer.hasPointerCapture(pointerEvent.pointerId)) {
      layer.releasePointerCapture(pointerEvent.pointerId);
    }
  };

  layer.addEventListener("pointermove", addPoints);
  layer.addEventListener("pointerup", finishStroke);
  layer.addEventListener("pointercancel", cancelStroke);
}

function attachInkLayer(page) {
  if (!(page instanceof HTMLElement) || page.querySelector(":scope > .florilegiumInkLayer")) {
    return;
  }

  const pageNumber = page.dataset.pageNumber;
  if (!pageNumber) {
    return;
  }

  const layer = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  layer.classList.add("florilegiumInkLayer");
  layer.setAttribute("viewBox", "0 0 1000 1000");
  layer.setAttribute("preserveAspectRatio", "none");
  layer.setAttribute("aria-label", `Drawing layer for page ${pageNumber}`);
  layer.addEventListener("pointerdown", event => {
    beginInkStroke(event, layer, pageNumber);
  });

  page.append(layer);
  renderPageStrokes(layer, pageNumber);
}

function attachVisibleInkLayers() {
  document.querySelectorAll("#viewer .page").forEach(attachInkLayer);
}

function hasInkStrokes() {
  return Object.values(inkDocument.pages).some(strokes => strokes.length > 0);
}

function updateInkButtons() {
  const drawButton = document.getElementById("inkDrawButton");
  const visibilityButton = document.getElementById("inkVisibilityButton");
  const undoButton = document.getElementById("inkUndoButton");

  if (drawButton) {
    drawButton.setAttribute("aria-pressed", String(inkDrawingEnabled));
    drawButton.title = inkDrawingEnabled ? "Stop drawing" : "Draw on this PDF";
    drawButton.setAttribute("aria-label", drawButton.title);
    drawButton.querySelector(".florilegiumCustomIcon").textContent =
      inkDrawingEnabled ? "Done" : "Draw";
  }
  if (visibilityButton) {
    visibilityButton.setAttribute("aria-pressed", String(!inkDocument.hidden));
    visibilityButton.title = inkDocument.hidden
      ? "Show drawing layer"
      : "Hide drawing layer";
    visibilityButton.setAttribute("aria-label", visibilityButton.title);
    visibilityButton.querySelector(".florilegiumCustomIcon").textContent =
      inkDocument.hidden ? "Show" : "Hide";
    visibilityButton.hidden = !hasInkStrokes();
  }
  if (undoButton) {
    undoButton.disabled = !hasInkStrokes();
    undoButton.hidden = !hasInkStrokes();
  }
}

function setInkDrawing(enabled) {
  inkDrawingEnabled = enabled;
  document.documentElement.classList.toggle(INK_DRAWING_CLASS, enabled);
  if (enabled && inkDocument.hidden) {
    setInkVisibility(true);
  }
  updateInkButtons();
}

function setInkVisibility(visible) {
  inkDocument.hidden = !visible;
  document.documentElement.classList.toggle(INK_HIDDEN_CLASS, !visible);
  if (!visible) {
    setInkDrawing(false);
  }
  saveInkDocument();
  updateInkButtons();
}

function undoLastInkStroke() {
  let mostRecent = null;
  for (const [pageNumber, strokes] of Object.entries(inkDocument.pages)) {
    const stroke = strokes.at(-1);
    if (stroke && (!mostRecent || stroke.createdAt > mostRecent.stroke.createdAt)) {
      mostRecent = { pageNumber, stroke };
    }
  }

  if (!mostRecent) {
    return;
  }

  inkDocument.pages[mostRecent.pageNumber].pop();
  if (inkDocument.pages[mostRecent.pageNumber].length === 0) {
    delete inkDocument.pages[mostRecent.pageNumber];
  }

  const layer = document.querySelector(
    `#viewer .page[data-page-number="${CSS.escape(mostRecent.pageNumber)}"] > .florilegiumInkLayer`
  );
  if (layer) {
    renderPageStrokes(layer, mostRecent.pageNumber);
  }

  saveInkDocument();
  updateInkButtons();
}

function addInkControls() {
  if (document.getElementById("inkDrawButton")) {
    return;
  }

  const toolbar = document.getElementById("toolbarViewerRight");
  if (!toolbar) {
    return;
  }

  const drawButton = createToolbarButton({
    id: "inkDrawButton",
    className: "florilegiumReadingButton florilegiumInkButton",
    iconText: "Draw",
    label: "Draw on this PDF",
    onClick: () => setInkDrawing(!inkDrawingEnabled),
  });
  const visibilityButton = createToolbarButton({
    id: "inkVisibilityButton",
    className: "florilegiumReadingButton florilegiumInkButton",
    iconText: "Hide",
    label: "Hide drawing layer",
    onClick: () => setInkVisibility(inkDocument.hidden),
  });
  const undoButton = createToolbarButton({
    id: "inkUndoButton",
    className: "florilegiumReadingButton florilegiumInkButton",
    iconText: "Undo",
    label: "Undo last drawing",
    onClick: undoLastInkStroke,
  });

  toolbar.prepend(undoButton);
  toolbar.prepend(visibilityButton);
  toolbar.prepend(drawButton);

  const viewer = document.getElementById("viewer");
  if (viewer) {
    new MutationObserver(attachVisibleInkLayers).observe(viewer, {
      childList: true,
      subtree: true,
    });
  }

  const initializeForDocument = () => {
    const documentId = getCurrentDocumentId();
    if (documentId !== inkDocumentId) {
      inkDocumentId = documentId;
      inkDocument = loadInkDocument(documentId);
    }
    document.documentElement.classList.toggle(
      INK_HIDDEN_CLASS,
      inkDocument.hidden
    );
    attachVisibleInkLayers();
    updateInkButtons();
  };

  const eventBus = window.PDFViewerApplication?.eventBus;
  eventBus?.on("documentloaded", initializeForDocument);
  eventBus?.on("pagerendered", attachVisibleInkLayers);
  initializeForDocument();
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Controls still work when storage is blocked.
  }
}

function getSavedBoolean(key) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function getSavedSensitivity() {
  try {
    const saved = Number.parseInt(
      localStorage.getItem(BOOK_SENSITIVITY_STORAGE_KEY),
      10
    );
    return Number.isFinite(saved) && saved >= 100 && saved <= 300
      ? saved
      : DEFAULT_SENSITIVITY;
  } catch {
    return DEFAULT_SENSITIVITY;
  }
}

function setInverted(isInverted, save = true) {
  document.documentElement.classList.toggle(INVERT_CLASS, isInverted);

  if (isInverted) {
    setBookMode(false, save);
  }

  const button = document.getElementById("invertColorsButton");
  if (button) {
    button.setAttribute("aria-pressed", String(isInverted));
    button.title = isInverted ? "Use original PDF colors" : "Invert PDF colors";
    button.setAttribute(
      "aria-label",
      isInverted ? "Use original PDF colors" : "Invert PDF colors"
    );
  }

  if (save) {
    savePreference(INVERT_STORAGE_KEY, isInverted);
  }
}

function setBookSensitivity(value, save = true) {
  const sensitivity = Math.min(300, Math.max(100, Number(value)));
  document.documentElement.style.setProperty(
    "--florilegium-book-contrast",
    String(sensitivity / 100)
  );

  const slider = document.getElementById("bookModeSensitivity");
  const output = document.getElementById("bookModeSensitivityValue");
  if (slider) {
    slider.value = String(sensitivity);
    slider.setAttribute("aria-valuetext", `${sensitivity}% contrast`);
  }
  if (output) {
    output.textContent = `${sensitivity}%`;
  }

  if (save) {
    savePreference(BOOK_SENSITIVITY_STORAGE_KEY, sensitivity);
  }
}

function setBookMode(isActive, save = true) {
  document.documentElement.classList.toggle(BOOK_MODE_CLASS, isActive);

  if (isActive) {
    setInverted(false, save);
  }

  const button = document.getElementById("bookModeButton");
  const controls = document.getElementById("bookModeControls");
  if (button) {
    button.setAttribute("aria-pressed", String(isActive));
    button.title = isActive
      ? "Turn off scanned book mode"
      : "Scanned book mode";
    button.setAttribute(
      "aria-label",
      isActive ? "Turn off scanned book mode" : "Scanned book mode"
    );
  }
  if (controls) {
    controls.hidden = !isActive;
  }

  if (save) {
    savePreference(BOOK_MODE_STORAGE_KEY, isActive);
  }
}

function createToolbarButton({ id, className, iconText, label, onClick }) {
  const button = document.createElement("button");
  button.id = id;
  button.className = `toolbarButton ${className}`;
  button.type = "button";
  button.tabIndex = 0;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");

  const icon = document.createElement("span");
  icon.className = "florilegiumCustomIcon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = iconText;
  button.append(icon);
  button.addEventListener("click", onClick);
  return button;
}

function addReadingControls() {
  if (document.getElementById("invertColorsButton")) {
    return;
  }

  const toolbar = document.getElementById("toolbarViewerRight");
  if (!toolbar) {
    return;
  }

  const invertButton = createToolbarButton({
    id: "invertColorsButton",
    className: "florilegiumReadingButton florilegiumInvertButton",
    iconText: "Invert",
    label: "Invert PDF colors",
    onClick: () => {
      setInverted(!document.documentElement.classList.contains(INVERT_CLASS));
    },
  });

  const bookButton = createToolbarButton({
    id: "bookModeButton",
    className: "florilegiumReadingButton florilegiumBookModeButton",
    iconText: "Book",
    label: "Scanned book mode",
    onClick: () => {
      setBookMode(!document.documentElement.classList.contains(BOOK_MODE_CLASS));
    },
  });

  const controls = document.createElement("div");
  controls.id = "bookModeControls";
  controls.className = "florilegiumBookModeControls";
  controls.hidden = true;

  const label = document.createElement("label");
  label.htmlFor = "bookModeSensitivity";
  label.className = "visuallyHidden";
  label.textContent = "Book mode contrast";

  const slider = document.createElement("input");
  slider.id = "bookModeSensitivity";
  slider.className = "florilegiumBookModeSlider";
  slider.type = "range";
  slider.min = "100";
  slider.max = "300";
  slider.step = "5";
  slider.setAttribute("aria-label", "Book mode contrast");

  const output = document.createElement("output");
  output.id = "bookModeSensitivityValue";
  output.className = "florilegiumBookModeValue";
  output.htmlFor = "bookModeSensitivity";

  slider.addEventListener("input", event => {
    setBookSensitivity(event.currentTarget.value);
  });

  controls.append(label, slider, output);
  toolbar.prepend(controls);
  toolbar.prepend(bookButton);
  toolbar.prepend(invertButton);

  setBookSensitivity(getSavedSensitivity(), false);
  const savedBookMode = getSavedBoolean(BOOK_MODE_STORAGE_KEY);
  const savedInvert = getSavedBoolean(INVERT_STORAGE_KEY);
  setBookMode(savedBookMode, false);
  setInverted(!savedBookMode && savedInvert, false);
  addInkControls();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addReadingControls, {
    once: true,
  });
} else {
  addReadingControls();
}
