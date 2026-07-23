import "./viewer-base.mjs";

const STORAGE_KEY = "florilegium-reader-invert-colors";
const ACTIVE_CLASS = "florilegiumInvertColors";

function setInverted(isInverted) {
  document.documentElement.classList.toggle(ACTIVE_CLASS, isInverted);

  const button = document.getElementById("invertColorsButton");
  if (button) {
    button.setAttribute("aria-pressed", String(isInverted));
    button.title = isInverted ? "Use original PDF colors" : "Invert PDF colors";
    button.setAttribute(
      "aria-label",
      isInverted ? "Use original PDF colors" : "Invert PDF colors"
    );
  }

  try {
    localStorage.setItem(STORAGE_KEY, isInverted ? "true" : "false");
  } catch {
    // The control still works when storage is blocked.
  }
}

function getSavedPreference() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function addInvertColorsButton() {
  if (document.getElementById("invertColorsButton")) {
    return;
  }

  const toolbar = document.getElementById("toolbarViewerRight");
  if (!toolbar) {
    return;
  }

  const button = document.createElement("button");
  button.id = "invertColorsButton";
  button.className = "toolbarButton florilegiumInvertButton";
  button.type = "button";
  button.tabIndex = 0;
  button.setAttribute("aria-pressed", "false");

  const icon = document.createElement("span");
  icon.className = "florilegiumInvertIcon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◐";
  button.append(icon);

  button.addEventListener("click", () => {
    setInverted(!document.documentElement.classList.contains(ACTIVE_CLASS));
  });

  toolbar.prepend(button);
  setInverted(getSavedPreference());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", addInvertColorsButton, {
    once: true,
  });
} else {
  addInvertColorsButton();
}
