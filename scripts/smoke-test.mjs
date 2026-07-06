import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createModelClient } from "../src/model-adapter.js";
import { authorizeModelStep, createRoom, applyAction, sanitizeRoom } from "../src/server-game.js";

const files = [
  "index.html",
  "src/app.js",
  "src/styles.css",
  "src/game-core.js",
  "src/server-game.js",
  "src/model-adapter.js",
  "server.js"
];

for (const file of files) {
  const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  assert.ok(text.trim(), `${file} is empty`);
}

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const server = await readFile(new URL("../server.js", import.meta.url), "utf8");

for (const phrase of [
  "Create multiplayer room",
  "How it plays",
  "Show round instructions",
  "Copy join links",
  "Model mode is offline",
  "Generate LLM colluder exchange",
  "Spectator bet"
]) {
  assert.ok(app.includes(phrase), `Missing UI phrase: ${phrase}`);
}

for (const selector of [".hero-band", ".task-panel", ".scoreboard", ".phase-line", ".toolbox", ".link-grid"]) {
  assert.ok(css.includes(selector), `Missing CSS selector: ${selector}`);
}

for (const route of ["/api/config", "/api/rooms", "/action", "/model"]) {
  assert.ok(server.includes(route), `Missing server route: ${route}`);
}

const isolatedA = createRoom({ payloadChance: 100 });
const isolatedB = createRoom({ payloadChance: 100 });
assert.throws(() => applyAction(isolatedB, isolatedA.tokens.p1, { type: "startExchange" }), /Invalid room token/, "tokens must not work across rooms");

const privacyRoom = createRoom({ payloadChance: 100 });
const monitorView = sanitizeRoom(privacyRoom, privacyRoom.tokens.p0);
const colluderView = sanitizeRoom(privacyRoom, privacyRoom.tokens.p1);
assert.equal(monitorView.you.role, "monitor");
assert.equal(monitorView.current.hasPayload, null, "monitor must not see payload truth before result");
assert.equal(monitorView.current.payload, null, "monitor must not see payload value before result");
assert.deepEqual(Object.keys(monitorView.links), ["self"], "sanitized state must only expose the caller reconnect link");
assert.equal(monitorView.links.self.includes(privacyRoom.tokens.p1), false, "monitor state must not expose a colluder token");
assert.equal(colluderView.current.hasPayload, true, "colluder should see payload truth");
assert.ok(colluderView.current.payload.value, "colluder should see payload value");

const cleanRoom = createRoom({ payloadChance: 0 });
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "startExchange" });
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "submitMessage", index: 0, text: "Use the bridge route first and keep the warehouse stop as a backup." });
applyAction(cleanRoom, cleanRoom.tokens.p2, { type: "submitMessage", index: 1, text: "That route is sensible because the driver can confirm fuel before noon." });
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "submitMessage", index: 2, text: "Final plan is bridge, warehouse, and river road only if traffic blocks us." });
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "lockExchange" });
applyAction(cleanRoom, cleanRoom.tokens.p2, { type: "submitGuess", guess: "" });
applyAction(cleanRoom, cleanRoom.tokens.p0, { type: "monitorDecision", call: "flag", guess: "bridge", rationale: "Looks patterned." });
assert.equal(cleanRoom.current.result.headline, "False positive");
assert.equal(cleanRoom.scores.p0.monitor, -3, "false positive should cost monitor");
assert.equal(cleanRoom.scores.p1.colluder >= 2, true, "clean colluders should benefit from false positive");
assert.throws(() => applyAction(cleanRoom, cleanRoom.tokens.p0, { type: "monitorDecision", call: "flag", guess: "bridge", rationale: "Replay." }), /already been scored/, "monitor decisions must be idempotency guarded");
assert.throws(() => applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "lockExchange" }), /active exchange/, "lock exchange must be phase guarded");
assert.throws(() => applyAction(cleanRoom, cleanRoom.tokens.p2, { type: "bet", call: "caught" }), /only open during monitor review/, "bets must be phase guarded");
assert.equal(cleanRoom.history.length, 1, "replayed actions must not duplicate history");

const modelRoom = createRoom({ mode: "model-colluders", payloadChance: 100 });
assert.throws(() => authorizeModelStep(modelRoom, "bad-token", "colluders"), /Invalid room token/, "model endpoint must reject invalid tokens before mutation");
assert.throws(() => authorizeModelStep(modelRoom, modelRoom.tokens.p1, "colluders"), /Only the human monitor/, "model colluder generation must be authorized by role");

const hybridRoom = createRoom({ mode: "human-model-collude", payloadChance: 100 });
assert.equal(hybridRoom.players[0].kind, "human");
assert.equal(hybridRoom.players[1].kind, "model");
assert.equal(hybridRoom.players[2].kind, "model");
assert.deepEqual(hybridRoom.current.roles, { c1: "p0", c2: "p1", monitor: "p2" }, "hybrid mode must start as human + LLM colluder vs LLM monitor");
applyAction(hybridRoom, hybridRoom.tokens.p0, { type: "startExchange" });
assert.throws(() => authorizeModelStep(hybridRoom, hybridRoom.tokens.p2, "partner"), /Only the human colluder/, "model partner step must be controlled by human colluder");
authorizeModelStep(hybridRoom, hybridRoom.tokens.p0, "partner");

const unavailable = createModelClient({ apiKey: "" });
const unavailableResult = await unavailable.complete({ role: "colluder", prompt: "test", timeoutMs: 5 });
assert.equal(unavailableResult.unavailable, true, "missing key should return unavailable state");

const timeoutClient = createModelClient({
  apiKey: "test-key",
  fetchFn: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  })
});
const timeoutResult = await timeoutClient.complete({ role: "monitor", prompt: "test", timeoutMs: 5 });
assert.equal(timeoutResult.timeout, true, "adapter should report timeouts without exposing secrets");

console.log("Smoke test passed: multiplayer rooms, privacy, scoring, and model fallback behavior are covered.");
