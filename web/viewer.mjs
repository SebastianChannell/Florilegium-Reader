import "./viewer-base.mjs";

const INVERT_STORAGE_KEY = "florilegium-reader-invert-colors";
const BOOK_MODE_STORAGE_KEY = "florilegium-reader-book-mode";
const BOOK_SENSITIVITY_STORAGE_KEY = "florilegium-reader-book-sensitivity";
const INVERT_CLASS = "florilegiumInvertColors";
const BOOK_MODE_CLASS = "florilegiumBookMode";
const DEFAULT_SENSITIVITY = 180;

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
    iconText: "◐",
    label: "Invert PDF colors",
    onClick: () => {
      setInverted(!document.documentElement.classList.contains(INVERT_CLASS));
    },
  });

  const bookButton = createToolbarButton({
    id: "bookModeButton",
    className: "florilegiumReadingButton florilegiumBookModeButton",
    iconText: "Aa",
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addReadingControls, {
    once: true,
  });
} else {
  addReadingControls();
}
