/**
 * ================================================================
 * doeReport.js — Rapport HTML pour l'analyse DOE
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
    '.meta .val,.stat-val{color:#0D1B2A}}'
  ].join('\n');

  var h = '<!DOCTYPE html>\n<html lang="fr">\n<head>\n<meta charset="UTF-8">\n';
  h += '<title>Rapport DOE &mdash; ' + (doeInfo.expName || 'Exp&eacute;rience') + '</title>\n';
  h += '<style>' + css + '</style>\n</head>\n<body>\n';

  // En-tête
  h += '<h1>Rapport d\'Analyse par Plans d\'Exp&eacute;riences (DOE)</h1>\n';
  h += '<p style="font-size:11px;color:#4A6A8A;margin-bottom:8px">Response Surface Methodology &mdash; Box &amp; Wilson (1951) &middot; Box-Behnken (1960) &middot; Analyse ANOVA</p>\n';

  // Meta
  h += '<div class="meta">\n';
  [
    ['Exp&eacute;rience',   doeInfo.expName  || '&mdash;'],
    ['R&eacute;ponse',     responseName],
    ['Type de plan',       doeInfo.type     || '&mdash;'],
    ['N&deg; essais',      doeInfo.nRuns    || '&mdash;'],
    ['N&deg; facteurs',    doeInfo.nFactors || '&mdash;'],
    ['Points centraux',    doeInfo.nCenterPts || 0],
    ['Laboratoire',        opts.labo    || '&mdash;'],
    ['Date',               dateS],
  ].forEach(function(p) {
    h += '<div><div class="lbl">' + p[0] + '</div><div class="val">' + p[1] + '</div></div>\n';
  });
  h += '</div>\n';

  // 1. Facteurs
  if (opts.params !== false && factors.length > 0) {
    h += '<h2>1. Facteurs exp&eacute;rimentaux</h2>\n<table>\n';
    h += '<tr><th>#</th><th>Facteur</th><th>Minimum</th><th>Maximum</th><th>Centre</th><th>Niveaux</th></tr>\n';
    factors.forEach(function(f, i) {
      var centre = ((f.min + f.max) / 2).toFixed(3);
      h += '<tr><td class="mono">' + (i+1) + '</td><td><strong>' + f.name + '</strong></td>';
      h += '<td class="mono">' + f.min + '</td><td class="mono">' + f.max + '</td>';
      h += '<td class="mono">' + centre + '</td><td>' + (f.levels || 2) + '</td></tr>\n';
    });
    h += '</table>\n';
  }

  // 2. Matrice
  if (opts.matrix !== false && matrix.length > 0) {
    h += '<h2>2. Matrice exp&eacute;rimentale (' + matrix.length + ' essais)</h2>\n<table>\n';
    h += '<tr><th>N&deg;</th><th>Type</th>';
    factors.forEach(function(f) { h += '<th>' + f.name + '</th>'; });
    h += '<th>' + responseName + '</th></tr>\n';
    matrix.forEach(function(row) {
      h += '<tr><td class="mono">' + row.run + '</td><td style="color:#40C4FF">' + (row.type||'') + '</td>';
      factors.forEach(function(f) {
        h += '<td class="mono">' + (typeof row[f.name]==='number' ? row[f.name].toFixed(3) : row[f.name]||'') + '</td>';
      });
      h += '<td class="mono" style="color:#00E676">' + (row.response !== undefined && row.response !== '' ? row.response : '—') + '</td></tr>\n';
    });
    h += '</table>\n';
  }

  // 3. ANOVA
  if (opts.anova !== false && analysis) {
    var diag = analysis.diagnostics;
    h += '<h2>3. Analyse ANOVA et Qualit&eacute; du Mod&egrave;le</h2>\n';
    h += '<div class="stat-grid">\n';
    [['R&sup2;', diag.R2.toFixed(4)], ['R&sup2; ajust&eacute;', diag.R2adj.toFixed(4)],
     ['RMSE', diag.RMSE.toFixed(4)], ['p-mod&egrave;le', diag.pModel.toFixed(6)]].forEach(function(s) {
      h += '<div class="stat-item"><div class="stat-lbl">' + s[0] + '</div><div class="stat-val">' + s[1] + '</div></div>\n';
    });
    h += '</div>\n';

    h += '<table>\n<tr><th>Source</th><th>SS</th><th>df</th><th>MS</th><th>F</th><th>p-valeur</th><th>Signif.</th></tr>\n';
    analysis.anova.forEach(function(a) {
      var sig = a.p !== null ? (a.p < 0.001 ? '***' : a.p < 0.01 ? '**' : a.p < 0.05 ? '*' : 'ns') : '';
      var sc = a.p !== null && a.p < 0.05 ? ' class="sig"' : ' class="ns"';
      h += '<tr><td>' + a.source + '</td>';
      h += '<td class="mono">' + a.SS.toFixed(4) + '</td>';
      h += '<td class="mono">' + a.df + '</td>';
      h += '<td class="mono">' + (a.MS !== null ? a.MS.toFixed(4) : '&mdash;') + '</td>';
      h += '<td class="mono">' + (a.F  !== null ? a.F.toFixed(4)  : '&mdash;') + '</td>';
      h += '<td class="mono">' + (a.p  !== null ? a.p.toFixed(6)  : '&mdash;') + '</td>';
      h += '<td' + sc + '>' + sig + '</td></tr>\n';
    });
    h += '</table>\n';
  }

  // 4. Graphique effets principaux
  if (opts.effects !== false && chartSVGs.mainEffects) {
    h += '<h2>4. Graphique des Effets Principaux</h2>\n';
    h += '<div class="svg-wrap">' + chartSVGs.mainEffects + '</div>\n';
  }

  // 5. Surface de réponse
  if (opts.surface !== false && chartSVGs.surface) {
    h += '<h2>5. Surface de R&eacute;ponse</h2>\n';
    h += '<div class="svg-wrap">' + chartSVGs.surface + '</div>\n';
  }

  // 6. Conditions optimales
  if (opts.optim !== false && optimRes && optimRes.best) {
    h += '<h2>6. Conditions Optimales</h2>\n';
    h += '<div class="optim-box">\n';
    factors.forEach(function(f) {
      if (optimRes.best[f.name] !== undefined) {
        h += '<div><span style="color:#7B9DB8">' + f.name + ' :</span> <span class="optim-val">' + optimRes.best[f.name].toFixed(3) + '</span></div>\n';
      }
    });
    h += '<div style="margin-top:8px;border-top:1px solid #1A2E47;padding-top:8px">';
    h += '<span style="color:#7B9DB8">' + responseName + ' pr&eacute;dit :</span> ';
    h += '<span class="optim-pred">' + (optimRes.best.predicted !== undefined ? optimRes.best.predicted.toFixed(3) : '&mdash;') + '</span>';
    h += '</div>\n</div>\n';

    if (optimRes.top5 && optimRes.top5.length > 1) {
      h += '<p class="fn">Top 5 solutions :</p>\n<table>\n';
      var topHeaders = factors.map(function(f){ return f.name; }).concat([responseName + ' prédit']);
      h += '<tr>' + topHeaders.map(function(t){ return '<th>'+t+'</th>'; }).join('') + '</tr>\n';
      optimRes.top5.forEach(function(sol, i) {
        h += '<tr>';
        factors.forEach(function(f) {
          h += '<td class="mono">' + (sol[f.name] !== undefined ? sol[f.name].toFixed(3) : '&mdash;') + '</td>';
        });
        h += '<td class="mono" style="color:#00E676">' + (sol.predicted !== undefined ? sol.predicted.toFixed(3) : '&mdash;') + '</td>';
        h += '</tr>\n';
      });
      h += '</table>\n';
    }
  }

  // 7. Interprétation IA
  if (opts.ai !== false && aiText) {
    h += '<h2>7. Interpr&eacute;tation par Intelligence Artificielle</h2>\n';
    h += '<div class="ai-box">' + aiText.replace(/\n/g, '<br>') + '</div>\n';
  }

  h += '<div class="footer">Rapport g&eacute;n&eacute;r&eacute; par <strong>DOE&middot;AI Add-in</strong> &mdash; ' + dateS + ' &agrave; ' + timeS + '<br>';
  h += 'Box &amp; Wilson (1951) &middot; Box-Behnken (1960) &middot; Myers &amp; Montgomery (2009) &middot; R&eacute;f. : ' + (opts.ref||'&mdash;') + '</div>\n';
  h += '</body>\n</html>';
  return h;
}

function downloadReport(html, filename) {
  var blob = new Blob([html], { type: "text/html;charset=utf-8" });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement("a");
  a.href   = url;
  a.download = filename || "Rapport_DOE.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.DOEReport = { generateDOEReport, downloadReport };
