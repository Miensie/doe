/**
 * ================================================================
 * doeReport.js — Rapport HTML pour l'analyse DOE
 *
 * Bugs corrigés :
 *  [BUG 1] Section "Facteurs" : crash sur f.min/f.max pour les qualitatifs
 *           (NaN.toFixed → TypeError qui coupe la génération silencieusement)
 *  [BUG 2] Section "Conditions optimales" : .toFixed(3) appelé sur une string
 *           pour les facteurs qualitatifs → TypeError + rapport tronqué
 *  [BUG 3] Section "Top 5" : même crash .toFixed(3) sur string qualitatif
 *  [BUG 4] URL.revokeObjectURL appelé immédiatement après a.click()
 *           → sur certains navigateurs le blob est révoqué avant que le
 *           téléchargement n'ait commencé (fichier vide ou absent)
 *  [BUG 5] La matrice est lue depuis appState.matrix mais taskpane.js passe
 *           APP.responses || APP.matrix — si responses est undefined la matrice
 *           peut être vide alors que les données existent dans APP.matrix
 *  [MODIF] Support complet des facteurs qualitatifs dans toutes les sections
 * ================================================================
 */
"use strict";

function generateDOEReport(appState, options) {
  var opts      = options || {};
  var doeInfo   = appState.doeInfo   || {};
  var matrix    = appState.matrix    || [];
  var analysis  = appState.analysis;
  var optimRes  = appState.optimRes;
  var aiText    = appState.aiText    || "";
  var chartSVGs = appState.charts    || {};

  var dateS = new Date().toLocaleDateString("fr-FR");
  var timeS = new Date().toLocaleTimeString("fr-FR");
  var factors = doeInfo.factors || [];
  var responseName = doeInfo.responseName || "Réponse";

  // ── CSS ────────────────────────────────────────────────────────────────────
  var css = [
    '*{box-sizing:border-box}',
    'body{font-family:"Segoe UI",Arial,sans-serif;font-size:12px;color:#E2EAF0;',
    '     background:#0D1B2A;padding:24px 32px;max-width:1060px;margin:auto;line-height:1.6}',
    'h1{font-size:20px;color:#00E5FF;border-bottom:2px solid #00E5FF;padding-bottom:8px;margin-bottom:4px}',
    'h2{font-size:11px;font-weight:700;color:#B0C8DA;margin:22px 0 8px;',
    '   border-left:4px solid #00E5FF;padding-left:10px;text-transform:uppercase;letter-spacing:.06em}',
    '.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;',
    '      background:#132236;border-radius:6px;padding:14px;margin:14px 0}',
    '.meta .lbl{font-size:9px;color:#4A6A8A;text-transform:uppercase;letter-spacing:.05em}',
    '.meta .val{font-weight:700;font-size:13px;color:#00E5FF;margin-top:2px}',
    'table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px}',
    'th{background:#0D1B2A;color:#00E5FF;padding:6px 8px;text-align:left;',
    '   font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}',
    'td{padding:5px 8px;border-bottom:1px solid #1A2E47;white-space:nowrap;color:#B0C8DA}',
    'tr:nth-child(even) td{background:#132236}',
    '.mono{font-family:"Courier New",monospace}',
    '.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-weight:700;font-size:10px}',
    '.sig{color:#00E676;font-weight:700}.ns{color:#4A6A8A}',
    '.verdict{padding:12px 16px;border-radius:6px;margin:10px 0;font-size:13px;line-height:1.6;',
    '         background:#132236;border-left:4px solid #00E5FF}',
    '.optim-box{background:#0D1B2A;border:1px solid #00E5FF;border-radius:6px;',
    '           padding:14px;font-family:"Courier New",monospace;font-size:12px;line-height:2.2}',
    '.optim-val{color:#00E5FF;font-weight:700}',
    '.optim-pred{color:#00E676;font-size:16px;font-weight:700}',
    /* [MODIF] badge pour les qualitatifs */
    '.qual-badge{color:#CE93D8;font-size:10px;font-style:italic}',
    '.qual-val{color:#CE93D8;font-weight:600}',
    '.ai-box{background:#132236;border:1px solid #1A2E47;border-radius:6px;',
    '        padding:14px;font-size:12px;line-height:1.7;border-left:3px solid #00E5FF}',
    '.fn{font-size:10px;color:#4A6A8A;font-style:italic;margin:4px 0}',
    '.svg-wrap{border:1px solid #1A2E47;border-radius:6px;margin:10px 0;overflow:hidden}',
    '.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0}',
    '.stat-item{background:#132236;border-radius:5px;padding:10px;text-align:center}',
    '.stat-lbl{font-size:9px;color:#4A6A8A;text-transform:uppercase;letter-spacing:.05em}',
    '.stat-val{font-size:16px;font-weight:700;color:#00E5FF;margin-top:4px;font-family:"Courier New",monospace}',
    '.footer{margin-top:40px;padding-top:12px;border-top:1px solid #1A2E47;',
    '        font-size:10px;color:#4A6A8A;text-align:center}',
    '@media print{body{background:#fff;color:#1a1a2e}h1,h2{color:#0D1B2A;border-color:#0D1B2A}',
    '.meta,.stat-item{background:#F0F3F8}.verdict,.optim-box,.ai-box{background:#F0F3F8}',
    '.meta .val,.stat-val{color:#0D1B2A}.qual-val{color:#6A0DAD}}'
  ].join('\n');

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** [MODIF] Retourne vrai si le facteur est qualitatif */
  function isQual(f) {
    return f && f.type === "qualitative" && Array.isArray(f.categories) && f.categories.length >= 2;
  }

  /**
   * [BUG 2 + 3] Formate une valeur d'optimisation selon le type du facteur.
   * Pour les qualitatifs, la valeur est une string → pas de .toFixed().
   */
  function fmtOptimVal(f, val) {
    if (val === undefined || val === null) return '&mdash;';
    if (isQual(f)) {
      return '<span class="qual-val">' + escHtml(String(val)) + '</span>';
    }
    return typeof val === 'number' ? val.toFixed(3) : String(val);
  }

  /** Échappe les caractères HTML dangereux dans une string */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Construction HTML ──────────────────────────────────────────────────────
  var h = '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n';
  h += '<title>Rapport DOE &mdash; ' + escHtml(doeInfo.expName || 'Expérience') + '</title>\n';
  h += '<style>' + css + '</style>\n</head>\n<body>\n';

  // En-tête
  h += '<h1>Rapport d\'Analyse par Plans d\'Exp&eacute;riences (DOE)</h1>\n';
  h += '<p style="font-size:11px;color:#4A6A8A;margin-bottom:8px">Response Surface Methodology &mdash; Box &amp; Wilson (1951) &middot; Box-Behnken (1960) &middot; Analyse ANOVA</p>\n';

  // Meta-bloc
  var nQual  = factors.filter(isQual).length;
  var nQuant = factors.length - nQual;
  h += '<div class="meta">\n';
  [
    ['Exp&eacute;rience',     escHtml(doeInfo.expName  || '—')],
    ['R&eacute;ponse',        escHtml(responseName)],
    ['Type de plan',          escHtml(doeInfo.type     || '—')],
    ['N&deg; essais',         doeInfo.nRuns    || '—'],
    ['Facteurs quant.',       nQuant],
    ['Facteurs qual.',        nQual],       /* [MODIF] */
    ['Laboratoire',           escHtml(opts.labo || '—')],
    ['Date',                  dateS],
  ].forEach(function(p) {
    h += '<div><div class="lbl">' + p[0] + '</div><div class="val">' + p[1] + '</div></div>\n';
  });
  h += '</div>\n';

  // ── 1. Facteurs ────────────────────────────────────────────────────────────
  if (opts.params !== false && factors.length > 0) {
    h += '<h2>1. Facteurs exp&eacute;rimentaux</h2>\n<table>\n';
    /* [MODIF] En-tête adaptatif : colonne "Modalités" pour les qualitatifs */
    h += '<tr><th>#</th><th>Facteur</th><th>Type</th><th>Minimum / Modalit&eacute;s</th><th>Maximum</th><th>Centre / Niveaux</th></tr>\n';
    factors.forEach(function(f, i) {
      h += '<tr><td class="mono">' + (i+1) + '</td>';
      h += '<td><strong>' + escHtml(f.name) + '</strong></td>';
      if (isQual(f)) {
        /* [BUG 1 fix] On n'appelle plus .toFixed sur f.min/f.max pour les qualitatifs */
        h += '<td><span class="qual-badge">&#128292; Qualitatif</span></td>';
        h += '<td class="qual-val">' + (f.categories || []).map(escHtml).join(', ') + '</td>';
        h += '<td class="mono">&mdash;</td>';
        h += '<td class="mono">' + (f.categories || []).length + ' niveaux</td>';
      } else {
        var centre = ((f.min + f.max) / 2).toFixed(3);
        h += '<td style="color:#7B9DB8">Quantitatif</td>';
        h += '<td class="mono">' + f.min + '</td>';
        h += '<td class="mono">' + f.max + '</td>';
        h += '<td class="mono">' + centre + '</td>';
      }
      h += '</tr>\n';
    });
    h += '</table>\n';
  }

  // ── 2. Matrice ─────────────────────────────────────────────────────────────
  if (opts.matrix !== false && matrix.length > 0) {
    h += '<h2>2. Matrice exp&eacute;rimentale (' + matrix.length + ' essais)</h2>\n<table>\n';
    h += '<tr><th>N&deg;</th><th>Type</th>';
    factors.forEach(function(f) {
      h += '<th>' + escHtml(f.name) + (isQual(f) ? ' &#128292;' : '') + '</th>';
    });
    h += '<th>' + escHtml(responseName) + '</th></tr>\n';
    matrix.forEach(function(row) {
      h += '<tr><td class="mono">' + row.run + '</td>';
      h += '<td style="color:#40C4FF">' + escHtml(row.type || '') + '</td>';
      factors.forEach(function(f) {
        var val = row[f.name];
        var cell;
        if (isQual(f)) {
          /* [BUG 1 fix] valeur textuelle, pas .toFixed */
          cell = '<td class="qual-val">' + escHtml(val !== undefined ? String(val) : '—') + '</td>';
        } else {
          cell = '<td class="mono">' + (typeof val === 'number' ? val.toFixed(3) : escHtml(String(val || ''))) + '</td>';
        }
        h += cell;
      });
      var resp = row.response;
      h += '<td class="mono" style="color:#00E676">' + (resp !== undefined && resp !== '' ? resp : '&mdash;') + '</td>';
      h += '</tr>\n';
    });
    h += '</table>\n';
  }

  // ── 3. ANOVA ───────────────────────────────────────────────────────────────
  if (opts.anova !== false && analysis) {
    var diag = analysis.diagnostics;
    h += '<h2>3. Analyse ANOVA et Qualit&eacute; du Mod&egrave;le</h2>\n';
    h += '<div class="stat-grid">\n';
    [
      ['R&sup2;',           diag.R2.toFixed(4)],
      ['R&sup2; ajust&eacute;', diag.R2adj.toFixed(4)],
      ['RMSE',              diag.RMSE.toFixed(4)],
      ['p-mod&egrave;le',   diag.pModel.toFixed(6)],
    ].forEach(function(s) {
      h += '<div class="stat-item"><div class="stat-lbl">' + s[0] + '</div><div class="stat-val">' + s[1] + '</div></div>\n';
    });
    h += '</div>\n';

    h += '<table>\n<tr><th>Source</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p-valeur</th><th>Signif.</th></tr>\n';
    analysis.anova.forEach(function(a) {
      var sig = a.p !== null ? (a.p < 0.001 ? '***' : a.p < 0.01 ? '**' : a.p < 0.05 ? '*' : 'ns') : '';
      var sc  = (a.p !== null && a.p < 0.05) ? ' class="sig"' : ' class="ns"';
      h += '<tr><td>' + escHtml(a.source) + '</td>';
      h += '<td class="mono">' + a.SS.toFixed(4) + '</td>';
      h += '<td class="mono">' + a.df + '</td>';
      h += '<td class="mono">' + (a.MS !== null ? a.MS.toFixed(4) : '&mdash;') + '</td>';
      h += '<td class="mono">' + (a.F  !== null ? a.F.toFixed(4)  : '&mdash;') + '</td>';
      h += '<td class="mono">' + (a.p  !== null ? a.p.toFixed(6)  : '&mdash;') + '</td>';
      h += '<td' + sc + '>' + sig + '</td></tr>\n';
    });
    h += '</table>\n';

    // Tableau des coefficients
    if (analysis.termNames && analysis.reg) {
      h += '<p class="fn" style="margin-top:14px">Coefficients du mod&egrave;le :</p>\n<table>\n';
      h += '<tr><th>Terme</th><th>Coefficient</th><th>Erreur std.</th><th>t</th><th>p-valeur</th><th>Signif.</th></tr>\n';
      analysis.termNames.forEach(function(name, i) {
        var sig = analysis.reg.pT[i] < 0.001 ? '***' : analysis.reg.pT[i] < 0.01 ? '**' : analysis.reg.pT[i] < 0.05 ? '*' : 'ns';
        var isSig = analysis.reg.pT[i] < 0.05;
        h += '<tr style="' + (isSig ? 'color:#00E5FF' : '') + '">';
        h += '<td>' + escHtml(name) + '</td>';
        h += '<td class="mono">' + analysis.reg.beta[i].toFixed(5) + '</td>';
        h += '<td class="mono">' + analysis.reg.seB[i].toFixed(5)  + '</td>';
        h += '<td class="mono">' + analysis.reg.tStat[i].toFixed(4) + '</td>';
        h += '<td class="mono">' + analysis.reg.pT[i].toFixed(6)   + '</td>';
        h += '<td class="' + (isSig ? 'sig' : 'ns') + '">' + sig + '</td>';
        h += '</tr>\n';
      });
      h += '</table>\n';
    }

    // Diagnostics textuels
    var d = diag;
    h += '<div class="verdict">';
    h += (d.R2adj >= 0.9 ? '✅' : d.R2adj >= 0.8 ? '⚠️' : '❌') + ' ';
    h += 'R&sup2;ajust&eacute; = ' + d.R2adj.toFixed(4) + ' &mdash; ';
    h += (d.R2adj >= 0.9 ? 'Excellent' : d.R2adj >= 0.8 ? 'Bon' : 'Insuffisant (&lt;&nbsp;0.80)') + '<br>';
    h += (d.pModel < 0.05 ? '✅' : '❌') + ' ';
    h += 'Mod&egrave;le ' + (d.pModel < 0.05 ? 'significatif' : 'non significatif') + ' (p&nbsp;=&nbsp;' + d.pModel.toFixed(6) + ')<br>';
    h += 'ℹ️ ' + d.n + ' essais, ' + d.p + ' termes, ' + (d.n - d.p) + ' degr&eacute;s de libert&eacute; r&eacute;sidu';
    if (d.lackOfFit) {
      h += '<br>' + (d.lackOfFit.significant ? '⚠️' : '✅') + ' ';
      h += 'Manque d\'ajustement : F&nbsp;=&nbsp;' + d.lackOfFit.F + ', p&nbsp;=&nbsp;' + d.lackOfFit.p;
      h += ' &mdash; ' + (d.lackOfFit.significant ? '⚠ Mod&egrave;le potentiellement inadapt&eacute;' : '✓ OK');
    }
    h += '</div>\n';
  }

  // ── 4. Effets principaux ───────────────────────────────────────────────────
  if (opts.effects !== false && chartSVGs.mainEffects) {
    h += '<h2>4. Graphique des Effets Principaux</h2>\n';
    h += '<div class="svg-wrap">' + chartSVGs.mainEffects + '</div>\n';
  }

  // ── 4b. Interactions ───────────────────────────────────────────────────────
  if (chartSVGs.interactions) {
    h += '<h2>4b. Diagramme des Interactions</h2>\n';
    h += '<div class="svg-wrap">' + chartSVGs.interactions + '</div>\n';
  }

  // ── 5. Surface de réponse ─────────────────────────────────────────────────
  if (opts.surface !== false && chartSVGs.surface) {
    h += '<h2>5. Surface de R&eacute;ponse</h2>\n';
    h += '<div class="svg-wrap">' + chartSVGs.surface + '</div>\n';
  }

  // ── 6. Conditions optimales ────────────────────────────────────────────────
  if (opts.optim !== false && optimRes && optimRes.best) {
    h += '<h2>6. Conditions Optimales</h2>\n';
    h += '<div class="optim-box">\n';
    factors.forEach(function(f) {
      var val = optimRes.best[f.name];
      if (val !== undefined) {
        h += '<div><span style="color:#7B9DB8">' + escHtml(f.name) + ' :</span> ';
        /* [BUG 2 fix] Utilise fmtOptimVal qui gère qualitatifs ET quantitatifs */
        h += '<span class="optim-val">' + fmtOptimVal(f, val) + '</span></div>\n';
      }
    });
    h += '<div style="margin-top:8px;border-top:1px solid #1A2E47;padding-top:8px">';
    h += '<span style="color:#7B9DB8">' + escHtml(responseName) + ' pr&eacute;dit :</span> ';
    var pred = optimRes.best.predicted;
    h += '<span class="optim-pred">' + (pred !== undefined ? Number(pred).toFixed(3) : '&mdash;') + '</span>';
    h += '</div>\n</div>\n';

    // Top 5
    if (optimRes.top5 && optimRes.top5.length > 1) {
      h += '<p class="fn">Top 5 solutions :</p>\n<table>\n';
      h += '<tr>';
      factors.forEach(function(f) {
        h += '<th>' + escHtml(f.name) + (isQual(f) ? ' &#128292;' : '') + '</th>';
      });
      h += '<th>' + escHtml(responseName) + ' pr&eacute;dit</th></tr>\n';
      optimRes.top5.forEach(function(sol) {
        h += '<tr>';
        factors.forEach(function(f) {
          var val = sol[f.name];
          if (isQual(f)) {
            /* [BUG 3 fix] Pas de .toFixed sur une modalité qualitative */
            h += '<td class="qual-val">' + escHtml(val !== undefined ? String(val) : '—') + '</td>';
          } else {
            h += '<td class="mono">' + (val !== undefined ? Number(val).toFixed(3) : '&mdash;') + '</td>';
          }
        });
        h += '<td class="mono" style="color:#00E676">';
        h += (sol.predicted !== undefined ? Number(sol.predicted).toFixed(3) : '&mdash;');
        h += '</td></tr>\n';
      });
      h += '</table>\n';
    }
  }

  // ── 7. Interprétation IA ──────────────────────────────────────────────────
  if (opts.ai !== false && aiText) {
    h += '<h2>7. Interpr&eacute;tation par Intelligence Artificielle</h2>\n';
    h += '<div class="ai-box">' + aiText.replace(/\n/g, '<br>') + '</div>\n';
  }

  // ── Pied de page ──────────────────────────────────────────────────────────
  h += '<div class="footer">';
  h += 'Rapport g&eacute;n&eacute;r&eacute; par <strong>DOE&middot;AI Add-in</strong> &mdash; ' + dateS + ' &agrave; ' + timeS + '<br>';
  h += 'Box &amp; Wilson (1951) &middot; Box-Behnken (1960) &middot; Myers &amp; Montgomery (2009)';
  if (opts.ref) h += ' &middot; R&eacute;f. : ' + escHtml(opts.ref);
  if (opts.auteur) h += ' &middot; Auteur : ' + escHtml(opts.auteur);
  if (opts.version) h += ' &middot; v' + escHtml(opts.version);
  h += '</div>\n</body>\n</html>';

  return h;
}

/**
 * [BUG 4 fix] URL.revokeObjectURL était appelé immédiatement après a.click(),
 * ce qui révoquait le blob avant que le navigateur n'ait eu le temps de
 * déclencher le téléchargement → fichier vide ou absent.
 * On diffère la révocation de 10 secondes.
 */
function downloadReport(html, filename) {
  var blob = new Blob([html], { type: "text/html;charset=utf-8" });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement("a");
  a.href     = url;
  a.download = filename || "Rapport_DOE.html";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  /* [BUG 4 fix] Révocation différée → le navigateur a le temps de lire le blob */
  setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
}

window.DOEReport = { generateDOEReport, downloadReport };