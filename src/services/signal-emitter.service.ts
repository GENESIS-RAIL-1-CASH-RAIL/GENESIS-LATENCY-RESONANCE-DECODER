// ─── Signal Emitter Service — Fire-and-Forget Broadcast ─────────────────────

import { ResonanceEvent, ResonanceSignal, SignalType } from "../types";

const MAX_SIGNALS = 2000;

interface BroadcastTarget {
  url: string;
  endpoint: string;
  label: string;
}

export class SignalEmitterService {
  private signals: ResonanceSignal[] = [];
  private signalCounter = 0;
  private targets: BroadcastTarget[];

  constructor() {
    this.targets = [
      { url: process.env.TPO_URL || "http://genesis-trade-parameter-optimizer:8848", endpoint: "/config", label: "TPO" },
      { url: process.env.ARB_DETECTOR_URL || "http://genesis-arb-detector:8750", endpoint: "/intel", label: "ARB" },
      { url: process.env.CIA_URL || "http://genesis-cia:8797", endpoint: "/intel", label: "CIA" },
      { url: process.env.WHITEBOARD_URL || "http://genesis-whiteboard:8710", endpoint: "/ingest", label: "WB" },
      { url: process.env.DARPA_URL || "http://genesis-darpa:8840", endpoint: "/intel", label: "DARPA" },
      { url: process.env.GTC_URL || "http://genesis-gtc:8650", endpoint: "/ingest", label: "GTC" },
    ];
  }

  // ── Emit Signal ─────────────────────────────────────────────────────────

  async emit(event: ResonanceEvent, type: SignalType = "RESONANCE_DETECTED"): Promise<ResonanceSignal> {
    const signal: ResonanceSignal = {
      signalId: `LS-${++this.signalCounter}`,
      type,
      event,
      advisory: this.buildAdvisory(event),
      emittedAt: Date.now(),
      targets: this.targets.map((t) => t.label),
    };

    this.signals.push(signal);
    if (this.signals.length > MAX_SIGNALS) {
      this.signals = this.signals.slice(-MAX_SIGNALS);
    }

    await this.broadcast(signal);
    return signal;
  }

  // ── Broadcast Batch ─────────────────────────────────────────────────────

  async broadcastActive(events: ResonanceEvent[]): Promise<number> {
    let emitted = 0;
    for (const event of events) {
      if (event.status !== "ACTIVE") continue;
      await this.emit(event);
      emitted++;
    }
    if (emitted > 0) {
      console.log(`[SIGNAL] Broadcast ${emitted} active resonance events to ${this.targets.length} targets`);
    }
    return emitted;
  }

  // ── Fire-and-Forget Broadcast ───────────────────────────────────────────

  private async broadcast(signal: ResonanceSignal): Promise<void> {
    const payload = {
      source: "LATENCY_RESONANCE_DECODER",
      signalId: signal.signalId,
      type: signal.type,
      pair: signal.event.pair,
      fastVenue: signal.event.fastVenue,
      slowVenue: signal.event.slowVenue,
      sigmaDeviation: signal.event.sigmaDeviation,
      confidence: signal.event.confidence,
      advisory: signal.advisory,
      timestamp: signal.emittedAt,
    };

    const results = await Promise.allSettled(
      this.targets.map((t) => this.fire(t, payload))
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    if (ok < this.targets.length) {
      console.log(`[SIGNAL] ${signal.signalId}: ${ok}/${this.targets.length} targets reached`);
    }
  }

  private async fire(target: BroadcastTarget, payload: object): Promise<void> {
    try {
      await fetch(`${target.url}${target.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      /* fire-and-forget — target unreachable is acceptable */
    }
  }

  // ── Advisory Builder ────────────────────────────────────────────────────

  private buildAdvisory(event: ResonanceEvent): string {
    const parts: string[] = [];
    parts.push(`Latency resonance: ${event.pair} ${event.fastVenue}→${event.slowVenue}`);
    parts.push(`Δ${event.latencyDeltaMs.toFixed(1)}ms (${event.sigmaDeviation.toFixed(1)}σ)`);
    if (event.strategicRun) {
      parts.push(`Strategic run ${event.strategicRun.fsmState} (chain=${event.strategicRun.messageChainLength})`);
    }
    parts.push(`Confidence: ${(event.confidence * 100).toFixed(0)}%`);
    return parts.join(" | ");
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  getRecent(limit: number = 50): ResonanceSignal[] {
    return this.signals.slice(-limit);
  }

  getByVenue(venue: string): ResonanceSignal[] {
    return this.signals.filter(
      (s) => s.event.fastVenue === venue || s.event.slowVenue === venue
    );
  }

  getStats(): { totalEmitted: number; targetCount: number } {
    return { totalEmitted: this.signals.length, targetCount: this.targets.length };
  }

  reset(): void {
    this.signals = [];
    this.signalCounter = 0;
    console.log("[SIGNAL] Reset complete");
  }
}
