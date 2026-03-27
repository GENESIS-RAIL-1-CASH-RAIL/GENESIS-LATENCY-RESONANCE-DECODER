// ─── Resonance Detector Service — Hasbrouck-Saar FSM + 3σ Deviation ─────────

import { TimestampMatrixService } from "./timestamp-matrix.service";
import { StrategicRun, FsmState, ResonanceEvent, ResonanceStatus, PairwiseLatency } from "../types";

const MAX_EVENTS = 2000;
const MAX_RUNS = 1000;
const RUN_CHAIN_THRESHOLD = 3; // minimum linked messages for strategic run
const RUN_TIMEOUT_MS = 5000;
const RESONANCE_DECAY_MS = 300_000; // 5 minutes

export class ResonanceDetectorService {
  private runs: Map<string, StrategicRun> = new Map();
  private events: ResonanceEvent[] = [];
  private runCounter = 0;
  private eventCounter = 0;

  constructor(private matrix: TimestampMatrixService) {}

  // ── Hasbrouck-Saar FSM — Strategic Run Detection ────────────────────────

  processLinkedMessage(pair: string, venue: string, timestamp: number): StrategicRun {
    const key = `${pair}|${venue}`;
    const existing = this.runs.get(key);

    if (!existing || timestamp - existing.lastTimestamp > RUN_TIMEOUT_MS) {
      const run: StrategicRun = {
        runId: `SR-${++this.runCounter}`,
        pair,
        initiatingVenue: venue,
        fsmState: "WATCHING",
        messageChainLength: 1,
        startTimestamp: timestamp,
        lastTimestamp: timestamp,
        confidence: 0.2,
      };
      this.runs.set(key, run);
      this.pruneRuns();
      return run;
    }

    existing.messageChainLength++;
    existing.lastTimestamp = timestamp;

    if (existing.messageChainLength >= RUN_CHAIN_THRESHOLD && existing.fsmState === "WATCHING") {
      existing.fsmState = "RUN_DETECTED";
      existing.confidence = Math.min(0.5 + existing.messageChainLength * 0.1, 0.95);
      console.log(`[RESONANCE] Strategic run detected: ${pair} from ${venue} (chain=${existing.messageChainLength})`);
    }

    if (existing.messageChainLength >= RUN_CHAIN_THRESHOLD * 2) {
      existing.fsmState = "CONFIRMED";
      existing.confidence = Math.min(0.7 + existing.messageChainLength * 0.05, 0.99);
    }

    return existing;
  }

  // ── Resonance Scan — Combine 3σ Deviations + Strategic Runs ─────────────

  scan(): ResonanceEvent[] {
    const deviations = this.matrix.getDeviations();
    const newEvents: ResonanceEvent[] = [];

    for (const dev of deviations) {
      const matchingRun = this.findMatchingRun(dev);
      const confidence = this.computeConfidence(dev, matchingRun);

      if (confidence < 0.3) continue;

      const [fast, slow] = dev.deltaMs > 0
        ? [dev.venueA, dev.venueB]
        : [dev.venueB, dev.venueA];

      const event: ResonanceEvent = {
        eventId: `RE-${++this.eventCounter}`,
        pair: dev.pair,
        fastVenue: fast,
        slowVenue: slow,
        latencyDeltaMs: dev.deltaMs,
        sigmaDeviation: dev.sigma,
        strategicRun: matchingRun,
        confidence,
        status: "ACTIVE",
        detectedAt: Date.now(),
        decayedAt: null,
      };

      this.events.push(event);
      newEvents.push(event);
      console.log(`[RESONANCE] Event ${event.eventId}: ${dev.pair} ${fast}→${slow} Δ${dev.deltaMs.toFixed(1)}ms (${dev.sigma.toFixed(1)}σ) conf=${confidence.toFixed(2)}`);
    }

    this.decayOldEvents();
    this.pruneEvents();
    return newEvents;
  }

  // ── Confidence Computation ──────────────────────────────────────────────

  private computeConfidence(dev: PairwiseLatency, run: StrategicRun | null): number {
    let base = Math.min((dev.sigma - 3) * 0.15 + 0.3, 0.6);
    if (run) {
      const runBonus = run.fsmState === "CONFIRMED" ? 0.3 : run.fsmState === "RUN_DETECTED" ? 0.2 : 0.05;
      base += runBonus;
    }
    const sampleBonus = Math.min(dev.sampleCount / 100, 0.1);
    return Math.min(base + sampleBonus, 0.99);
  }

  // ── Find Matching Run ───────────────────────────────────────────────────

  private findMatchingRun(dev: PairwiseLatency): StrategicRun | null {
    for (const run of this.runs.values()) {
      if (run.pair !== dev.pair) continue;
      if (run.fsmState === "IDLE") continue;
      if (Date.now() - run.lastTimestamp > RUN_TIMEOUT_MS * 2) continue;
      if (run.initiatingVenue === dev.venueA || run.initiatingVenue === dev.venueB) {
        return run;
      }
    }
    return null;
  }

  // ── Decay + Prune ──────────────────────────────────────────────────────

  private decayOldEvents(): void {
    const now = Date.now();
    for (const event of this.events) {
      if (event.status === "ACTIVE" && now - event.detectedAt > RESONANCE_DECAY_MS) {
        event.status = "DECAYED";
        event.decayedAt = now;
      }
    }
  }

  private pruneEvents(): void {
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }
  }

  private pruneRuns(): void {
    if (this.runs.size > MAX_RUNS) {
      const entries = [...this.runs.entries()].sort((a, b) => a[1].lastTimestamp - b[1].lastTimestamp);
      const toRemove = entries.slice(0, this.runs.size - MAX_RUNS);
      for (const [key] of toRemove) this.runs.delete(key);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getActiveEvents(): ResonanceEvent[] {
    return this.events.filter((e) => e.status === "ACTIVE");
  }

  getAllEvents(limit: number = 50): ResonanceEvent[] {
    return this.events.slice(-limit);
  }

  getEventById(eventId: string): ResonanceEvent | null {
    return this.events.find((e) => e.eventId === eventId) ?? null;
  }

  getStrategicRuns(): StrategicRun[] {
    return [...this.runs.values()].filter((r) => r.fsmState !== "IDLE");
  }

  getStats(): { totalEvents: number; activeEvents: number; runsDetected: number } {
    return {
      totalEvents: this.events.length,
      activeEvents: this.events.filter((e) => e.status === "ACTIVE").length,
      runsDetected: [...this.runs.values()].filter((r) => r.fsmState !== "IDLE").length,
    };
  }

  reset(): void {
    this.events = [];
    this.runs.clear();
    this.eventCounter = 0;
    this.runCounter = 0;
    console.log("[RESONANCE] Reset complete");
  }
}
