/**
 * ================================================================
 * doeGemini.js — Interprétation IA des résultats DOE
 * Spécialisé en plans d'expériences, optimisation de procédés
 * ================================================================
 */
"use strict";

const GEMINI_DOE = {
  endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent",
  maxTokens: 2048,
  storageKey: "doe_gemini_key",
};

const _mem = {};
let _key = "";
let _chatHist = [];

function storage_get(k) { try { return localStorage.getItem(k); } catch { return _mem[k]||null; } }
function storage_set(k, v) { try { localStorage.setItem(k, v); } catch { _mem[k] = v; } }

function setApiKey(k) { _key = k.trim(); storage_set(GEMINI_DOE.storageKey, _key); }
function loadApiKey() { const s = storage_get(GEMINI_DOE.storageKey); if (s) _key = s; return _key; }
function hasApiKey() { return !!_key; }

const SYS_DOE = `Tu es un expert en plans d'expériences (DOE) et optimisation des procédés industriels et scientifiques.
Tu maîtrises :
- Les plans factoriels complets et fractionnaires (Box-Hunter)
- Central Composite Design (CCD) et Box-Behnken (BBD)
- L'analyse ANOVA et la régression polynomiale du second ordre
- La surface de réponse (RSM — Response Surface Methodology)
- L'optimisation multi-objectif et la fonction de désirabilité
- Les applications en chimie, génie des procédés, biologie, pharmaceutique

Tu réponds en français, de manière précise, structurée, avec des recommandations concrètes et chiffrées.
Tu utilises la terminologie scientifique appropriée.`;

async function _call(userPrompt) {
  if (!_key) throw new Error("Clé API Gemini non configurée.");

  const resp = await fetch(`${GEMINI_DOE.endpoint}?key=${_key}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: SYS_DOE + "\n\n" + userPrompt }] }],
      generationConfig: { maxOutputTokens: GEMINI_DOE.maxTokens, temperature: 0.35 },
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(()=>({}));
    throw new Error(err?.error?.message || `Erreur API ${resp.status}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

/**
 * Interprétation complète des résultats DOE
 */
async function interpreterResultats(analysisResult, doeInfo, optimResult) {
  const { reg, anova, effects, termNames, diagnostics } = analysisResult;
  const factors = doeInfo?.factors || [];
  const responseName = doeInfo?.responseName || "Réponse";

  const sigTerms = termNames.filter((n,i) => i>0 && reg.pT[i] < 0.05)
    .map((n,i) => `${n} (p=${reg.pT[termNames.indexOf(n)]?.toFixed(4)})`);

  const effectsSummary = Object.entries(effects)
    .sort((a,b) => Math.abs(b[1].effect) - Math.abs(a[1].effect))
    .map(([name, e]) => `${name}: effet=${e.effect.toFixed(3)}, coef=${e.coef.toFixed(3)}`)
    .join("\n  ");

  const optimSummary = optimResult?.best
    ? Object.entries(optimResult.best)
        .map(([k,v]) => `${k}=${typeof v==="number"?v.toFixed(3):v}`)
        .join(", ")
    : "Non calculé";

  return _call(`
RÉSULTATS DOE À INTERPRÉTER :

Plan : ${doeInfo?.type || "—"} | ${doeInfo?.nFactors || "?"} facteurs | ${doeInfo?.nRuns || "?"} essais
Réponse : ${responseName} | Objectif : ${doeInfo?.goal || "maximiser"}

QUALITÉ DU MODÈLE :
  R² = ${diagnostics.R2.toFixed(4)} | R²adj = ${diagnostics.R2adj.toFixed(4)} | RMSE = ${diagnostics.RMSE.toFixed(4)}
  p-modèle = ${diagnostics.pModel.toFixed(6)}

TERMES SIGNIFICATIFS (p < 0.05) :
  ${sigTerms.join(", ") || "Aucun terme significatif"}

EFFETS PRINCIPAUX (triés par amplitude) :
  ${effectsSummary}

CONDITIONS OPTIMALES :
  ${optimSummary}

Rédigez une interprétation scientifique structurée contenant :
1. **Qualité du modèle** — validation statistique, commentaire R², RMSE
2. **Facteurs significatifs** — classement par importance, seuil α=5%
3. **Effets principaux** — sens et magnitude de chaque effet
4. **Interactions** — interactions significatives et leur signification physique
5. **Conditions optimales** — recommandations pratiques avec justification
6. **Validité expérimentale** — lacunes, biais éventuels, robustesse du plan
7. **Recommandations** — 3 actions concrètes pour améliorer ou valider`);
}

/**
 * Analyse des facteurs significatifs
 */
async function analyserFacteurs(analysisResult, doeInfo) {
  const { reg, termNames, diagnostics } = analysisResult;
  const factors = doeInfo?.factors || [];

  const termsInfo = termNames.map((n,i) => ({
    name: n, coef: reg.beta[i].toFixed(4),
    se: reg.seB[i].toFixed(4), t: reg.tStat[i].toFixed(3),
    p: reg.pT[i].toFixed(6),
    sig: reg.pT[i] < 0.001 ? "***" : reg.pT[i] < 0.01 ? "**" : reg.pT[i] < 0.05 ? "*" : "ns",
  }));

  return _call(`
ANALYSE DES FACTEURS DOE :

Facteurs : ${factors.map(f => `${f.name} [${f.min}–${f.max}]`).join(", ")}
R² = ${diagnostics.R2.toFixed(4)} | R²adj = ${diagnostics.R2adj.toFixed(4)}

COEFFICIENTS :
${termsInfo.map(t => `  ${t.name}: β=${t.coef}, SE=${t.se}, t=${t.t}, p=${t.p} ${t.sig}`).join("\n")}

Analysez :
1. **Hiérarchie des effets** — classez les facteurs du plus au moins influent
2. **Signification statistique** — interprétez les p-valeurs et les niveaux de signification
3. **Signe des coefficients** — sens de l'effet (augmenter/diminuer la réponse)
4. **Interactions** — identifiez les interactions importantes et leur mécanisme probable
5. **Effets quadratiques** — présence d'optimum ou de comportement non linéaire`);
}

/**
 * Suggestions expérimentales intelligentes
 */
async function suggererExperiences(doeInfo, analysisResult, optimResult) {
  const factors = doeInfo?.factors || [];
  const { diagnostics } = analysisResult;
  const best = optimResult?.best || {};

  return _call(`
DEMANDE DE SUGGESTIONS EXPÉRIMENTALES :

Plan actuel : ${doeInfo?.type || "—"}, ${doeInfo?.nRuns || "?"} essais
R²adj = ${diagnostics.R2adj.toFixed(3)} | RMSE = ${diagnostics.RMSE.toFixed(3)}
Conditions optimales prédites : ${Object.entries(best).map(([k,v])=>`${k}=${typeof v==="number"?v.toFixed(3):v}`).join(", ")}
Domaine expérimental : ${factors.map(f=>`${f.name}=[${f.min}–${f.max}]`).join(", ")}

Proposez :
1. **Essais de validation** — points expérimentaux pour confirmer les conditions optimales (3–5 essais)
2. **Extension du domaine** — si l'optimum est sur la frontière du domaine, comment l'étendre
3. **Réduction du modèle** — si certains termes sont non significatifs, simplification possible
4. **Plan complémentaire** — type de plan recommandé si R²adj < 0.80
5. **Critères d'acceptation** — valeurs cibles de R², RMSE et intervalle de confiance pour valider`);
}

function resetChat() { _chatHist = []; }

async function sendChat(msg, context) {
  _chatHist.push({ role: "user", text: msg });

  const ctxText = context ? `\nContexte DOE :\n${JSON.stringify(context, null, 2)}\n` : "";
  const hist = _chatHist.slice(-8).map(m =>
    `${m.role === "user" ? "Ingénieur" : "Expert DOE"}: ${m.text}`
  ).join("\n");

  const resp = await _call(ctxText + hist);
  _chatHist.push({ role: "asst", text: resp });
  return resp;
}

function formatAI(text) {
  if (!text) return "";
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n/g, "<br><br>")
    .replace(/\n/g, "<br>")
    .replace(/^(\d+)\.\s+/gm, "<br><b>$1.</b> ");
}

window.DOEGemini = {
  setApiKey, loadApiKey, hasApiKey,
  interpreterResultats,
  analyserFacteurs,
  suggererExperiences,
  sendChat, resetChat,
  formatAI,
};
