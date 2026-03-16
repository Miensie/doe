"""
================================================================
DOE·AI Backend — FastAPI + NumPy + SciPy
Calculs avancés pour grands jeux de données
================================================================
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
from scipy import stats, optimize as sci_opt
from scipy.stats import f as fdist

app = FastAPI(title="DOE·AI API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class Factor(BaseModel):
    name: str
    min: float
    max: float

class RunData(BaseModel):
    run: int
    response: float
    coded: List[float]

class AnalysisRequest(BaseModel):
    factors: List[Factor]
    runs: List[RunData]
    model_order: int = 2  # 1 = linéaire, 2 = second ordre
    goal: str = "maximize"
    target: Optional[float] = None

def build_X(coded_matrix, k, model_order):
    """Construit la matrice de design."""
    rows = []
    for coded in coded_matrix:
        row = [1.0]
        row.extend(coded)  # effets principaux
        for i in range(k-1):
            for j in range(i+1, k):
                row.append(coded[i] * coded[j])  # interactions
        if model_order == 2:
            row.extend([c**2 for c in coded])  # quadratiques
        rows.append(row)
    return np.array(rows)

@app.get("/")
def root():
    return {"service": "DOE·AI API", "status": "ok"}

@app.post("/api/analyze")
def analyze(req: AnalysisRequest):
    k  = len(req.factors)
    Y  = np.array([r.response for r in req.runs])
    CM = [r.coded for r in req.runs]

    X = build_X(CM, k, req.model_order)

    # Régression OLS
    try:
        beta, residuals, rank, sv = np.linalg.lstsq(X, Y, rcond=None)
    except Exception as e:
        raise HTTPException(400, str(e))

    yhat  = X @ beta
    resid = Y - yhat
    n, p  = X.shape
    ybar  = np.mean(Y)

    SST = np.sum((Y - ybar)**2)
    SSE = np.sum(resid**2)
    SSR = SST - SSE
    dfR, dfE = p-1, n-p
    MSR = SSR/dfR if dfR > 0 else 0
    MSE = SSE/dfE if dfE > 0 else 0
    F   = MSR/MSE if MSE > 0 else 0
    pF  = 1 - fdist.cdf(F, dfR, dfE) if dfE > 0 else 1
    R2  = SSR/SST if SST > 0 else 0
    R2a = 1 - (1-R2)*(n-1)/dfE if dfE > 0 else 0

    # Erreurs std des coefficients
    try:
        XtXi = np.linalg.inv(X.T @ X)
        seB  = np.sqrt(np.maximum(0, np.diag(XtXi)) * MSE)
    except:
        seB = np.zeros(p)

    tStat = beta / np.where(seB > 0, seB, 1)
    pT = [2*(1 - stats.t.cdf(abs(t), df=dfE)) for t in tStat]

    # Optimisation SciPy
    def neg_pred(x):
        coded = list(np.clip(x, -1, 1))
        row = build_X([coded], k, req.model_order)[0]
        y = float(row @ beta)
        return -y if req.goal == "maximize" else (y if req.goal == "minimize" else abs(y - (req.target or 0)))

    best_val = None
    try:
        # Multi-start
        best = None
        for _ in range(100):
            x0 = np.random.uniform(-1, 1, k)
            res = sci_opt.minimize(neg_pred, x0, bounds=[(-1,1)]*k, method="L-BFGS-B")
            if best is None or res.fun < best.fun:
                best = res
        if best:
            opt_coded = list(best.x)
            opt_real  = {req.factors[i].name: float(req.factors[i].min + (opt_coded[i]+1)*(req.factors[i].max-req.factors[i].min)/2) for i in range(k)}
            opt_pred  = float(build_X([opt_coded], k, req.model_order)[0] @ beta)
            best_val  = {**opt_real, "predicted": opt_pred}
    except:
        pass

    return {
        "beta":   [round(float(b), 6) for b in beta],
        "seB":    [round(float(s), 6) for s in seB],
        "tStat":  [round(float(t), 4) for t in tStat],
        "pT":     [round(float(p2), 6) for p2 in pT],
        "yhat":   [round(float(y), 4) for y in yhat],
        "resid":  [round(float(r), 4) for r in resid],
        "R2":     round(float(R2), 6),  "R2adj": round(float(R2a), 6),
        "RMSE":   round(float(np.sqrt(MSE)), 4),
        "SST":    round(float(SST), 4), "SSR": round(float(SSR), 4), "SSE": round(float(SSE), 4),
        "dfR": int(dfR), "dfE": int(dfE), "MSR": round(float(MSR), 4), "MSE": round(float(MSE), 4),
        "F":  round(float(F), 4),  "pF":  round(float(pF), 6),
        "optimum": best_val,
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
