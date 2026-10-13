import * as pdfjsLib from "../build/pdf.mjs";

const PDF_URL = "https://assets.sacrumflorilegium.com/pdfs/little-pictorial-lives-of-the-saints.pdf?v=da52bc45c82ad021c23cbde561db46f5";
const VIEWER_URL = "https://reader.sacrumflorilegium.com/web/viewer.html";
const STORAGE_KEY = "sf-saints-pages-v2:" + PDF_URL;
const MONTHS = [
  ["January", "jan"], ["February", "feb"], ["March", "mar"],
  ["April", "apr"], ["May", "may"], ["June", "jun"],
  ["July", "jul"], ["August", "aug"], ["September", "sep", "sept"],
  ["October", "oct"], ["November", "nov"], ["December", "dec"]
];
const LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const current = new Date();
const todayId = key(current.getMonth(), current.getDate());
const requestedId = new URLSearchParams(window.location.search).get("date");
const days = [];
let pageMap = {};

for (let month = 0; month < 12; month++) {
  for (let day = 1; day <= LENGTHS[month]; day++) {
    const id = key(month, day);
    if (month === 1 && day === 29) continue;
    days.push({ id, month, day });
  }
}
document.getElementById("today-date").textContent =
  MONTHS[current.getMonth()][0] + " " + current.getDate();
drawCalendar();
start().catch((error) => {
  console.error("Daily saints indexing failed", error);
  setStatus("The book's page index could not be prepared. Please open the book directly in Librarium and try again later.");
});

function key(month, day) {
  return String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function dateHref(id) {
  return "?date=" + encodeURIComponent(id);
}

function viewerHref(page) {
  const url = new URL(VIEWER_URL);
  url.searchParams.set("file", PDF_URL);
  url.hash = "page=" + page;
  return url.toString();
}

function setStatus(message) {
  document.getElementById("index-status").textContent = message;
}

function drawCalendar() {
  const jump = document.getElementById("month-jump");
  const months = document.getElementById("months");
  const jumpFragment = document.createDocumentFragment();
  const sectionFragment = document.createDocumentFragment();

  MONTHS.forEach((monthAliases, monthIndex) => {
    const name = monthAliases[0];
    const jumpLink = document.createElement("a");
    jumpLink.href = "#month-" + monthIndex;
    jumpLink.textContent = name.slice(0, 3);
    jumpFragment.append(jumpLink);

    const section = document.createElement("section");
    section.className = "month";
    section.id = "month-" + monthIndex;
    const heading = document.createElement("h2");
    heading.textContent = name;
    section.append(heading);

    const grid = document.createElement("div");
    grid.className = "date-grid";
    for (let d = 1; d <= LENGTHS[monthIndex]; d++) {
      const id = key(monthIndex, d);
      const a = document.createElement("a");
      a.className = "date-link";
      a.href = dateHref(id);
      a.textContent = String(d);
      a.title = name + " " + d;
      a.setAttribute("aria-label", "Open " + name + " " + d);
      a.dataset.date = id;
      if (id === todayId) a.classList.add("current");
      if (monthIndex === 1 && d === 29) a.title += " — leap year only";
      grid.append(a);
    }
    section.append(grid);
    sectionFragment.append(section);
  });
  jump.replaceChildren(jumpFragment);
  months.replaceChildren(sectionFragment);
}

async function start() {
  const saved = getSavedIndex();
  if (saved) {
    pageMap = saved.pages;
    activateLinks();
    return;
  }

  setStatus("Reading the book's searchable text to build your date index. This is a one-time step on this device.");
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("../build/pdf.worker.mjs", import.meta.url).href;
  const loading = pdfjsLib.getDocument({ url: PDF_URL });
  const pdf = await loading.promise;
  const occurrences = Object.create(null);
  const startPage = Math.min(17, Math.floor(pdf.numPages * 0.025));
  let pagesWithText = 0;

  for (let number = startPage; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    const text = content.items.map((item) => item.str || "").join(" ")
      .toLocaleLowerCase("en-US")
      .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1")
      .replace(/[^a-z0-9]+/g, " ");
    if (text.length > 70) pagesWithText++;
    for (let m = 0; m < MONTHS.length; m++) {
      const aliases = MONTHS[m].map((a) => a.toLowerCase()).join("|");
      const forward = new RegExp("\\b(?:" + aliases + ")\\s+([1-9]|[12][0-9]|3[01])\\b", "g");
      const backward = new RegExp("\\b([1-9]|[12][0-9]|3[01])\\s+(?:" + aliases + ")\\b", "g");
      for (const regex of [forward, backward]) {
        for (const hit of text.matchAll(regex)) {
          const day = Number(hit[1]);
          if (day < 1 || day > LENGTHS[m]) continue;
          const id = key(m, day);
          (occurrences[id] ||= new Set()).add(number);
        }
      }
    }
    page.cleanup();
    if (number % 8 === 0 || number === pdf.numPages) {
      setStatus("Indexing searchable pages: " + number + " / " + pdf.numPages + "…");
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  if (pagesWithText < pdf.numPages / 3) {
    setStatus("This copy does not expose enough searchable text to locate daily entries reliably. The original PDF is unchanged.");
    return;
  }

  // Select candidates close to the calendar position, rather than dates
  // mentioned incidentally in a saint's biography or the book's index.
  const candidates = {};
  for (let index = 0; index < days.length; index++) {
    const d = days[index];
    const expected = startPage + index * (pdf.numPages - startPage - 9) / (days.length - 1);
    const pages = Array.from(occurrences[d.id] || []);
    const sorted = pages.filter((p) => Math.abs(p - expected) <= 75)
      .sort((a, b) => Math.abs(a - expected) - Math.abs(b - expected));
    if (sorted.length) candidates[d.id] = sorted[0];
  }

  // Reject out-of-order text mentions. Use interpolated page positions for
  // occasional OCR misses, and mark those links as approximate.
  let last = 1;
  const confirmed = new Map();
  for (let i = 0; i < days.length; i++) {
    const candidate = candidates[days[i].id];
    if (candidate && candidate >= last && candidate - last < 14) {
      confirmed.set(i, candidate);
      last = candidate;
    }
  }
  if (confirmed.size < 120) {
    setStatus("The PDF has searchable text, but fewer than 120 clear date headings were found. I will not invent the missing page links.");
    return;
  }

  const known = [...confirmed.keys()].sort((a, b) => a - b);
  for (let i = 0; i < days.length; i++) {
    if (confirmed.has(i)) {
      pageMap[days[i].id] = { page: confirmed.get(i), exact: true };
      continue;
    }
    const left = known.filter((n) => n < i).at(-1);
    const right = known.find((n) => n > i);
    let page;
    if (left !== undefined && right !== undefined) {
      const ratio = (i - left) / (right - left);
      page = confirmed.get(left) + ratio * (confirmed.get(right) - confirmed.get(left));
    } else if (left !== undefined) {
      page = confirmed.get(left) + (i - left) * 1.65;
    } else if (right !== undefined) {
      page = confirmed.get(right) - (right - i) * 1.65;
    } else {
      continue;
    }
    pageMap[days[i].id] = { page: Math.max(1, Math.min(pdf.numPages, Math.round(page))), exact: false };
  }
  pageMap["02-29"] = { ...pageMap["02-28"], exact: false };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pages: pageMap, pageCount: pdf.numPages }));
  } catch {
    // Browsers in private mode may disallow storage; this session still works.
  }
  activateLinks();
}

function activateLinks() {
  let exact = 0;
  let estimated = 0;
  for (const element of document.querySelectorAll("[data-date]")) {
    const entry = pageMap[element.dataset.date];
    if (!entry) {
      element.classList.add("unindexed");
      continue;
    }
    element.href = viewerHref(entry.page);
    if (entry.exact) {
      exact++;
    } else {
      estimated++;
      element.classList.add("estimated");
      element.title += " — approximate PDF page";
    }
  }
  const today = pageMap[todayId];
  const todayLink = document.getElementById("today-link");
  if (today) {
    todayLink.href = viewerHref(today.page);
    todayLink.removeAttribute("aria-disabled");
    todayLink.textContent = "Read today's life · PDF page " + today.page + " →";
  }
  const message = exact + " dates identified in the PDF; " + estimated +
    " dates use estimated nearby pages (marked ·). Bookmarks open in your Librarium reader.";
  setStatus(message);

  if (requestedId && Object.prototype.hasOwnProperty.call(pageMap, requestedId)) {
    window.location.replace(viewerHref(pageMap[requestedId].page));
  }
}

function getSavedIndex() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return saved && saved.pages && Object.keys(saved.pages).length >= 365 ? saved : null;
  } catch {
    return null;
  }
}