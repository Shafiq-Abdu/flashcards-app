const API_BASE = "https://flashcards-app-ppop.onrender.com";
 // keep localhost for desktop. For phone later, change to your LAN IP.

const els = {
  navNew: document.getElementById("navNew"),
  navLibrary: document.getElementById("navLibrary"),

  deckName: document.getElementById("deckName"),
  fileInput: document.getElementById("fileInput"),
  notesInput: document.getElementById("notesInput"),
  cardCount: document.getElementById("cardCount"),
  difficulty: document.getElementById("difficulty"),
  style: document.getElementById("style"),
  generateBtn: document.getElementById("generateBtn"),
  clearBtn: document.getElementById("clearBtn"),
  status: document.getElementById("status"),

  deckMeta: document.getElementById("deckMeta"),
  progressBar: document.getElementById("progressBar"),
  counter: document.getElementById("counter"),
  flashcard: document.getElementById("flashcard"),
  cardContent: document.getElementById("cardContent"),
  sidePill: document.getElementById("sidePill"),

  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  flipBtn: document.getElementById("flipBtn"),
  shuffleBtn: document.getElementById("shuffleBtn"),

  saveBtn: document.getElementById("saveBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importInput: document.getElementById("importInput"),

  refreshLibraryBtn: document.getElementById("refreshLibraryBtn"),
  library: document.getElementById("library"),
};

let state = {
  deck: null, // {id, name, createdAt, settings, flashcards, stats}
  idx: 0,
  showingQuestion: true,
};

// ---------- Utilities ----------

function nowISO() { return new Date().toISOString(); }

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function setStatus(msg, isError=false){
  els.status.textContent = msg || "";
  els.status.style.color = isError ? "#b00020" : "#111";
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function shuffleArray(arr){
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Deck rendering ----------

function updateStudyUI(){
  if (!state.deck || !state.deck.flashcards?.length){
    els.flashcard.classList.add("hidden");
    els.counter.textContent = "No flashcards yet.";
    els.deckMeta.textContent = "No deck loaded.";
    els.progressBar.style.width = "0%";
    return;
  }

  const total = state.deck.flashcards.length;
  state.idx = clamp(state.idx, 0, total - 1);

  const card = state.deck.flashcards[state.idx];
  const side = state.showingQuestion ? "Question" : "Answer";
  const text = state.showingQuestion ? card.question : card.answer;

  els.sidePill.textContent = side;
  els.cardContent.textContent = text;
  els.flashcard.classList.remove("hidden");

  els.counter.textContent = `Card ${state.idx + 1} of ${total}`;
  els.progressBar.style.width = `${Math.round(((state.idx + 1) / total) * 100)}%`;

  const s = state.deck.settings;
  els.deckMeta.textContent =
    `${state.deck.name || "Untitled deck"} · ${total} cards · ${s.difficulty} · ${s.style} · target ${s.targetCount}`;
}

function nextCard(){
  if (!state.deck?.flashcards?.length) return;
  state.idx = (state.idx + 1) % state.deck.flashcards.length;
  state.showingQuestion = true;
  updateStudyUI();
}

function prevCard(){
  if (!state.deck?.flashcards?.length) return;
  state.idx = (state.idx - 1 + state.deck.flashcards.length) % state.deck.flashcards.length;
  state.showingQuestion = true;
  updateStudyUI();
}

function flipCard(){
  if (!state.deck?.flashcards?.length) return;
  state.showingQuestion = !state.showingQuestion;
  updateStudyUI();
}

// ---------- Local storage library ----------

const LS_KEY = "flashcards.decks.v1";

function loadAllDecks(){
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}

function saveAllDecks(decks){
  localStorage.setItem(LS_KEY, JSON.stringify(decks));
}

function upsertDeck(deck){
  const decks = loadAllDecks();
  const i = decks.findIndex(d => d.id === deck.id);
  if (i >= 0) decks[i] = deck;
  else decks.unshift(deck);
  saveAllDecks(decks);
}

function deleteDeck(id){
  const decks = loadAllDecks().filter(d => d.id !== id);
  saveAllDecks(decks);
}

function renderLibrary(){
  const decks = loadAllDecks();
  els.library.innerHTML = "";

  if (!decks.length){
    els.library.innerHTML = `<div class="muted">No saved decks.</div>`;
    return;
  }

  for (const d of decks){
    const el = document.createElement("div");
    el.className = "deck";

    const created = new Date(d.createdAt).toLocaleString();
    const count = d.flashcards?.length || 0;
    const meta = `${count} cards · ${created} · ${d.settings?.difficulty || "?"} · ${d.settings?.style || "?"}`;

    el.innerHTML = `
      <div>
        <div class="deck-title">${escapeHtml(d.name || "Untitled deck")}</div>
        <div class="deck-meta">${escapeHtml(meta)}</div>
      </div>
      <div class="deck-actions">
        <button class="btn" data-action="load" data-id="${d.id}">Load</button>
        <button class="btn" data-action="export" data-id="${d.id}">Export</button>
        <button class="btn" data-action="delete" data-id="${d.id}">Delete</button>
      </div>
    `;

    els.library.appendChild(el);
  }
}

function escapeHtml(s){
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function loadDeckById(id){
  const d = loadAllDecks().find(x => x.id === id);
  if (!d) return;
  state.deck = d;
  state.idx = 0;
  state.showingQuestion = true;
  setStatus(`Loaded deck: ${d.name || "Untitled"}`);
  updateStudyUI();
}

// ---------- Generate deck from backend ----------

async function generateDeck(){
  const name = els.deckName.value.trim() || "Untitled deck";
  const text = els.notesInput.value.trim();
  const files = els.fileInput.files;

  if (!text && (!files || files.length === 0)){
    setStatus("Paste notes or upload at least one file.", true);
    return;
  }

  const settings = {
    targetCount: parseInt(els.cardCount.value, 10),
    difficulty: els.difficulty.value,
    style: els.style.value,
  };

  els.generateBtn.disabled = true;
  setStatus("Generating…");

  try{
    const formData = new FormData();
    formData.append("extra_text", text);

    // These extra fields are future-proof: backend can use them later if you update prompt.
    formData.append("target_count", String(settings.targetCount));
    formData.append("difficulty", settings.difficulty);
    formData.append("style", settings.style);

    if (files && files.length){
      for (let i = 0; i < files.length; i++){
        formData.append("files", files[i]);
      }
    }

    const res = await fetch(`${API_BASE}/api/upload-and-generate`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok){
      const err = await res.json().catch(() => null);
      const msg = err?.detail || `Server error (${res.status})`;
      setStatus(msg, true);
      return;
    }

    const data = await res.json();
    const cards = data.flashcards || [];

    if (!cards.length){
      setStatus("No flashcards generated. Try a more detailed PDF/text.", true);
      return;
    }

    state.deck = {
      id: uid(),
      name,
      createdAt: nowISO(),
      settings,
      flashcards: cards,
      stats: { again: 0, hard: 0, good: 0, easy: 0 },
    };

    state.idx = 0;
    state.showingQuestion = true;

    setStatus(`Generated ${cards.length} flashcards.`);
    updateStudyUI();

  } catch (e){
    console.error(e);
    setStatus("Failed to contact backend. Is it running on 127.0.0.1:8000?", true);
  } finally {
    els.generateBtn.disabled = false;
  }
}

// ---------- Export / Import ----------

function downloadJSON(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCurrentDeck(){
  if (!state.deck){
    setStatus("Nothing to export (no deck loaded).", true);
    return;
  }
  const safe = (state.deck.name || "deck").replaceAll(/[^\w\- ]+/g, "").trim().replaceAll(" ", "_");
  downloadJSON(`${safe || "deck"}.json`, state.deck);
  setStatus("Exported deck JSON.");
}

// ---------- Wiring events ----------

els.generateBtn.addEventListener("click", generateDeck);

els.clearBtn.addEventListener("click", () => {
  els.deckName.value = "";
  els.fileInput.value = "";
  els.notesInput.value = "";
  setStatus("");
});

els.flashcard.addEventListener("click", flipCard);
els.flipBtn.addEventListener("click", flipCard);
els.nextBtn.addEventListener("click", nextCard);
els.prevBtn.addEventListener("click", prevCard);

els.shuffleBtn.addEventListener("click", () => {
  if (!state.deck?.flashcards?.length) return;
  state.deck.flashcards = shuffleArray(state.deck.flashcards);
  state.idx = 0;
  state.showingQuestion = true;
  setStatus("Shuffled deck.");
  updateStudyUI();
});

els.saveBtn.addEventListener("click", () => {
  if (!state.deck){
    setStatus("Nothing to save (no deck loaded).", true);
    return;
  }
  upsertDeck(state.deck);
  renderLibrary();
  setStatus("Saved to library.");
});

els.exportBtn.addEventListener("click", exportCurrentDeck);

els.importInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try{
    const text = await file.text();
    const deck = JSON.parse(text);

    // Minimal validation
    if (!deck?.flashcards?.length){
      setStatus("Invalid deck JSON: missing flashcards.", true);
      return;
    }
    if (!deck.id) deck.id = uid();
    if (!deck.createdAt) deck.createdAt = nowISO();

    upsertDeck(deck);
    renderLibrary();
    loadDeckById(deck.id);
    setStatus("Imported and loaded deck.");

  } catch {
    setStatus("Failed to import deck JSON.", true);
  } finally {
    els.importInput.value = "";
  }
});

els.refreshLibraryBtn.addEventListener("click", renderLibrary);

els.library.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "load") loadDeckById(id);
  if (action === "delete"){
    deleteDeck(id);
    renderLibrary();
    setStatus("Deleted deck.");
  }
  if (action === "export"){
    const d = loadAllDecks().find(x => x.id === id);
    if (!d) return;
    const safe = (d.name || "deck").replaceAll(/[^\w\- ]+/g, "").trim().replaceAll(" ", "_");
    downloadJSON(`${safe || "deck"}.json`, d);
    setStatus("Exported deck JSON.");
  }
});

els.navNew.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

els.navLibrary.addEventListener("click", () => {
  els.library.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Grade buttons (simple stats, no scheduling yet)
document.querySelectorAll(".grade .btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!state.deck) return;
    const g = btn.dataset.grade;
    state.deck.stats = state.deck.stats || { again:0, hard:0, good:0, easy:0 };
    if (state.deck.stats[g] !== undefined) state.deck.stats[g] += 1;
    // Simple behavior: if "again", don't advance; otherwise go next
    if (g !== "again") nextCard();
    setStatus(`Marked: ${g}`);
  });
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") nextCard();
  if (e.key === "ArrowLeft") prevCard();
  if (e.key === " "){
    e.preventDefault();
    flipCard();
  }
});

// Initialize
renderLibrary();
updateStudyUI();
