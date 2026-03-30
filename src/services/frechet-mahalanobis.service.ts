// ─── Frechet-Mahalanobis Service — Regime-Conditioned Distance Thresholds ────
// Replaces fixed 3-sigma with Frechet-calibrated Mahalanobis distance
// D_M = sqrt((l - mu_r)^T Sigma_r^{-1} (l - mu_r))
// Spark #007 v9.2 — GCHQ lens Final Polish
// Academic: Frechet (1927), Mahalanobis (1936), EVT (Embrechts et al. 1997)
// ─────────────────────────────────────────────────────────────────────────────

export type RegimeType = "QUIET" | "TOXIC" | "BURST";

interface FrechetParams {
  gamma: number;   // shape (tail index)
  xi: number;      // scale
}

interface RegimeProfile {
  regime: RegimeType;
  frechet: FrechetParams;
  mu: number[];        // mean latency vector per venue pair
  sigmaInv: number[][]; // inverse covariance matrix
  threshold: number;    // D_M threshold for anomaly
}

interface FrechetDiagnostic {
  regime: RegimeType;
  mahalanobisDistance: number;
  frechetThreshold: number;
  anomaly: boolean;
  latencyVector: number[];
  mu: number[];
  timestamp: number;
}

// ── Calibrated Frechet parameters per regime ──
const REGIME_PROFILES: Record<RegimeType, { gamma: number; xi: number }> = {
  QUIET: { gamma: 2.14, xi: 0.214 },
  TOXIC: { gamma: 3.81, xi: 0.347 },
  BURST: { gamma: 5.22, xi: 0.418 },
};

// ── Default mean vectors per regime (3 venue pairs: Binance/OKX/Bybit) ──
const DEFAULT_MU: Record<RegimeType, number[]> = {
  QUIET: [1.2, 1.8, 2.1],
  TOXIC: [3.4, 4.1, 5.2],
  BURST: [8.1, 9.7, 12.3],
};

// ── Default inverse covariance (diagonal-dominant for numerical stability) ──
const DEFAULT_SIGMA_INV: Record<RegimeType, number[][]> = {
  QUIET: [
    [2.8, -0.3, -0.1],
    [-0.3, 2.4, -0.2],
    [-0.1, -0.2, 1.9],
  ],
  TOXIC: [
    [1.4, -0.2, -0.05],
    [-0.2, 1.2, -0.1],
    [-0.05, -0.1, 0.9],
  ],
  BURST: [
    [0.7, -0.1, -0.02],
    [-0.1, 0.6, -0.05],
    [-0.02, -0.05, 0.5],
  ],
};

const MAX_DIAGNOSTICS = 2000;

export class FrechetMahalanobisService {
  private currentRegime: RegimeType = "QUIET";
  private diagnostics: FrechetDiagnostic[] = [];
  private profiles: Map<RegimeType, RegimeProfile> = new Map();
  private anomalyCount = 0;
  private totalChecks = 0;

  constructor() {
    this.initProfiles();
  }

  private initProfiles(): void {
    for (const regime of ["QUIET", "TOXIC", "BURST"] as RegimeType[]) {
      const fp = REGIME_PROFILES[regime];
      // Frechet threshold: gamma * (1 + xi) — calibrated per regime
      const threshold = fp.gamma * (1 + fp.xi);
      this.profiles.set(regime, {
        regime,
        frechet: fp,
        mu: DEFAULT_MU[regime],
        sigmaInv: DEFAULT_SIGMA_INV[regime],
        threshold,
      });
    }
  }

  // ── Core: Compute Mahalanobis distance ──
  computeDistance(latencyVector: number[], regime?: RegimeType): FrechetDiagnostic {
    const r = regime ?? this.currentRegime;
    const profile = this.profiles.get(r)!;
    const diff = latencyVector.map((v, i) => v - profile.mu[i]);

    // D_M = sqrt( diff^T * SigmaInv * diff )
    let quadForm = 0;
    for (let i = 0; i < diff.length; i++) {
      for (let j = 0; j < diff.length; j++) {
        quadForm += diff[i] * profile.sigmaInv[i][j] * diff[j];
      }
    }
    const dm = Math.sqrt(Math.max(0, quadForm));

    const diagnostic: FrechetDiagnostic = {
      regime: r,
      mahalanobisDistance: dm,
      frechetThreshold: profile.threshold,
      anomaly: dm > profile.threshold,
      latencyVector,
      mu: profile.mu,
      timestamp: Date.now(),
    };

    this.diagnostics.push(diagnostic);
    this.totalChecks++;
    if (diagnostic.anomaly) this.anomalyCount++;
    if (this.diagnostics.length > MAX_DIAGNOSTICS) {
      this.diagnostics = this.diagnostics.slice(-MAX_DIAGNOSTICS);
    }

    return diagnostic;
  }

  // ── Regime switch ──
  setRegime(regime: RegimeType): void {
    if (this.currentRegime !== regime) {
      console.log(`[FRECHET] Regime switch: ${this.currentRegime} -> ${regime}`);
      this.currentRegime = regime;
    }
  }

  // ── Update mean vector from live data ──
  updateMu(regime: RegimeType, mu: number[]): void {
    const profile = this.profiles.get(regime);
    if (profile) profile.mu = mu;
  }

  // ── Queries ──
  getDiagnostics(limit: number = 50): FrechetDiagnostic[] {
    return this.diagnostics.slice(-limit);
  }

  getAnomalies(limit: number = 50): FrechetDiagnostic[] {
    return this.diagnostics.filter((d) => d.anomaly).slice(-limit);
  }

  getState(): Record<string, unknown> {
    const profile = this.profiles.get(this.currentRegime)!;
    return {
      currentRegime: this.currentRegime,
      frechetParams: profile.frechet,
      threshold: profile.threshold,
      mu: profile.mu,
      totalChecks: this.totalChecks,
      anomalyCount: this.anomalyCount,
      anomalyRate: this.totalChecks > 0 ? this.anomalyCount / this.totalChecks : 0,
      recentDiagnostics: this.diagnostics.slice(-10),
      allProfiles: Object.fromEntries(
        [...this.profiles.entries()].map(([k, v]) => [k, { gamma: v.frechet.gamma, xi: v.frechet.xi, threshold: v.threshold }])
      ),
    };
  }

  reset(): void {
    this.diagnostics = [];
    this.anomalyCount = 0;
    this.totalChecks = 0;
    this.currentRegime = "QUIET";
    this.initProfiles();
    console.log("[FRECHET] Reset complete");
  }
}
