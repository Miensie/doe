/**
 * ================================================================
 * doeCharts.js — Graphiques SVG pour l'analyse DOE
 * Effets principaux, interactions, surface de réponse
 *
 * [MODIF] Support des facteurs qualitatifs :
 *  - buildMainEffectsChart : tracé discret (barres) pour qualitatifs
 *  - buildInteractionChart : autant de courbes que de modalités du facteur B
 *  - buildResponseSurfaceChart : axes discrets si facteur qualitatif
 * ================================================================
 */
"use strict";

// ─── Utilitaires SVG ─────────────────────────────────────────────────────────

const COLORS = {
  cyan:    "#00E5FF",
  green:   "#00E676",
  orange:  "#FF9800",
  purple:  "#CE93D8",
  red:     "#FF5252",
  yellow:  "#FFEB3B",
  blue:    "#40C4FF",
  pink:    "#FF80AB",
};
const PALETTE = Object.values(COLORS);

function svgOpen(w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block;background:#0D1B2A;border-radius:6px">`;
}
function svgClose() { return '</svg>'; }

function tickFormat(v) {
  if (Math.abs(v) >= 1000) return (v/1000).toFixed(1) + "k";
  if (Math.abs(v) < 1 && v !== 0) return v.toFixed(2);
  return v.toFixed(1);
}

// [MODIF] Helper : est-ce que ce facteur est qualitatif ?
function isQual(f) {
  return f && f.type === "qualitative" && Array.isArray(f.categories) && f.categories.length >= 2;
}

// ─── Graphique des effets principaux ─────────────────────────────────────────

/**
 * [MODIF] buildMainEffectsChart :
 * - Facteur quantitatif → courbe continue (inchangé)
 * - Facteur qualitatif  → segments entre points discrets + marqueurs par modalité
 *
 * Les courbes qualitatives utilisent les labels des modalités sur l'axe X
 * et des marqueurs carrés pour les distinguer des courbes continues.
 */
function buildMainEffectsChart(effectCurves, factors, responseLabel, factorColMap) {
  const W = 760, H = 280;
  const ML = 52, MR = 20, MT = 24, MB = 55;
  const CW = W - ML - MR, CH = H - MT - MB;

  const allY = effectCurves.flat().map(p => p.y);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;
  const yLo = yMin - yRange * 0.08, yHi = yMax + yRange * 0.08;

  function py(y) {
    return MT + CH - (y - yLo) / (yHi - yLo) * CH;
  }

  // Pour un facteur quantitatif : px basé sur la valeur réelle
  function pxQuant(x, f) {
    return ML + (x - f.min) / (f.max - f.min) * CW;
  }

  // Pour un facteur qualitatif : px basé sur l'index de modalité (0-based)
  function pxQual(idx, nCats) {
    if (nCats <= 1) return ML + CW / 2;
    return ML + (idx / (nCats - 1)) * CW;
  }

  let svg = svgOpen(W, H);
  svg += `<rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="#132236" rx="2"/>`;

  // Grille Y
  for (let i = 0; i <= 5; i++) {
    const yv = yLo + i * (yHi - yLo) / 5;
    const yp = py(yv).toFixed(1);
    svg += `<line x1="${ML}" y1="${yp}" x2="${ML+CW}" y2="${yp}" stroke="#1F3550" stroke-width="0.7"/>`;
    svg += `<text x="${ML-5}" y="${+yp+4}" text-anchor="end" font-size="9" fill="#4A6A8A" font-family="JetBrains Mono,monospace">${tickFormat(yv)}</text>`;
  }

  if (yLo < 0 && yHi > 0) {
    const y0 = py(0).toFixed(1);
    svg += `<line x1="${ML}" y1="${y0}" x2="${ML+CW}" y2="${y0}" stroke="#243B57" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }

  // ── Tracer chaque courbe ──────────────────────────────────────────────────
  effectCurves.forEach((curve, fi) => {
    const f   = factors[fi];
    const col = PALETTE[fi % PALETTE.length];
    const qual = isQual(f);

    if (qual) {
      // [MODIF] Facteur QUALITATIF : points discrets reliés par des tirets
      const nCats = f.categories.length;
      let path = "";
      const pts = [];

      curve.forEach((pt, i) => {
        const x = pxQual(pt.x, nCats).toFixed(1); // pt.x = index modalité
        const y = py(pt.y).toFixed(1);
        path += (i === 0 ? `M${x},${y}` : `L${x},${y}`);
        pts.push({ x, y, label: pt.label });
      });

      // Ligne en tirets pour signaler le caractère discret
      svg += `<path d="${path}" fill="none" stroke="${col}" stroke-width="1.8" stroke-dasharray="6,3" opacity="0.85"/>`;

      // Marqueurs carrés (≠ ronds pour quantitatif)
      pts.forEach(pt => {
        svg += `<rect x="${+pt.x-5}" y="${+pt.y-5}" width="10" height="10" fill="${col}" stroke="#0D1B2A" stroke-width="1.5" rx="2"/>`;
      });

      // Labels des modalités sous l'axe X
      pts.forEach(pt => {
        svg += `<text x="${pt.x}" y="${MT+CH+16}" text-anchor="middle" font-size="8" fill="${col}" font-family="DM Sans,sans-serif">${pt.label}</text>`;
      });

      // Étiquette du facteur
      svg += `<text x="${ML+CW/2}" y="${MT+CH+28}" text-anchor="middle" font-size="8" fill="${col}" font-family="DM Sans,sans-serif" font-style="italic">${f.name}</text>`;

    } else {
      // Facteur QUANTITATIF : courbe continue (comportement original)
      let path = "";
      curve.forEach((pt, i) => {
        const x = pxQuant(pt.x, f).toFixed(1);
        const y = py(pt.y).toFixed(1);
        path += (i === 0 ? `M${x},${y}` : `L${x},${y}`);
      });
      svg += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2" opacity="0.9"/>`;

      // Points extrêmes
      const ptLow  = curve[0];
      const ptHigh = curve[curve.length-1];
      svg += `<circle cx="${pxQuant(ptLow.x,f).toFixed(1)}"  cy="${py(ptLow.y).toFixed(1)}"  r="4" fill="${col}" stroke="#0D1B2A" stroke-width="1.5"/>`;
      svg += `<circle cx="${pxQuant(ptHigh.x,f).toFixed(1)}" cy="${py(ptHigh.y).toFixed(1)}" r="4" fill="${col}" stroke="#0D1B2A" stroke-width="1.5"/>`;

      // Ticks X
      for (let t = 0; t <= 4; t++) {
        const xv = f.min + t * (f.max - f.min) / 4;
        const xp = pxQuant(xv, f).toFixed(1);
        svg += `<line x1="${xp}" y1="${MT+CH}" x2="${xp}" y2="${MT+CH+4}" stroke="#4A6A8A" stroke-width="0.7"/>`;
      }
    }
  });

  // Axes labels génériques (quantitatifs uniquement)
  const hasOnlyQuant = factors.every(f => !isQual(f));
  if (hasOnlyQuant) {
    svg += `<text x="${ML+CW/2}" y="${H-4}" text-anchor="middle" font-size="9" fill="#7B9DB8" font-family="DM Sans,sans-serif">Valeur des facteurs</text>`;
  }
  svg += `<text transform="rotate(-90,14,${MT+CH/2})" x="14" y="${MT+CH/2+4}" text-anchor="middle" font-size="9" fill="#7B9DB8" font-family="DM Sans,sans-serif">${responseLabel || "Réponse"}</text>`;

  // Légende
  factors.forEach((f, fi) => {
    const col  = PALETTE[fi % PALETTE.length];
    const lx   = ML + fi * 160;
    const ly   = H - 10;
    const qual = isQual(f);
    if (qual) {
      // [MODIF] Petite icône carrée pour qualitatif dans la légende
      svg += `<rect x="${lx}" y="${ly-9}" width="10" height="10" fill="${col}" rx="2"/>`;
      svg += `<text x="${lx+14}" y="${ly}" font-size="9" fill="${col}" font-family="DM Sans,sans-serif">${f.name} 🔤</text>`;
    } else {
      svg += `<line x1="${lx}" y1="${ly-3}" x2="${lx+20}" y2="${ly-3}" stroke="${col}" stroke-width="2"/>`;
      svg += `<text x="${lx+24}" y="${ly}" font-size="9" fill="${col}" font-family="DM Sans,sans-serif">${f.name}</text>`;
    }
  });

  svg += svgClose();
  return svg;
}

// ─── Graphique des interactions ───────────────────────────────────────────────

/**
 * [MODIF] buildInteractionChart :
 * - Si fj est quantitatif : 2 courbes bas/haut comme avant
 * - Si fj est qualitatif  : autant de courbes que de modalités (une couleur par modalité)
 * - Si fi est qualitatif  : l'axe X est discret (points indexés)
 */
function buildInteractionChart(factors, beta, termNames, responseLabel, factorColMap) {
  const k = factors.length;
  if (k < 2) return "<p style='color:#4A6A8A;font-size:11px;padding:8px'>Au moins 2 facteurs requis pour les interactions.</p>";

  const pairs = [];
  for (let i = 0; i < k-1; i++) {
    for (let j = i+1; j < k; j++) {
      pairs.push([i, j]);
    }
  }

  const nPairs = pairs.length;
  const cellW = 220, cellH = 160, gap = 12;
  const cols = Math.min(nPairs, 3);
  const rows = Math.ceil(nPairs / cols);
  const W = cols * cellW + (cols+1)*gap;
  const H = rows * cellH + (rows+1)*gap;

  let svg = svgOpen(W, H);
  svg += `<rect width="${W}" height="${H}" fill="#0D1B2A" rx="6"/>`;

  // ── Prédiction générique (quant codé OU qual string) ──────────────────────
  function predictAt(mixedVals) {
    const xVec = new Array(termNames.length).fill(0);
    xVec[0] = 1;

    factors.forEach((f, fi) => {
      const val = mixedVals[fi];
      const map = factorColMap ? factorColMap[fi] : null;
      const col = map ? map.start : fi + 1;

      if (isQual(f) && f.categories.length > 2) {
        const idx = f.categories.indexOf(val);
        f.categories.slice(1).forEach((_, d_i) => {
          const c = map ? map.start + d_i : fi + 1 + d_i;
          if (c < xVec.length) xVec[c] = (idx === d_i + 1) ? 1 : 0;
        });
      } else if (isQual(f)) {
        if (col < xVec.length) xVec[col] = f.categories.indexOf(val) === 1 ? 1 : -1;
      } else {
        if (col < xVec.length) xVec[col] = val; // coded
      }
    });

    // Interactions
    termNames.forEach((name, ti) => {
      if (ti === 0 || !name.includes("×")) return;
      const parts = name.split("×");
      if (parts.length === 2) {
        const ci = termNames.indexOf(parts[0]);
        const cj = termNames.indexOf(parts[1]);
        if (ci > 0 && cj > 0) xVec[ti] = xVec[ci] * xVec[cj];
      }
    });

    // Quadratiques
    termNames.forEach((name, ti) => {
      if (name.endsWith("²")) {
        const ci = termNames.indexOf(name.slice(0,-1));
        if (ci > 0) xVec[ti] = xVec[ci] * xVec[ci];
      }
    });

    return beta.reduce((s, b, j) => s + b * xVec[j], 0);
  }

  pairs.forEach(([fi, fj], idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const ox = gap + col * (cellW + gap);
    const oy = gap + row * (cellH + gap);
    const ml = 34, mr = 6, mt = 22, mb = 30;
    const cw = cellW - ml - mr;
    const ch = cellH - mt - mb;

    const fA = factors[fi], fB = factors[fj];
    const qualA = isQual(fA), qualB = isQual(fB);
    const nPts  = 20;

    // [MODIF] Déterminer les "niveaux" du facteur B pour les courbes
    let bLevels; // [{label, val}]
    if (qualB) {
      bLevels = fB.categories.map(cat => ({ label: cat, val: cat }));
    } else {
      bLevels = [
        { label: fB.name + " (bas)",  val: -1 },
        { label: fB.name + " (haut)", val:  1 },
      ];
    }

    // [MODIF] Générer les courbes pour chaque niveau de B
    const curves = bLevels.map(bl => {
      const pts = [];
      if (qualA) {
        // Axe A discret
        fA.categories.forEach((catA, ci) => {
          const base = factors.map((f, fIdx) => {
            if (fIdx === fi) return qualA ? catA : 0;
            if (fIdx === fj) return bl.val;
            return isQual(f) ? f.categories[0] : 0;
          });
          pts.push({
            x: ci,
            label: catA,
            y: predictAt(base),
          });
        });
      } else {
        for (let p = 0; p <= nPts; p++) {
          const codedA = -1 + 2*p/nPts;
          const base = factors.map((f, fIdx) => {
            if (fIdx === fi) return codedA;
            if (fIdx === fj) return bl.val;
            return isQual(f) ? f.categories[0] : 0;
          });
          const realX = DOEEngine.decode(codedA, fA.min, fA.max);
          pts.push({ x: realX, label: null, y: predictAt(base) });
        }
      }
      return pts;
    });

    const allY = curves.flat().map(p => p.y);
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
    const yRange = yMax - yMin || 1;
    const yLo = yMin - yRange*0.1, yHi = yMax + yRange*0.1;

    function pxInter(pt, ptIdx) {
      if (qualA) {
        const n = fA.categories.length;
        return ox + ml + (ptIdx / Math.max(n-1, 1)) * cw;
      }
      return ox + ml + (pt.x - fA.min)/(fA.max - fA.min) * cw;
    }
    function pyInter(y) { return oy + mt + ch - (y - yLo)/(yHi - yLo) * ch; }

    // Fond cellule
    svg += `<rect x="${ox}" y="${oy}" width="${cellW}" height="${cellH}" fill="#132236" rx="4" stroke="#1F3550" stroke-width="1"/>`;
    svg += `<text x="${ox+cellW/2}" y="${oy+12}" text-anchor="middle" font-size="9" fill="#7B9DB8" font-family="DM Sans,sans-serif">${fA.name} × ${fB.name}</text>`;

    // Grilles Y
    for (let g = 0; g <= 3; g++) {
      const yv = yLo + g*(yHi-yLo)/3;
      const yp = pyInter(yv).toFixed(1);
      svg += `<line x1="${ox+ml}" y1="${yp}" x2="${ox+ml+cw}" y2="${yp}" stroke="#1F3550" stroke-width="0.5"/>`;
      svg += `<text x="${ox+ml-3}" y="${+yp+3}" text-anchor="end" font-size="7" fill="#4A6A8A" font-family="JetBrains Mono,monospace">${tickFormat(yv)}</text>`;
    }

    // [MODIF] Tracer chaque courbe
    curves.forEach((curve, ci) => {
      const curveCol = PALETTE[(fi * 4 + ci) % PALETTE.length];
      const isQualACurve = qualA;

      let path = "";
      curve.forEach((pt, pi) => {
        const x = pxInter(pt, pi).toFixed(1);
        const y = pyInter(pt.y).toFixed(1);
        path += (pi===0 ? `M${x},${y}` : `L${x},${y}`);
      });

      // Tirets si axe A qualitatif
      const dash = isQualACurve ? 'stroke-dasharray="5,2"' : '';
      svg += `<path d="${path}" fill="none" stroke="${curveCol}" stroke-width="1.5" ${dash}/>`;

      // Marqueurs
      curve.forEach((pt, pi) => {
        const x = pxInter(pt, pi).toFixed(1);
        const y = pyInter(pt.y).toFixed(1);
        if (isQualACurve) {
          svg += `<rect x="${+x-4}" y="${+y-4}" width="8" height="8" fill="${curveCol}" stroke="#0D1B2A" stroke-width="1" rx="1"/>`;
          // Label modalité A sous le point
          svg += `<text x="${x}" y="${oy+mt+ch+12}" text-anchor="middle" font-size="6" fill="#7B9DB8" font-family="DM Sans,sans-serif">${pt.label}</text>`;
        } else {
          svg += `<circle cx="${x}" cy="${y}" r="2.5" fill="${curveCol}"/>`;
        }
      });
    });

    // Légende des niveaux de B
    bLevels.forEach((bl, bi) => {
      const lCol = PALETTE[(fi * 4 + bi) % PALETTE.length];
      const legX = ox + ml + bi * Math.floor(cw / bLevels.length);
      const legY = oy + cellH - (qualA ? 18 : 10);
      svg += `<line x1="${legX}" y1="${legY}" x2="${legX+10}" y2="${legY}" stroke="${lCol}" stroke-width="1.5"/>`;
      svg += `<text x="${legX+12}" y="${legY+3}" font-size="6" fill="${lCol}" font-family="DM Sans,sans-serif">${bl.label}</text>`;
    });

    // Label axe X
    svg += `<text x="${ox+ml+cw/2}" y="${oy+cellH-4}" text-anchor="middle" font-size="7" fill="#4A6A8A" font-family="DM Sans,sans-serif">${fA.name}${qualA ? " 🔤" : ""}</text>`;
  });

  svg += svgClose();
  return svg;
}

// ─── Surface de réponse (contour plot SVG) ────────────────────────────────────

/**
 * [MODIF] buildResponseSurfaceChart :
 * - Si les deux axes sont quantitatifs : comportement original
 * - Si un axe est qualitatif : ticks discrets avec labels textuels
 */
function buildResponseSurfaceChart(surfData, responseLabel) {
  const { grid, gridN, xFactor, yFactor, zMin, zMax } = surfData;
  const W = 480, H = 380;
  const ML = 52, MR = 80, MT = 28, MB = 52;
  const CW = W - ML - MR, CH = H - MT - MB;

  const nRows = grid.length;
  const nCols = grid[0]?.length || 1;
  const cellW = CW / nCols;
  const cellH = CH / nRows;
  const zRange = zMax - zMin || 1;

  function heatColor(v) {
    const t = (v - zMin) / zRange;
    const stops = [
      [0,    [13,  27,  42 ]],
      [0.25, [0,   100, 200]],
      [0.5,  [0,   229, 255]],
      [0.75, [0,   230, 118]],
      [1.0,  [255, 152, 0  ]],
    ];
    let s = stops[0], e = stops[stops.length-1];
    for (let i = 0; i < stops.length-1; i++) {
      if (t >= stops[i][0] && t <= stops[i+1][0]) { s = stops[i]; e = stops[i+1]; break; }
    }
    const u = s[0] === e[0] ? 0 : (t - s[0]) / (e[0] - s[0]);
    const r = Math.round(s[1][0] + u*(e[1][0]-s[1][0]));
    const g = Math.round(s[1][1] + u*(e[1][1]-s[1][1]));
    const b = Math.round(s[1][2] + u*(e[1][2]-s[1][2]));
    return `rgb(${r},${g},${b})`;
  }

  let svg = svgOpen(W, H);
  svg += `<rect width="${W}" height="${H}" fill="#0D1B2A" rx="6"/>`;
  svg += `<rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="#132236"/>`;

  // Cellules colorées
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const z = grid[r][c];
      const x = ML + c * cellW;
      const y = MT + (nRows - 1 - r) * cellH;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellW+0.5).toFixed(1)}" height="${(cellH+0.5).toFixed(1)}" fill="${heatColor(z)}" opacity="0.85"/>`;
    }
  }

  // Lignes de contour (seulement si les deux axes sont quantitatifs)
  if (!xFactor.isQual && !yFactor.isQual) {
    const nContours = 6;
    for (let ci = 1; ci < nContours; ci++) {
      const zc = zMin + ci * zRange / nContours;
      const pts = [];
      for (let r = 0; r < nRows - 1; r++) {
        for (let c = 0; c < nCols - 1; c++) {
          const vals = [grid[r][c], grid[r][c+1], grid[r+1][c], grid[r+1][c+1]];
          if (vals.some(v => v >= zc) && vals.some(v => v < zc)) {
            const x = ML + c * cellW + cellW/2;
            const y = MT + (nRows - 1 - r) * cellH + cellH/2;
            pts.push([x.toFixed(1), y.toFixed(1)]);
          }
        }
      }
      if (pts.length > 2) {
        pts.sort((a,b) => +a[0]-+b[0]);
        const path = pts.map((p,i) => `${i?"L":"M"}${p[0]},${p[1]}`).join(" ");
        svg += `<path d="${path}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>`;
        if (pts.length > 0) {
          const lp = pts[Math.floor(pts.length/2)];
          svg += `<text x="${lp[0]}" y="${lp[1]}" font-size="7" fill="rgba(255,255,255,0.6)" text-anchor="middle" font-family="JetBrains Mono,monospace">${tickFormat(zc)}</text>`;
        }
      }
    }
  }

  // ── Axe X ─────────────────────────────────────────────────────────────────
  if (xFactor.isQual && xFactor.axisLabels) {
    // [MODIF] Ticks textuels pour qualitatif
    const nCats = xFactor.axisLabels.length;
    xFactor.axisLabels.forEach((label, i) => {
      const xp = (ML + (i / Math.max(nCats-1, 1)) * CW).toFixed(1);
      svg += `<line x1="${xp}" y1="${MT+CH}" x2="${xp}" y2="${MT+CH+4}" stroke="#CE93D8" stroke-width="1"/>`;
      svg += `<text x="${xp}" y="${MT+CH+14}" text-anchor="middle" font-size="8" fill="#CE93D8" font-family="DM Sans,sans-serif">${label}</text>`;
    });
  } else {
    const xTicks = 4;
    for (let t = 0; t <= xTicks; t++) {
      const xv = xFactor.min + t*(xFactor.max - xFactor.min)/xTicks;
      const xp = (ML + t*CW/xTicks).toFixed(1);
      svg += `<line x1="${xp}" y1="${MT+CH}" x2="${xp}" y2="${MT+CH+4}" stroke="#4A6A8A" stroke-width="0.7"/>`;
      svg += `<text x="${xp}" y="${MT+CH+14}" text-anchor="middle" font-size="8" fill="#7B9DB8" font-family="JetBrains Mono,monospace">${xv.toFixed(1)}</text>`;
    }
  }

  // ── Axe Y ─────────────────────────────────────────────────────────────────
  if (yFactor.isQual && yFactor.axisLabels) {
    // [MODIF] Ticks textuels pour qualitatif
    const nCats = yFactor.axisLabels.length;
    yFactor.axisLabels.forEach((label, i) => {
      const yp = (MT + CH - (i / Math.max(nCats-1, 1)) * CH).toFixed(1);
      svg += `<line x1="${ML-4}" y1="${yp}" x2="${ML}" y2="${yp}" stroke="#CE93D8" stroke-width="1"/>`;
      svg += `<text x="${ML-6}" y="${+yp+3}" text-anchor="end" font-size="8" fill="#CE93D8" font-family="DM Sans,sans-serif">${label}</text>`;
    });
  } else {
    const yTicks = 4;
    for (let t = 0; t <= yTicks; t++) {
      const yv = yFactor.min + t*(yFactor.max - yFactor.min)/yTicks;
      const yp = (MT + CH - t*CH/yTicks).toFixed(1);
      svg += `<line x1="${ML-4}" y1="${yp}" x2="${ML}" y2="${yp}" stroke="#4A6A8A" stroke-width="0.7"/>`;
      svg += `<text x="${ML-6}" y="${+yp+3}" text-anchor="end" font-size="8" fill="#7B9DB8" font-family="JetBrains Mono,monospace">${yv.toFixed(1)}</text>`;
    }
  }

  // Labels axes
  const xLabel = xFactor.name + (xFactor.isQual ? " 🔤" : "");
  const yLabel = yFactor.name + (yFactor.isQual ? " 🔤" : "");
  svg += `<text x="${ML+CW/2}" y="${H-6}" text-anchor="middle" font-size="10" fill="#B0C8DA" font-family="DM Sans,sans-serif">${xLabel}</text>`;
  svg += `<text transform="rotate(-90,14,${MT+CH/2})" x="14" y="${MT+CH/2+4}" text-anchor="middle" font-size="10" fill="#B0C8DA" font-family="DM Sans,sans-serif">${yLabel}</text>`;
  svg += `<text x="${ML+CW/2}" y="${MT-8}" text-anchor="middle" font-size="10" fill="#B0C8DA" font-family="DM Sans,sans-serif">${responseLabel || "Réponse"}</text>`;

  // Barre de couleur
  const cbX = ML + CW + 16, cbY = MT, cbH = CH, cbW = 16;
  for (let i = 0; i <= 40; i++) {
    const t2 = i/40;
    const z2 = zMin + t2 * zRange;
    const yc = (cbY + cbH - t2*cbH).toFixed(1);
    svg += `<rect x="${cbX}" y="${yc}" width="${cbW}" height="${(cbH/40+0.5).toFixed(1)}" fill="${heatColor(z2)}"/>`;
  }
  svg += `<text x="${cbX+cbW/2}" y="${cbY-4}" text-anchor="middle" font-size="8" fill="#7B9DB8" font-family="JetBrains Mono,monospace">${tickFormat(zMax)}</text>`;
  svg += `<text x="${cbX+cbW/2}" y="${cbY+cbH+12}" text-anchor="middle" font-size="8" fill="#7B9DB8" font-family="JetBrains Mono,monospace">${tickFormat(zMin)}</text>`;

  // [MODIF] Note si axes qualitatifs
  if (xFactor.isQual || yFactor.isQual) {
    svg += `<text x="${ML+CW/2}" y="${H-18}" text-anchor="middle" font-size="7" fill="#CE93D8" font-family="DM Sans,sans-serif">
      Les axes 🔤 sont qualitatifs (niveaux discrets)
    </text>`;
  }

  svg += svgClose();
  return svg;
}

window.DOECharts = {
  buildMainEffectsChart,
  buildInteractionChart,
  buildResponseSurfaceChart,
};