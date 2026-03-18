/**
 * ================================================================
 * doeEngine.js — Moteur de Plans d'Expériences (DOE)
 *
 * Génère et analyse :
 *  - Plan factoriel complet 2^k
 *  - Plan factoriel fractionnaire 2^(k-p)
 *  - Central Composite Design (CCD)
 *  - Box-Behnken Design (BBD)
 *  - Plans à niveaux personnalisés
 *
 * Statistiques :
 *  - Régression polynomiale (moindres carrés)
 *  - Table ANOVA avec F et p-valeur
 *  - Effets principaux et interactions
 *  - Diagnostic du modèle
 *
 * [MODIF] Support des facteurs qualitatifs (nominaux)
 *  - Dummy coding (k-1 colonnes par facteur à k modalités)
 *  - Génération de plans avec modalités textuelles
 *  - Effets principaux discrets pour les qualitatifs
 *  - Optimisation sur grille discrète/continue mixte
 * ================================================================
 */
"use strict";

// ─── Utilitaires mathématiques ────────────────────────────────────────────────

function matMul(A, B) {
  const m = A.length, n = B.length, p = B[0].length;
  const C = Array.from({length:m}, () => new Array(p).fill(0));
  for (let i=0; i<m; i++)
    for (let k=0; k<n; k++)
      for (let j=0; j<p; j++)
        C[i][j] += A[i][k] * B[k][j];
  return C;
}

function matTranspose(A) {
  return A[0].map((_, j) => A.map(row => row[j]));
}

function matInverse(A) {
  const n = A.length;
  const M = A.map(row => [...row]);
  const I = Array.from({length:n}, (_,i) => {
    const r = new Array(n).fill(0); r[i]=1; return r;
  });
  for (let col=0; col<n; col++) {
    let maxRow = col;
    for (let r=col+1; r<n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow=r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    [I[col], I[maxRow]] = [I[maxRow], I[col]];
    const piv = M[col][col];
    if (Math.abs(piv) < 1e-14) return null;
    for (let j=0; j<n; j++) { M[col][j]/=piv; I[col][j]/=piv; }
    for (let r=0; r<n; r++) {
      if (r===col) continue;
      const f = M[r][col];
      for (let j=0; j<n; j++) { M[r][j]-=f*M[col][j]; I[r][j]-=f*I[col][j]; }
    }
  }
  return I;
}

function fDistPValue(F, df1, df2) {
  if (!isFinite(F) || F < 0) return 1;
  if (F === 0) return 1;
  const x = df2 / (df2 + df1 * F);
  return incompleteBeta(df2/2, df1/2, x);
}

function incompleteBeta(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const maxIter = 200, eps = 1e-10;
  let fpmin = 1e-300;
  let qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1/d; let h = d;
  for (let m=1; m<=maxIter; m++) {
    let m2 = 2*m;
    let aa = m * (b-m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa*d; if (Math.abs(d) < fpmin) d=fpmin;
    c = 1 + aa/c; if (Math.abs(c) < fpmin) c=fpmin;
    d=1/d; h *= d*c;
    aa = -(a+m)*(qab+m)*x/((a+m2)*(qap+m2));
    d = 1+aa*d; if (Math.abs(d) < fpmin) d=fpmin;
    c = 1+aa/c; if (Math.abs(c) < fpmin) c=fpmin;
    d=1/d; const del=d*c; h*=del;
    if (Math.abs(del-1) < eps) break;
  }
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a+b);
  const bt = Math.exp(Math.log(x)*a + Math.log(1-x)*b - lbeta);
  return bt * h / a;
}

function lgamma(x) {
  const g = 7;
  const c = [0.99999999999980993,676.5203681218851,-1259.1392167224028,
    771.32342877765313,-176.61502916214059,12.507343278686905,
    -0.13857109526572012,9.9843695780195716e-6,1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI/Math.sin(Math.PI*x)) - lgamma(1-x);
  x--;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i=1; i<g+2; i++) a += c[i]/(x+i);
  return 0.5*Math.log(2*Math.PI) + (x+0.5)*Math.log(t) - t + Math.log(a);
}

function mean(arr) { return arr.reduce((s,v)=>s+v,0)/arr.length; }

function stdDev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/(arr.length-1));
}

// ─── Codage/décodage des facteurs ─────────────────────────────────────────────

/**
 * Encode une valeur réelle en valeur codée [-1, +1]
 */
function encode(val, min, max) {
  return 2 * (val - min) / (max - min) - 1;
}

/**
 * Décode une valeur codée [-1, +1] en valeur réelle
 */
function decode(coded, min, max) {
  return min + (coded + 1) * (max - min) / 2;
}

// ─── [MODIF] Utilitaires pour facteurs qualitatifs ────────────────────────────

/**
 * Retourne vrai si le facteur est qualitatif
 */
function isQual(f) {
  return f.type === "qualitative" && Array.isArray(f.categories) && f.categories.length >= 2;
}

/**
 * Retourne les niveaux codés d'un facteur qualitatif à 2 modalités : [-1, +1]
 * Pour plus de 2 modalités, les niveaux codés sont espacés de -1 à +1
 */
function qualCodedLevels(f) {
  const m = f.categories.length;
  if (m === 2) return [-1, 1];
  return f.categories.map((_, i) => -1 + 2 * i / (m - 1));
}

/**
 * Pour un facteur qualitatif, retourne la valeur codée [-1..+1] d'une modalité
 * (utilisé pour les plans 2-niveaux)
 */
function encodeQualBinary(category, f) {
  const idx = f.categories.indexOf(category);
  if (idx < 0) return 0;
  const levels = qualCodedLevels(f);
  return levels[idx] !== undefined ? levels[idx] : 0;
}

/**
 * Construit le vecteur de dummy coding pour un facteur qualitatif.
 * Référence = première modalité (idx 0).
 * Retourne un tableau de longueur (m-1).
 */
function dummyEncode(category, f) {
  const m = f.categories.length;
  const idx = f.categories.indexOf(category);
  // dummy[d] = 1 si catégorie d+1, 0 sinon
  return f.categories.slice(1).map((_, d) => (idx === d + 1 ? 1 : 0));
}

// ─── Génération des plans ─────────────────────────────────────────────────────

/**
 * [MODIF] Remplit une ligne de la matrice pour un facteur donné
 * selon son type (quantitatif ou qualitatif)
 */
function fillFactorRow(row, f, coded) {
  if (isQual(f)) {
    // coded = -1 → catégorie[0], +1 → catégorie[dernière] pour 2 niveaux
    const levels = qualCodedLevels(f);
    // Trouver la modalité la plus proche du coded demandé
    let bestIdx = 0;
    let bestDist = Infinity;
    levels.forEach((lv, i) => {
      const d = Math.abs(lv - coded);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    row[f.name + "_coded"] = levels[bestIdx];
    row[f.name] = f.categories[bestIdx];
  } else {
    row[f.name + "_coded"] = coded;
    row[f.name] = +(decode(coded, f.min, f.max)).toFixed(4);
  }
}

/**
 * Plan factoriel complet 2^k
 */
function generateFullFactorial(factors) {
  const k = factors.length;
  const nRuns = Math.pow(2, k);
  const matrix = [];

  for (let run = 0; run < nRuns; run++) {
    const row = {};
    factors.forEach((f, i) => {
      const bit = (run >> (k - 1 - i)) & 1;
      const coded = bit === 0 ? -1 : 1;
      fillFactorRow(row, f, coded); // [MODIF] remplace l'appel direct decode()
    });
    row.run = run + 1;
    matrix.push(row);
  }
  return matrix;
}

/**
 * Plan factoriel fractionnaire 2^(k-p)
 */
function generateFractionalFactorial(factors) {
  const k = factors.length;

  const generators = {
    3: { base: 2, gen: [(r,m) => m[0]*m[1]] },
    4: { base: 3, gen: [(r,m) => m[0]*m[1]*m[2]] },
    5: { base: 3, gen: [(r,m) => m[0]*m[1]*m[2], (r,m) => m[0]*m[1]] },
    6: { base: 4, gen: [(r,m) => m[0]*m[1]*m[2], (r,m) => m[1]*m[2]*m[3]] },
    7: { base: 4, gen: [(r,m) => m[0]*m[1]*m[2], (r,m) => m[0]*m[1]*m[3], (r,m) => m[0]*m[2]*m[3]] },
  };

  const cfg = generators[Math.min(k, 7)] || generators[7];
  const baseMatrix = generateFullFactorial(factors.slice(0, cfg.base));
  const matrix = [];

  baseMatrix.forEach((row, ri) => {
    const baseCoded = factors.slice(0, cfg.base).map(f => row[f.name + "_coded"]);
    const newRow = { ...row, run: ri + 1 };

    cfg.gen.forEach((gen, gi) => {
      if (cfg.base + gi < k) {
        const f = factors[cfg.base + gi];
        const coded = gen(ri, baseCoded);
        fillFactorRow(newRow, f, coded); // [MODIF]
      }
    });
    matrix.push(newRow);
  });

  return matrix;
}

/**
 * Central Composite Design (CCD)
 * [MODIF] : les facteurs qualitatifs ne participent pas aux points axiaux
 * (ils restent à leur modalité de référence / niveau médian)
 */
function generateCCD(factors) {
  const k = factors.length;
  // Pour le calcul de alpha, on ne compte que les facteurs quantitatifs
  const nQuant = factors.filter(f => !isQual(f)).length || k;
  const alpha = Math.pow(Math.pow(2, nQuant), 0.25);
  const matrix = [];
  let run = 1;

  // 1. Points factoriels (±1)
  const factorial = generateFullFactorial(factors);
  factorial.forEach(row => {
    matrix.push({ ...row, run: run++, type: "Factoriel" });
  });

  // 2. Points axiaux uniquement pour les facteurs quantitatifs
  factors.forEach((f, i) => {
    if (isQual(f)) return; // [MODIF] pas de point axial pour les qualitatifs
    [-alpha, alpha].forEach(a => {
      const row = { run: run++, type: "Axial" };
      factors.forEach((ff, j) => {
        let coded;
        if (i === j) {
          coded = a;
        } else if (isQual(ff)) {
          // [MODIF] qualitatif au niveau central → première modalité
          coded = -1; // sera mappé à catégorie[0]
        } else {
          coded = 0;
        }
        fillFactorRow(row, ff, coded);
      });
      matrix.push(row);
    });
  });

  return { matrix, alpha: +alpha.toFixed(4) };
}

/**
 * Box-Behnken Design (BBD)
 * [MODIF] : les qualitatifs sont fixés à leur première modalité dans les paires BBD
 */
function generateBBD(factors) {
  const k = factors.length;
  if (k < 3) return { matrix: generateCCD(factors).matrix, note: "BBD→CCD (k<3)" };

  const pairs = [];
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      pairs.push([i, j]);
    }
  }

  const matrix = [];
  let run = 1;

  pairs.forEach(([a, b]) => {
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([va, vb]) => {
      const row = { run: run++, type: "BBD" };
      factors.forEach((f, i) => {
        let coded;
        if (i === a) coded = va;
        else if (i === b) coded = vb;
        else coded = isQual(f) ? -1 : 0; // [MODIF] qualitatif → première modalité
        fillFactorRow(row, f, coded);
      });
      matrix.push(row);
    });
  });

  return { matrix };
}

/**
 * Ajoute les points centraux au plan
 * [MODIF] : pour les qualitatifs, le "centre" est la première modalité
 */
function addCenterPoints(matrix, factors, nCenter) {
  const n = matrix.length;
  for (let c = 0; c < nCenter; c++) {
    const row = { run: n + c + 1, type: "Centre" };
    factors.forEach(f => {
      if (isQual(f)) {
        // [MODIF] centre qualitatif = première modalité
        row[f.name + "_coded"] = -1;
        row[f.name] = f.categories[0];
      } else {
        row[f.name + "_coded"] = 0;
        row[f.name] = +(decode(0, f.min, f.max)).toFixed(4);
      }
    });
    matrix.push(row);
  }
  return matrix;
}

/**
 * Point d'entrée principal — génère un plan selon le type choisi
 */
function generateDOE(factors, doeType, nCenterPts) {
  let matrix, info = {};

  switch (doeType) {
    case "full": {
      matrix = generateFullFactorial(factors);
      info.type = "Factoriel complet 2^" + factors.length;
      info.resolution = "V (complète)";
      break;
    }
    case "fractional": {
      matrix = generateFractionalFactorial(factors);
      info.type = "Factoriel fractionnaire 2^(" + factors.length + "-p)";
      info.resolution = factors.length <= 4 ? "IV" : "III-V";
      break;
    }
    case "ccd": {
      const res = generateCCD(factors);
      matrix = res.matrix;
      info.type = "Central Composite Design (CCD)";
      info.alpha = res.alpha;
      info.resolution = "V (rotatable)";
      break;
    }
    case "bbd": {
      const res = generateBBD(factors);
      matrix = res.matrix;
      info.type = "Box-Behnken Design (BBD)";
      info.resolution = "IV";
      break;
    }
    case "custom": {
      matrix = generateCustomLevels(factors);
      info.type = "Plan à niveaux personnalisés";
      break;
    }
    default:
      matrix = generateFullFactorial(factors);
      info.type = "Factoriel complet";
  }

  if (nCenterPts > 0) {
    addCenterPoints(matrix, factors, nCenterPts);
  }

  matrix.forEach((row, i) => { row.run = i + 1; });

  info.nRuns      = matrix.length;
  info.nFactors   = factors.length;
  info.nCenterPts = nCenterPts;
  info.factors    = factors;

  return { matrix, info };
}

/**
 * Plan à niveaux personnalisés (grille complète sur les niveaux définis)
 * [MODIF] : pour les qualitatifs, les niveaux sont les modalités
 */
function generateCustomLevels(factors) {
  function cartesian(arrays) {
    return arrays.reduce((acc, arr) => {
      const res = [];
      acc.forEach(a => arr.forEach(b => res.push([...a, b])));
      return res;
    }, [[]]);
  }

  const levelArrays = factors.map(f => {
    if (isQual(f)) {
      // [MODIF] pour un qualitatif, les niveaux sont les modalités textuelles
      return f.categories;
    }
    const lvls = f.levels || 2;
    const arr = [];
    for (let i = 0; i < lvls; i++) {
      arr.push(f.min + i * (f.max - f.min) / (lvls - 1));
    }
    return arr;
  });

  const combos = cartesian(levelArrays);
  return combos.map((combo, i) => {
    const row = { run: i+1, type: "Custom" };
    factors.forEach((f, j) => {
      if (isQual(f)) {
        // [MODIF]
        row[f.name] = combo[j];
        row[f.name + "_coded"] = encodeQualBinary(combo[j], f);
      } else {
        row[f.name] = +combo[j].toFixed(4);
        row[f.name + "_coded"] = +(encode(combo[j], f.min, f.max)).toFixed(4);
      }
    });
    return row;
  });
}

// ─── Construction de la matrice de régression ─────────────────────────────────

/**
 * [MODIF] Construit la matrice X pour la régression polynomiale.
 *
 * Pour les facteurs QUANTITATIFS : codage continu [-1, +1], termes linéaires,
 * interactions et quadratiques comme avant.
 *
 * Pour les facteurs QUALITATIFS : dummy coding (k-1 colonnes par facteur).
 * Référence = première modalité. Pas de terme quadratique (non applicable).
 * Les interactions quali × quanti et quali × quali sont incluses.
 *
 * La fonction retourne aussi un index `factorColMap` qui indique pour chaque
 * facteur original quelles colonnes X il occupe → utilisé par les graphiques.
 */
function buildRegressionMatrix(matrix, factors, modelOrder) {
  const k = factors.length;
  const X = [];
  const termNames = ["Intercept"];

  // ── Mapper les facteurs → colonnes X ──────────────────────────────────────
  // factorColMap[i] = [startCol, endCol] dans X (hors intercept, 0-based depuis col 1)
  const factorColMap = [];
  let colCursor = 1; // après l'intercept

  factors.forEach(f => {
    const start = colCursor;
    if (isQual(f) && f.categories.length > 2) {
      // dummy coding : m-1 colonnes
      f.categories.slice(1).forEach(cat => {
        termNames.push(`${f.name}[${cat}]`);
        colCursor++;
      });
    } else {
      // quantitatif ou qualitatif binaire : 1 colonne
      termNames.push(f.name);
      colCursor++;
    }
    factorColMap.push({ start, end: colCursor - 1 });
  });

  // ── Interactions 2 à 2 ────────────────────────────────────────────────────
  // Pour chaque paire, on génère une colonne par combinaison de colonnes
  const interactionDefs = []; // [{iF, jF, iCol, jCol, name}]
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      const fi = factors[i], fj = factors[j];
      const colsI = range(factorColMap[i].start, factorColMap[i].end);
      const colsJ = range(factorColMap[j].start, factorColMap[j].end);
      colsI.forEach(ci => {
        colsJ.forEach(cj => {
          const nameI = termNames[ci];
          const nameJ = termNames[cj];
          termNames.push(`${nameI}×${nameJ}`);
          interactionDefs.push({ ci, cj });
          colCursor++;
        });
      });
    }
  }

  // ── Termes quadratiques (facteurs quantitatifs seulement) ─────────────────
  const quadDefs = []; // colonnes sources pour x²
  if (modelOrder === 2) {
    factors.forEach((f, fi) => {
      if (!isQual(f)) {
        const col = factorColMap[fi].start; // 1 seule colonne pour un quantitatif
        termNames.push(f.name + "²");
        quadDefs.push(col);
        colCursor++;
      }
    });
  }

  // ── Remplir X pour chaque essai ───────────────────────────────────────────
  matrix.forEach(row => {
    const xRow = [1]; // intercept

    // Effets principaux
    factors.forEach(f => {
      if (isQual(f) && f.categories.length > 2) {
        // dummy coding
        const dummy = dummyEncode(row[f.name], f);
        dummy.forEach(d => xRow.push(d));
      } else if (isQual(f)) {
        // qualitatif binaire → coded binaire -1/+1
        const coded = encodeQualBinary(row[f.name], f);
        xRow.push(coded);
      } else {
        // quantitatif
        const coded = row[f.name + "_coded"] !== undefined
          ? row[f.name + "_coded"]
          : encode(row[f.name], f.min, f.max);
        xRow.push(coded);
      }
    });

    // Interactions (produit des colonnes déjà calculées dans xRow)
    interactionDefs.forEach(({ ci, cj }) => {
      xRow.push(xRow[ci] * xRow[cj]);
    });

    // Termes quadratiques
    quadDefs.forEach(col => {
      xRow.push(xRow[col] * xRow[col]);
    });

    X.push(xRow);
  });

  return { X, termNames, factorColMap };
}

// helper : tableau [start..end] inclus
function range(start, end) {
  const out = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

// ─── Régression par moindres carrés ──────────────────────────────────────────

function leastSquares(X, Y) {
  const Xt   = matTranspose(X);
  const XtX  = matMul(Xt, X);
  const XtXi = matInverse(XtX);
  if (!XtXi) return null;

  const XtY  = matMul(Xt, Y.map(v => [v]));
  const beta = matMul(XtXi, XtY).map(r => r[0]);

  const yHat = X.map(row => row.reduce((s,v,j) => s + v*beta[j], 0));
  const resid = Y.map((y,i) => y - yHat[i]);

  const yMean = mean(Y);
  const SST   = Y.reduce((s,y) => s + (y-yMean)**2, 0);
  const SSE   = resid.reduce((s,r) => s + r**2, 0);
  const SSR   = SST - SSE;

  const n  = Y.length;
  const p  = beta.length;
  const dfR = p - 1;
  const dfE = n - p;
  const dfT = n - 1;

  const MSR = dfR > 0 ? SSR / dfR : 0;
  const MSE = dfE > 0 ? SSE / dfE : 0;
  const F   = MSE > 0 ? MSR / MSE : 0;
  const pF  = fDistPValue(F, dfR, dfE);

  const R2    = SST > 0 ? SSR / SST : 0;
  const R2adj = 1 - (1 - R2) * (n - 1) / Math.max(dfE, 1);

  const seB = XtXi
    ? XtXi.map((row, j) => Math.sqrt(Math.abs(row[j]) * MSE))
    : beta.map(() => 0);

  const tStat = beta.map((b, j) => seB[j] > 0 ? b / seB[j] : 0);
  const pT = tStat.map(t => {
    const absT = Math.abs(t);
    if (dfE > 30) return 2 * (1 - normalCDF(absT));
    return fDistPValue(t*t, 1, dfE);
  });

  return {
    beta, seB, tStat, pT,
    yHat, resid,
    SST, SSR, SSE,
    dfR, dfE, dfT,
    MSR, MSE, F, pF,
    R2, R2adj,
    RMSE: Math.sqrt(MSE),
    n, p,
    XtXi,
  };
}

function normalCDF(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744))));
  return x > 0 ? 1 - prob : prob;
}

// ─── ANOVA ────────────────────────────────────────────────────────────────────

/**
 * [MODIF] buildANOVA : les facteurs qualitatifs multi-niveaux ont df > 1.
 * La table ANOVA groupe toutes les colonnes dummy d'un même facteur en 1 ligne.
 */
function buildANOVA(X, Y, beta, termNames, reg, factors, factorColMap) {
  const n  = Y.length;
  const p  = beta.length;

  // SS séquentielles terme par terme
  const termSS = [];
  let prevSSR = 0;
  for (let j = 1; j < p; j++) {
    const Xj = X.map(row => [...row.slice(0, j+1)]);
    const regJ = leastSquares(Xj, Y);
    if (!regJ) { termSS.push(0); continue; }
    termSS.push(Math.max(0, regJ.SSR - prevSSR));
    prevSSR = regJ.SSR;
  }

  const rows = [];

  if (factors && factorColMap) {
    // ── Ligne par facteur (groupe les dummy) ──────────────────────────────
    factors.forEach((f, fi) => {
      const { start, end } = factorColMap[fi];
      const df = end - start + 1; // nombre de colonnes = df pour ce facteur
      const SS = termSS.slice(start - 1, end).reduce((s, v) => s + (v||0), 0);
      rows.push({
        source: f.name + (isQual(f) ? " [qualitatif]" : ""),
        SS, df,
        MS: df > 0 ? SS / df : 0,
        F:  reg.MSE > 0 ? (SS / df) / reg.MSE : 0,
        p:  reg.MSE > 0 ? fDistPValue((SS / df) / reg.MSE, df, reg.dfE) : 1,
      });
    });

    // ── Interactions ──────────────────────────────────────────────────────
    // Colonnes après les effets principaux
    const mainEnd = factorColMap[factors.length - 1].end;
    let intStart = mainEnd; // 0-based dans termSS
    const nInteractionCols = termNames.filter(n => n.includes("×")).length;
    if (nInteractionCols > 0) {
      const intSS = termSS.slice(intStart, intStart + nInteractionCols).reduce((s,v)=>s+(v||0), 0);
      rows.push({
        source: "Interactions",
        SS: intSS, df: nInteractionCols,
        MS: intSS / nInteractionCols,
        F:  reg.MSE > 0 ? (intSS / nInteractionCols) / reg.MSE : 0,
        p:  reg.MSE > 0 ? fDistPValue((intSS / nInteractionCols) / reg.MSE, nInteractionCols, reg.dfE) : 1,
      });
    }
  } else {
    // Fallback : une ligne par terme
    termNames.slice(1).forEach((name, i) => {
      rows.push({
        source: name, SS: termSS[i]||0, df: 1,
        MS: termSS[i]||0,
        F:  reg.MSE > 0 ? (termSS[i]||0) / reg.MSE : 0,
        p:  reg.MSE > 0 ? fDistPValue((termSS[i]||0)/reg.MSE, 1, reg.dfE) : 1,
      });
    });
  }

  rows.push({ source: "Régression",     SS: reg.SSR, df: reg.dfR, MS: reg.MSR, F: reg.F, p: reg.pF, bold: true });
  rows.push({ source: "Résidu (Erreur)",SS: reg.SSE, df: reg.dfE, MS: reg.MSE, F: null, p: null });
  rows.push({ source: "Total",          SS: reg.SST, df: reg.dfT, MS: null,    F: null, p: null, bold: true });

  return rows;
}

// ─── Effets principaux ────────────────────────────────────────────────────────

/**
 * [MODIF] computeMainEffects :
 * - Pour un facteur quantitatif : calcul entre -1 et +1 (inchangé)
 * - Pour un facteur qualitatif : calcul de la réponse prédite pour chaque modalité
 */
function computeMainEffects(factors, beta, termNames, modelOrder, factorColMap) {
  const effects = {};

  factors.forEach((f, fi) => {
    if (isQual(f)) {
      // [MODIF] : calculer la réponse prédite pour chaque modalité
      const catPreds = f.categories.map(cat => {
        const xVec = new Array(termNames.length).fill(0);
        xVec[0] = 1;
        if (f.categories.length > 2) {
          const dummy = dummyEncode(cat, f);
          dummy.forEach((d, d_i) => {
            const col = factorColMap[fi].start + d_i;
            if (col < xVec.length) xVec[col] = d;
          });
        } else {
          const col = factorColMap[fi].start;
          if (col < xVec.length) xVec[col] = encodeQualBinary(cat, f);
        }
        return beta.reduce((s, b, j) => s + b * xVec[j], 0);
      });
      const yMin = Math.min(...catPreds);
      const yMax = Math.max(...catPreds);
      effects[f.name] = {
        type:       "qualitative",
        categories: f.categories,
        catPreds,
        low:        +yMin.toFixed(4),
        high:       +yMax.toFixed(4),
        effect:     +(yMax - yMin).toFixed(4),
        coef:       0,
      };
    } else {
      // Quantitatif (inchangé)
      const col = factorColMap[fi].start;
      const xLow  = new Array(termNames.length).fill(0); xLow[0] = 1;  xLow[col] = -1;
      const xHigh = new Array(termNames.length).fill(0); xHigh[0] = 1; xHigh[col] = 1;
      const yLow  = beta.reduce((s,b,j) => s + b*xLow[j],  0);
      const yHigh = beta.reduce((s,b,j) => s + b*xHigh[j], 0);
      effects[f.name] = {
        type:   "quantitative",
        low:    +yLow.toFixed(4),
        high:   +yHigh.toFixed(4),
        effect: +(yHigh - yLow).toFixed(4),
        coef:   +beta[col].toFixed(4),
      };
    }
  });

  return effects;
}

/**
 * [MODIF] getMainEffectCurve :
 * - Quantitatif : courbe continue (inchangé)
 * - Qualitatif : points discrets, un par modalité
 */
function getMainEffectCurve(factorIdx, factors, beta, termNames, nPts, factorColMap) {
  nPts = nPts || 30;
  const f = factors[factorIdx];

  if (isQual(f)) {
    // [MODIF] : points discrets pour chaque modalité
    return f.categories.map((cat, ci) => {
      const xVec = new Array(termNames.length).fill(0);
      xVec[0] = 1;
      if (f.categories.length > 2) {
        const dummy = dummyEncode(cat, f);
        dummy.forEach((d, d_i) => {
          const col = factorColMap[factorIdx].start + d_i;
          if (col < xVec.length) xVec[col] = d;
        });
      } else {
        const col = factorColMap[factorIdx].start;
        if (col < xVec.length) xVec[col] = encodeQualBinary(cat, f);
      }
      const y = beta.reduce((s, b, j) => s + b * xVec[j], 0);
      return { x: ci, label: cat, y: +y.toFixed(4), coded: ci };
    });
  }

  // Quantitatif (inchangé sauf on utilise factorColMap)
  const col = factorColMap ? factorColMap[factorIdx].start : factorIdx + 1;
  const points = [];
  for (let i = 0; i <= nPts; i++) {
    const coded = -1 + 2 * i / nPts;
    const x = new Array(termNames.length).fill(0);
    x[0] = 1;
    x[col] = coded;

    // Terme quadratique éventuel
    const quadName = f.name + "²";
    const quadIdx = termNames.indexOf(quadName);
    if (quadIdx >= 0) x[quadIdx] = coded * coded;

    const y = beta.reduce((s,b,j) => s + b*x[j], 0);
    const realX = decode(coded, f.min, f.max);
    points.push({ x: +realX.toFixed(4), y: +y.toFixed(4), coded });
  }
  return points;
}

// ─── Surface de réponse ───────────────────────────────────────────────────────

/**
 * [MODIF] computeResponseSurface :
 * - Si les deux facteurs sont quantitatifs : grille continue (inchangé)
 * - Si un facteur est qualitatif : grille discrète sur les modalités × continue
 * - Si les deux sont qualitatifs : grille discrète m×n
 */
function computeResponseSurface(fi, fj, factors, beta, termNames, gridN, factorColMap) {
  gridN = gridN || 25;
  const fA = factors[fi], fB = factors[fj];
  const qualA = isQual(fA), qualB = isQual(fB);

  // Axes
  const axisA = qualA
    ? fA.categories.map((cat, i) => ({ val: i, label: cat, coded: encodeQualBinary(cat, fA), cat }))
    : Array.from({length: gridN + 1}, (_, i) => {
        const coded = -1 + 2*i/gridN;
        return { val: decode(coded, fA.min, fA.max), label: null, coded };
      });
  const axisB = qualB
    ? fB.categories.map((cat, i) => ({ val: i, label: cat, coded: encodeQualBinary(cat, fB), cat }))
    : Array.from({length: gridN + 1}, (_, i) => {
        const coded = -1 + 2*i/gridN;
        return { val: decode(coded, fB.min, fB.max), label: null, coded };
      });

  const grid = [];
  let zMin = Infinity, zMax = -Infinity;

  for (let r = 0; r < axisB.length; r++) {
    const row = [];
    for (let c = 0; c < axisA.length; c++) {
      const xVec = new Array(termNames.length).fill(0);
      xVec[0] = 1;

      // Facteur A
      if (qualA && fA.categories.length > 2) {
        const dummy = dummyEncode(axisA[c].cat, fA);
        dummy.forEach((d, d_i) => {
          const col = factorColMap[fi].start + d_i;
          if (col < xVec.length) xVec[col] = d;
        });
      } else {
        const colA = factorColMap ? factorColMap[fi].start : fi + 1;
        if (colA < xVec.length) xVec[colA] = axisA[c].coded;
      }

      // Facteur B
      if (qualB && fB.categories.length > 2) {
        const dummy = dummyEncode(axisB[r].cat, fB);
        dummy.forEach((d, d_i) => {
          const col = factorColMap[fj].start + d_i;
          if (col < xVec.length) xVec[col] = d;
        });
      } else {
        const colB = factorColMap ? factorColMap[fj].start : fj + 1;
        if (colB < xVec.length) xVec[colB] = axisB[r].coded;
      }

      // Terme quadratique pour A (si quantitatif)
      if (!qualA) {
        const quadName = fA.name + "²";
        const qi = termNames.indexOf(quadName);
        if (qi >= 0) xVec[qi] = axisA[c].coded * axisA[c].coded;
      }
      // Terme quadratique pour B (si quantitatif)
      if (!qualB) {
        const quadName = fB.name + "²";
        const qi = termNames.indexOf(quadName);
        if (qi >= 0) xVec[qi] = axisB[r].coded * axisB[r].coded;
      }

      const z = beta.reduce((s,b,j) => s + b*xVec[j], 0);
      row.push(+z.toFixed(4));
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
    }
    grid.push(row);
  }

  return {
    grid,
    gridN: axisA.length, // peut être différent de gridN si qualitatif
    xFactor: {
      ...fA,
      isQual: qualA,
      axisLabels: qualA ? fA.categories : null,
      min: qualA ? 0 : fA.min,
      max: qualA ? fA.categories.length - 1 : fA.max,
    },
    yFactor: {
      ...fB,
      isQual: qualB,
      axisLabels: qualB ? fB.categories : null,
      min: qualB ? 0 : fB.min,
      max: qualB ? fB.categories.length - 1 : fB.max,
    },
    zMin: +zMin.toFixed(3),
    zMax: +zMax.toFixed(3),
  };
}

// ─── Optimisation ────────────────────────────────────────────────────────────

/**
 * [MODIF] optimize :
 * - Les facteurs qualitatifs sont échantillonnés sur leurs modalités
 * - Les facteurs quantitatifs sont traités comme avant (grille ou Monte-Carlo)
 */
function optimize(factors, beta, termNames, goal, target, gridRes, factorColMap) {
  gridRes = gridRes || 50;
  const k = factors.length;

  // Fonction de prédiction [MODIF] : gère dummy coding
  function predict(mixedVals) {
    // mixedVals[i] = valeur réelle pour qualitatif (string), codée pour quantitatif
    const xVec = new Array(termNames.length).fill(0);
    xVec[0] = 1;

    factors.forEach((f, fi) => {
      const val = mixedVals[fi];
      const map = factorColMap ? factorColMap[fi] : null;

      if (isQual(f) && f.categories.length > 2) {
        const dummy = dummyEncode(val, f);
        dummy.forEach((d, d_i) => {
          const col = map ? map.start + d_i : fi + 1 + d_i;
          if (col < xVec.length) xVec[col] = d;
        });
      } else if (isQual(f)) {
        const col = map ? map.start : fi + 1;
        if (col < xVec.length) xVec[col] = encodeQualBinary(val, f);
      } else {
        const col = map ? map.start : fi + 1;
        if (col < xVec.length) xVec[col] = val; // coded value
      }
    });

    // Interactions (produit des colonnes)
    termNames.forEach((name, ti) => {
      if (ti === 0 || !name.includes("×")) return;
      const parts = name.split("×");
      if (parts.length === 2) {
        // Retrouver les index colonnes pour chaque partie
        const ci = termNames.indexOf(parts[0]);
        const cj = termNames.indexOf(parts[1]);
        if (ci > 0 && cj > 0) xVec[ti] = xVec[ci] * xVec[cj];
      }
    });

    // Termes quadratiques
    termNames.forEach((name, ti) => {
      if (name.endsWith("²")) {
        const baseName = name.slice(0, -1);
        const ci = termNames.indexOf(baseName);
        if (ci > 0) xVec[ti] = xVec[ci] * xVec[ci];
      }
    });

    return beta.reduce((s, b, j) => s + b * xVec[j], 0);
  }

  function objective(y) {
    if (goal === "maximize") return -y;
    if (goal === "minimize") return y;
    return Math.abs(y - (target || 0));
  }

  // [MODIF] Générer les candidats en tenant compte des types
  const candidates = [];
  const nQuant = factors.filter(f => !isQual(f)).length;
  const nSamples = Math.max(5000, Math.pow(gridRes, Math.min(nQuant, 2)) * (nQuant <= 2 ? 1 : 50));

  // Monte-Carlo mixte
  for (let s = 0; s < nSamples; s++) {
    candidates.push(factors.map(f => {
      if (isQual(f)) {
        // Choisir une modalité au hasard
        return f.categories[Math.floor(Math.random() * f.categories.length)];
      }
      return -1 + 2 * Math.random(); // coded [-1, +1]
    }));
  }

  // Coins du domaine quantitatif × toutes les modalités qualitatives
  const nCorners = Math.min(64, Math.pow(2, Math.max(nQuant, 1)));
  const qualFactors = factors.filter(f => isQual(f));
  // Produit cartésien des modalités qualitatives
  const qualCombos = qualFactors.reduce((acc, f) => {
    const res = [];
    acc.forEach(a => f.categories.forEach(cat => res.push([...a, cat])));
    return res;
  }, [[]]);

  for (let c = 0; c < nCorners; c++) {
    qualCombos.forEach(qCombo => {
      let qIdx = 0;
      const cand = factors.map((f) => {
        if (isQual(f)) return qCombo[qIdx++];
        const bit = (c >> factors.filter(ff => !isQual(ff)).indexOf(f)) & 1;
        return bit === 0 ? -1 : 1;
      });
      candidates.push(cand);
    });
  }

  // Évaluer et trier
  const results = candidates.map(cand => {
    const y = predict(cand);
    return { cand, y: +y.toFixed(4), obj: objective(y) };
  });
  results.sort((a, b) => a.obj - b.obj);

  // Top 5 : convertir les valeurs codées en valeurs réelles
  const top5 = results.slice(0, 5).map(r => {
    const realVals = {};
    factors.forEach((f, i) => {
      if (isQual(f)) {
        realVals[f.name] = r.cand[i]; // déjà la modalité (string)
      } else {
        realVals[f.name] = +decode(r.cand[i], f.min, f.max).toFixed(4);
      }
    });
    return { ...realVals, predicted: r.y };
  });

  return { best: top5[0], top5 };
}

// ─── Pipeline complet ─────────────────────────────────────────────────────────

/**
 * [MODIF] analyzeResults : passe factorColMap à toutes les fonctions
 */
function analyzeResults(matrixWithResponses, factors, doeType) {
  const validRows = matrixWithResponses.filter(row =>
    typeof row.response === "number" && isFinite(row.response)
  );

  if (validRows.length < factors.length + 2) {
    throw new Error(`Pas assez de réponses : ${validRows.length} lignes, minimum ${factors.length + 2}`);
  }

  const Y = validRows.map(r => r.response);

  // Ordre du modèle : second ordre pour CCD et BBD (seulement si facteurs quanti disponibles)
  const hasQuant = factors.some(f => !isQual(f));
  const modelOrder = (hasQuant && (doeType === "ccd" || doeType === "bbd")) ? 2 : 1;

  const { X, termNames, factorColMap } = buildRegressionMatrix(validRows, factors, modelOrder);
  const reg = leastSquares(X, Y);

  if (!reg) throw new Error("Régression impossible — vérifiez la matrice (multicolinéarité ?)");

  const anova    = buildANOVA(X, Y, reg.beta, termNames, reg, factors, factorColMap);
  const effects  = computeMainEffects(factors, reg.beta, termNames, modelOrder, factorColMap);

  const effectCurves = factors.map((f, i) =>
    getMainEffectCurve(i, factors, reg.beta, termNames, 30, factorColMap)
  );

  const diagnostics = {
    R2:      +reg.R2.toFixed(4),
    R2adj:   +reg.R2adj.toFixed(4),
    RMSE:    +reg.RMSE.toFixed(4),
    n:       reg.n,
    p:       reg.p,
    adequate: reg.R2adj >= 0.8,
    pModel:  +reg.pF.toFixed(6),
    lackOfFit: null,
  };

  // Lack-of-fit (si points dupliqués)
  const dupGroups = {};
  validRows.forEach(row => {
    const key = factors.map(f => {
      if (isQual(f)) return row[f.name]; // [MODIF] clé textuelle pour qualitatif
      return (row[f.name + "_coded"] ?? encode(row[f.name], f.min, f.max)).toFixed(3);
    }).join(",");
    if (!dupGroups[key]) dupGroups[key] = [];
    dupGroups[key].push(row.response);
  });
  const purErrorGroups = Object.values(dupGroups).filter(g => g.length > 1);
  if (purErrorGroups.length > 0) {
    const SSPE = purErrorGroups.reduce((s, g) => {
      const gm = mean(g);
      return s + g.reduce((ss, v) => ss + (v-gm)**2, 0);
    }, 0);
    const dfPE = purErrorGroups.reduce((s, g) => s + g.length - 1, 0);
    const SSLOF = Math.max(0, reg.SSE - SSPE);
    const dfLOF = reg.dfE - dfPE;
    const FSLOF = dfPE > 0 && dfLOF > 0 ? (SSLOF/dfLOF) / (SSPE/dfPE) : 0;
    diagnostics.lackOfFit = {
      F: +FSLOF.toFixed(4),
      p: +fDistPValue(FSLOF, dfLOF, dfPE).toFixed(4),
      significant: fDistPValue(FSLOF, dfLOF, dfPE) < 0.05,
    };
  }

  return {
    reg, anova, effects, effectCurves,
    termNames, X, Y,
    modelOrder, diagnostics,
    factors, factorColMap, // [MODIF] exposer factorColMap
  };
}

// ─── Export ───────────────────────────────────────────────────────────────────

window.DOEEngine = {
  generateDOE,
  analyzeResults,
  computeResponseSurface,
  optimize,
  getMainEffectCurve,
  encode, decode,
  isQual,           // [MODIF] exposé pour taskpane et doeCharts
  dummyEncode,      // [MODIF]
  encodeQualBinary, // [MODIF]
};