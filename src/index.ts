// ─── GENESIS LATENCY RESONANCE DECODER — WD-035 ────────────────────────────
// Cross-Venue Propagation SIGINT — Pairwise latency matrix + Hasbrouck-Saar FSM
// Port 8857 | 19 Endpoints | 3 Loops
// Spark #007 v9.2 — GCHQ lens Final Polish (2026-03-30)
// Academic: Aquilina et al. (QJE 2022), Hasbrouck (1995), Frechet (1927)
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import { TimestampMatrixService } from "./services/timestamp-matrix.service";
import { ResonanceDetectorService } from "./services/resonance-detector.service";
import { SignalEmitterService } from "./services/signal-emitter.service";
import { FrechetMahalanobisService } from "./services/frechet-mahalanobis.service";
import { HasbrouckIsService } from "./services/hasbrouck-is.service";
import { HealthResponse } from "./types";

const app = express();
app.use(express.json());
const PORT = parseInt(process.env.LATENCY_DECODER_PORT || "8857", 10);
const startTime = Date.now();

// ── Service Instantiation ─────────────────────────────────────────────────

const matrix = new TimestampMatrixService();
const detector = new ResonanceDetectorService(matrix);
const emitter = new SignalEmitterService();
const frechet = new FrechetMahalanobisService();
const hasbrouck = new HasbrouckIsService();

// ── Loop State ────────────────────────────────────────────────────────────

const loops = [
  { name: "Latency Collection", intervalMs: 15_000, lastRun: 0 },
  { name: "Resonance Detection", intervalMs: 30_000, lastRun: 0 },
  { name: "Signal Broadcast", intervalMs: 60_000, lastRun: 0 },
];

// ── Loop Functions ────────────────────────────────────────────────────────

async function loopCollect(): Promise<void> {
  const count = await matrix.collectFromGate();
  loops[0].lastRun = Date.now();
  if (count > 0) console.log(`[LOOP] Latency collection: ${count} pairwise updates`);
}

async function loopDetect(): Promise<void> {
  const events = detector.scan();
  loops[1].lastRun = Date.now();
  if (events.length > 0) console.log(`[LOOP] Resonance detection: ${events.length} new events`);
}

async function loopBroadcast(): Promise<void> {
  const active = detector.getActiveEvents();
  const count = await emitter.broadcastActive(active);
  loops[2].lastRun = Date.now();
  if (count > 0) console.log(`[LOOP] Signal broadcast: ${count} signals emitted`);
}

// ── Health Endpoints (4) ──────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  const stats = detector.getStats();
  const sigStats = emitter.getStats();
  const response: HealthResponse = {
    service: "GENESIS-LATENCY-RESONANCE-DECODER",
    version: "9.2.0",
    port: PORT,
    status: stats.activeEvents > 10 ? "YELLOW" : "GREEN",
    uptime: Date.now() - startTime,
    stats: {
      venuePairsTracked: matrix.getVenuePairCount(),
      totalSnapshots: matrix.getSnapshots(1).length,
      activeResonanceEvents: stats.activeEvents,
      totalResonanceEvents: stats.totalEvents,
      strategicRunsDetected: stats.runsDetected,
      signalsEmitted: sigStats.totalEmitted,
      averageLatencyMs: matrix.getAverageLatency(),
      max3SigmaDeviations: matrix.getDeviations().length,
    },
    loops,
  };
  res.json(response);
});

app.get("/state", (_req, res) => {
  res.json({
    service: "GENESIS-LATENCY-RESONANCE-DECODER",
    uptime: Date.now() - startTime,
    matrix: { venuePairs: matrix.getVenuePairCount(), deviations: matrix.getDeviations().length },
    resonance: detector.getStats(),
    signals: emitter.getStats(),
    loops,
  });
});

app.get("/stats", (_req, res) => {
  res.json({ ...detector.getStats(), ...emitter.getStats(), venuePairs: matrix.getVenuePairCount() });
});

app.post("/reset", (_req, res) => {
  matrix.reset();
  detector.reset();
  emitter.reset();
  res.json({ reset: true });
});

// ── Matrix Endpoints (4) ──────────────────────────────────────────────────

app.get("/matrix", (_req, res) => {
  res.json({ entries: matrix.getMatrix().length, matrix: matrix.getMatrix().slice(0, 100) });
});

app.get("/matrix/:venue", (req, res) => {
  res.json({ venue: req.params.venue, entries: matrix.getByVenue(req.params.venue) });
});

app.get("/matrix/deviations", (_req, res) => {
  res.json({ deviations: matrix.getDeviations() });
});

app.post("/matrix/snapshot", (_req, res) => {
  const snapshot = matrix.takeSnapshot();
  res.json(snapshot);
});

// ── Resonance Endpoints (4) ───────────────────────────────────────────────

app.get("/resonance/events", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ events: detector.getAllEvents(limit) });
});

app.get("/resonance/active", (_req, res) => {
  res.json({ events: detector.getActiveEvents() });
});

app.get("/resonance/:id", (req, res) => {
  const event = detector.getEventById(req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  res.json(event);
});

app.post("/resonance/detect", (_req, res) => {
  const events = detector.scan();
  res.json({ detected: events.length, events });
});

// ── Signal Endpoints (4) ──────────────────────────────────────────────────

app.get("/signals/recent", (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  res.json({ signals: emitter.getRecent(limit) });
});

app.get("/signals/stats", (_req, res) => {
  res.json(emitter.getStats());
});

app.get("/signals/venue/:venue", (req, res) => {
  res.json({ signals: emitter.getByVenue(req.params.venue) });
});

app.post("/signals/manual", async (req, res) => {
  const event = detector.getActiveEvents()[0];
  if (!event) return res.json({ emitted: false, reason: "No active events" });
  const signal = await emitter.emit(event, "RESONANCE_DETECTED");
  res.json({ emitted: true, signal });
});

// ── Frechet-Mahalanobis Endpoint (v9.2) ─────────────────────────────────

app.get("/latency/frechet", (_req, res) => {
  res.json(frechet.getState());
});

// ── Hasbrouck Information Share Endpoint (v9.2) ──────────────────────────

app.get("/latency/hasbrouck", (_req, res) => {
  res.json(hasbrouck.getState());
});

// ── Master v9.2 Dashboard ───────────────────────────────────────────────

app.get("/v92/status", (_req, res) => {
  res.json({
    service: "GENESIS-LATENCY-RESONANCE-DECODER",
    version: "9.2.0",
    spark: "#007 GCHQ v9.2 Final Polish",
    uptime: Date.now() - startTime,
    frechet: frechet.getState(),
    hasbrouck: hasbrouck.getState(),
    resonance: detector.getStats(),
    signals: emitter.getStats(),
    matrix: { venuePairs: matrix.getVenuePairCount(), deviations: matrix.getDeviations().length },
    loops,
  });
});

// ── Boot ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  GENESIS LATENCY RESONANCE DECODER — WD-035");
  console.log("  Cross-Venue Propagation SIGINT — v9.2 POLISHED");
  console.log("  Spark #007 — GCHQ lens Final Polish");
  console.log(`  Port: ${PORT}`);
  console.log("  Endpoints: 19 (health 4, matrix 4, resonance 4, signals 4, v9.2 3)");
  console.log("  Loops: 3 (collect 15s, detect 30s, broadcast 60s)");
  console.log("  v9.2: Frechet-Mahalanobis + Hasbrouck IS");
  console.log("  Deployment Class: RECON, STRIKE");
  console.log("═══════════════════════════════════════════════════════════");

  setInterval(loopCollect, loops[0].intervalMs);
  setInterval(loopDetect, loops[1].intervalMs);
  setInterval(loopBroadcast, loops[2].intervalMs);

  setTimeout(loopCollect, 3_000);
  setTimeout(loopDetect, 8_000);
  setTimeout(loopBroadcast, 15_000);
});
