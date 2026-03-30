// ─── Hasbrouck Information Share Service — VECM-Based Venue Leadership ───────
// IS_j = ([psi * beta]_j)^2 / (psi * Omega * psi^T)
// Omega from UKF innovation covariance
// Leader Run flag when IS_Binance > 0.84
// Spark #007 v9.2 — GCHQ lens Final Polish
// Academic: Hasbrouck (1995) "One Security, Many Markets"
// ─────────────────────────────────────────────────────────────────────────────

export interface VenueInfoShare {
  venue: string;
  informationShare: number;  // 0-1, fraction of price discovery
  isLeader: boolean;
  timestamp: number;
}

interface InfoShareState {
  venues: VenueInfoShare[];
  leaderVenue: string | null;
  leaderRunActive: boolean;
  leaderRunStartTime: number | null;
  leaderRunDuration: number;
  psiVector: number[];
  omegaDiag: number[];
  totalUpdates: number;
  lastUpdate: number;
}

// ── Calibrated VECM parameters ──
const VENUES = ["BINANCE", "OKX", "BYBIT"];
const LEADER_THRESHOLD = 0.84;
const LEADER_RUN_MIN_DURATION_MS = 5000;

// Default psi (error correction) coefficients from VECM estimation
const DEFAULT_PSI: number[] = [0.72, 0.19, 0.09];

// Default innovation covariance diagonal (from UKF)
const DEFAULT_OMEGA_DIAG: number[] = [0.0014, 0.0031, 0.0048];

// Beta (cointegration) vector — normalised
const BETA: number[] = [1.0, -0.98, -0.02];

const MAX_HISTORY = 2000;

export class HasbrouckIsService {
  private state: InfoShareState;
  private history: VenueInfoShare[][] = [];

  constructor() {
    this.state = {
      venues: [],
      leaderVenue: null,
      leaderRunActive: false,
      leaderRunStartTime: null,
      leaderRunDuration: 0,
      psiVector: [...DEFAULT_PSI],
      omegaDiag: [...DEFAULT_OMEGA_DIAG],
      totalUpdates: 0,
      lastUpdate: 0,
    };
    this.computeInfoShares();
  }

  // ── Core: Compute Information Shares ──
  computeInfoShares(psi?: number[], omega?: number[]): VenueInfoShare[] {
    const psiVec = psi ?? this.state.psiVector;
    const omegaVec = omega ?? this.state.omegaDiag;

    // psi * beta for each venue
    const psiBeta = VENUES.map((_, j) => {
      let sum = 0;
      for (let k = 0; k < psiVec.length; k++) {
        sum += psiVec[k] * BETA[k];
      }
      return psiVec[j] * BETA[j];
    });

    // psi * Omega * psi^T (scalar)
    let denominator = 0;
    for (let i = 0; i < psiVec.length; i++) {
      denominator += psiVec[i] * psiVec[i] * omegaVec[i];
    }
    if (denominator === 0) denominator = 1e-12;

    // IS_j = (psiBeta_j)^2 / denominator
    const rawShares = psiBeta.map((pb) => (pb * pb) / denominator);

    // Normalise to sum to 1
    const total = rawShares.reduce((a, b) => a + b, 0);
    const normalised = rawShares.map((s) => (total > 0 ? s / total : 1 / VENUES.length));

    const now = Date.now();
    const shares: VenueInfoShare[] = VENUES.map((venue, i) => ({
      venue,
      informationShare: normalised[i],
      isLeader: normalised[i] > LEADER_THRESHOLD,
      timestamp: now,
    }));

    // Update state
    this.state.venues = shares;
    this.state.psiVector = psiVec;
    this.state.omegaDiag = omegaVec;
    this.state.totalUpdates++;
    this.state.lastUpdate = now;

    // Leader detection
    const leader = shares.find((s) => s.isLeader);
    if (leader) {
      if (!this.state.leaderRunActive || this.state.leaderVenue !== leader.venue) {
        this.state.leaderRunActive = true;
        this.state.leaderVenue = leader.venue;
        this.state.leaderRunStartTime = now;
        console.log(`[HASBROUCK] Leader Run: ${leader.venue} IS=${leader.informationShare.toFixed(3)}`);
      }
      this.state.leaderRunDuration = now - (this.state.leaderRunStartTime ?? now);
    } else {
      if (this.state.leaderRunActive) {
        console.log(`[HASBROUCK] Leader Run ended: ${this.state.leaderVenue} duration=${this.state.leaderRunDuration}ms`);
      }
      this.state.leaderRunActive = false;
      this.state.leaderRunDuration = 0;
    }

    // Archive
    this.history.push(shares);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY);
    }

    return shares;
  }

  // ── Update from UKF innovations ──
  updateFromUkf(innovationCovariance: number[]): void {
    if (innovationCovariance.length === VENUES.length) {
      this.state.omegaDiag = innovationCovariance;
      this.computeInfoShares();
    }
  }

  // ── Update psi from VECM re-estimation ──
  updatePsi(psi: number[]): void {
    if (psi.length === VENUES.length) {
      this.state.psiVector = psi;
      this.computeInfoShares();
    }
  }

  // ── Queries ──
  getShares(): VenueInfoShare[] {
    return this.state.venues;
  }

  isLeaderRun(): boolean {
    return this.state.leaderRunActive && this.state.leaderRunDuration >= LEADER_RUN_MIN_DURATION_MS;
  }

  getLeaderVenue(): string | null {
    return this.state.leaderRunActive ? this.state.leaderVenue : null;
  }

  getState(): Record<string, unknown> {
    return {
      venues: this.state.venues,
      leaderVenue: this.state.leaderVenue,
      leaderRunActive: this.state.leaderRunActive,
      leaderRunDuration: this.state.leaderRunDuration,
      leaderThreshold: LEADER_THRESHOLD,
      psiVector: this.state.psiVector,
      omegaDiag: this.state.omegaDiag,
      totalUpdates: this.state.totalUpdates,
      lastUpdate: this.state.lastUpdate,
      historyLength: this.history.length,
      recentHistory: this.history.slice(-5),
    };
  }

  reset(): void {
    this.state = {
      venues: [],
      leaderVenue: null,
      leaderRunActive: false,
      leaderRunStartTime: null,
      leaderRunDuration: 0,
      psiVector: [...DEFAULT_PSI],
      omegaDiag: [...DEFAULT_OMEGA_DIAG],
      totalUpdates: 0,
      lastUpdate: 0,
    };
    this.history = [];
    this.computeInfoShares();
    console.log("[HASBROUCK] Reset complete");
  }
}
