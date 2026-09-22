import "./viewer-base.mjs";
import {
  decryptInkDocument,
  deriveSyncCredentials,
  encryptInkDocument,
  getRemoteDocumentKey,
  isValidSyncCredentials,
} from "./annotation-sync.mjs";

const INVERT_STORAGE_KEY = "florilegium-reader-invert-colors";
const BOOK_MODE_STORAGE_KEY = "florilegium-reader-book-mode";
const BOOK_SENSITIVITY_STORAGE_KEY = "florilegium-reader-book-sensitivity";
const INVERT_CLASS = "florilegiumInvertColors";
const BOOK_MODE_CLASS = "florilegiumBookMode";
const DEFAULT_SENSITIVITY = 180;
const INK_STORAGE_PREFIX = "florilegium-reader-ink:";
const INK_SYNC_CREDENTIALS_KEY = "florilegium-reader-annotation-sync";
const INK_SYNC_DELAY = 1200;
const INK_HIDDEN_CLASS = "florilegiumInkHidden";
const INK_DRAWING_CLASS = "florilegiumInkDrawing";
const INK_COLOR = "#8451cf";
const INK_OPACITY = 0.92;
const INK_WIDTH = 4;

let inkDocument = createEmptyInkDocument();
let inkDocumentId = "";
let inkDrawingEnabled = false;
let activeInkStroke = null;
let inkSyncCredentials = loadSyncCredentials();
let inkSyncStatus = inkSyncCredentials ? "ready" : "local";
let inkSyncLastSaved = 0;
let inkSyncTimer = 0;
let inkSyncGeneration = 0;
let inkSyncPromptShown = false;

function createEmptyInkDocument(documentId = "") {
  return {
    version: 1,
    documentId,
    hidden: false,
    pages: {},
    updatedAt: 0,
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
    if (isValidInkDocument(saved, documentId)) {
      return saved;
    }
  } catch {
    // Start with an empty layer if local storage is unavailable or invalid.
  }
  return createEmptyInkDocument(documentId);
}

function isValidInkDocument(value, documentId = value?.documentId) {
  return Boolean(
    value?.version === 1 &&
      value.documentId === documentId &&
      value.pages &&
      typeof value.pages === "object" &&
      Object.values(value.pages).every(Array.isArray)
  );
}

function cacheInkDocument() {
  try {
    localStorage.setItem(getInkStorageKey(), JSON.stringify(inkDocument));
  } catch {
    const alert = document.getElementById("viewer-alert");
    if (alert) {
      alert.textContent = "This browser could not save the drawing layer.";
    }
  }
}

function saveInkDocument() {
  inkDocument.updatedAt = Date.now();
  cacheInkDocument();
  if (inkSyncCredentials) {
    scheduleInkSync();
  } else {
    setInkSyncStatus("local");
  }
}

function loadSyncCredentials() {
  try {
    const saved = JSON.parse(localStorage.getItem(INK_SYNC_CREDENTIALS_KEY));
    return isValidSyncCredentials(saved) ? saved : null;
  } catch {
    return null;
  }
}

function storeSyncCredentials(credentials) {
  inkSyncCredentials = credentials;
  try {
    localStorage.setItem(INK_SYNC_CREDENTIALS_KEY, JSON.stringify(credentials));
  } catch {
    // Sync still works for this tab if browser storage is unavailable.
  }
  updateInkButtons();
}

function setInkSyncStatus(status, lastSaved = inkSyncLastSaved) {
  inkSyncStatus = status;
  inkSyncLastSaved = lastSaved;
  updateInkButtons();
  updateInkSyncDialog();
}

function scheduleInkSync() {
  window.clearTimeout(inkSyncTimer);
  setInkSyncStatus("saving");
  const generation = inkSyncGeneration;
  inkSyncTimer = window.setTimeout(() => {
    uploadInkDocument(generation);
  }, INK_SYNC_DELAY);
}

async function getInkSyncEndpoint(documentId = inkDocumentId) {
  const documentKey = await getRemoteDocumentKey(documentId);
  return {
    documentKey,
    url: `/api/annotations/${inkSyncCredentials.vaultId}/${documentKey}`,
  };
}

async function uploadInkDocument(generation = inkSyncGeneration) {
  if (!inkSyncCredentials || !inkDocumentId || generation !== inkSyncGeneration) {
    return;
  }

  const documentSnapshot = structuredClone(inkDocument);
  const credentials = inkSyncCredentials;
  const documentId = inkDocumentId;
  setInkSyncStatus("saving");

  try {
    const endpoint = await getInkSyncEndpoint(documentId);
    const envelope = await encryptInkDocument(
      documentSnapshot,
      credentials,
      endpoint.documentKey
    );
    const response = await fetch(endpoint.url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${credentials.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });
    if (!response.ok) {
      throw new Error(`Annotation sync failed (${response.status}).`);
    }
    if (
      generation === inkSyncGeneration &&
      inkDocument.updatedAt === documentSnapshot.updatedAt
    ) {
      setInkSyncStatus("synced", documentSnapshot.updatedAt);
    } else if (generation === inkSyncGeneration) {
      scheduleInkSync();
    }
  } catch (error) {
    console.error("Unable to save annotation layer", error);
    if (generation === inkSyncGeneration) {
      setInkSyncStatus("error");
    }
  }
}

function renderAllInkLayers() {
  document.querySelectorAll("#viewer .page").forEach(page => {
    const pageNumber = page.dataset.pageNumber;
    const layer = page.querySelector(":scope > .florilegiumInkLayer");
    if (pageNumber && layer) {
      renderPageStrokes(layer, pageNumber);
    }
  });
}

async function synchronizeInkDocument(documentId = inkDocumentId) {
  if (!inkSyncCredentials || !documentId) {
    setInkSyncStatus("local");
    return;
  }

  const generation = inkSyncGeneration;
  const credentials = inkSyncCredentials;
  setInkSyncStatus("loading");

  try {
    const endpoint = await getInkSyncEndpoint(documentId);
    const response = await fetch(endpoint.url, {
      headers: { Authorization: `Bearer ${credentials.authToken}` },
      cache: "no-store",
    });

    if (response.status === 404) {
      if (generation === inkSyncGeneration && hasInkStrokes()) {
        await uploadInkDocument(generation);
      } else if (generation === inkSyncGeneration) {
        setInkSyncStatus("empty");
      }
      return;
    }
    if (!response.ok) {
      throw new Error(`Annotation sync failed (${response.status}).`);
    }

    const envelope = await response.json();
    const remoteDocument = await decryptInkDocument(
      envelope,
      credentials,
      endpoint.documentKey
    );
    if (!isValidInkDocument(remoteDocument, documentId)) {
      throw new Error("The saved annotation document is invalid.");
    }
    if (generation !== inkSyncGeneration || documentId !== inkDocumentId) {
      return;
    }

    if ((remoteDocument.updatedAt || 0) > (inkDocument.updatedAt || 0)) {
      inkDocument = remoteDocument;
      cacheInkDocument();
      document.documentElement.classList.toggle(
        INK_HIDDEN_CLASS,
        inkDocument.hidden
      );
      renderAllInkLayers();
      updateInkButtons();
    } else if ((inkDocument.updatedAt || 0) > (remoteDocument.updatedAt || 0)) {
      await uploadInkDocument(generation);
      return;
    }
    setInkSyncStatus("synced", Math.max(
      remoteDocument.updatedAt || 0,
      inkDocument.updatedAt || 0
    ));
  } catch (error) {
    console.error("Unable to load annotation layer", error);
    if (generation === inkSyncGeneration) {
      setInkSyncStatus("error");
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

function getInkPointerSamples(event) {
  const samples = event.getCoalescedEvents?.();
  return samples?.length ? samples : [event];
}

function clearActiveInkStroke(active, removePath = false) {
  if (!active || activeInkStroke !== active) {
    return;
  }

  activeInkStroke = null;
  if (active.inputMode === "touch") {
    window.removeEventListener("touchmove", active.addPoints, true);
    window.removeEventListener("touchend", active.finish, true);
    window.removeEventListener("touchcancel", active.cancel, true);
  } else {
    window.removeEventListener("pointermove", active.addPoints, true);
    window.removeEventListener("pointerup", active.finish, true);
    window.removeEventListener("pointercancel", active.cancel, true);
    active.layer.removeEventListener("lostpointercapture", active.cancel);

    try {
      if (active.layer.hasPointerCapture(active.pointerId)) {
        active.layer.releasePointerCapture(active.pointerId);
      }
    } catch {
      // Mobile Safari can drop capture before dispatching its final event.
    }
  }

  if (removePath) {
    active.path.remove();
  }
}

function cancelActiveInkStroke() {
  if (activeInkStroke) {
    clearActiveInkStroke(activeInkStroke, true);
  }
}

function createActiveInkStroke(layer, pageNumber, initialPoint) {
  const stroke = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    color: INK_COLOR,
    opacity: INK_OPACITY,
    width: INK_WIDTH,
    points: initialPoint,
  };
  const path = createStrokePath(stroke);
  layer.append(path);
  return { layer, pageNumber, stroke, path };
}

function commitActiveInkStroke(active) {
  clearActiveInkStroke(active);
  if (active.stroke.points.length < 4) {
    active.path.remove();
    return;
  }
  getPageStrokes(active.pageNumber).push(active.stroke);
  saveInkDocument();
  updateInkButtons();
}

function beginInkStroke(event, layer, pageNumber) {
  if (
    !inkDrawingEnabled ||
    (event.pointerType === "mouse" && event.button !== 0) ||
    (event.pointerType === "touch" && "ontouchstart" in window)
  ) {
    return;
  }
  if (activeInkStroke) {
    return;
  }

  event.preventDefault();
  const active = Object.assign(
    createActiveInkStroke(layer, pageNumber, pointInLayer(event, layer)),
    {
      inputMode: "pointer",
      pointerId: event.pointerId,
      addPoints: null,
      finish: null,
      cancel: null,
    }
  );

  active.addPoints = pointerEvent => {
    if (
      activeInkStroke !== active ||
      pointerEvent.pointerId !== active.pointerId
    ) {
      return;
    }
    pointerEvent.preventDefault();
    for (const sample of getInkPointerSamples(pointerEvent)) {
      active.stroke.points.push(...pointInLayer(sample, layer));
    }
    active.path.setAttribute("d", strokePath(active.stroke.points));
  };

  active.finish = pointerEvent => {
    if (
      activeInkStroke !== active ||
      pointerEvent.pointerId !== active.pointerId
    ) {
      return;
    }
    active.addPoints(pointerEvent);
    commitActiveInkStroke(active);
  };

  active.cancel = pointerEvent => {
    if (
      activeInkStroke === active &&
      (!pointerEvent?.pointerId || pointerEvent.pointerId === active.pointerId)
    ) {
      clearActiveInkStroke(active, true);
    }
  };

  activeInkStroke = active;
  window.addEventListener("pointermove", active.addPoints, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointerup", active.finish, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointercancel", active.cancel, true);
  layer.addEventListener("lostpointercapture", active.cancel);

  try {
    layer.setPointerCapture(event.pointerId);
  } catch {
    // Window-level listeners still complete the stroke if capture is unavailable.
  }
}

function findTouch(event, identifier) {
  return [...event.changedTouches, ...event.touches].find(
    touch => touch.identifier === identifier
  );
}

function beginInkTouchStroke(event, layer, pageNumber) {
  if (!inkDrawingEnabled || activeInkStroke || event.changedTouches.length === 0) {
    return;
  }

  event.preventDefault();
  const initialTouch = event.changedTouches[0];
  const active = Object.assign(
    createActiveInkStroke(
      layer,
      pageNumber,
      pointInLayer(initialTouch, layer)
    ),
    {
      inputMode: "touch",
      touchId: initialTouch.identifier,
      addPoints: null,
      finish: null,
      cancel: null,
    }
  );

  active.addPoints = touchEvent => {
    if (activeInkStroke !== active) {
      return;
    }
    const touch = findTouch(touchEvent, active.touchId);
    if (!touch) {
      return;
    }
    touchEvent.preventDefault();
    active.stroke.points.push(...pointInLayer(touch, layer));
    active.path.setAttribute("d", strokePath(active.stroke.points));
  };

  active.finish = touchEvent => {
    if (activeInkStroke !== active) {
      return;
    }
    const touch = [...touchEvent.changedTouches].find(
      item => item.identifier === active.touchId
    );
    if (!touch) {
      return;
    }
    touchEvent.preventDefault();
    active.stroke.points.push(...pointInLayer(touch, layer));
    active.path.setAttribute("d", strokePath(active.stroke.points));
    commitActiveInkStroke(active);
  };

  active.cancel = () => {
    if (activeInkStroke === active) {
      clearActiveInkStroke(active, true);
    }
  };

  activeInkStroke = active;
  window.addEventListener("touchmove", active.addPoints, {
    capture: true,
    passive: false,
  });
  window.addEventListener("touchend", active.finish, {
    capture: true,
    passive: false,
  });
  window.addEventListener("touchcancel", active.cancel, true);
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
  layer.addEventListener(
    "touchstart",
    event => beginInkTouchStroke(event, layer, pageNumber),
    { passive: false }
  );

  page.append(layer);
  renderPageStrokes(layer, pageNumber);
}

function attachVisibleInkLayers() {
  document.querySelectorAll("#viewer .page").forEach(attachInkLayer);
}

function attachAddedInkLayers(mutations) {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) {
        continue;
      }
      if (node.matches(".page")) {
        attachInkLayer(node);
      }
      node.querySelectorAll?.(".page").forEach(attachInkLayer);
    }
  }
}

function attachRenderedInkLayer({ pageNumber } = {}) {
  if (!pageNumber) {
    return;
  }
  const page = document.querySelector(
    `#viewer .page[data-page-number="${CSS.escape(String(pageNumber))}"]`
  );
  if (page) {
    attachInkLayer(page);
  }
}

function hasInkStrokes() {
  return Object.values(inkDocument.pages).some(strokes => strokes.length > 0);
}

function updateInkButtons() {
  const drawButton = document.getElementById("inkDrawButton");
  const visibilityButton = document.getElementById("inkVisibilityButton");
  const undoButton = document.getElementById("inkUndoButton");
  const syncButton = document.getElementById("inkSyncButton");

  if (drawButton) {
    drawButton.setAttribute("aria-pressed", String(inkDrawingEnabled));
    drawButton.title = inkDrawingEnabled ? "Stop drawing" : "Draw on this PDF";
    drawButton.setAttribute("aria-label", drawButton.title);
    drawButton
      .querySelector(".florilegiumCustomIcon")
      .classList.toggle("florilegiumIconDone", inkDrawingEnabled);
  }
  if (visibilityButton) {
    visibilityButton.setAttribute("aria-pressed", String(!inkDocument.hidden));
    visibilityButton.title = inkDocument.hidden
      ? "Show drawing layer"
      : "Hide drawing layer";
    visibilityButton.setAttribute("aria-label", visibilityButton.title);
    visibilityButton
      .querySelector(".florilegiumCustomIcon")
      .classList.toggle("florilegiumIconHidden", inkDocument.hidden);
    visibilityButton.hidden = !hasInkStrokes();
  }
  if (undoButton) {
    undoButton.disabled = !hasInkStrokes();
    undoButton.hidden = !hasInkStrokes();
  }
  if (syncButton) {
    const titles = {
      local: "Annotations are saved on this device only",
      ready: "Permanent annotation sync is ready",
      loading: "Loading permanent annotations",
      saving: "Saving annotations",
      synced: "Annotations are permanently saved",
      empty: "No permanent annotations for this passphrase yet",
      error: "Annotation sync needs attention",
    };
    syncButton.title = titles[inkSyncStatus] || titles.local;
    syncButton.setAttribute("aria-label", syncButton.title);
    syncButton.setAttribute("aria-pressed", String(Boolean(inkSyncCredentials)));
    syncButton.dataset.syncStatus = inkSyncStatus;
  }
}

function setInkDrawing(enabled) {
  if (!enabled) {
    cancelActiveInkStroke();
  }
  inkDrawingEnabled = enabled;
  document.documentElement.classList.toggle(INK_DRAWING_CLASS, enabled);
  if (enabled && inkDocument.hidden) {
    setInkVisibility(true);
  }
  if (enabled && !inkSyncCredentials && !inkSyncPromptShown) {
    inkSyncPromptShown = true;
    window.setTimeout(openInkSyncDialog, 0);
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

function formatInkSyncTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function getInkSyncStatusMessage() {
  if (!inkSyncCredentials) {
    return "This drawing layer is currently saved only in this browser.";
  }
  if (inkSyncStatus === "loading") {
    return "Loading the permanent drawing layer…";
  }
  if (inkSyncStatus === "saving") {
    return "Saving encrypted annotations…";
  }
  if (inkSyncStatus === "synced") {
    const time = formatInkSyncTime(inkSyncLastSaved);
    return time ? `Permanently saved at ${time}.` : "Permanent sync is ready.";
  }
  if (inkSyncStatus === "empty") {
    return "No permanent annotations were found for this passphrase. New drawings will save here.";
  }
  if (inkSyncStatus === "error") {
    return "Could not reach permanent storage. The local copy is safe and will retry.";
  }
  return "Permanent sync is ready.";
}

function updateInkSyncDialog() {
  const dialog = document.getElementById("inkSyncDialog");
  if (!dialog) {
    return;
  }
  const status = dialog.querySelector(".florilegiumSyncStatus");
  const exportButton = dialog.querySelector(".florilegiumSyncExport");
  if (status) {
    status.textContent = getInkSyncStatusMessage();
    status.dataset.syncStatus = inkSyncStatus;
  }
  if (exportButton) {
    exportButton.disabled = !hasInkStrokes();
  }
}

function exportInkDocument() {
  const safeName = (inkDocumentId.split("/").at(-1) || "document")
    .replace(/\.pdf(?:\?.*)?$/iu, "")
    .replace(/[^a-z0-9._-]+/giu, "-")
    .replace(/^-+|-+$/gu, "") || "document";
  const blob = new Blob([JSON.stringify(inkDocument, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${safeName}-annotations.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function ensureInkSyncDialog() {
  const existing = document.getElementById("inkSyncDialog");
  if (existing) {
    return existing;
  }

  const dialog = document.createElement("dialog");
  dialog.id = "inkSyncDialog";
  dialog.className = "florilegiumSyncDialog";

  const heading = document.createElement("h2");
  heading.textContent = "Permanent annotations";
  const explanation = document.createElement("p");
  explanation.textContent =
    "Choose a private passphrase to encrypt and sync your drawing layer. After clearing Safari or using another device, enter the same passphrase to restore it.";
  const warning = document.createElement("p");
  warning.className = "florilegiumSyncWarning";
  warning.textContent =
    "Save this passphrase in your password manager. Florilegium cannot recover it.";

  const form = document.createElement("form");
  form.className = "florilegiumSyncForm";
  const label = document.createElement("label");
  label.htmlFor = "inkSyncPassphrase";
  label.textContent = "Sync passphrase";
  const input = document.createElement("input");
  input.id = "inkSyncPassphrase";
  input.type = "password";
  input.minLength = 12;
  input.required = true;
  input.autocomplete = "current-password";
  input.placeholder = "At least 12 characters";
  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = inkSyncCredentials ? "Use passphrase" : "Enable sync";
  form.append(label, input, submit);

  const status = document.createElement("p");
  status.className = "florilegiumSyncStatus";

  const actions = document.createElement("div");
  actions.className = "florilegiumSyncActions";
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.className = "florilegiumSyncExport";
  exportButton.textContent = "Export JSON backup";
  exportButton.addEventListener("click", exportInkDocument);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => dialog.close());
  actions.append(exportButton, closeButton);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    submit.disabled = true;
    status.textContent = "Preparing encrypted sync…";
    try {
      const credentials = await deriveSyncCredentials(input.value);
      storeSyncCredentials(credentials);
      input.value = "";
      submit.textContent = "Use passphrase";
      await synchronizeInkDocument();
    } catch (error) {
      status.textContent = error.message || "Could not enable annotation sync.";
      status.dataset.syncStatus = "error";
    } finally {
      submit.disabled = false;
    }
  });

  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog.append(heading, explanation, warning, form, status, actions);
  document.body.append(dialog);
  updateInkSyncDialog();
  return dialog;
}

function openInkSyncDialog() {
  const dialog = ensureInkSyncDialog();
  updateInkSyncDialog();
  if (!dialog.open) {
    dialog.showModal();
  }
  dialog.querySelector("#inkSyncPassphrase")?.focus();
}

function addInkControls(target) {
  if (document.getElementById("inkDrawButton")) {
    return;
  }

  if (!target) {
    return;
  }

  const drawButton = createToolbarButton({
    id: "inkDrawButton",
    className: "florilegiumReadingButton florilegiumInkButton",
    iconName: "draw",
    label: "Draw on this PDF",
    onClick: () => setInkDrawing(!inkDrawingEnabled),
  });
  const visibilityButton = createToolbarButton({
    id: "inkVisibilityButton",
    className: "florilegiumReadingButton florilegiumInkButton",
    iconName: "visibility",
    label: "Hide drawing layer",
    onClick: () => setInkVisibility(inkDocument.hidden),
  });
  const undoButton = createToolbarButton({
    id: "inkUndoButton",
    className: "florilegiumReadingButton florilegiumInkButton",
    iconName: "undo",
    label: "Undo last drawing",
    onClick: undoLastInkStroke,
  });
  const syncButton = createToolbarButton({
    id: "inkSyncButton",
    className: "florilegiumReadingButton florilegiumSyncButton",
    iconName: "cloud",
    label: "Set up permanent annotation sync",
    onClick: openInkSyncDialog,
  });

  target.append(drawButton, visibilityButton, undoButton, syncButton);

  const viewer = document.getElementById("viewer");
  if (viewer) {
    new MutationObserver(attachAddedInkLayers).observe(viewer, {
      childList: true,
      subtree: true,
    });
  }

  const initializeForDocument = () => {
    const documentId = getCurrentDocumentId();
    let documentChanged = false;
    if (documentId !== inkDocumentId) {
      cancelActiveInkStroke();
      window.clearTimeout(inkSyncTimer);
      inkSyncGeneration += 1;
      inkDocumentId = documentId;
      inkDocument = loadInkDocument(documentId);
      documentChanged = true;
    }
    document.documentElement.classList.toggle(
      INK_HIDDEN_CLASS,
      inkDocument.hidden
    );
    attachVisibleInkLayers();
    updateInkButtons();
    if (documentChanged) {
      synchronizeInkDocument(documentId);
    }
  };

  const eventBus = window.PDFViewerApplication?.eventBus;
  eventBus?.on("documentloaded", initializeForDocument);
  eventBus?.on("pagerendered", attachRenderedInkLayer);
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

function createToolbarButton({ id, className, iconName, label, onClick }) {
  const button = document.createElement("button");
  button.id = id;
  button.className = `toolbarButton ${className}`;
  button.type = "button";
  button.tabIndex = 0;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.setAttribute("aria-pressed", "false");

  const icon = document.createElement("span");
  icon.className = `florilegiumCustomIcon florilegiumIcon-${iconName}`;
  icon.setAttribute("aria-hidden", "true");
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
    iconName: "invert",
    label: "Invert PDF colors",
    onClick: () => {
      setInverted(!document.documentElement.classList.contains(INVERT_CLASS));
    },
  });

  const bookButton = createToolbarButton({
    id: "bookModeButton",
    className: "florilegiumReadingButton florilegiumBookModeButton",
    iconName: "book",
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

  const readingControls = document.createElement("div");
  readingControls.id = "florilegiumReadingControls";
  readingControls.className = "florilegiumReadingControls";

  addInkControls(readingControls);
  readingControls.append(invertButton, bookButton, controls);
  toolbar.prepend(readingControls);
  updateInkButtons();

  setBookSensitivity(getSavedSensitivity(), false);
  const savedBookMode = getSavedBoolean(BOOK_MODE_STORAGE_KEY);
  const savedInvert = getSavedBoolean(INVERT_STORAGE_KEY);
  setBookMode(savedBookMode, false);
  setInverted(!savedBookMode && savedInvert, false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addReadingControls, {
    once: true,
  });
} else {
  addReadingControls();
}

window.addEventListener("online", () => {
  if (inkSyncCredentials && inkDocumentId && inkSyncStatus === "error") {
    synchronizeInkDocument();
  }
});
