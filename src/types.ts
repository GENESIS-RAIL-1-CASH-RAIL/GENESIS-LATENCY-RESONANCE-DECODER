// ─── GENESIS LATENCY RESONANCE DECODER — WD-035 Types ────────────────────────
// Cross-Venue Propagation SIGINT — Pairwise latency matrix + Hasbrouck-Saar FSM
// Spark #007 — GCHQ lens (Grok, 2026-03-26)
// ─────────────────────────────────────────────────────────────────────────────

// ── Latency Matrix ──────────────────────────────────────────────────────────

export interface VenueTimestamp {
  venue: string;
  pair: string;
  timestamp: number;
  receivedAt: number;
}

export interface PairwiseLatency {
  venueA: string;
  venueB: string;
  pair: string;
  deltaMs: number;
  rollingMean: number;
  rollingStdDev: number;
  sigma: number; // deviation in σ units
  sampleCount: number;
  lastUpdated: number;
}

export interface MatrixSnapshot {
  snapshotId: string;
  timestamp: number;
  venuePairCount: number;
  entries: PairwiseLatency[];
  deviations3Sigma: PairwiseLatency[];
}

// ── Strategic Run Detection (Hasbrouck-Saar FSM) ────────────────────────────

export type FsmState = "IDLE" | "WATCHING" | "RUN_DETECTED" | "CONFIRMED";

export interface StrategicRun {
  runId: string;
  pair: string;
  initiatingVenue: string;
  fsmState: FsmState;
  messageChainLength: number;
  startTimestamp: number;
  lastTimestamp: number;
  confidence: number; // 0-1
}

// ── Resonance Events ────────────────────────────────────────────────────────

export type ResonanceStatus = "ACTIVE" | "DECAYED" | "EXPLOITED";

export interface ResonanceEvent {
  eventId: string;
  pair: string;
  fastVenue: string;
  slowVenue: string;
  latencyDeltaMs: number;
  sigmaDeviation: number;
  strategicRun: StrategicRun | null;
  confidence: number; // 0-1
  status: ResonanceStatus;
  detectedAt: number;
  decayedAt: number | null;
}

// ── Signals ─────────────────────────────────────────────────────────────────

export type SignalType = "RESONANCE_DETECTED" | "RUN_CONFIRMED" | "MATRIX_ANOMALY";

export interface ResonanceSignal {
  signalId: string;
  type: SignalType;
  event: ResonanceEvent;
  advisory: string;
  emittedAt: number;
  targets: string[];
}

// ── Stats ───────────────────────────────────────────────────────────────────

export interface DecoderStats {
  venuePairsTracked: number;
  totalSnapshots: number;
  activeResonanceEvents: number;
  totalResonanceEvents: number;
  strategicRunsDetected: number;
  signalsEmitted: number;
  averageLatencyMs: number;
  max3SigmaDeviations: number;
}

// ── Health ──────────────────────────────────────────────────────────────────

export interface HealthResponse {
  service: string;
  version: string;
  port: number;
  status: "GREEN" | "YELLOW" | "RED";
  uptime: number;
  stats: DecoderStats;
  loops: { name: string; intervalMs: number; lastRun: number }[];
}
