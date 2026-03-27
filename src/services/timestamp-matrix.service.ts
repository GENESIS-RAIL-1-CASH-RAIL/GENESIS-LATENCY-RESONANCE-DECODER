// ─── Timestamp Matrix Service — Pairwise Latency Tracking ───────────────────

import { VenueTimestamp, PairwiseLatency, MatrixSnapshot } from "../types";

const MAX_SNAPSHOTS = 500;
const ROLLING_WINDOW = 100; // samples for mean/stddev
const SIGMA_THRESHOLD = 3.0;

export class TimestampMatrixService {
  private matrix: Map<string, PairwiseLatency> = new Map();
  private snapshots: MatrixSnapshot[] = [];
  private snapshotCounter = 0;
  private ingestionGateUrl: string;

  constructor() {
    this.ingestionGateUrl = process.env.INGESTION_GATE_URL || "http://genesis-ingestion-gate:8700";
  }

  // ── Key Generation ──────────────────────────────────────────────────────

  private pairKey(venueA: string, venueB: string, pair: string): string {
    const sorted = [venueA, venueB].sort();
    return `${sorted[0]}|${sorted[1]}|${pair}`;
  }

  // ── Ingest Venue Timestamps ─────────────────────────────────────────────

  ingestTimestamps(timestamps: VenueTimestamp[]): number {
    const byPair = new Map<string, VenueTimestamp[]>();
    for (const ts of timestamps) {
      const key = ts.pair;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key)!.push(ts);
    }

    let updated = 0;
    for (const [, group] of byPair) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i];
          const b = group[j];
          const deltaMs = Math.abs(a.receivedAt - b.receivedAt);
          this.updatePairwise(a.venue, b.venue, a.pair, deltaMs);
          updated++;
        }
      }
    }
    return updated;
  }

  // ── Update Pairwise Entry ───────────────────────────────────────────────

  private updatePairwise(venueA: string, venueB: string, pair: string, deltaMs: number): void {
    const key = this.pairKey(venueA, venueB, pair);
    const existing = this.matrix.get(key);

    if (!existing) {
      this.matrix.set(key, {
        venueA, venueB, pair, deltaMs,
        rollingMean: deltaMs,
        rollingStdDev: 0,
        sigma: 0,
        sampleCount: 1,
        lastUpdated: Date.now(),
      });
      return;
    }

    const n = Math.min(existing.sampleCount + 1, ROLLING_WINDOW);
    const alpha = 1 / n;
    const newMean = existing.rollingMean * (1 - alpha) + deltaMs * alpha;
    const variance = existing.rollingStdDev * existing.rollingStdDev;
    const newVariance = variance * (1 - alpha) + alpha * (deltaMs - newMean) * (deltaMs - existing.rollingMean);
    const newStdDev = Math.sqrt(Math.max(0, newVariance));
    const sigma = newStdDev > 0.001 ? Math.abs(deltaMs - newMean) / newStdDev : 0;

    existing.deltaMs = deltaMs;
    existing.rollingMean = newMean;
    existing.rollingStdDev = newStdDev;
    existing.sigma = sigma;
    existing.sampleCount = n;
    existing.lastUpdated = Date.now();
  }

  // ── Collect from Ingestion Gate ─────────────────────────────────────────

  async collectFromGate(): Promise<number> {
    try {
      const res = await fetch(`${this.ingestionGateUrl}/state`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return 0;
      const data = await res.json() as { feeds?: Array<{ exchange: string; pair: string; lastPollTs: number }> };
      if (!data.feeds || !Array.isArray(data.feeds)) return 0;

      const timestamps: VenueTimestamp[] = data.feeds
        .filter((f) => f.lastPollTs > 0)
        .map((f) => ({
          venue: f.exchange,
          pair: f.pair || "BTCUSDT",
          timestamp: f.lastPollTs,
          receivedAt: Date.now(),
        }));

      return this.ingestTimestamps(timestamps);
    } catch {
      return 0;
    }
  }

  // ── Snapshot ────────────────────────────────────────────────────────────

  takeSnapshot(): MatrixSnapshot {
    const entries = [...this.matrix.values()];
    const deviations3Sigma = entries.filter((e) => e.sigma >= SIGMA_THRESHOLD && e.sampleCount >= 10);
    const snapshot: MatrixSnapshot = {
      snapshotId: `MS-${++this.snapshotCounter}`,
      timestamp: Date.now(),
      venuePairCount: entries.length,
      entries,
      deviations3Sigma,
    };
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) {
      this.snapshots = this.snapshots.slice(-MAX_SNAPSHOTS);
    }
    return snapshot;
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getMatrix(): PairwiseLatency[] {
    return [...this.matrix.values()];
  }

  getByVenue(venue: string): PairwiseLatency[] {
    return [...this.matrix.values()].filter(
      (e) => e.venueA === venue || e.venueB === venue
    );
  }

  getDeviations(): PairwiseLatency[] {
    return [...this.matrix.values()].filter(
      (e) => e.sigma >= SIGMA_THRESHOLD && e.sampleCount >= 10
    );
  }

  getSnapshots(limit: number = 20): MatrixSnapshot[] {
    return this.snapshots.slice(-limit);
  }

  getVenuePairCount(): number {
    return this.matrix.size;
  }

  getAverageLatency(): number {
    const entries = [...this.matrix.values()];
    if (entries.length === 0) return 0;
    return entries.reduce((sum, e) => sum + e.rollingMean, 0) / entries.length;
  }

  reset(): void {
    this.matrix.clear();
    this.snapshots = [];
    this.snapshotCounter = 0;
    console.log("[MATRIX] Reset complete");
  }
}
