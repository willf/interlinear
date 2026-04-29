import { BOOKS } from "./books.js";

const bookSelect = document.getElementById("bookSelect");
const chapterSelect = document.getElementById("chapterSelect");
const debugModeControl = document.getElementById("debugModeControl");
const benchmarkControl = document.getElementById("benchmarkControl");
const debugToggle = document.getElementById("debugToggle");
const benchmarkToggle = document.getElementById("benchmarkToggle");
const englishToggle = document.getElementById("englishToggle");
const statusText = document.getElementById("statusText");
const viewer = document.getElementById("viewer");
const verseTemplate = document.getElementById("verseTemplate");

let currentBook = BOOKS[0];
let parsedBook = null;
let isDebugMode = false;
let isBenchmarkMode = false;
let showEnglish = true;
let parseMs = 0;
let currentViewState = null;

init();

function init() {
  const showDebugControls = new URLSearchParams(window.location.search).has(
    "debug",
  );

  if (!showDebugControls) {
    if (debugModeControl) {
      debugModeControl.style.display = "none";
    }
    if (benchmarkControl) {
      benchmarkControl.style.display = "none";
    }
  }

  populateBookSelect();

  bookSelect.addEventListener("change", async () => {
    const nextBook = BOOKS.find((b) => b.file === bookSelect.value);
    if (!nextBook) {
      return;
    }

    currentBook = nextBook;
    await loadBook(nextBook);
  });

  chapterSelect.addEventListener("change", () => {
    renderCurrentChapter();
  });

  if (debugToggle) {
    debugToggle.addEventListener("change", () => {
      isDebugMode = debugToggle.checked;
      document.body.classList.toggle("debug-mode", isDebugMode);
      updateStatus();
    });
  }

  if (benchmarkToggle) {
    benchmarkToggle.addEventListener("change", () => {
      isBenchmarkMode = benchmarkToggle.checked;
      updateStatus();
    });
  }

  if (englishToggle) {
    showEnglish = englishToggle.checked;
    document.body.classList.toggle("hide-english", !showEnglish);
    englishToggle.addEventListener("change", () => {
      showEnglish = englishToggle.checked;
      document.body.classList.toggle("hide-english", !showEnglish);
      updateStatus();
    });
  }

  loadBook(currentBook);
}

function populateBookSelect() {
  for (const book of BOOKS) {
    const opt = document.createElement("option");
    opt.value = book.file;
    opt.textContent = `${book.code} - ${book.name}`;
    bookSelect.appendChild(opt);
  }

  bookSelect.value = currentBook.file;
}

async function loadBook(book) {
  setStatus(`Loading ${book.name}...`);
  viewer.replaceChildren();

  try {
    const response = await fetch(`./usx/${book.file}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const xml = await response.text();
    const parseStart = performance.now();
    parsedBook = parseUSX(xml, book);
    parseMs = performance.now() - parseStart;

    populateChapterSelect(parsedBook.chapters);
    renderCurrentChapter();
  } catch (err) {
    parsedBook = null;
    chapterSelect.replaceChildren();
    setStatus(`Failed to load ${book.file}: ${err.message}`);
  }
}

function parseUSX(xmlText, bookMeta) {
  const xml = new DOMParser().parseFromString(xmlText, "text/xml");

  const parserErr = xml.querySelector("parsererror");
  if (parserErr) {
    throw new Error("Invalid XML");
  }

  let chapter = null;
  let verse = null;

  const chapters = new Map();

  const walker = xml.createTreeWalker(
    xml.documentElement,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );

  let node = walker.currentNode;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node;
      const tag = el.tagName;

      if (tag === "chapter") {
        chapter = Number(el.getAttribute("number"));
        verse = null;
        ensureChapter(chapters, chapter);
      } else if (tag === "para" && el.getAttribute("style") === "s1") {
        if (chapter != null) {
          const heading = (el.textContent || "").trim();
          if (heading) {
            const chapterData = ensureChapter(chapters, chapter);
            chapterData.pendingHeadings.push(heading);
          }
        }
      } else if (tag === "verse") {
        if (chapter == null) {
          node = walker.nextNode();
          continue;
        }

        verse = Number(el.getAttribute("number"));
        ensureVerse(chapters, chapter, verse);

        const chapterData = ensureChapter(chapters, chapter);
        if (chapterData.pendingHeadings.length > 0) {
          const existing = chapterData.headingsBeforeVerse.get(verse) || [];
          chapterData.headingsBeforeVerse.set(
            verse,
            existing.concat(chapterData.pendingHeadings),
          );
          chapterData.pendingHeadings = [];
        }
      } else if (tag === "char" && el.getAttribute("style") === "rb") {
        if (chapter == null || verse == null) {
          node = walker.nextNode();
          continue;
        }

        const source = (el.getAttribute("gloss") || "").trim();
        const target = (el.textContent || "").trim();

        if (!source && !target) {
          node = walker.nextNode();
          continue;
        }

        ensureVerse(chapters, chapter, verse).push({
          source,
          target,
          type: "rb",
        });
      }
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      const parent = node.parentElement;

      if (!parent) {
        node = walker.nextNode();
        continue;
      }

      // Avoid duplicating translation text that is already captured
      // from <char style="rb">...</char> nodes.
      if (parent.tagName === "char" && parent.getAttribute("style") === "rb") {
        node = walker.nextNode();
        continue;
      }

      // Only keep paragraph text from content-bearing paragraph styles.
      // This avoids pulling in heading/reference paragraphs.
      if (parent.tagName !== "para") {
        node = walker.nextNode();
        continue;
      }

      const paraStyle = parent.getAttribute("style") || "";
      if (!isContentParaStyle(paraStyle)) {
        node = walker.nextNode();
        continue;
      }

      if (chapter != null && verse != null && text && /\S/.test(text)) {
        const cleaned = text.replace(/\s+/g, " ").trim();
        if (cleaned) {
          ensureVerse(chapters, chapter, verse).push({
            source: "",
            target: cleaned,
            type: "txt",
          });
        }
      }
    }

    node = walker.nextNode();
  }

  const sortedChapters = [...chapters.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([chapterNum, chapterData]) => {
      const verses = [...chapterData.verses.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([verseNum, tokens]) => ({ verseNum, tokens }));

      const headingsBeforeVerse = new Map(chapterData.headingsBeforeVerse);
      if (chapterData.pendingHeadings.length > 0 && verses.length > 0) {
        const firstVerse = verses[0].verseNum;
        const existing = headingsBeforeVerse.get(firstVerse) || [];
        headingsBeforeVerse.set(
          firstVerse,
          chapterData.pendingHeadings.concat(existing),
        );
      }

      return { chapterNum, verses, headingsBeforeVerse };
    });

  return {
    bookCode: bookMeta.code,
    bookName: bookMeta.name,
    chapters: sortedChapters,
  };
}

function ensureChapter(chapters, chapterNum) {
  if (!chapters.has(chapterNum)) {
    chapters.set(chapterNum, {
      verses: new Map(),
      headingsBeforeVerse: new Map(),
      pendingHeadings: [],
    });
  }
  return chapters.get(chapterNum);
}

function ensureVerse(chapters, chapterNum, verseNum) {
  const chapterData = ensureChapter(chapters, chapterNum);
  if (!chapterData.verses.has(verseNum)) {
    chapterData.verses.set(verseNum, []);
  }
  return chapterData.verses.get(verseNum);
}

function isContentParaStyle(style) {
  return /^(p|q|m|pi|li)/.test(style);
}

function populateChapterSelect(chapters) {
  chapterSelect.replaceChildren();

  for (const chapter of chapters) {
    const opt = document.createElement("option");
    opt.value = String(chapter.chapterNum);
    opt.textContent = `Chapter ${chapter.chapterNum}`;
    chapterSelect.appendChild(opt);
  }

  if (chapters.length > 0) {
    chapterSelect.value = String(chapters[0].chapterNum);
  }
}

function renderCurrentChapter() {
  if (!parsedBook) {
    return;
  }

  if (currentViewState?.observer) {
    currentViewState.observer.disconnect();
  }

  const renderStart = performance.now();
  const chapterNum = Number(chapterSelect.value);
  const chapter = parsedBook.chapters.find((c) => c.chapterNum === chapterNum);

  viewer.replaceChildren();
  if (!chapter) {
    return;
  }

  const title = document.createElement("h2");
  title.className = "chapter-title";
  title.textContent = `${parsedBook.bookCode} ${chapter.chapterNum}`;
  viewer.appendChild(title);

  const verseByNumber = new Map(chapter.verses.map((v) => [v.verseNum, v]));
  const headingsBeforeVerse = chapter.headingsBeforeVerse || new Map();
  const fallbackTokenCount = chapter.verses.reduce((sum, v) => {
    let count = 0;
    for (const token of v.tokens) {
      if (token.type === "txt" && token.target) {
        count += 1;
      }
    }
    return sum + count;
  }, 0);

  const rowByVerseNum = new Map();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          hydrateVerseRow(entry.target, false);
          observer.unobserve(entry.target);
        }
      }
    },
    {
      root: null,
      rootMargin: "250px 0px",
      threshold: 0.01,
    },
  );

  currentViewState = {
    chapter,
    fallbackTokenCount,
    hydratedVerseCount: 0,
    totalVerses: chapter.verses.length,
    verseByNumber,
    rowByVerseNum,
    observer,
    renderMs: 0,
  };

  for (const verse of chapter.verses) {
    const sectionHeadings = headingsBeforeVerse.get(verse.verseNum) || [];
    for (const heading of sectionHeadings) {
      const headingNode = document.createElement("h3");
      headingNode.className = "section-heading";
      headingNode.textContent = heading;
      viewer.appendChild(headingNode);
    }

    const fragment = verseTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".verse-row");
    const verseNumNode = fragment.querySelector(".verse-num");
    const tokensNode = fragment.querySelector(".tokens");
    verseNumNode.textContent = String(verse.verseNum);

    row.dataset.verseNum = String(verse.verseNum);
    row.dataset.hydrated = "0";
    row._tokensNode = tokensNode;
    rowByVerseNum.set(verse.verseNum, row);

    viewer.appendChild(row);
    observer.observe(row);
  }

  for (const verse of chapter.verses.slice(0, 6)) {
    const row = rowByVerseNum.get(verse.verseNum);
    if (row) {
      hydrateVerseRow(row, false);
      observer.unobserve(row);
    }
  }

  currentViewState.renderMs = performance.now() - renderStart;
  updateStatus();

  function hydrateVerseRow(row, force) {
    const verseNum = Number(row.dataset.verseNum);
    if (!Number.isFinite(verseNum)) {
      return;
    }

    if (!force && row.dataset.hydrated === "1") {
      return;
    }

    const verse = verseByNumber.get(verseNum);
    if (!verse) {
      return;
    }

    const tokensContainer = row._tokensNode || row.querySelector(".tokens");
    tokensContainer.replaceChildren();

    for (const token of verse.tokens) {
      if (token.type === "rb") {
        const tokenNode = document.createElement("span");
        tokenNode.className = "token";
        tokenNode.dataset.tokenType = "rb";

        if (token.source) {
          const source = document.createElement("span");
          source.className = "source";
          source.textContent = token.source;
          tokenNode.appendChild(source);
        }

        if (token.target) {
          const target = document.createElement("span");
          target.className = "target";
          target.textContent = token.target;
          tokenNode.appendChild(target);
        }

        tokensContainer.appendChild(tokenNode);
      } else if (token.target) {
        const txtNode = document.createElement("span");
        txtNode.className = "target-only";
        txtNode.dataset.tokenType = "txt";
        txtNode.textContent = token.target;
        tokensContainer.appendChild(txtNode);
      }
    }

    if (row.dataset.hydrated !== "1") {
      currentViewState.hydratedVerseCount += 1;
      row.dataset.hydrated = "1";
      updateStatus();
    }
  }
}

function updateStatus() {
  if (!parsedBook) {
    return;
  }

  if (!currentViewState) {
    setStatus(`Loaded ${parsedBook.bookName}.`);
    return;
  }

  const chapterNum = currentViewState.chapter.chapterNum;
  const parts = [`Loaded ${parsedBook.bookName} ${chapterNum}.`];

  if (isDebugMode) {
    parts.push(`fallback text tokens: ${currentViewState.fallbackTokenCount}`);
  }

  if (isBenchmarkMode) {
    parts.push(`parse: ${parseMs.toFixed(1)}ms`);
    parts.push(`render shell: ${currentViewState.renderMs.toFixed(1)}ms`);
    parts.push(
      `hydrated verses: ${currentViewState.hydratedVerseCount}/${currentViewState.totalVerses}`,
    );
  }

  if (!showEnglish) {
    parts.push("English hidden");
  }

  setStatus(parts.join(" | "));
}

function setStatus(message) {
  statusText.textContent = message;
}
