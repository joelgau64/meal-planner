import { useState, useEffect, useCallback, useRef } from "react";

const DB_RECETTES = "9b50c853-33c1-44f8-ac7c-69a575f3f143";
const DB_PLANNING = "93ddc644-acf0-4c22-9131-1a35c0cbbcf4";
const DB_COURSES = "2cc46964-341a-449f-ae67-520a85d9a65f";

const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MOMENTS = ["Petit-déjeuner", "Déjeuner", "Dîner", "Snack"];
const MOMENT_COLORS = { "Petit-déjeuner": "#F59E0B", "Déjeuner": "#3B82F6", "Dîner": "#8B5CF6", "Snack": "#10B981" };
const CAT_COLORS = { "Fruits & Légumes": "#16A34A", "Viandes & Poissons": "#DC2626", "Produits laitiers": "#2563EB", "Épicerie": "#EA580C", "Surgelés": "#7C3AED", "Boissons": "#0891B2", "Autre": "#6B7280" };
const EMPTY_FORM = { nom: "", categorie: "Dîner", temps: "", portions: 2, ingredients: "", instructions: "", tags: [], note: "***" };

// ── Session cache ─────────────────────────────────────────────────────────────
const cache = { recettes: null, planning: null, courses: null };
const cacheTime = { recettes: 0, planning: 0, courses: 0 };
const CACHE_TTL = 5 * 60 * 1000;
function getCached(key) { return cache[key] && Date.now() - cacheTime[key] < CACHE_TTL ? cache[key] : null; }
function setCache(key, data) { cache[key] = data; cacheTime[key] = Date.now(); }

// ── Notion API (direct, no Claude) ───────────────────────────────────────────
async function notionQuery(dbId, filter) {
  const body = filter ? { filter } : {};
  const res = await fetch(`/api/notion?path=/v1/databases/${dbId}/query`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function notionCreate(dbId, properties) {
  const res = await fetch(`/api/notion?path=/v1/pages`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parent: { database_id: dbId }, properties }),
  });
  return res.json();
}

async function notionUpdate(pageId, properties) {
  const res = await fetch(`/api/notion?path=/v1/pages/${pageId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ properties }),
  });
  return res.json();
}

// ── Notion property helpers ───────────────────────────────────────────────────
function notionText(s) { return { rich_text: [{ text: { content: String(s || "").slice(0, 2000) } }] }; }
function notionTitle(s) { return { title: [{ text: { content: String(s || "") } }] }; }
function notionNumber(n) { return { number: Number(n) || 0 }; }
function notionSelect(s) { return s ? { select: { name: String(s) } } : { select: null }; }
function notionDate(d) { return d ? { date: { start: d } } : { date: null }; }
function notionCheckbox(b) { return { checkbox: !!b }; }

function getTitle(page) {
  const t = page.properties;
  for (const key of Object.keys(t)) {
    if (t[key].type === "title" && t[key].title?.[0]?.plain_text) return t[key].title[0].plain_text;
  }
  return "";
}
function getText(prop) { return prop?.rich_text?.[0]?.plain_text || ""; }
function getSelect(prop) { return prop?.select?.name || ""; }
function getNumber(prop) { return prop?.number || 0; }
function getCheckbox(prop) { return prop?.checkbox || false; }
function getDate(prop) { return prop?.date?.start || null; }

function parseRecette(page) {
  const p = page.properties;
  return {
    id: page.id,
    nom: getTitle(page),
    categorie: getSelect(p["Catégorie"]),
    temps: getNumber(p["Temps de préparation"]),
    portions: getNumber(p["Portions"]),
    ingredients: getText(p["Ingrédients"]),
    instructions: getText(p["Instructions"]),
    note: getSelect(p["Note"]),
    likes: getNumber(p["Likes"]),
    dislikes: getNumber(p["Dislikes"]),
    fois_cuisinee: getNumber(p["Fois cuisinée"]),
    derniere_cuisson: getDate(p["Dernière cuisson"]),
  };
}

function parsePlanning(page) {
  const p = page.properties;
  return {
    id: page.id,
    repas: getTitle(page),
    date: getDate(p["Date"]),
    moment: getSelect(p["Moment"]),
    recette: getText(p["Recette"]),
    portions: getNumber(p["Portions"]),
    notes: getText(p["Notes"]),
    fait: getCheckbox(p["Acheté"]),
  };
}

function parseCourse(page) {
  const p = page.properties;
  return {
    id: page.id,
    article: getTitle(page),
    categorie: getSelect(p["Catégorie"]),
    quantite: getText(p["Quantité"]),
    achete: getCheckbox(p["Acheté"]),
    semaine: getText(p["Semaine"]),
  };
}

// ── Claude API (only for AI features) ────────────────────────────────────────
async function claudeJSON(system, user, withSearch = false) {
  const body = {
    model: "claude-sonnet-4-5", max_tokens: 1500,
    system, messages: [{ role: "user", content: user }],
  };
  if (withSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];
  const res = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return parseJSON((data.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
}

async function claudeVision(prompt, base64, mediaType) {
  const res = await fetch("/api/claude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 1500, system: "Tu es un chef cuisinier expert. Retourne UNIQUEMENT un JSON valide, sans backticks.", messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }] }),
  });
  const data = await res.json();
  return parseJSON((data.content || []).filter(b => b.type === "text").map(b => b.text).join(""));
}

function parseJSON(text) { try { return JSON.parse(text.replace(/```json\n?|```\n?/g, "").trim()); } catch { return null; } }

const RECIPE_JSON_PROMPT = `Retourne exactement ce JSON sans backticks:
{"nom":"nom du plat en français","categorie":"Déjeuner","temps":30,"portions":4,"ingredients":"liste avec quantités en g/ml","instructions":"étapes numérotées","tags":[],"note":"***"}`;

// ── Icons ─────────────────────────────────────────────────────────────────────
const Icon = ({ name, size = 18 }) => {
  const icons = {
    book: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
    calendar: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
    cart: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 001.99 1.61H19a2 2 0 001.99-1.82l1-9.58H6"/></svg>,
    plus: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>,
    check: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>,
    camera: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>,
    link: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>,
    sparkle: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="M5 3l.75 2.25L8 6l-2.25.75L5 9l-.75-2.25L2 6l2.25-.75z"/></svg>,
    edit: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>,
    close: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
    loader: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>,
    arrow: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>,
    thumb_up: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/><path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3" fill="none" stroke="currentColor" strokeWidth="2"/></svg>,
    thumb_down: <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17" fill="none" stroke="currentColor" strokeWidth="2"/></svg>,
    chef: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 13.87A4 4 0 017.41 6a5.11 5.11 0 0111.18 0A4 4 0 0118 13.87V21H6z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>,
    refresh: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>,
    sparkle2: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/></svg>,
    import: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  };
  return icons[name] || null;
};

// ── UI primitives ─────────────────────────────────────────────────────────────
function Spinner({ label = "Chargement..." }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 40, color: "#94A3B8" }}>
      <div style={{ animation: "spin 1s linear infinite" }}><Icon name="loader" size={28} /></div>
      <span style={{ fontSize: 13 }}>{label}</span>
    </div>
  );
}

function Toast({ message, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, background: "#1E293B", color: "#F8FAFC", padding: "12px 20px", borderRadius: 10, fontSize: 13, fontWeight: 500, zIndex: 1000, boxShadow: "0 8px 32px rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: "#4ADE80" }}><Icon name="check" size={16} /></span>{message}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }} onClick={onClose}>
      <div style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 16, width: "100%", maxWidth: wide ? 680 : 520, maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #1E293B", position: "sticky", top: 0, background: "#0F172A", zIndex: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#F8FAFC", fontFamily: "'Playfair Display', serif" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", padding: 4 }}><Icon name="close" /></button>
        </div>
        <div style={{ padding: 24 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = { width: "100%", background: "#1E293B", border: "1px solid #334155", borderRadius: 8, color: "#F8FAFC", padding: "10px 12px", fontSize: 14, boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
const btnPrimary = { padding: "12px", background: "#6366F1", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", width: "100%", marginTop: 8 };
const btnDisabled = { ...btnPrimary, background: "#1E293B", color: "#475569", cursor: "default" };

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return null;
  const color = score > 0 ? "#4ADE80" : score < 0 ? "#F87171" : "#64748B";
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}22`, padding: "2px 7px", borderRadius: 10 }}>{score > 0 ? `+${score}` : score}</span>;
}

function DaysSince({ date }) {
  if (!date) return <span style={{ fontSize: 11, color: "#475569" }}>jamais cuisiné</span>;
  const days = Math.floor((new Date() - new Date(date)) / 86400000);
  const color = days > 30 ? "#F59E0B" : days > 14 ? "#94A3B8" : "#4ADE80";
  return <span style={{ fontSize: 11, color }}>il y a {days}j</span>;
}

function RecipeForm({ form, setForm, saving, onSave, analyzing }) {
  const isReady = form.nom && !analyzing && !saving;
  return (
    <>
      <Field label="Nom"><input style={inputStyle} value={form.nom} onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} placeholder="Ex: Poulet rôti aux herbes" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Catégorie">
          <select style={inputStyle} value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
            {["Petit-déjeuner", "Déjeuner", "Dîner", "Snack", "Dessert"].map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
        <Field label="Note">
          <select style={inputStyle} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}>
            {["*", "**", "***", "****", "*****"].map(n => <option key={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Temps (min)"><input style={inputStyle} type="number" value={form.temps} onChange={e => setForm(f => ({ ...f, temps: e.target.value }))} placeholder="30" /></Field>
        <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e => setForm(f => ({ ...f, portions: e.target.value }))} /></Field>
      </div>
      <Field label="Ingrédients"><textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={form.ingredients} onChange={e => setForm(f => ({ ...f, ingredients: e.target.value }))} placeholder="200g poulet, 2 gousses d'ail..." /></Field>
      <Field label="Instructions"><textarea style={{ ...inputStyle, minHeight: 100, resize: "vertical" }} value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))} placeholder="1. Préchauffer le four..." /></Field>
      <button onClick={onSave} disabled={!isReady} style={isReady ? btnPrimary : btnDisabled}>
        {saving ? "Enregistrement..." : analyzing ? "Analyse en cours..." : "Sauvegarder"}
      </button>
    </>
  );
}

// ── Add Recipe Modal ──────────────────────────────────────────────────────────
const METHODS = [
  { id: "manual", label: "Saisie manuelle", icon: "edit", color: "#6366F1" },
  { id: "photo", label: "Photo", icon: "camera", color: "#F59E0B" },
  { id: "url", label: "URL", icon: "link", color: "#10B981" },
  { id: "ai", label: "Générer avec l'IA", icon: "sparkle", color: "#EC4899" },
  { id: "ingredients", label: "Par ingrédients", icon: "chef", color: "#14B8A6" },
];

function AddRecipeModal({ onClose, onSaved }) {
  const [method, setMethod] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [url, setUrl] = useState("");
  const [prompt, setPrompt] = useState("");
  const fileInputRef = useRef(null);

  const handlePhotoFile = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    setPhotoPreview(URL.createObjectURL(file));
    setAnalyzing(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(",")[1];
      const result = await claudeVision(RECIPE_JSON_PROMPT, base64, file.type);
      if (result) setForm(f => ({ ...f, ...result, tags: Array.isArray(result.tags) ? result.tags : f.tags }));
      setAnalyzing(false);
    };
    reader.readAsDataURL(file);
  };

  const fetchFromUrl = async () => {
    if (!url) return;
    setAnalyzing(true);
    const result = await claudeJSON(
      "Tu es un expert en recettes. Retourne UNIQUEMENT un JSON valide, sans backticks.",
      `Visite cette URL et extrais la recette en français avec mesures métriques: ${url}\n\n${RECIPE_JSON_PROMPT}`,
      true
    );
    if (result) setForm(f => ({ ...f, ...result, tags: Array.isArray(result.tags) ? result.tags : f.tags }));
    setAnalyzing(false);
  };

  const generateFromPrompt = async () => {
    if (!prompt) return;
    setAnalyzing(true);
    const isIngredients = method === "ingredients";
    const result = await claudeJSON(
      "Tu es un chef cuisinier créatif français. Retourne UNIQUEMENT un JSON valide, sans backticks.",
      isIngredients
        ? `L'utilisateur a ces ingrédients: "${prompt}". Propose une recette créative qui les utilise.\n\n${RECIPE_JSON_PROMPT}`
        : `Génère une recette pour: "${prompt}"\n\n${RECIPE_JSON_PROMPT}`
    );
    if (result) setForm(f => ({ ...f, ...result, tags: Array.isArray(result.tags) ? result.tags : f.tags }));
    setAnalyzing(false);
  };

  const save = async () => {
    setSaving(true);
    await notionCreate(DB_RECETTES, {
      "Nom": notionTitle(form.nom),
      "Catégorie": notionSelect(form.categorie),
      "Temps de préparation": notionNumber(form.temps),
      "Portions": notionNumber(form.portions),
      "Ingrédients": notionText(form.ingredients),
      "Instructions": notionText(form.instructions),
      "Note": notionSelect(form.note),
      "Likes": notionNumber(0),
      "Dislikes": notionNumber(0),
      "Fois cuisinée": notionNumber(0),
    });
    setSaving(false);
    setCache("recettes", null); // invalidate
    onSaved("Recette ajoutée ✓");
    onClose();
  };

  if (!method) {
    return (
      <Modal title="Nouvelle recette" onClose={onClose}>
        <p style={{ color: "#64748B", fontSize: 13, marginBottom: 20, marginTop: 0 }}>Comment veux-tu ajouter cette recette ?</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          {METHODS.map(m => (
            <button key={m.id} onClick={() => setMethod(m.id)}
              style={{ padding: "18px 12px", background: "#0A0F1E", border: "1px solid #1E293B", borderRadius: 12, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = m.color; e.currentTarget.style.background = `${m.color}11`; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E293B"; e.currentTarget.style.background = "#0A0F1E"; }}>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${m.color}22`, display: "flex", alignItems: "center", justifyContent: "center", color: m.color }}><Icon name={m.icon} size={18} /></div>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#F8FAFC", textAlign: "center" }}>{m.label}</span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  const backBtn = <button onClick={() => setMethod(null)} style={{ background: "none", border: "none", color: "#6366F1", fontSize: 12, cursor: "pointer", marginBottom: 16, padding: 0 }}>← Changer de méthode</button>;

  if (method === "photo") {
    return (
      <Modal title="Recette depuis une photo" onClose={onClose} wide>
        {backBtn}
        <div onClick={() => fileInputRef.current?.click()}
          onDrop={e => { e.preventDefault(); handlePhotoFile(e.dataTransfer.files[0]); }}
          onDragOver={e => e.preventDefault()}
          style={{ marginBottom: 20, borderRadius: 12, overflow: "hidden", cursor: "pointer", border: `2px dashed ${photoPreview ? "#F59E0B" : "#1E293B"}`, background: "#0A0F1E" }}>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhotoFile(e.target.files[0])} />
          {photoPreview ? (
            <div style={{ position: "relative" }}>
              <img src={photoPreview} alt="preview" style={{ width: "100%", height: 180, objectFit: "cover", display: "block" }} />
              {analyzing && <div style={{ position: "absolute", inset: 0, background: "rgba(2,6,23,0.8)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12 }}><div style={{ animation: "spin 1s linear infinite", color: "#F59E0B" }}><Icon name="loader" size={24} /></div><span style={{ color: "#FDE68A", fontSize: 13, fontWeight: 600 }}>Analyse...</span></div>}
              {!analyzing && <div style={{ position: "absolute", bottom: 8, left: 8, background: "#4ADE80", borderRadius: 20, padding: "4px 12px", fontSize: 11, fontWeight: 700, color: "#022c22" }}>✓ Recette reconnue</div>}
            </div>
          ) : (
            <div style={{ padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, textAlign: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#1E293B", display: "flex", alignItems: "center", justifyContent: "center", color: "#F59E0B" }}><Icon name="camera" size={22} /></div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#94A3B8" }}>Photo du plat ou d'un livre de recette</div>
              <div style={{ fontSize: 11, color: "#475569" }}>Cliquer ou glisser-déposer</div>
            </div>
          )}
        </div>
        {(photoPreview && !analyzing) && <RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing} />}
      </Modal>
    );
  }

  if (method === "url") {
    return (
      <Modal title="Recette depuis une URL" onClose={onClose} wide>
        {backBtn}
        <Field label="URL de la recette">
          <div style={{ display: "flex", gap: 8 }}>
            <input style={{ ...inputStyle, flex: 1 }} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.marmiton.org/..." />
            <button onClick={fetchFromUrl} disabled={!url || analyzing}
              style={{ padding: "10px 16px", background: url && !analyzing ? "#10B981" : "#1E293B", border: "none", borderRadius: 8, color: url && !analyzing ? "#fff" : "#475569", fontWeight: 600, fontSize: 13, cursor: url && !analyzing ? "pointer" : "default", whiteSpace: "nowrap" }}>
              {analyzing ? <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}><Icon name="loader" size={14} /></span> : "Extraire"}
            </button>
          </div>
        </Field>
        {form.nom && <RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing} />}
      </Modal>
    );
  }

  if (method === "ai" || method === "ingredients") {
    const color = method === "ai" ? "#EC4899" : "#14B8A6";
    const placeholder = method === "ai" ? "Ex: pasta crémeuse au saumon fumé, rapide..." : "Ex: j'ai des courgettes, du parmesan et des pâtes...";
    const suggestions = method === "ai"
      ? ["Repas rapide pour 2", "Dessert chocolat", "Végétarien équilibré", "Plat d'hiver réconfortant"]
      : ["poulet + riz", "saumon + crème", "aubergines + tomates", "œufs + fromage"];
    return (
      <Modal title={method === "ai" ? "Générer avec l'IA" : "Recherche par ingrédients"} onClose={onClose} wide>
        {backBtn}
        <Field label={method === "ai" ? "Décris la recette" : "Quels ingrédients as-tu ?"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={placeholder} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {suggestions.map(s => (
                <button key={s} onClick={() => setPrompt(method === "ingredients" ? `J'ai ${s}` : s)}
                  style={{ padding: "5px 12px", borderRadius: 16, fontSize: 11, cursor: "pointer", border: "1px solid #334155", background: "transparent", color: "#64748B" }}>{s}</button>
              ))}
            </div>
            <button onClick={generateFromPrompt} disabled={!prompt || analyzing}
              style={{ padding: "11px 16px", background: prompt && !analyzing ? color : "#1E293B", border: "none", borderRadius: 8, color: prompt && !analyzing ? "#fff" : "#475569", fontWeight: 600, fontSize: 13, cursor: prompt && !analyzing ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {analyzing ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}><Icon name="loader" size={14} /></span> Génération...</> : <><Icon name="sparkle" size={14} /> Générer</>}
            </button>
          </div>
        </Field>
        {form.nom && <RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={analyzing} />}
      </Modal>
    );
  }

  return (
    <Modal title="Saisie manuelle" onClose={onClose} wide>
      {backBtn}
      <RecipeForm form={form} setForm={setForm} saving={saving} onSave={save} analyzing={false} />
    </Modal>
  );
}

// ── Recettes Tab ──────────────────────────────────────────────────────────────
function RecettesTab({ toast }) {
  const [recettes, setRecettes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("Toutes");
  const [sortBy, setSortBy] = useState("score");
  const [voting, setVoting] = useState(null);

  const load = useCallback(async (force = false) => {
    const cached = getCached("recettes");
    if (cached && !force) { setRecettes(cached); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await notionQuery(DB_RECETTES);
      const parsed = (data.results || []).map(parseRecette);
      setRecettes(parsed);
      setCache("recettes", parsed);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const vote = async (r, type) => {
    setVoting(r.id + type);
    const field = type === "up" ? "Likes" : "Dislikes";
    const current = type === "up" ? (r.likes || 0) : (r.dislikes || 0);
    const updated = recettes.map(x => x.id === r.id ? { ...x, [type === "up" ? "likes" : "dislikes"]: current + 1 } : x);
    setRecettes(updated);
    setCache("recettes", updated);
    if (selected?.id === r.id) setSelected(prev => ({ ...prev, [type === "up" ? "likes" : "dislikes"]: current + 1 }));
    notionUpdate(r.id, { [field]: notionNumber(current + 1) }); // fire and forget
    setVoting(null);
  };

  const score = r => (r.likes || 0) - (r.dislikes || 0);
  const cats = ["Toutes", "Petit-déjeuner", "Déjeuner", "Dîner", "Snack", "Dessert"];
  const sorted = [...recettes]
    .filter(r => filter === "Toutes" || r.categorie === filter)
    .sort((a, b) => {
      if (sortBy === "score") return score(b) - score(a);
      if (sortBy === "cuisinee") return (b.fois_cuisinee || 0) - (a.fois_cuisinee || 0);
      if (sortBy === "recent") {
        if (!a.derniere_cuisson) return 1;
        if (!b.derniere_cuisson) return -1;
        return new Date(a.derniere_cuisson) - new Date(b.derniere_cuisson);
      }
      return 0;
    });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {cats.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: "1px solid", borderColor: filter === c ? "#6366F1" : "#1E293B", background: filter === c ? "#6366F1" : "transparent", color: filter === c ? "#fff" : "#94A3B8" }}>{c}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "6px 10px" }}>
            <option value="score">Score</option>
            <option value="cuisinee">Plus cuisinée</option>
            <option value="recent">À refaire</option>
          </select>
          <button onClick={() => load(true)} title="Rafraîchir" style={{ padding: "8px 10px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, color: "#64748B", cursor: "pointer" }}><Icon name="refresh" size={14} /></button>
          <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "#6366F1", border: "none", borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            <Icon name="plus" size={16} /> Nouvelle
          </button>
        </div>
      </div>

      {loading ? <Spinner label="Chargement des recettes..." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
          {sorted.length === 0 && <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 48, color: "#475569" }}><div style={{ fontSize: 40, marginBottom: 12 }}>📖</div><div style={{ fontSize: 14 }}>Aucune recette.</div></div>}
          {sorted.map((r, i) => (
            <div key={i} style={{ background: "#0F172A", border: "1px solid #1E293B", borderRadius: 12, padding: 16, cursor: "pointer", transition: "border-color 0.15s, transform 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "#6366F1"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1E293B"; e.currentTarget.style.transform = "translateY(0)"; }}>
              <div onClick={() => setSelected(r)} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#F8FAFC", fontFamily: "'Playfair Display', serif", lineHeight: 1.3, flex: 1, marginRight: 8 }}>{r.nom || "Sans titre"}</h4>
                  <ScoreBadge score={score(r)} />
                </div>
                {r.categorie && <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 4, background: "#1E293B", color: "#94A3B8" }}>{r.categorie}</span>}
                <div style={{ marginTop: 8, display: "flex", gap: 10, fontSize: 11, color: "#64748B", flexWrap: "wrap" }}>
                  {r.temps > 0 && <span>⏱ {r.temps} min</span>}
                  {r.fois_cuisinee > 0 && <span>🍳 {r.fois_cuisinee}x</span>}
                  <DaysSince date={r.derniere_cuisson} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, borderTop: "1px solid #1E293B", paddingTop: 10 }} onClick={e => e.stopPropagation()}>
                <button onClick={() => vote(r, "up")} disabled={voting === r.id + "up"}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "6px", background: "#0A2010", border: "1px solid #166534", borderRadius: 6, color: "#4ADE80", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  <Icon name="thumb_up" size={13} /> {r.likes || 0}
                </button>
                <button onClick={() => vote(r, "down")} disabled={voting === r.id + "down"}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "6px", background: "#1C0A0A", border: "1px solid #991B1B", borderRadius: 6, color: "#F87171", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>
                  <Icon name="thumb_down" size={13} /> {r.dislikes || 0}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && <AddRecipeModal onClose={() => setShowAdd(false)} onSaved={(msg) => { toast(msg); load(true); }} />}

      {selected && (
        <Modal title={selected.nom} onClose={() => setSelected(null)} wide>
          <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
            {selected.categorie && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "#1E293B", color: "#94A3B8" }}>{selected.categorie}</span>}
            {selected.temps > 0 && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "#1E293B", color: "#94A3B8" }}>⏱ {selected.temps} min</span>}
            {selected.portions > 0 && <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, background: "#1E293B", color: "#94A3B8" }}>🍽 {selected.portions} p.</span>}
            <ScoreBadge score={score(selected)} />
            {selected.fois_cuisinee > 0 && <span style={{ fontSize: 12, color: "#64748B" }}>🍳 {selected.fois_cuisinee}x</span>}
            <DaysSince date={selected.derniere_cuisson} />
          </div>
          {selected.ingredients && <>
            <h5 style={{ color: "#6366F1", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Ingrédients</h5>
            <p style={{ color: "#CBD5E1", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 16 }}>{selected.ingredients}</p>
          </>}
          {selected.instructions && <>
            <h5 style={{ color: "#6366F1", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Instructions</h5>
            <p style={{ color: "#CBD5E1", fontSize: 13, lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{selected.instructions}</p>
          </>}
          <div style={{ display: "flex", gap: 8, marginTop: 20, borderTop: "1px solid #1E293B", paddingTop: 16 }}>
            <button onClick={() => vote(selected, "up")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px", background: "#0A2010", border: "1px solid #166534", borderRadius: 8, color: "#4ADE80", cursor: "pointer", fontWeight: 600 }}>
              <Icon name="thumb_up" size={16} /> J'aime ({selected.likes || 0})
            </button>
            <button onClick={() => vote(selected, "down")} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px", background: "#1C0A0A", border: "1px solid #991B1B", borderRadius: 8, color: "#F87171", cursor: "pointer", fontWeight: 600 }}>
              <Icon name="thumb_down" size={16} /> Pas fan ({selected.dislikes || 0})
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Planning Tab ──────────────────────────────────────────────────────────────
function PlanningTab({ toast }) {
  const [planning, setPlanning] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], moment: "Dîner", recette: "", portions: 2, notes: "" });
  const [saving, setSaving] = useState(false);
  const [weekOffset, setWeekOffset] = useState(0);
  const [confirming, setConfirming] = useState(null);

  const getWeekDates = (offset = 0) => {
    const now = new Date(); const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
  };
  const weekDates = getWeekDates(weekOffset);

  const load = useCallback(async (force = false) => {
    const cached = getCached("planning");
    if (cached && !force) { setPlanning(cached); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await notionQuery(DB_PLANNING);
      const parsed = (data.results || []).map(parsePlanning);
      setPlanning(parsed);
      setCache("planning", parsed);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [weekOffset]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    await notionCreate(DB_PLANNING, {
      "Repas": notionTitle(form.recette),
      "Date": notionDate(form.date),
      "Moment": notionSelect(form.moment),
      "Recette": notionText(form.recette),
      "Portions": notionNumber(form.portions),
      "Notes": notionText(form.notes),
    });
    toast("Repas ajouté ✓");
    setSaving(false);
    setShowForm(false);
    setCache("planning", null);
    load(true);
  };

  const confirmCuisine = async (meal) => {
    setConfirming(meal.id);
    const today = new Date().toISOString().split("T")[0];
    const updated = planning.map(p => p.id === meal.id ? { ...p, fait: true } : p);
    setPlanning(updated);
    setCache("planning", updated);
    notionUpdate(meal.id, { "Acheté": notionCheckbox(true) });
    toast(`"${meal.recette}" marqué comme cuisiné ✓`);
    setConfirming(null);
  };

  const isToday = d => d.toDateString() === new Date().toDateString();
  const isPast = d => d < new Date() && !isToday(d);
  const getMeals = date => planning.filter(p => p.date === date.toISOString().split("T")[0]);
  const weekLabel = () => ({ 0: "Cette semaine", 1: "Semaine prochaine", "-1": "Semaine dernière" }[weekOffset] || `Sem. ${weekOffset > 0 ? "+" : ""}${weekOffset}`);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={() => setWeekOffset(w => w - 1)} style={{ background: "#1E293B", border: "none", borderRadius: 6, color: "#94A3B8", cursor: "pointer", padding: "6px 10px", transform: "rotate(180deg)" }}><Icon name="arrow" size={16} /></button>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#F8FAFC" }}>{weekLabel()}</span>
          <button onClick={() => setWeekOffset(w => w + 1)} style={{ background: "#1E293B", border: "none", borderRadius: 6, color: "#94A3B8", cursor: "pointer", padding: "6px 10px" }}><Icon name="arrow" size={16} /></button>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => load(true)} style={{ padding: "8px 10px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, color: "#64748B", cursor: "pointer" }}><Icon name="refresh" size={14} /></button>
          <button onClick={() => setShowForm(true)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "#6366F1", border: "none", borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            <Icon name="plus" size={16} /> Ajouter
          </button>
        </div>
      </div>

      {loading ? <Spinner label="Chargement du planning..." /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
          {weekDates.map((date, i) => {
            const meals = getMeals(date); const today = isToday(date); const past = isPast(date);
            return (
              <div key={i} style={{ background: today ? "#1E1B4B" : "#0F172A", border: `1px solid ${today ? "#6366F1" : "#1E293B"}`, borderRadius: 10, padding: 10, minHeight: 130, opacity: past ? 0.7 : 1 }}>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: today ? "#A5B4FC" : "#64748B", textTransform: "uppercase" }}>{DAYS[i].slice(0, 3)}</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: today ? "#6366F1" : "#F8FAFC", fontFamily: "'Playfair Display', serif" }}>{date.getDate()}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {meals.length === 0 && <div style={{ fontSize: 11, color: "#334155" }}>—</div>}
                  {meals.map((m, j) => (
                    <div key={j} style={{ borderRadius: 6, overflow: "hidden" }}>
                      <div style={{ padding: "4px 7px", fontSize: 11, fontWeight: 600, background: `${MOMENT_COLORS[m.moment] || "#64748B"}22`, color: MOMENT_COLORS[m.moment] || "#94A3B8", lineHeight: 1.3, textDecoration: m.fait ? "line-through" : "none", opacity: m.fait ? 0.5 : 1 }}>
                        <div style={{ fontSize: 9, opacity: 0.8, marginBottom: 1 }}>{m.moment}</div>
                        {m.recette || m.repas}
                      </div>
                      {(today || past) && !m.fait && (
                        <button onClick={() => confirmCuisine(m)} disabled={confirming === m.id}
                          style={{ width: "100%", padding: "3px", background: "#064E3B", border: "none", color: "#34D399", fontSize: 10, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <Icon name="chef" size={9} /> Cuisiné !
                        </button>
                      )}
                      {m.fait && <div style={{ padding: "2px 7px", background: "#064E3B", fontSize: 9, color: "#34D399", fontWeight: 700 }}>✓ fait</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <Modal title="Ajouter au planning" onClose={() => setShowForm(false)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Date"><input style={inputStyle} type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></Field>
            <Field label="Moment">
              <select style={inputStyle} value={form.moment} onChange={e => setForm(f => ({ ...f, moment: e.target.value }))}>
                {MOMENTS.map(m => <option key={m}>{m}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Recette / Plat"><input style={inputStyle} value={form.recette} onChange={e => setForm(f => ({ ...f, recette: e.target.value }))} placeholder="Ex: Poulet rôti" /></Field>
          <Field label="Portions"><input style={inputStyle} type="number" value={form.portions} onChange={e => setForm(f => ({ ...f, portions: e.target.value }))} /></Field>
          <Field label="Notes"><input style={inputStyle} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optionnel..." /></Field>
          <button onClick={save} disabled={saving || !form.recette} style={form.recette ? btnPrimary : btnDisabled}>{saving ? "Enregistrement..." : "Ajouter"}</button>
        </Modal>
      )}
    </div>
  );
}

// ── Courses Tab ───────────────────────────────────────────────────────────────
function CoursesTab({ toast }) {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ article: "", categorie: "Épicerie", quantite: "", semaine: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (force = false) => {
    const cached = getCached("courses");
    if (cached && !force) { setCourses(cached); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await notionQuery(DB_COURSES);
      const parsed = (data.results || []).map(parseCourse);
      setCourses(parsed);
      setCache("courses", parsed);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleAchete = async (item) => {
    const newVal = !item.achete;
    const updated = courses.map(c => c.id === item.id ? { ...c, achete: newVal } : c);
    setCourses(updated);
    setCache("courses", updated);
    notionUpdate(item.id, { "Acheté": notionCheckbox(newVal) }); // fire and forget
  };

  const addItem = async () => {
    setSaving(true);
    await notionCreate(DB_COURSES, {
      "Article": notionTitle(form.article),
      "Catégorie": notionSelect(form.categorie),
      "Quantité": notionText(form.quantite),
      "Acheté": notionCheckbox(false),
      "Semaine": notionText(form.semaine),
    });
    toast("Article ajouté ✓");
    setSaving(false);
    setShowForm(false);
    setForm({ article: "", categorie: "Épicerie", quantite: "", semaine: "" });
    setCache("courses", null);
    load(true);
  };

  const grouped = courses.reduce((acc, c) => { const cat = c.categorie || "Autre"; if (!acc[cat]) acc[cat] = []; acc[cat].push(c); return acc; }, {});
  const total = courses.length; const done = courses.filter(c => c.achete).length;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {total > 0 && <>
            <div style={{ background: "#1E293B", borderRadius: 20, height: 6, width: 120, overflow: "hidden" }}>
              <div style={{ background: "#4ADE80", height: "100%", width: `${(done / total) * 100}%`, borderRadius: 20, transition: "width 0.3s" }} />
            </div>
            <span style={{ fontSize: 12, color: "#64748B" }}>{done}/{total}</span>
          </>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => load(true)} style={{ padding: "8px 10px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, color: "#64748B", cursor: "pointer" }}><Icon name="refresh" size={14} /></button>
          <button onClick={() => setShowForm(true)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", background: "#6366F1", border: "none", borderRadius: 8, color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
            <Icon name="plus" size={16} /> Ajouter
          </button>
        </div>
      </div>

      {loading ? <Spinner label="Chargement des courses..." /> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {Object.keys(grouped).length === 0 && <div style={{ textAlign: "center", padding: 48, color: "#475569" }}><div style={{ fontSize: 40, marginBottom: 12 }}>🛒</div><div style={{ fontSize: 14 }}>Liste vide.</div></div>}
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: CAT_COLORS[cat] || "#6B7280" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.1em" }}>{cat}</span>
              </div>
              {items.map((item, j) => (
                <div key={j} onClick={() => toggleAchete(item)}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: "#0F172A", border: "1px solid #1E293B", borderRadius: 8, cursor: "pointer", opacity: item.achete ? 0.5 : 1, marginBottom: 4, transition: "opacity 0.2s" }}>
                  <div style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${item.achete ? "#4ADE80" : "#334155"}`, background: item.achete ? "#4ADE80" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {item.achete && <Icon name="check" size={12} />}
                  </div>
                  <span style={{ flex: 1, fontSize: 14, color: "#F8FAFC", textDecoration: item.achete ? "line-through" : "none" }}>{item.article}</span>
                  {item.quantite && <span style={{ fontSize: 12, color: "#64748B" }}>{item.quantite}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal title="Ajouter un article" onClose={() => setShowForm(false)}>
          <Field label="Article"><input style={inputStyle} value={form.article} onChange={e => setForm(f => ({ ...f, article: e.target.value }))} placeholder="Ex: Tomates" /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Catégorie">
              <select style={inputStyle} value={form.categorie} onChange={e => setForm(f => ({ ...f, categorie: e.target.value }))}>
                {Object.keys(CAT_COLORS).map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Quantité"><input style={inputStyle} value={form.quantite} onChange={e => setForm(f => ({ ...f, quantite: e.target.value }))} placeholder="500g..." /></Field>
          </div>
          <Field label="Semaine"><input style={inputStyle} value={form.semaine} onChange={e => setForm(f => ({ ...f, semaine: e.target.value }))} placeholder="Ex: Semaine du 3 juin" /></Field>
          <button onClick={addItem} disabled={saving || !form.article} style={form.article ? btnPrimary : btnDisabled}>{saving ? "Ajout..." : "Ajouter à la liste"}</button>
        </Modal>
      )}
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("recettes");
  const [toastMsg, setToastMsg] = useState(null);
  const toast = msg => setToastMsg(msg);
  const tabs = [{ id: "recettes", label: "Recettes", icon: "book" }, { id: "planning", label: "Planning", icon: "calendar" }, { id: "courses", label: "Courses", icon: "cart" }];

  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#F8FAFC", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: #0F172A; } ::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        select option { background: #1E293B; }
      `}</style>
      <div style={{ borderBottom: "1px solid #0F172A", padding: "0 24px", background: "#020617", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0" }}>
            <span style={{ fontSize: 22 }}>🍽️</span>
            <span style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Playfair Display', serif", background: "linear-gradient(135deg, #F8FAFC, #94A3B8)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Meal Planner</span>
          </div>
          <nav style={{ display: "flex", gap: 2 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 8, background: tab === t.id ? "#1E293B" : "transparent", border: "none", color: tab === t.id ? "#F8FAFC" : "#64748B", fontWeight: tab === t.id ? 700 : 500, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>
                <Icon name={t.icon} size={15} /> {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
        {tab === "recettes" && <RecettesTab toast={toast} />}
        {tab === "planning" && <PlanningTab toast={toast} />}
        {tab === "courses" && <CoursesTab toast={toast} />}
      </div>
      {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </div>
  );
}
