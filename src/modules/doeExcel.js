/**
 * ================================================================
 * doeExcel.js — Interface Office.js pour le DOE Add-in
 * Écriture du plan, lecture des réponses, tableaux de résultats
 * ================================================================
 */
"use strict";

async function writeDOEMatrix(matrix, factors, responseName) {
  return Excel.run(async ctx => {
    const wb = ctx.workbook;
    const sheetName = "Plan_DOE";

    let sheet = wb.worksheets.getItemOrNullObject(sheetName);
    await ctx.sync();
    if (sheet.isNullObject) { sheet = wb.worksheets.add(sheetName); }
    else { sheet.getUsedRangeOrNullObject().clear(); }
    await ctx.sync();
    sheet.tabColor = "#00E5FF";

    // Headers
    const headers = ["N° Essai", "Type", ...factors.map(f => f.name), responseName || "Réponse"];
    const nCols = headers.length;
    const nRows = matrix.length;

    // Données
    const rows = [headers, ...matrix.map(row => [
      row.run,
      row.type || "Factoriel",
      ...factors.map(f => typeof row[f.name] === "number" ? +row[f.name].toFixed(4) : row[f.name]),
      row.response !== undefined ? row.response : "",
    ])];

    const endCol = String.fromCharCode(64 + Math.min(nCols, 26));
    sheet.getRange(`A1:${endCol}${rows.length}`).values = rows;

    // Style en-tête
    const hdrRange = sheet.getRange(`A1:${endCol}1`);
    hdrRange.format.fill.color = "#0D1B2A";
    hdrRange.format.font.color = "#00E5FF";
    hdrRange.format.font.bold  = true;
    hdrRange.format.font.size  = 9;

    // Colonne réponse en vert clair
    const respCol = String.fromCharCode(64 + nCols);
    sheet.getRange(`${respCol}2:${respCol}${rows.length}`).format.fill.color = "#132236";
    sheet.getRange(`${respCol}2:${respCol}${rows.length}`).format.font.color = "#00E676";

    // Lignes alternées
    for (let r = 2; r <= rows.length; r += 2) {
      sheet.getRange(`A${r}:${endCol}${r}`).format.fill.color = "#132236";
    }

    // Colonne type centrée + colorée
    for (let r = 2; r <= rows.length; r++) {
      const row = matrix[r - 2];
      let col = "#B0C8DA";
      if (row.type === "Centre")    col = "#CE93D8";
      if (row.type === "Axial")     col = "#FF9800";
      if (row.type === "BBD")       col = "#40C4FF";
      sheet.getRange(`B${r}`).format.font.color = col;
    }

    sheet.getRange("A1").format.rowHeight = 24;
    sheet.getRange("A1").format.columnWidth = 70;

    // Instruction colonne réponse
    sheet.getRange(`${respCol}1`).values = [[responseName || "Réponse ← SAISIR ICI"]];

    sheet.activate();
    await ctx.sync();
    return { sheetName, nRows, nCols };
  });
}

async function readResponses(factors, responseName) {
  return Excel.run(async ctx => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    const used  = sheet.getUsedRange();
    used.load("values,address");
    await ctx.sync();

    const values = used.values;
    if (!values || values.length < 2) throw new Error("Feuille vide");

    // Détecter les colonnes
    const headers = values[0].map(h => String(h).trim().toLowerCase());
    const runIdx  = headers.findIndex(h => h.includes("essai") || h === "run" || h === "n°");
    const respIdx = headers.findIndex(h =>
      h.includes(responseName?.toLowerCase() || "réponse") ||
      h.includes("response") || h.includes("réponse")
    );

    if (respIdx === -1) throw new Error(`Colonne "${responseName || "Réponse"}" introuvable`);

    const factorIdxs = factors.map(f =>
      headers.findIndex(h => h === f.name.toLowerCase() || h.includes(f.name.toLowerCase()))
    );

    const result = [];
    for (let r = 1; r < values.length; r++) {
      const row = values[r];
      if (row.every(v => v === "" || v === null)) continue;

      const entry = {
        run:      runIdx >= 0 ? row[runIdx] : r,
        response: parseFloat(row[respIdx]),
      };

      factors.forEach((f, fi) => {
        if (factorIdxs[fi] >= 0) entry[f.name] = parseFloat(row[factorIdxs[fi]]);
      });

      result.push(entry);
    }

    return result.filter(r => !isNaN(r.response));
  });
}

async function writeAnalysisResults(analysisResult, doeInfo) {
  const { reg, anova, effects, termNames, diagnostics } = analysisResult;

  return Excel.run(async ctx => {
    const wb = ctx.workbook;
    const sheetName = "Analyse_DOE";

    let sheet = wb.worksheets.getItemOrNullObject(sheetName);
    await ctx.sync();
    if (sheet.isNullObject) { sheet = wb.worksheets.add(sheetName); }
    else { sheet.getUsedRangeOrNullObject().clear(); }
    await ctx.sync();
    sheet.tabColor = "#00E676";

    let row = 1;

    // Titre
    sheet.getRange(`A${row}`).values = [["RÉSULTATS D'ANALYSE DOE — " + (doeInfo?.type || "") + " — " + new Date().toLocaleDateString("fr-FR")]];
    sheet.getRange(`A${row}`).format.font.bold = true;
    sheet.getRange(`A${row}`).format.font.color = "#00E5FF";
    sheet.getRange(`A${row}`).format.font.size  = 11;
    row += 2;

    // Diagnostics
    sheet.getRange(`A${row}`).values = [["DIAGNOSTICS DU MODÈLE"]];
    sheet.getRange(`A${row}`).format.font.bold = true; row++;
    const diagData = [
      ["R²",       diagnostics.R2],
      ["R² ajusté", diagnostics.R2adj],
      ["RMSE",      diagnostics.RMSE],
      ["N essais",  diagnostics.n],
      ["p-modèle",  diagnostics.pModel],
    ];
    diagData.forEach(([k, v]) => {
      sheet.getRange(`A${row}:B${row}`).values = [[k, v]];
      row++;
    });
    row++;

    // ANOVA
    sheet.getRange(`A${row}`).values = [["TABLE ANOVA"]];
    sheet.getRange(`A${row}`).format.font.bold = true; row++;
    const anovaHeaders = ["Source", "SS", "df", "MS", "F", "p-valeur", "Signif."];
    sheet.getRange(`A${row}:G${row}`).values = [anovaHeaders];
    sheet.getRange(`A${row}:G${row}`).format.fill.color = "#0D1B2A";
    sheet.getRange(`A${row}:G${row}`).format.font.color = "#00E5FF";
    sheet.getRange(`A${row}:G${row}`).format.font.bold  = true;
    row++;

    anova.forEach(a => {
      const sig = a.p !== null ? (a.p < 0.001 ? "***" : a.p < 0.01 ? "**" : a.p < 0.05 ? "*" : "ns") : "";
      sheet.getRange(`A${row}:G${row}`).values = [[
        a.source,
        +a.SS.toFixed(4),
        a.df,
        a.MS !== null ? +a.MS.toFixed(4) : "",
        a.F  !== null ? +a.F.toFixed(4)  : "",
        a.p  !== null ? +a.p.toFixed(6)  : "",
        sig,
      ]];
      if (a.p !== null && a.p < 0.05) {
        sheet.getRange(`A${row}:G${row}`).format.font.color = "#00E676";
      }
      row++;
    });
    row++;

    // Coefficients
    sheet.getRange(`A${row}`).values = [["COEFFICIENTS DU MODÈLE"]];
    sheet.getRange(`A${row}`).format.font.bold = true; row++;
    const coefHeaders = ["Terme", "Coefficient", "Erreur Std.", "t-stat", "p-valeur", "Signif."];
    sheet.getRange(`A${row}:F${row}`).values = [coefHeaders];
    sheet.getRange(`A${row}:F${row}`).format.fill.color = "#0D1B2A";
    sheet.getRange(`A${row}:F${row}`).format.font.color = "#00E5FF";
    sheet.getRange(`A${row}:F${row}`).format.font.bold  = true;
    row++;

    termNames.forEach((name, i) => {
      const sig = reg.pT[i] < 0.001 ? "***" : reg.pT[i] < 0.01 ? "**" : reg.pT[i] < 0.05 ? "*" : "ns";
      sheet.getRange(`A${row}:F${row}`).values = [[
        name, +reg.beta[i].toFixed(5), +reg.seB[i].toFixed(5),
        +reg.tStat[i].toFixed(4), +reg.pT[i].toFixed(6), sig,
      ]];
      if (reg.pT[i] < 0.05) sheet.getRange(`A${row}:F${row}`).format.font.color = "#00E676";
      row++;
    });

    sheet.activate();
    await ctx.sync();
    return sheetName;
  });
}

async function getActiveSheetName() {
  return Excel.run(async ctx => {
    const sheet = ctx.workbook.worksheets.getActiveWorksheet();
    sheet.load("name");
    await ctx.sync();
    return sheet.name;
  });
}

window.DOEExcel = {
  writeDOEMatrix,
  readResponses,
  writeAnalysisResults,
  getActiveSheetName,
};
