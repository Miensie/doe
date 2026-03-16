/**
 * ================================================================
 * doeCharts.js — Graphiques SVG pour l'analyse DOE
 * Effets principaux, interactions, surface de réponse
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

// ─── Graphique des effets principaux ─────────────────────────────────────────

/**
 * Génère le graphique des effets principaux (one curve per factor)
 */
function buildMainEffectsChart(effectCurves, factors, responseLabel) {
  const W = 760, H = 280;
  const ML = 52, MR = 20, MT = 24, MB = 55;
  const CW = W - ML - MR, CH = H - MT - MB;

  // Plages
  const allY = effectCurves.flat().map(p => p.y);
  const allX = effectCurves.flat().map(p => p.x);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const yRange = yMax - yMin || 1;
  const yLo = yMin - yRange * 0.08, yHi = yMax + yRange * 0.08;

  function px(x, f) {
    return ML + (x - f.min) / (f.max - f.min) * CW;
  }
  function py(y) {
    return MT + CH - (y - yLo) / (yHi - yLo) * CH;
  }

  let svg = svgOpen(W, H);
  svg += `<rect x="${ML}" y="${MT}" width="${CW}" height="${CH}" fill="#132236" rx="2"/>`;

  // Grille Y
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const yv = yLo + i * (yHi - yLo) / yTicks;
    const yp = py(yv).toFixed(1);
    svg += `<line x1="${ML}" y1="${yp}" x2="${ML+CW}" y2="${yp}" stroke="#1F3550" stroke-width="0.7"/>`;
    svg += `<text x="${ML-5}" y="${+yp+4}" text-anchor="end" font-size="9" fill="#4A6A8A" font-family="JetBrains Mono,monospace">${tickFormat(yv)}</text>`;
  }

  // Ligne zéro si visible
  if (yLo < 0 && yHi > 0) {
    const y0 = py(0).toFixed(1);
    svg += `<line x1="${ML}" y1="${y0}" x2="${ML+CW}" y2="${y0}" stroke="#243B57" stroke-width="1.5" stroke-dasharray="4,3"/>`;
  }

  // Une courbe par facteur
  effectCurves.forEach((curve, fi) => {
    const f = factors[fi];
    const col = PALETTE[fi % PALETTE.length];
    let path = "";
    curve.forEach((pt, i) => {
      const x = px(pt.x, f).toFixed(1);
      const y = py(pt.y).toFixed(1);
      path += (i === 0 ? `M${x},${y}` : `L${x},${y}`);
    });
    svg += `<path d="${path}" fill="none" stroke="${col}" stroke-width="2" opacity="0.9"/>`;

    // Points min/max
    const ptLow  = curve[0];
    const ptHigh = curve[curve.length-1];
    svg += `<circle cx="${px(ptLow.x, f).toFixed(1)}" cy="${py(ptLow.y).toFixed(1)}" r="4" fill="${col}" stroke="#0D1B2A" stroke-width="1.5"/>`;
    svg += `<circle cx="${px(ptHigh.x, f).toFixed(1)}" cy="${py(ptHigh.y).toFixed(1)}" r="4" fill="${col}" stroke="#0D1B2A" stroke-width="1.5"/>`;

    // Axe X en bas
    const xTicks = 4;
    for (let t = 0; t <= xTicks; t++) {
      const xv = f.min + t * (f.max - f.min) / xTicks;
      const xp = px(xv, f).toFixed(1);
      svg += `<line x1="${xp}" y1="${MT+CH}" x2="${xp}" y2="${MT+CH+4}" stroke="#4A6A8A" stroke-width="0.7"/>`;
    }
  });

  // Axe X : label du premier facteur (simplification)
  svg += `<text x="${ML+CW/2}" y="${H-4}" text-anchor="middle" font-size="9" fill="#7B9DB8" font-family="DM Sans,sans-serif">Valeur des facteurs</text>`;

  // Axe Y label
  svg += `<text transform="rotate(-90,14,${MT+CH/2})" x="14" y="${MT+CH/2+4}" text-anchor="middle" font-size="9" fill="#7B9DB8" font-family="DM Sans,sans-serif">${responseLabel || "Réponse"}</text>`;

  // Légende
  factors.forEach((f, fi) => {
    const col = PALETTE[fi % PALETTE.length];
    const lx = ML + fi * 160;
    const ly = H - 10;
    svg += `<line x1="${lx}" y1="${ly-3}" x2="${lx+20}" y2="${ly-3}" stroke="${col}" stroke-width="2"/>`;
    svg += `<text x="${lx+24}" y="${ly}" font-size="9" fill="${col}" font-family="DM Sans,sans-serif">${f.name}</text>`;
  });

  svg += svgClose();
  return svg;
}

// ─── Graphique des interactions ───────────────────────────────────────────────

/**
 * Génère les graphiques d'interaction (grille fi×fj)
 * Pour chaque paire de facteurs : 2 courbes (niveau bas/haut du facteur B)
 */
function buildInteractionChart(factors, beta, termNames, responseLabel) {
  const k = factors.length;
  if (k < 2) return "<p style='color:#4A6A8A;font-size:11px;padding:8px'>Au moins 2 facteurs requis pour les interactions.</p>";

  // Pour chaque paire (fi, fj), tracer la réponse en variant fi à {-1,0,1} pour fj={-1,+1}
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

  function predictAt(codedVals) {
    const x = new Array(termNames.length).fill(0);
    x[0] = 1;
    codedVals.forEach((v, i) => { x[i+1] = v; });
    let intIdx = k + 1;
    for (let a = 0; a < k-1; a++) {
      for (let b = a+1; b < k; b++) {
        x[intIdx++] = codedVals[a] * codedVals[b];
      }
    }
    codedVals.forEach((v, i) => {
      if (intIdx + i < termNames.length) x[intIdx+i] = v*v;
    });
    return beta.reduce((s, b, j) => s + b*x[j], 0);
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
    const nPts = 20;

    // Prédire 2 courbes : fj = -1 et fj = +1
    const curve1 = [], curve2 = [];
    for (let p = 0; p <= nPts; p++) {
      const codedA = -1 + 2*p/nPts;
      const base = new Array(k).fill(0);
      base[fi] = codedA;
      base[fj] = -1;
      curve1.push({ x: decode(codedA, fA.min, fA.max), y: predictAt(base) });
      base[fj] = 1;
      curve2.push({ x: decode(codedA, fA.min, fA.max), y: predictAt(base) });
    }

    const allY = [...curve1, ...curve2].map(p => p.y);
    const yMin = Math.min(...allY), yMax = Math.max(...allY);
    const yRange = yMax - yMin || 1;
    const yLo = yMin - yRange*0.1, yHi = yMax + yRange*0.1;

    function px(x) { return ox + ml + (x - fA.min)/(fA.max - fA.min) * cw; }
    function py(y) { return oy + mt + ch - (y - yLo)/(yHi - yLo) * ch; }

    // Fond cellule
    svg += `<rect x="${ox}" y="${oy}" width="${cellW}" height="${cellH}" fill="#132236" rx="4" stroke="#1F3550" stroke-width="1"/>`;

    // Titre
    svg += `<text x="${ox+cellW/2}" y="${oy+12}" text-anchor="middle" font-size="9" fill="#7B9DB8" font-family="DM Sans,sans-serif">${fA.name} × ${fB.name}</text>`;

    // Grilles
    for (let g = 0; g <= 3; g++) {
      const yv = yLo + g*(yHi-yLo)/3;
      const yp = py(yv).toFixed(1);
      svg += `<line x1="${ox+ml}" y1="${yp}" x2="${ox+ml+cw}" y2="${yp}" stroke="#1F3550" stroke-width="0.5"/>`;
      svg += `<text x="${ox+ml-3}" y="${+yp+3}" text-anchor="end" font-size="7" fill="#4A6A8A" font-family="JetBrains Mono,monospace">${tickFormat(yv)}</text>`;
    }

    // Courbes
    [[curve1, COLORS.cyan, fB.name+" (bas)"], [curve2, COLORS.orange, fB.name+" (haut)"]].forEach(([curve, col, label]) => {
      let path = "";
      curve.forEach((pt, i) => {
        const x = px(pt.x).toFixed(1);
        const y = py(pt.y).toFixed(1);
        path += (i===0 ? `M${x},${y}` : `L${x},${y}`);
      });
      svg += `<path d="${path}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
    });

    // Labels axes
    svg += `<text x="${ox+ml+cw/2}" y="${oy+cellH-4}" text-anchor="middle" font-size="7" fill="#4A6A8A" font-family="DM Sans,sans-serif">${fA.name}</text>`;

    // Légende mini
    const leg1x = ox + ml;
    const leg2x = ox + ml + cw/2 + 4;
    svg += `<line x1="${leg1x}" y1="${oy+cellH-10}" x2="${leg1x+12}" y2="${oy+cellH-10}" stroke="${COLORS.cyan}" stroke-width="1.5"/>`;
    svg += `<text x="${leg1x+14}" y="${oy+cellH-7}" font-size="7" fill="${COLORS.cyan}" font-family="DM Sans,sans-serif">${fB.name} bas</text>`;
    svg += `<line x1="${leg2x}" y1="${oy+cellH-10}" x2="${leg2x+12}" y2="${oy+cellH-10}" stroke="${COLORS.orange}" stroke-width="1.5"/>`;
    svg += `<text x="${leg2x+14}" y="${oy+cellH-7}" font-size="7" fill="${COLORS.orange}" font-family="DM Sans,sans-serif">${fB.name} haut</text>`;
  });

  svg += svgClose();
  return svg;
}

// ─── Surface de réponse (contour plot SVG) ────────────────────────────────────

/**
 * Génère un contour plot de la surface de réponse
 */
function buildResponseSurfaceChart(surfData, responseLabel) {
  const { grid, gridN, xFactor, yFactor, zMin, zMax } = surfData;
  const W = 480, H = 380;
  const ML = 52, MR = 80, MT = 28, MB = 52;
  const CW = W - ML - MR, CH = H - MT - MB;

  const cellW = CW / gridN;
  const cellH = CH / gridN;
  const zRange = zMax - zMin || 1;

  // Palette de couleurs (bleu → cyan → vert → jaune → rouge)
  function heatColor(v) {
    const t = (v - zMin) / zRange;
    const stops = [
      [0,    [13,  27,  42 ]], // slate
      [0.25, [0,   100, 200]],
      [0.5,  [0,   229, 255]], // cyan
      [0.75, [0,   230, 118]], // green
      [1.0,  [255, 152, 0  ]], // orange
    ];
    let s = stops[0], e = stops[stops.length-1];
    for (let i = 0; i < stops.length-1; i++) {
      if (t >= stops[i][0] && t <= stops[i+1][0]) {
        s = stops[i]; e = stops[i+1]; break;
      }
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

  // Contour plot — grille de cellules colorées
  for (let r = 0; r < gridN; r++) {
    for (let c = 0; c < gridN; c++) {
      const z = grid[r][c];
      const x = ML + c * cellW;
      const y = MT + (gridN - 1 - r) * cellH;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellW+0.5).toFixed(1)}" height="${(cellH+0.5).toFixed(1)}" fill="${heatColor(z)}" opacity="0.85"/>`;
    }
  }

  // Contours (lignes d'iso-réponse)
  const nContours = 6;
  for (let ci = 1; ci < nContours; ci++) {
    const zc = zMin + ci * zRange / nContours;
    // Marching squares simplifié : points de croisement
    const pts = [];
    for (let r = 0; r < gridN - 1; r++) {
      for (let c = 0; c < gridN - 1; c++) {
        const v00 = grid[r][c], v01 = grid[r][c+1];
        const v10 = grid[r+1][c], v11 = grid[r+1][c+1];
        const cross = (v, [v00, v01, v10, v11].some(v2 => v2 >= zc) &&
                       [v00, v01, v10, v11].some(v2 => v2 < zc));
        if (cross) {
          const x = ML + c * cellW + cellW/2;
          const y = MT + (gridN - 1 - r) * cellH + cellH/2;
          pts.push([x.toFixed(1), y.toFixed(1)]);
        }
      }
    }
    if (pts.length > 2) {
      pts.sort((a,b) => +a[0]-+b[0]);
      const path = pts.map((p,i) => `${i?"L":"M"}${p[0]},${p[1]}`).join(" ");
      svg += `<path d="${path}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="0.8"/>`;
      // Label
      if (pts.length > 0) {
        const lp = pts[Math.floor(pts.length/2)];
        svg += `<text x="${lp[0]}" y="${lp[1]}" font-size="7" fill="rgba(255,255,255,0.6)" text-anchor="middle" font-family="JetBrains Mono,monospace">${tickFormat(zc)}</text>`;
      }
    }
  }

  // Axes
  const xTicks = 4, yTicks = 4;
  for (let t = 0; t <= xTicks; t++) {
    const xv = xFactor.min + t*(xFactor.max - xFactor.min)/xTicks;
    const xp = (ML + t*CW/xTicks).toFixed(1);
    svg += `<line x1="${xp}" y1="${MT+CH}" x2="${xp}" y2="${MT+CH+4}" stroke="#4A6A8A" stroke-width="0.7"/>`;
    svg += `<text x="${xp}" y="${MT+CH+14}" text-anchor="middle" font-size="8" fill="#7B9DB8" font-family="JetBrains Mono,monospace">${xv.toFixed(1)}</text>`;
  }
  for (let t = 0; t <= yTicks; t++) {
    const yv = yFactor.min + t*(yFactor.max - yFactor.min)/yTicks;
    const yp = (MT + CH - t*CH/yTicks).toFixed(1);
    svg += `<line x1="${ML-4}" y1="${yp}" x2="${ML}" y2="${yp}" stroke="#4A6A8A" stroke-width="0.7"/>`;
    svg += `<text x="${ML-6}" y="${+yp+3}" text-anchor="end" font-size="8" fill="#7B9DB8" font-family="JetBrains Mono,monospace">${yv.toFixed(1)}</text>`;
  }

  // Labels
  svg += `<text x="${ML+CW/2}" y="${H-6}" text-anchor="middle" font-size="10" fill="#B0C8DA" font-family="DM Sans,sans-serif">${xFactor.name}</text>`;
  svg += `<text transform="rotate(-90,14,${MT+CH/2})" x="14" y="${MT+CH/2+4}" text-anchor="middle" font-size="10" fill="#B0C8DA" font-family="DM Sans,sans-serif">${yFactor.name}</text>`;
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

  svg += svgClose();
  return svg;
}

window.DOECharts = {
  buildMainEffectsChart,
  buildInteractionChart,
  buildResponseSurfaceChart,
};
