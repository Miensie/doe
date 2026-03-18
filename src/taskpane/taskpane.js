/**
 * ================================================================
 * taskpane.js — Orchestrateur DOE·AI Add-in
 * [MODIF] Support des facteurs qualitatifs (nominaux)
 * ================================================================
 */
import "./taskpane.css";
import "../modules/doeEngine.js";
import "../modules/doeCharts.js";
import "../modules/doeExcel.js";
import "../modules/doeGemini.js";
import "../modules/doeReport.js";

// ─── État global ─────────────────────────────────────────────────────────────
const APP = {
  // [MODIF] chaque facteur peut maintenant avoir :
  //   type: "quantitative" | "qualitative"
  //   categories: ["A","B","C"]  (si type === "qualitative")
  factors:    [],
  doeType:    "ccd",
  centerPts:  3,
  goal:       "maximize",
  target:     null,
  matrix:     null,
  responses:  null,
  analysis:   null,
  optimRes:   null,
  aiText:     "",
  charts:     {},
  doeInfo:    {},
};

// ─── Init ────────────────────────────────────────────────────────────────────
Office.onReady(info => {
  if (info.host !== Office.HostType.Excel) {
    setStatus("⚠ Excel requis");
    return;
  }
  setupNav();
  setupDesignPanel();
  setupMatrixPanel();
  setupAnalysisPanel();
  setupChartsPanel();
  setupOptimPanel();
  setupReportPanel();
  DOEGemini.loadApiKey();
  // Initialiser avec 3 facteurs par défaut (tous quantitatifs)
  addFactor("Température", "quantitative", 40, 80, []);
  addFactor("pH",          "quantitative", 3,  7,  []);
  addFactor("Temps (min)", "quantitative", 10, 30, []);
  setStatus("DOE·AI v1.0 prêt ✓");
  log("Prêt. Définissez vos facteurs et générez le plan.", "info");
});

// ─── Navigation ──────────────────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll(".ntab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".ntab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.panel)?.classList.add("active");
    });
  });
}

// ─── PANEL : FACTEURS ────────────────────────────────────────────────────────
function setupDesignPanel() {
  document.getElementById("doe-type").addEventListener("change", e => {
    APP.doeType = e.target.value;
    // [MODIF] Avertir si CCD/BBD avec qualitatifs multi-niveaux
    const hasMultiQual = APP.factors.some(
      f => f.type === "qualitative" && f.categories.length > 2
    );
    if (hasMultiQual && (APP.doeType === "ccd" || APP.doeType === "bbd")) {
      toast("⚠ CCD/BBD avec facteurs qualitatifs > 2 niveaux : points axiaux ignorés pour ces facteurs.", "warn");
    }
  });
  document.getElementById("opt-goal").addEventListener("change", e => {
    APP.goal = e.target.value;
    document.getElementById("target-row").style.display =
      e.target.value === "target" ? "flex" : "none";
  });
  document.getElementById("btn-add-factor").addEventListener("click", () =>
    addFactor("", "quantitative", 0, 100, [])
  );
  document.getElementById("btn-generate").addEventListener("click", handleGenerate);
  document.getElementById("btn-demo").addEventListener("click", handleDemo);
}

/**
 * [MODIF] addFactor accepte maintenant type et categories
 */
function addFactor(name, type, min, max, categories) {
  APP.factors.push({
    name:       name || "",
    type:       type || "quantitative",
    min:        min ?? 0,
    max:        max ?? 100,
    levels:     2,
    categories: categories || [],
  });
  renderFactors();
}

/**
 * [MODIF] renderFactors : affiche un sélecteur de type + champs conditionnels
 */
function renderFactors() {
  const list = document.getElementById("factors-list");
  list.innerHTML = APP.factors.map((f, i) => {
    const isQual = f.type === "qualitative";
    return `
    <div class="factor-row" data-idx="${i}">
      <div class="fnum">F${i+1}</div>

      <input type="text" class="f-name" value="${f.name}" placeholder="Nom du facteur"/>

      <!-- [MODIF] Sélecteur de type -->
      <select class="f-type sel" title="Type de facteur">
        <option value="quantitative" ${!isQual ? "selected" : ""}>Quantitatif</option>
        <option value="qualitative"  ${isQual  ? "selected" : ""}>Qualitatif</option>
      </select>

      <!-- Champs quantitatifs -->
      <div class="f-quant-fields" style="display:${isQual ? "none" : "contents"}">
        <input type="number" class="f-min" value="${f.min}" placeholder="Min"/>
        <input type="number" class="f-max" value="${f.max}" placeholder="Max"/>
      </div>

      <!-- [MODIF] Champs qualitatifs -->
      <div class="f-qual-fields" style="display:${isQual ? "contents" : "none"}">
        <input type="text" class="f-categories"
          value="${(f.categories || []).join(", ")}"
          placeholder="Ex : A, B, C  (séparés par virgule)"
          title="Modalités du facteur qualitatif, séparées par des virgules"
          style="flex:2"/>
        <span class="f-qual-hint" style="font-size:9px;color:var(--slate-400);align-self:center;white-space:nowrap">
          ${f.categories.length} niveaux
        </span>
      </div>

      <button class="btn-rm" data-rm="${i}" title="Supprimer">✕</button>
    </div>`;
  }).join("");

  // ── Listeners ──────────────────────────────────────────────────────────────

  list.querySelectorAll(".f-name").forEach((el, i) => {
    el.addEventListener("input", e => { APP.factors[i].name = e.target.value; });
  });

  // [MODIF] Listener sur le sélecteur de type → re-render
  list.querySelectorAll(".f-type").forEach((el, i) => {
    el.addEventListener("change", e => {
      APP.factors[i].type = e.target.value;
      if (e.target.value === "quantitative") {
        APP.factors[i].categories = [];
      } else {
        // Initialiser avec 2 modalités par défaut si vide
        if (!APP.factors[i].categories.length) {
          APP.factors[i].categories = ["Niveau 1", "Niveau 2"];
        }
      }
      renderFactors();
    });
  });

  list.querySelectorAll(".f-min").forEach((el, i) => {
    el.addEventListener("input", e => { APP.factors[i].min = parseFloat(e.target.value) || 0; });
  });
  list.querySelectorAll(".f-max").forEach((el, i) => {
    el.addEventListener("input", e => { APP.factors[i].max = parseFloat(e.target.value) || 100; });
  });

  // [MODIF] Listener sur les modalités textuelles
  list.querySelectorAll(".f-categories").forEach((el, i) => {
    el.addEventListener("input", e => {
      const cats = e.target.value
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
      APP.factors[i].categories = cats;
      // min/max virtuels pour compatibilité (index de modalité)
      APP.factors[i].min = 0;
      APP.factors[i].max = Math.max(cats.length - 1, 1);
      // Mettre à jour le compteur de niveaux sans re-render complet
      const hint = el.parentElement.querySelector(".f-qual-hint");
      if (hint) hint.textContent = `${cats.length} niveau${cats.length > 1 ? "x" : ""}`;
    });
  });

  list.querySelectorAll("[data-rm]").forEach(btn => {
    btn.addEventListener("click", e => {
      APP.factors.splice(parseInt(e.target.dataset.rm), 1);
      renderFactors();
    });
  });
}

function readFactorsFromUI() {
  APP.doeType   = document.getElementById("doe-type").value;
  APP.centerPts = parseInt(document.getElementById("center-pts").value) || 0;
  APP.goal      = document.getElementById("opt-goal").value;
  APP.target    = parseFloat(document.getElementById("opt-target").value) || null;
}

/**
 * [MODIF] handleGenerate : validation distincte quant/qual
 */
async function handleGenerate() {
  readFactorsFromUI();

  // Validation
  const valid = APP.factors.filter(f => {
    if (!f.name.trim()) return false;
    if (f.type === "qualitative") {
      if (!f.categories || f.categories.length < 2) {
        toast(`Facteur "${f.name}" : saisissez au moins 2 modalités.`, "warn");
        return false;
      }
      return true;
    }
    return f.max > f.min;
  });

  if (valid.length < 1) { toast("Définissez au moins 1 facteur valide", "warn"); return; }

  // [MODIF] Avertissement CCD/BBD + qualitatifs multi-niveaux
  const hasMultiQual = valid.some(f => f.type === "qualitative" && f.categories.length > 2);
  if (hasMultiQual && (APP.doeType === "ccd" || APP.doeType === "bbd")) {
    toast("⚠ Facteurs qualitatifs > 2 niveaux : pas de points axiaux pour ces facteurs. Considérez le plan 'Niveaux personnalisés'.", "warn");
  }

  setBtnLoading("btn-generate", true, "Génération…");
  try {
    const { matrix, info } = DOEEngine.generateDOE(valid, APP.doeType, APP.centerPts);
    APP.matrix  = matrix;
    APP.factors = valid;
    APP.doeInfo = {
      ...info,
      expName:      document.getElementById("exp-name").value || "Expérience",
      responseName: document.getElementById("exp-resp").value || "Réponse",
      goal:         APP.goal,
    };

    renderMatrix();
    renderPlanInfo();
    populateSurfaceSelectors();

    toast(`✅ Plan généré : ${matrix.length} essais`, "info");
    log(`${info.type} — ${matrix.length} essais, ${valid.length} facteurs`, "ok");
    switchPanel("p-matrix");
  } catch (e) {
    toast("Erreur : " + e.message, "err");
    log("Erreur : " + e.message, "err");
    console.error(e);
  }
  setBtnLoading("btn-generate", false, "⊞ Générer le plan d'expérience");
}

function handleDemo() {
  APP.factors = [
    { name: "Température (°C)", type: "quantitative", min: 40, max: 80, levels: 2, categories: [] },
    { name: "pH",               type: "quantitative", min: 3,  max: 7,  levels: 2, categories: [] },
    { name: "Temps (min)",      type: "quantitative", min: 10, max: 30, levels: 2, categories: [] },
  ];
  APP.doeType   = "ccd";
  APP.centerPts = 3;
  APP.goal      = "maximize";

  document.getElementById("doe-type").value   = "ccd";
  document.getElementById("center-pts").value = 3;
  document.getElementById("opt-goal").value   = "maximize";
  document.getElementById("exp-name").value   = "Optimisation enzymatique";
  document.getElementById("exp-resp").value   = "Activité enzymatique (U/mg)";

  renderFactors();
  handleGenerate().then(() => {
    const demoResponses = [
      62.3, 78.1, 68.5, 81.2, 71.4, 84.6, 75.8, 88.3,
      70.2, 89.4, 65.1, 76.8, 72.5, 83.7, 79.1, 86.2,
      58.4, 91.2, 67.3, 79.5,
      85.1, 85.8, 84.9,
    ];
    if (APP.matrix) {
      APP.matrix.forEach((row, i) => {
        row.response = demoResponses[i] || (75 + (Math.random()-0.5)*10);
      });
      APP.responses = APP.matrix;
      renderMatrix();
      toast("✅ Démo chargée — réponses pré-remplies. Lancez l'analyse !", "info");
      log("Données de démonstration enzymatique chargées", "ok");
    }
  });
}

// ─── PANEL : MATRICE ─────────────────────────────────────────────────────────
function setupMatrixPanel() {
  document.getElementById("btn-write-matrix").addEventListener("click", async () => {
    if (!APP.matrix) { toast("Générez d'abord le plan", "warn"); return; }
    setBtnLoading("btn-write-matrix", true, "Écriture…");
    try {
      await DOEExcel.writeDOEMatrix(APP.matrix, APP.factors, APP.doeInfo.responseName);
      toast("✅ Plan écrit dans Excel", "info");
      log("Matrice écrite dans la feuille Plan_DOE", "ok");
    } catch (e) { toast(e.message, "err"); }
    setBtnLoading("btn-write-matrix", false, "⊞ Écrire le plan dans Excel");
  });

  document.getElementById("btn-read-responses").addEventListener("click", async () => {
    setBtnLoading("btn-read-responses", true, "Lecture…");
    try {
      const data = await DOEExcel.readResponses(APP.factors, APP.doeInfo.responseName);
      data.forEach(d => {
        const row = APP.matrix?.find(r => r.run === d.run);
        if (row) row.response = d.response;
      });
      APP.responses = APP.matrix?.filter(r => r.response !== undefined && !isNaN(r.response));
      renderMatrix();
      toast(`✅ ${data.length} réponses importées`, "info");
      log(`${data.length} réponses lues depuis Excel`, "ok");
    } catch (e) { toast(e.message, "err"); }
    setBtnLoading("btn-read-responses", false, "↓ Lire les réponses depuis Excel");
  });
}

/**
 * [MODIF] renderMatrix : affichage propre des valeurs qualitatives (texte, pas .toFixed)
 */
function renderMatrix() {
  if (!APP.matrix?.length) return;
  const factors = APP.factors;

  const thead = document.getElementById("matrix-thead");
  thead.innerHTML = `<tr>
    <th>N°</th><th>Type</th>
    ${factors.map(f => `<th>${f.name}${f.type === "qualitative" ? " 🔤" : ""}</th>`).join("")}
    <th style="color:var(--green)">${APP.doeInfo.responseName || "Réponse"}</th>
  </tr>`;

  const tbody = document.getElementById("matrix-tbody");
  tbody.innerHTML = APP.matrix.map(row => `<tr>
    <td>${row.run}</td>
    <td style="color:${typeColor(row.type)}">${row.type || "Factoriel"}</td>
    ${factors.map(f => {
      const val = row[f.name];
      // [MODIF] : qualitatif → texte brut, quantitatif → toFixed(3)
      const display = (f.type === "qualitative")
        ? `<span style="color:var(--purple);font-weight:500">${val ?? "—"}</span>`
        : (typeof val === "number" ? val.toFixed(3) : val ?? "");
      return `<td>${display}</td>`;
    }).join("")}
    <td style="color:var(--green)">${row.response !== undefined && row.response !== "" ? row.response : "—"}</td>
  </tr>`).join("");

  document.getElementById("matrix-n").textContent = APP.matrix.length;
  document.getElementById("matrix-empty").style.display   = "none";
  document.getElementById("matrix-content").style.display = "block";
}

function typeColor(type) {
  if (type === "Centre") return "#CE93D8";
  if (type === "Axial")  return "#FF9800";
  if (type === "BBD")    return "#40C4FF";
  return "#B0C8DA";
}

function renderPlanInfo() {
  const info = APP.doeInfo;
  // [MODIF] Ajouter un résumé des types de facteurs
  const nQual  = APP.factors.filter(f => f.type === "qualitative").length;
  const nQuant = APP.factors.length - nQual;
  document.getElementById("plan-info").innerHTML = [
    ["Type de plan",    info.type || "—"],
    ["Essais",          info.nRuns || 0],
    ["Facteurs quant.", nQuant],
    ["Facteurs qual.",  nQual],
    ["Points centraux", info.nCenterPts || 0],
    ["Résolution",      info.resolution || "—"],
    ["α axial",         info.alpha || "±1"],
  ].map(([l, v]) => `
    <div class="info-item">
      <div class="info-lbl">${l}</div>
      <div class="info-val">${v}</div>
    </div>`).join("");
}

// ─── PANEL : ANALYSE ─────────────────────────────────────────────────────────
function setupAnalysisPanel() {
  document.querySelector('[data-panel="p-analysis"]').addEventListener("click", () => {
    if (APP.responses?.length && !APP.analysis) runAnalysis();
  });
}

function runAnalysis() {
  if (!APP.responses?.length) {
    toast("Saisissez les réponses avant l'analyse", "warn");
    return;
  }

  try {
    APP.analysis = DOEEngine.analyzeResults(APP.responses, APP.factors, APP.doeType);
    renderAnalysis();
    renderCharts();
    setupOptimSliders();
    log("Analyse statistique complète", "ok");
    toast("✅ Analyse terminée", "info");
  } catch (e) {
    toast("Erreur analyse : " + e.message, "err");
    log("Erreur : " + e.message, "err");
    console.error(e);
  }
}

function renderAnalysis() {
  const a = APP.analysis;
  if (!a) return;

  const terms = a.termNames.map((n, i) =>
    `${a.reg.beta[i] >= 0 && i > 0 ? "+" : ""}${a.reg.beta[i].toFixed(4)}·${n}`
  ).join(" ");
  document.getElementById("model-eq").innerHTML =
    `<span style="color:#7B9DB8">${APP.doeInfo.responseName || "Ŷ"}</span> = ${terms}`;

  document.getElementById("model-stats").innerHTML = [
    ["R²",        a.diagnostics.R2.toFixed(4)],
    ["R² ajust.", a.diagnostics.R2adj.toFixed(4)],
    ["RMSE",      a.diagnostics.RMSE.toFixed(4)],
    ["p-modèle",  a.diagnostics.pModel.toFixed(6)],
  ].map(([l,v]) => `
    <div class="stat-item">
      <div class="stat-lbl">${l}</div>
      <div class="stat-val">${v}</div>
    </div>`).join("");

  // ANOVA
  document.getElementById("anova-tbody").innerHTML = a.anova.map(row => {
    const sig = row.p !== null ? (row.p < 0.001 ? "***" : row.p < 0.01 ? "**" : row.p < 0.05 ? "*" : "ns") : "";
    const sigCls = row.p !== null && row.p < 0.05 ? "sig-yes" : "sig-no";
    const isSig  = row.p !== null && row.p < 0.05;
    return `<tr style="${isSig ? "color:var(--green)" : ""}">
      <td>${row.source}</td>
      <td>${row.SS.toFixed(4)}</td>
      <td>${row.df}</td>
      <td>${row.MS !== null ? row.MS.toFixed(4) : "—"}</td>
      <td>${row.F  !== null ? row.F.toFixed(4)  : "—"}</td>
      <td>${row.p  !== null ? row.p.toFixed(6)  : "—"}</td>
      <td class="${sigCls}">${sig}</td>
    </tr>`;
  }).join("");

  // Effets / coefficients
  document.getElementById("effects-tbody").innerHTML = a.termNames.map((name, i) => {
    const sig = a.reg.pT[i] < 0.001 ? "***" : a.reg.pT[i] < 0.01 ? "**" : a.reg.pT[i] < 0.05 ? "*" : "ns";
    const isSig = a.reg.pT[i] < 0.05;
    return `<tr style="${isSig ? "color:var(--cyan)" : ""}">
      <td>${name}</td>
      <td>${a.reg.beta[i].toFixed(5)}</td>
      <td>${a.reg.seB[i].toFixed(5)}</td>
      <td>${a.reg.tStat[i].toFixed(4)}</td>
      <td>${a.reg.pT[i].toFixed(6)}</td>
      <td class="${isSig ? "sig-hi" : "sig-no"}">${sig}</td>
    </tr>`;
  }).join("");

  // Diagnostics
  const d = a.diagnostics;
  document.getElementById("diagnostics-box").innerHTML = [
    { col: d.R2adj >= 0.8 ? "#00E676" : "#FF9800", msg: `R²ajusté = ${d.R2adj.toFixed(4)} — ${d.R2adj >= 0.9 ? "Excellent" : d.R2adj >= 0.8 ? "Bon" : "Insuffisant (< 0.80)"}` },
    { col: d.pModel < 0.05 ? "#00E676" : "#FF5252", msg: `Modèle ${d.pModel < 0.05 ? "significatif" : "non significatif"} (p = ${d.pModel.toFixed(6)})` },
    { col: "#B0C8DA", msg: `${d.n} essais, ${d.p} termes, ${d.n - d.p} degrés de liberté résiduel` },
    ...(d.lackOfFit ? [{ col: d.lackOfFit.significant ? "#FF9800" : "#00E676", msg: `Manque d'ajustement : F=${d.lackOfFit.F}, p=${d.lackOfFit.p} — ${d.lackOfFit.significant ? "⚠ Modèle inadapté" : "✓ OK"}` }] : []),
  ].map(({ col, msg }) =>
    `<div class="diag-row"><div class="diag-dot" style="background:${col}"></div><span>${msg}</span></div>`
  ).join("");

  document.getElementById("analysis-empty").style.display   = "none";
  document.getElementById("analysis-content").style.display = "block";
}

// ─── PANEL : GRAPHIQUES ──────────────────────────────────────────────────────
function setupChartsPanel() {
  document.getElementById("btn-update-surface").addEventListener("click", renderSurface);
  document.getElementById("btn-insert-charts").addEventListener("click", () => {
    toast("Export Excel des graphiques — fonctionnalité disponible via Office.js dans l'add-in installé", "info");
  });

  document.querySelector('[data-panel="p-charts"]').addEventListener("click", () => {
    if (APP.analysis && !APP.charts.mainEffects) renderCharts();
  });
}

/**
 * [MODIF] populateSurfaceSelectors : marquer les facteurs qualitatifs dans les listes
 */
function populateSurfaceSelectors() {
  const selX = document.getElementById("surf-x");
  const selY = document.getElementById("surf-y");
  selX.innerHTML = APP.factors.map((f,i) =>
    `<option value="${i}">${f.name}${f.type === "qualitative" ? " 🔤" : ""}</option>`
  ).join("");
  selY.innerHTML = APP.factors.map((f,i) =>
    `<option value="${i}">${f.name}${f.type === "qualitative" ? " 🔤" : ""}</option>`
  ).join("");
  if (APP.factors.length > 1) selY.value = "1";
}

function renderCharts() {
  if (!APP.analysis) return;
  const a = APP.analysis;
  const rLabel = APP.doeInfo.responseName || "Réponse";

  // [MODIF] passer factorColMap aux graphiques
  const mainSVG = DOECharts.buildMainEffectsChart(
    a.effectCurves, APP.factors, rLabel, a.factorColMap
  );
  document.getElementById("chart-main-effects").innerHTML = mainSVG;
  APP.charts.mainEffects = mainSVG;

  const intSVG = DOECharts.buildInteractionChart(
    APP.factors, a.reg.beta, a.termNames, rLabel, a.factorColMap
  );
  document.getElementById("chart-interactions").innerHTML = intSVG;
  APP.charts.interactions = intSVG;

  renderSurface();

  document.getElementById("charts-empty").style.display    = "none";
  document.getElementById("charts-content").style.display = "block";
}

/**
 * [MODIF] renderSurface : bloquer si les deux facteurs sont identiques
 * Passer factorColMap à computeResponseSurface
 */
function renderSurface() {
  if (!APP.analysis) return;
  const fi = parseInt(document.getElementById("surf-x").value) || 0;
  const fj = parseInt(document.getElementById("surf-y").value) || (APP.factors.length > 1 ? 1 : 0);
  if (fi === fj) { toast("Choisissez deux facteurs différents", "warn"); return; }

  const surf = DOEEngine.computeResponseSurface(
    fi, fj, APP.factors,
    APP.analysis.reg.beta, APP.analysis.termNames, 30,
    APP.analysis.factorColMap // [MODIF]
  );
  const svg  = DOECharts.buildResponseSurfaceChart(surf, APP.doeInfo.responseName || "Réponse");
  document.getElementById("chart-surface").innerHTML = svg;
  APP.charts.surface = svg;
}

// ─── PANEL : OPTIMISATION ────────────────────────────────────────────────────
function setupOptimPanel() {
  document.getElementById("btn-save-key").addEventListener("click", () => {
    const k = document.getElementById("gemini-key").value.trim();
    if (!k) { toast("Saisissez votre clé API", "warn"); return; }
    DOEGemini.setApiKey(k);
    toast("✅ Clé API sauvegardée", "info");
  });

  document.getElementById("btn-optimize").addEventListener("click", handleOptimize);

  const aiMap = {
    "btn-ai-optim":   async () => DOEGemini.interpreterResultats(APP.analysis, APP.doeInfo, APP.optimRes),
    "btn-ai-factors": async () => DOEGemini.analyserFacteurs(APP.analysis, APP.doeInfo),
    "btn-ai-suggest": async () => DOEGemini.suggererExperiences(APP.doeInfo, APP.analysis, APP.optimRes),
  };
  const btnLabels = {
    "btn-ai-optim":   "✦ Interpréter les résultats complets",
    "btn-ai-factors": "⊡ Analyser les facteurs significatifs",
    "btn-ai-suggest": "⬡ Suggestions expérimentales",
  };

  Object.entries(aiMap).forEach(([btnId, fn]) => {
    document.getElementById(btnId).addEventListener("click", async () => {
      if (!APP.analysis) { toast("Lancez d'abord l'analyse", "warn"); return; }
      if (!DOEGemini.hasApiKey()) { toast("Configurez la clé API Gemini", "warn"); return; }

      setBtnLoading(btnId, true, "Analyse IA…");
      document.getElementById("ai-result").style.display = "block";
      document.getElementById("ai-result").innerHTML = '<span class="spinner"></span> Gemini analyse votre plan d\'expériences…';

      try {
        const resp = await fn();
        APP.aiText = resp;
        document.getElementById("ai-result").innerHTML = DOEGemini.formatAI(resp);
        toast("✅ Analyse IA terminée", "info");
      } catch (e) {
        document.getElementById("ai-result").innerHTML = `<span style="color:var(--red)">❌ ${e.message}</span>`;
        toast(e.message, "err");
      }
      setBtnLoading(btnId, false, btnLabels[btnId]);
    });
  });

  document.getElementById("btn-chat").addEventListener("click", handleChat);
  document.getElementById("chat-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChat(); }
  });
  document.querySelectorAll(".chip").forEach(chip => {
    chip.addEventListener("click", () => {
      document.getElementById("chat-input").value = chip.dataset.p;
      handleChat();
    });
  });

  document.querySelector('[data-panel="p-optim"]').addEventListener("click", () => {
    if (APP.responses?.length && !APP.analysis) runAnalysis();
    if (APP.analysis && !document.getElementById("optim-config").children.length) setupOptimSliders();
  });
}

/**
 * [MODIF] setupOptimSliders :
 * - Facteur quantitatif → slider (inchangé)
 * - Facteur qualitatif → <select> avec les modalités
 */
function setupOptimSliders() {
  const container = document.getElementById("optim-config");
  container.innerHTML = APP.factors.map((f, i) => {
    if (f.type === "qualitative") {
      // [MODIF] Sélecteur de modalité
      return `
        <div class="slider-row">
          <div class="slider-lbl">
            <span>${f.name} <span style="color:var(--purple);font-size:9px">🔤 qualitatif</span></span>
          </div>
          <select id="slider-${i}" class="sel" style="width:100%">
            ${(f.categories || []).map(cat =>
              `<option value="${cat}">${cat}</option>`
            ).join("")}
          </select>
        </div>`;
    }
    return `
      <div class="slider-row">
        <div class="slider-lbl">
          <span>${f.name}</span>
          <span id="slider-val-${i}">${((f.min+f.max)/2).toFixed(2)}</span>
        </div>
        <input type="range" id="slider-${i}"
          min="${f.min}" max="${f.max}"
          step="${((f.max-f.min)/100).toFixed(3)}"
          value="${(f.min+f.max)/2}"
          style="width:100%;accent-color:var(--cyan)"
          oninput="document.getElementById('slider-val-${i}').textContent=parseFloat(this.value).toFixed(2)"/>
      </div>`;
  }).join("");

  if (!APP.analysis && APP.responses?.length) runAnalysis();
}

function handleOptimize() {
  if (!APP.analysis) { runAnalysis(); return; }
  setBtnLoading("btn-optimize", true, "Optimisation…");

  try {
    const gridRes = parseInt(document.getElementById("grid-res").value) || 50;
    APP.optimRes  = DOEEngine.optimize(
      APP.factors,
      APP.analysis.reg.beta,
      APP.analysis.termNames,
      APP.goal,
      APP.target,
      gridRes,
      APP.analysis.factorColMap // [MODIF]
    );
    renderOptimResults();
    toast(`✅ Optimisation terminée — réponse prédite : ${APP.optimRes.best.predicted?.toFixed(3)}`, "info");
    log("Optimisation complète — " + gridRes + "pts grille", "ok");
  } catch (e) {
    toast("Erreur : " + e.message, "err");
    log("Erreur optimisation : " + e.message, "err");
  }
  setBtnLoading("btn-optimize", false, "✦ Lancer l'optimisation");
}

/**
 * [MODIF] renderOptimResults : affichage adapté (qualitatif = texte, quantitatif = .toFixed)
 */
function renderOptimResults() {
  if (!APP.optimRes) return;
  const best   = APP.optimRes.best;
  const rLabel = APP.doeInfo.responseName || "Réponse";

  document.getElementById("optim-best").innerHTML = APP.factors.map(f => {
    const val = best[f.name];
    const display = f.type === "qualitative"
      ? `<span style="color:var(--purple)">${val ?? "—"}</span>`
      : `<span class="optim-val">${typeof val === "number" ? val.toFixed(3) : "—"}</span>`;
    return `<div><span style="color:var(--slate-200)">${f.name} :</span> ${display}</div>`;
  }).join("") +
    `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <span style="color:var(--slate-200)">${rLabel} prédit :</span>
      <span class="optim-pred">${best.predicted?.toFixed(3) || "—"}</span>
     </div>`;

  // Top 5
  const thead = document.getElementById("optim-thead");
  const tbody  = document.getElementById("optim-tbody");
  thead.innerHTML = `<tr>
    ${APP.factors.map(f =>
      `<th>${f.name}${f.type === "qualitative" ? " 🔤" : ""}</th>`
    ).join("")}
    <th style="color:var(--green)">${rLabel} prédit</th>
  </tr>`;
  tbody.innerHTML = APP.optimRes.top5.map(sol => `<tr>
    ${APP.factors.map(f => {
      const val = sol[f.name];
      return f.type === "qualitative"
        ? `<td style="color:var(--purple)">${val ?? "—"}</td>`
        : `<td>${typeof val === "number" ? val.toFixed(3) : "—"}</td>`;
    }).join("")}
    <td style="color:var(--green)">${sol.predicted?.toFixed(3) || "—"}</td>
  </tr>`).join("");

  document.getElementById("optim-results").style.display = "block";
}

async function handleChat() {
  const input = document.getElementById("chat-input");
  const msg   = input.value.trim();
  if (!msg) return;
  if (!DOEGemini.hasApiKey()) { toast("Configurez la clé API Gemini", "warn"); return; }

  input.value = "";
  appendChat("user", msg);
  const tid = appendChat("asst", '<span class="spinner"></span>');

  try {
    const ctx = APP.analysis ? {
      plan:     APP.doeInfo.type,
      R2adj:    APP.analysis.diagnostics.R2adj,
      sigTerms: APP.analysis.termNames.filter((n,i) => i>0 && APP.analysis.reg.pT[i] < 0.05),
      best:     APP.optimRes?.best,
      // [MODIF] Indiquer le type de chaque facteur dans le contexte IA
      factors:  APP.factors.map(f =>
        f.type === "qualitative"
          ? `${f.name}[qualitatif: ${f.categories.join("/")}]`
          : `${f.name}[${f.min}-${f.max}]`
      ),
    } : {};
    const resp = await DOEGemini.sendChat(msg, ctx);
    document.getElementById(tid).innerHTML = DOEGemini.formatAI(resp);
  } catch (e) {
    document.getElementById(tid).innerHTML = `❌ ${e.message}`;
  }
}

let _chatN = 0;
function appendChat(role, html) {
  const id  = `c-${++_chatN}`;
  const box = document.getElementById("chat-msgs");
  box.insertAdjacentHTML("beforeend",
    `<div class="chat-msg ${role}"><div class="cb" id="${id}">${html}</div></div>`);
  box.scrollTop = box.scrollHeight;
  return id;
}

// ─── PANEL : RAPPORT ────────────────────────────────────────────────────────
function setupReportPanel() {
  document.getElementById("btn-report").addEventListener("click", () => {
    if (!APP.matrix) { toast("Générez d'abord le plan", "warn"); return; }

    const opts = {
      labo:     document.getElementById("rpt-labo").value,
      auteur:   document.getElementById("rpt-auteur").value,
      ref:      document.getElementById("rpt-ref").value,
      version:  document.getElementById("rpt-version").value,
      params:   document.getElementById("rpt-params").checked,
      matrix:   document.getElementById("rpt-matrix").checked,
      anova:    document.getElementById("rpt-anova").checked,
      effects:  document.getElementById("rpt-effects").checked,
      surface:  document.getElementById("rpt-surface").checked,
      optim:    document.getElementById("rpt-optim").checked,
      ai:       document.getElementById("rpt-ai").checked,
    };

    const html = DOEReport.generateDOEReport({
      doeInfo:  APP.doeInfo,
      matrix:   APP.responses || APP.matrix,
      analysis: APP.analysis,
      optimRes: APP.optimRes,
      aiText:   APP.aiText,
      charts:   APP.charts,
    }, opts);

    const fname = `Rapport_DOE_${(APP.doeInfo.expName||"exp").replace(/\s+/g,"_").slice(0,30)}_${new Date().toISOString().slice(0,10)}.html`;
    DOEReport.downloadReport(html, fname);
    toast("✅ Rapport HTML téléchargé", "info");
    logReport("Rapport généré : " + fname, "ok");
  });
}

// ─── Utilitaires UI ──────────────────────────────────────────────────────────
function switchPanel(id) {
  document.querySelectorAll(".ntab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.querySelector(`[data-panel="${id}"]`)?.classList.add("active");
  document.getElementById(id)?.classList.add("active");
}

function toast(msg, type, dur) {
  const el = document.createElement("div");
  el.className = `toast ${type || "info"}`;
  el.innerHTML = `<span>${{ok:"✅",err:"❌",info:"ℹ",warn:"⚠"}[type]||"ℹ"}</span><span>${msg}</span>`;
  document.getElementById("toast-ct").appendChild(el);
  setTimeout(() => {
    el.style.transition = "all 0.25s ease";
    el.style.opacity    = "0";
    el.style.transform  = "translateX(14px)";
    setTimeout(() => el.remove(), 250);
  }, dur || 3400);
}

function log(msg, type) {
  const el = document.getElementById("log-design");
  if (!el) return;
  const e = document.createElement("div");
  e.className = `le ${type||"info"}`;
  e.innerHTML = `<span class="ts">${new Date().toLocaleTimeString("fr-FR")}</span>${msg}`;
  el.appendChild(e);
  el.scrollTop = el.scrollHeight;
}

function logReport(msg, type) {
  const el = document.getElementById("log-report");
  if (!el) return;
  const e = document.createElement("div");
  e.className = `le ${type||"info"}`;
  e.innerHTML = `<span class="ts">${new Date().toLocaleTimeString("fr-FR")}</span>${msg}`;
  el.appendChild(e);
  el.scrollTop = el.scrollHeight;
}

function setBtnLoading(id, loading, label) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled  = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span> ${label}` : label;
}

function setStatus(msg) {
  const el = document.getElementById("hdr-status");
  if (el) el.textContent = msg;
}