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
 * ================================================================
 */
"use strict";

// ─── Utilitaires mathématiques ────────────────────────────────────────────────

function matMul(A, B) {
  // Multiplication matricielle A (m×n) * B (n×p) → (m×p)
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
  // Inversion par élimination de Gauss-Jordan
  const n = A.length;
  const M = A.map(row => [...row]);
  const I = Array.from({length:n}, (_,i) => {
    const r = new Array(n).fill(0); r[i]=1; return r;
  });
  for (let col=0; col<n; col++) {
    // Pivot
    let maxRow = col;
    for (let r=col+1; r<n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow=r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    [I[col], I[maxRow]] = [I[maxRow], I[col]];
    const piv = M[col][col];
    if (Math.abs(piv) < 1e-14) return null; // singulière
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
  // p-valeur distribution F (approximation)
  if (!isFinite(F) || F < 0) return 1;
  if (F === 0) return 1;
  // Approximation par la distribution Beta régularisée (méthode numérique)
  const x = df2 / (df2 + df1 * F);
  return incompleteBeta(df2/2, df1/2, x);
}

function incompleteBeta(a, b, x) {
  // Approximation de la fonction bêta incomplète (Abramowitz & Stegun)
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const maxIter = 200, eps = 1e-10;
  // Série de continued fraction (Lentz)
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
  // Logarithme de la fonction Bêta
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a+b);
  const bt = Math.exp(Math.log(x)*a + Math.log(1-x)*b - lbeta);
  return bt * h / a;
}

function lgamma(x) {
  // Approximation de Lanczos pour ln(Gamma(x))
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

// ─── Génération des plans ─────────────────────────────────────────────────────

/**
 * Plan factoriel complet 2^k
 * Génère toutes les combinaisons de ±1 pour k facteurs
 */
function generateFullFactorial(factors) {
  const k = factors.length;
  const nRuns = Math.pow(2, k);
  const matrix = [];

  for (let run = 0; run < nRuns; run++) {
    const row = {};
    factors.forEach((f, i) => {
      // Bit i du numéro de run → ±1
      const bit = (run >> (k - 1 - i)) & 1;
      const coded = bit === 0 ? -1 : 1;
      row[f.name + "_coded"] = coded;
      row[f.name] = +(decode(coded, f.min, f.max)).toFixed(4);
    });
    row.run = run + 1;
    matrix.push(row);
  }

  // Ajouter les points centraux
  return matrix;
}

/**
 * Plan factoriel fractionnaire 2^(k-p)
 * Générateurs standards de Box et Hunter (1961)
 */
function generateFractionalFactorial(factors) {
  const k = factors.length;

  // Générateurs standards selon k
  // k=3, p=1 → 4 runs (résolution III) : C=AB
  // k=4, p=1 → 8 runs (résolution IV) : D=ABC
  // k=5, p=1 → 16 runs (résolution V) : E=ABCD
  // k=5, p=2 → 8 runs (résolution III) : D=AB, E=AC
  // k=6, p=2 → 16 runs : E=ABC, F=BCD
  // k=7, p=3 → 16 runs : E=ABC, F=ABD, G=ACD

  const generators = {
    3: { base: 2, gen: [(r,m) => m[0]*m[1]] },
    4: { base: 3, gen: [(r,m) => m[0]*m[1]*m[2]] },
    5: { base: 3, gen: [(r,m) => m[0]*m[1]*m[2], (r,m) => m[0]*m[1]] }, // V
    6: { base: 4, gen: [(r,m) => m[0]*m[1]*m[2], (r,m) => m[1]*m[2]*m[3]] },
    7: { base: 4, gen: [(r,m) => m[0]*m[1]*m[2], (r,m) => m[0]*m[1]*m[3], (r,m) => m[0]*m[2]*m[3]] },
  };

  const cfg = generators[Math.min(k, 7)] || generators[7];
  const baseMatrix = generateFullFactorial(factors.slice(0, cfg.base));
  const matrix = [];

  baseMatrix.forEach((row, ri) => {
    const baseCoded = factors.slice(0, cfg.base).map(f => row[f.name + "_coded"]);
    const newRow = { ...row, run: ri + 1 };

    // Ajouter les facteurs générés
    cfg.gen.forEach((gen, gi) => {
      if (cfg.base + gi < k) {
        const f = factors[cfg.base + gi];
        const coded = gen(ri, baseCoded);
        newRow[f.name + "_coded"] = coded;
        newRow[f.name] = +(decode(coded, f.min, f.max)).toFixed(4);
      }
    });
    matrix.push(newRow);
  });

  return matrix;
}

/**
 * Central Composite Design (CCD)
 * = 2^k factoriel + 2k points axiaux + nc points centraux
 * α = (2^k)^(1/4) pour orthogonalité
 */
function generateCCD(factors) {
  const k = factors.length;
  const alpha = Math.pow(Math.pow(2, k), 0.25); // valeur axiale
  const matrix = [];
  let run = 1;

  // 1. Points factoriels (±1)
  const factorial = generateFullFactorial(factors);
  factorial.forEach(row => {
    const newRow = { ...row, run: run++, type: "Factoriel" };
    matrix.push(newRow);
  });

  // 2. Points axiaux (±α sur chaque axe, 0 pour les autres)
  factors.forEach((f, i) => {
    [-alpha, alpha].forEach(a => {
      const row = { run: run++, type: "Axial" };
      factors.forEach((ff, j) => {
        const coded = i === j ? a : 0;
        row[ff.name + "_coded"] = coded;
        row[ff.name] = +(decode(coded, ff.min, ff.max)).toFixed(4);
      });
      matrix.push(row);
    });
  });

  return { matrix, alpha: +alpha.toFixed(4) };
}

/**
 * Box-Behnken Design (BBD)
 * Disponible pour k=3,4,5,6,7 facteurs
 * Utilise des blocs incomplets équilibrés
 */
function generateBBD(factors) {
  const k = factors.length;
  if (k < 3) return { matrix: generateCCD(factors).matrix, note: "BBD→CCD (k<3)" };

  // Paires de facteurs variant à ±1 selon BBD
  // k=3: paires (1,2),(1,3),(2,3)
  // k=4: paires (1,2),(1,3),(1,4),(2,3),(2,4),(3,4)
  // Pour k>4, approximation par paires consécutives + circulaires
  const pairs = [];
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      pairs.push([i, j]);
    }
  }

  const matrix = [];
  let run = 1;

  pairs.forEach(([a, b]) => {
    // Pour chaque paire, 4 combinaisons ±1
    [[-1,-1],[-1,1],[1,-1],[1,1]].forEach(([va, vb]) => {
      const row = { run: run++, type: "BBD" };
      factors.forEach((f, i) => {
        let coded;
        if (i === a) coded = va;
        else if (i === b) coded = vb;
        else coded = 0;
        row[f.name + "_coded"] = coded;
        row[f.name] = +(decode(coded, f.min, f.max)).toFixed(4);
      });
      matrix.push(row);
    });
  });

  return { matrix };
}

/**
 * Ajoute les points centraux au plan
 */
function addCenterPoints(matrix, factors, nCenter) {
  const n = matrix.length;
  for (let c = 0; c < nCenter; c++) {
    const row = { run: n + c + 1, type: "Centre" };
    factors.forEach(f => {
      row[f.name + "_coded"] = 0;
      row[f.name] = +(decode(0, f.min, f.max)).toFixed(4);
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
      info.resolution = "V (rotatble)";
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
      // Plan à niveaux personnalisés : utilise les niveaux définis
      matrix = generateCustomLevels(factors);
      info.type = "Plan à niveaux personnalisés";
      break;
    }
    default:
      matrix = generateFullFactorial(factors);
      info.type = "Factoriel complet";
  }

  // Ajouter points centraux
  if (nCenterPts > 0) {
    addCenterPoints(matrix, factors, nCenterPts);
  }

  // Renuméroter les runs
  matrix.forEach((row, i) => { row.run = i + 1; });

  info.nRuns      = matrix.length;
  info.nFactors   = factors.length;
  info.nCenterPts = nCenterPts;
  info.factors    = factors;

  return { matrix, info };
}

/**
 * Plan à niveaux personnalisés (grille complète sur les niveaux définis)
 */
function generateCustomLevels(factors) {
  // Utilise les niveaux définis dans chaque facteur
  function cartesian(arrays) {
    return arrays.reduce((acc, arr) => {
      const res = [];
      acc.forEach(a => arr.forEach(b => res.push([...a, b])));
      return res;
    }, [[]]);
  }

  const levelArrays = factors.map(f => {
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
      row[f.name] = +combo[j].toFixed(4);
      row[f.name + "_coded"] = +(encode(combo[j], f.min, f.max)).toFixed(4);
    });
    return row;
  });
}

// ─── Construction de la matrice de régression ─────────────────────────────────

/**
 * Construit la matrice X pour la régression polynomiale (second ordre)
 * Termes : constante, effets principaux, carrés, interactions 2 à 2
 */
function buildRegressionMatrix(matrix, factors, modelOrder) {
  const k = factors.length;
  const X = [];
  const termNames = ["Intercept"];

  // Termes du premier ordre
  factors.forEach(f => termNames.push(f.name));

  // Interactions 2 à 2
  for (let i = 0; i < k - 1; i++) {
    for (let j = i + 1; j < k; j++) {
      termNames.push(factors[i].name + "×" + factors[j].name);
    }
  }

  // Termes du second ordre (si CCD ou BBD ou modelOrder === 2)
  if (modelOrder === 2) {
    factors.forEach(f => termNames.push(f.name + "²"));
  }

  matrix.forEach(row => {
    const xRow = [1]; // constante

    // Effets principaux
    factors.forEach(f => {
      xRow.push(row[f.name + "_coded"] || encode(row[f.name], f.min, f.max));
    });

    // Interactions 2 à 2
    for (let i = 0; i < k - 1; i++) {
      for (let j = i + 1; j < k; j++) {
        const xi = row[factors[i].name + "_coded"] || 0;
        const xj = row[factors[j].name + "_coded"] || 0;
        xRow.push(xi * xj);
      }
    }

    // Termes quadratiques
    if (modelOrder === 2) {
      factors.forEach(f => {
        const xi = row[f.name + "_coded"] || 0;
        xRow.push(xi * xi);
      });
    }

    X.push(xRow);
  });

  return { X, termNames };
}

// ─── Régression par moindres carrés ──────────────────────────────────────────

/**
 * Régression linéaire multiple : β = (X'X)^{-1} X'Y
 */
function leastSquares(X, Y) {
  const Xt   = matTranspose(X);
  const XtX  = matMul(Xt, X);
  const XtXi = matInverse(XtX);
  if (!XtXi) return null;

  const XtY  = matMul(Xt, Y.map(v => [v]));
  const beta = matMul(XtXi, XtY).map(r => r[0]);

  // Valeurs ajustées et résidus
  const yHat = X.map(row => row.reduce((s,v,j) => s + v*beta[j], 0));
  const resid = Y.map((y,i) => y - yHat[i]);

  // SS
  const yMean = mean(Y);
  const SST   = Y.reduce((s,y) => s + (y-yMean)**2, 0);
  const SSE   = resid.reduce((s,r) => s + r**2, 0);
  const SSR   = SST - SSE;

  const n  = Y.length;
  const p  = beta.length; // nb termes dont constante
  const dfR = p - 1;
  const dfE = n - p;
  const dfT = n - 1;

  const MSR = dfR > 0 ? SSR / dfR : 0;
  const MSE = dfE > 0 ? SSE / dfE : 0;
  const F   = MSE > 0 ? MSR / MSE : 0;
  const pF  = fDistPValue(F, dfR, dfE);

  // R² et R² ajusté
  const R2    = SST > 0 ? SSR / SST : 0;
  const R2adj = 1 - (1 - R2) * (n - 1) / dfE;

  // Erreur standard des coefficients
  const seB = XtXi
    ? XtXi.map((row, j) => Math.sqrt(Math.abs(row[j]) * MSE))
    : beta.map(() => 0);

  // t-stats pour chaque coefficient
  const tStat = beta.map((b, j) => seB[j] > 0 ? b / seB[j] : 0);
  // p-valeur t (approximation bilatérale)
  const pT = tStat.map(t => {
    const absT = Math.abs(t);
    // Approximation p-valeur t par la queue normale si df > 30
    if (dfE > 30) {
      return 2 * (1 - normalCDF(absT));
    }
    // Sinon F(1, dfE) = t²
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

// ─── ANOVA pour le modèle DOE ─────────────────────────────────────────────────

/**
 * Construit la table ANOVA complète avec SS par terme
 */
function buildANOVA(X, Y, beta, termNames, reg) {
  const n  = Y.length;
  const p  = beta.length;
  const yMean = mean(Y);

  // SS pour chaque terme (séquentielles)
  const termSS = [];
  let currentX = [[...new Array(n).fill(1)]]; // constante seulement
  let prevSSR = 0;

  for (let j = 1; j < p; j++) {
    // Ajouter le terme j
    const Xj = X.map(row => [...row.slice(0,j+1)]);
    const regJ = leastSquares(Xj, Y);
    if (!regJ) { termSS.push(0); continue; }
    const ssJ = regJ.SSR - prevSSR;
    termSS.push(Math.max(0, ssJ));
    prevSSR = regJ.SSR;
  }

  // Table ANOVA
  const rows = termNames.slice(1).map((name, i) => ({
    source: name,
    SS:  termSS[i] || 0,
    df:  1,
    MS:  termSS[i] || 0,
    F:   reg.MSE > 0 ? (termSS[i]||0) / reg.MSE : 0,
    p:   reg.MSE > 0 ? fDistPValue((termSS[i]||0)/reg.MSE, 1, reg.dfE) : 1,
  }));

  // Régression totale
  rows.push({
    source: "Régression",
    SS: reg.SSR, df: reg.dfR, MS: reg.MSR,
    F: reg.F, p: reg.pF, bold: true,
  });

  // Erreur résiduelle
  rows.push({
    source: "Résidu (Erreur)",
    SS: reg.SSE, df: reg.dfE, MS: reg.MSE,
    F: null, p: null,
  });

  // Total
  rows.push({
    source: "Total",
    SS: reg.SST, df: reg.dfT, MS: null,
    F: null, p: null, bold: true,
  });

  return rows;
}

// ─── Effets principaux ────────────────────────────────────────────────────────

/**
 * Calcule l'effet moyen de chaque facteur en variant de -1 à +1
 * (autres facteurs au niveau central)
 */
function computeMainEffects(factors, beta, termNames, modelOrder) {
  const k = factors.length;
  const effects = {};

  factors.forEach((f, fi) => {
    // Prédire à x=-1 (tous les autres à 0)
    const xLow  = new Array(termNames.length).fill(0); xLow[0] = 1; xLow[fi+1] = -1;
    const xHigh = new Array(termNames.length).fill(0); xHigh[0] = 1; xHigh[fi+1] = 1;

    const yLow  = beta.reduce((s,b,j) => s + b*xLow[j],  0);
    const yHigh = beta.reduce((s,b,j) => s + b*xHigh[j], 0);

    effects[f.name] = {
      low:    +yLow.toFixed(4),
      high:   +yHigh.toFixed(4),
      effect: +(yHigh - yLow).toFixed(4),
      coef:   +beta[fi+1].toFixed(4),
    };
  });

  return effects;
}

/**
 * Génère les points pour le graphique des effets principaux
 */
function getMainEffectCurve(factorIdx, factors, beta, termNames, nPts) {
  nPts = nPts || 30;
  const points = [];

  for (let i = 0; i <= nPts; i++) {
    const coded = -1 + 2 * i / nPts;
    const x = new Array(termNames.length).fill(0);
    x[0] = 1; // constante
    x[factorIdx + 1] = coded; // facteur courant

    // Termes quadratiques
    const kOff = factors.length + 1 + (factors.length * (factors.length-1))/2;
    if (kOff + factorIdx < termNames.length) {
      x[kOff + factorIdx] = coded * coded;
    }

    const y = beta.reduce((s,b,j) => s + b*x[j], 0);
    const realX = decode(coded, factors[factorIdx].min, factors[factorIdx].max);
    points.push({ x: +realX.toFixed(4), y: +y.toFixed(4), coded });
  }
  return points;
}

// ─── Surface de réponse ───────────────────────────────────────────────────────

/**
 * Génère la grille pour la surface de réponse
 * @param {number} fi - index facteur X
 * @param {number} fj - index facteur Y
 * @param {Array}  factors
 * @param {Array}  beta
 * @param {Array}  termNames
 * @param {number} gridN - résolution de la grille
 */
function computeResponseSurface(fi, fj, factors, beta, termNames, gridN) {
  gridN = gridN || 25;
  const grid = [];
  let zMin = Infinity, zMax = -Infinity;

  for (let r = 0; r <= gridN; r++) {
    const row = [];
    const codedY = -1 + 2 * r / gridN;
    for (let c = 0; c <= gridN; c++) {
      const codedX = -1 + 2 * c / gridN;

      const x = new Array(termNames.length).fill(0);
      x[0] = 1;
      x[fi + 1] = codedX;
      x[fj + 1] = codedY;

      // Interaction xi×xj
      const k = factors.length;
      let intIdx = k + 1;
      for (let a = 0; a < k-1; a++) {
        for (let b = a+1; b < k; b++) {
          if ((a===fi && b===fj) || (a===fj && b===fi)) {
            x[intIdx] = codedX * codedY;
          }
          intIdx++;
        }
      }

      // Termes quadratiques
      if (intIdx + fi < termNames.length) x[intIdx + fi] = codedX * codedX;
      if (intIdx + fj < termNames.length) x[intIdx + fj] = codedY * codedY;

      const z = beta.reduce((s,b,j) => s + b*x[j], 0);
      row.push(+z.toFixed(4));
      zMin = Math.min(zMin, z);
      zMax = Math.max(zMax, z);
    }
    grid.push(row);
  }

  return {
    grid, gridN,
    xFactor: factors[fi],
    yFactor: factors[fj],
    zMin: +zMin.toFixed(3),
    zMax: +zMax.toFixed(3),
  };
}

// ─── Optimisation ────────────────────────────────────────────────────────────

/**
 * Optimisation par recherche sur grille dans l'espace codé
 * @param {string} goal - "maximize" | "minimize" | "target"
 * @param {number} target - valeur cible (si goal="target")
 */
function optimize(factors, beta, termNames, goal, target, gridRes) {
  gridRes = gridRes || 50;
  const k = factors.length;

  // Fonction de prédiction
  function predict(codedVals) {
    const x = new Array(termNames.length).fill(0);
    x[0] = 1;
    codedVals.forEach((v, i) => { x[i+1] = v; });

    // Interactions
    let intIdx = k + 1;
    for (let a = 0; a < k-1; a++) {
      for (let b = a+1; b < k; b++) {
        x[intIdx++] = codedVals[a] * codedVals[b];
      }
    }
    // Quadratiques
    codedVals.forEach((v, i) => {
      if (intIdx + i < termNames.length) x[intIdx + i] = v * v;
    });

    return beta.reduce((s, b, j) => s + b * x[j], 0);
  }

  // Fonction objectif
  function objective(y) {
    if (goal === "maximize") return -y;
    if (goal === "minimize") return y;
    return Math.abs(y - target);
  }

  // Grille de recherche (simplifiée pour k ≤ 4, sinon aléatoire)
  const candidates = [];
  const nSamples = Math.pow(gridRes, Math.min(k, 2)) * (k <= 2 ? 1 : 50);

  if (k <= 2) {
    for (let i = 0; i <= gridRes; i++) {
      const v0 = -1 + 2*i/gridRes;
      if (k === 1) {
        candidates.push([v0]);
      } else {
        for (let j = 0; j <= gridRes; j++) {
          const v1 = -1 + 2*j/gridRes;
          candidates.push([v0, v1]);
        }
      }
    }
  } else {
    // Monte-Carlo pour k > 2
    for (let s = 0; s < Math.max(nSamples, 5000); s++) {
      candidates.push(factors.map(() => -1 + 2*Math.random()));
    }
    // Ajouter les coins du domaine
    const nCorners = Math.min(64, Math.pow(2, k));
    for (let c = 0; c < nCorners; c++) {
      candidates.push(factors.map((_, i) => ((c >> i) & 1) ? 1 : -1));
    }
  }

  // Évaluer et trier
  const results = candidates.map(coded => {
    const y = predict(coded);
    return { coded, y: +y.toFixed(4), obj: objective(y) };
  });
  results.sort((a, b) => a.obj - b.obj);

  // Top 5
  const top5 = results.slice(0, 5).map(r => {
    const realVals = {};
    factors.forEach((f, i) => {
      realVals[f.name] = +decode(r.coded[i], f.min, f.max).toFixed(4);
    });
    return { ...realVals, predicted: r.y };
  });

  return { best: top5[0], top5 };
}

// ─── Pipeline complet ─────────────────────────────────────────────────────────

/**
 * Analyse complète d'un DOE avec réponses
 */
function analyzeResults(matrixWithResponses, factors, doeType) {
  // Filtrer les lignes avec réponses
  const validRows = matrixWithResponses.filter(row =>
    typeof row.response === "number" && isFinite(row.response)
  );

  if (validRows.length < factors.length + 2) {
    throw new Error(`Pas assez de réponses : ${validRows.length} lignes, minimum ${factors.length + 2}`);
  }

  const Y = validRows.map(r => r.response);

  // Ordre du modèle : second ordre pour CCD et BBD
  const modelOrder = (doeType === "ccd" || doeType === "bbd") ? 2 : 1;

  const { X, termNames } = buildRegressionMatrix(validRows, factors, modelOrder);
  const reg = leastSquares(X, Y);

  if (!reg) throw new Error("Régression impossible — vérifiez la matrice (multicolinéarité ?)");

  const anova    = buildANOVA(X, Y, reg.beta, termNames, reg);
  const effects  = computeMainEffects(factors, reg.beta, termNames, modelOrder);

  // Courbes d'effets principaux
  const effectCurves = factors.map((f, i) =>
    getMainEffectCurve(i, factors, reg.beta, termNames, 30)
  );

  // Diagnostics
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
    const key = factors.map(f => row[f.name + "_coded"]?.toFixed(3)).join(",");
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
    factors,
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
};
