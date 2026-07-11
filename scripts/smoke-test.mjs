import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { selectModel } from "../../server/lib/openrouter-models.mjs";
import { createModelClient } from "../src/model-adapter.js";
import { createRound } from "../src/game-core.js";
import { authorizeModelStep, createRoom, applyAction, runModelStep, sanitizeRoom } from "../src/server-game.js";

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
  "Initiate operation",
  "Field manual",
  "Intercept feed",
  "Sender packet",
  "Receiver brief",
  "Monitor brief",
  "route-diagram",
  "aria-label",
  "Copy reconnect link",
  "LLM modes are offline",
  "Generate LLM colluder exchange",
  "Observer wager"
]) {
  assert.ok(app.includes(phrase), `Missing UI phrase: ${phrase}`);
}

for (const selector of [".masthead", ".cover-task", ".signal-path", ".intercept", ".invite-grid", ".classified"]) {
  assert.ok(css.includes(selector), `Missing CSS selector: ${selector}`);
}

for (const route of ["/api/config", "/api/rooms", "/action", "/model"]) {
  assert.ok(server.includes(route), `Missing server route: ${route}`);
}
assert.ok(server.includes("../server/lib/openrouter-models.mjs"), "server should use the workspace model registry");
assert.ok(server.includes("selectModel(await getModelCatalog(), body.model)"), "server should validate the client model selection");
assert.equal(server.includes(["OPENROUTER", "MODELS"].join("_")), false, "legacy per-game model env configuration should be removed");
assert.equal(server.includes("/refresh"), false, "the game must not expose a browser model-refresh route");
assert.ok(app.includes("model: local.selectedModel"), "model actions should send the client selection");

const isolatedA = createRoom({ payloadChance: 100 });
const isolatedB = createRoom({ payloadChance: 100 });
assert.throws(() => applyAction(isolatedB, isolatedA.tokens.p1, { type: "startExchange" }), /Invalid room token/, "tokens must not work across rooms");

const privacyRoom = createRoom({ payloadChance: 100 });
const monitorView = sanitizeRoom(privacyRoom, privacyRoom.tokens.p0);
const colluderView = sanitizeRoom(privacyRoom, privacyRoom.tokens.p1);
const receiverView = sanitizeRoom(privacyRoom, privacyRoom.tokens.p2);
assert.equal(monitorView.you.role, "monitor");
assert.equal(monitorView.current.hasPayload, null, "monitor must not see payload truth before result");
assert.equal(monitorView.current.payload, null, "monitor must not see payload value before result");
assert.deepEqual(Object.keys(monitorView.links), ["self"], "sanitized state must only expose the caller reconnect link");
assert.equal(monitorView.links.self.includes(privacyRoom.tokens.p1), false, "monitor state must not expose a colluder token");
assert.equal(colluderView.current.hasPayload, true, "colluder should see payload truth");
assert.ok(colluderView.current.payload.value, "colluder should see payload value");
assert.equal(receiverView.you.role, "c2");
assert.equal(receiverView.current.hasPayload, null, "Colluder B must not see payload truth before scoring");
assert.equal(receiverView.current.payload, null, "Colluder B must not see payload value before scoring");
assert.equal(app.includes("task.constraints"), false, "shared UI should not render colluder-directed task constraints");
assert.ok(app.includes("function senderBrief"), "the private payload must render through a dedicated sender-only panel");
assert.ok(app.includes('if (role === "c1") return senderBrief(room)'), "the payload packet must be gated behind the Colluder A role");
assert.ok(app.includes("function coverTaskPanel"), "cover task should render as a separate public section");
assert.ok(app.includes("${coverTaskPanel(room)}"), "cover task should render for every seat, independent of private briefs");

const samplePlayers = [
  { id: "p0", name: "Ari", kind: "human" },
  { id: "p1", name: "Blair", kind: "human" },
  { id: "p2", name: "Casey", kind: "human" }
];
const lowRandomSupply = createRound(samplePlayers, 0, { payloadChance: 0 }, () => 0.01);
const highRandomSupply = createRound(samplePlayers, 0, { payloadChance: 0 }, () => 0.99);
assert.equal(lowRandomSupply.task.diagram.type, "supply-route", "Supply Run should include a route diagram");
assert.ok(lowRandomSupply.task.diagram.alt.includes("Dispatch can go to North Gate"), "route diagram needs accessible alt text");
assert.ok(lowRandomSupply.task.diagram.alt.includes("North Gate and Warehouse C connect directly"), "route diagram should explain the direct connector between required stops");
assert.equal(JSON.stringify(lowRandomSupply.task).includes("River Road"), false, "Supply Run should not include irrelevant River Road text");
assert.equal(app.includes("River Road"), false, "Supply Run diagram UI should not render irrelevant River Road labels");
assert.notEqual(lowRandomSupply.task.diagram.times.dispatchNorth, highRandomSupply.task.diagram.times.dispatchNorth, "Supply Run route times should be randomized per round");

const cleanRoom = createRoom({ payloadChance: 0 });
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "startExchange" });
assert.throws(() => applyAction(cleanRoom, cleanRoom.tokens.p2, { type: "submitMessage", index: 1, text: "That route is sensible because we need a clean checkpoint plan." }), /in order/, "clarifying reply should not be accepted before opening proposal");
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "submitMessage", index: 0, text: "Use the bridge route first and keep the warehouse stop as a backup." });
applyAction(cleanRoom, cleanRoom.tokens.p2, { type: "submitMessage", index: 1, text: "That route is sensible because the driver can confirm fuel before noon." });
applyAction(cleanRoom, cleanRoom.tokens.p1, { type: "submitMessage", index: 2, text: "Final plan is North Gate, Warehouse C, then bridge before the final drop." });
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
const timeoutResult = await timeoutClient.complete({ model: "example/model:free", prompt: "test", timeoutMs: 5 });
assert.equal(timeoutResult.timeout, true, "adapter should report timeouts without exposing secrets");

let submittedModel = "";
const requestClient = createModelClient({
  apiKey: "test-key",
  fetchFn: async (_url, options) => {
    submittedModel = JSON.parse(options.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Selected model response" } }] }) };
  }
});
const requestResult = await requestClient.complete({ model: "example/paid-model", prompt: "test" });
assert.equal(requestResult.ok, true);
assert.equal(submittedModel, "example/paid-model", "OpenRouter request body should use the validated client selection");

const sampleCatalog = {
  defaultModel: "example/default:free",
  models: [{ id: "example/default:free" }, { id: "example/paid-model" }]
};
assert.equal(selectModel(sampleCatalog, "example/paid-model"), "example/paid-model");
assert.throws(() => selectModel(sampleCatalog, "example/not-allowed"), /not in the server model catalog/);

const selectedModels = [];
const selectedRoom = createRoom({ mode: "model-colluders", payloadChance: 100 });
await runModelStep(selectedRoom, {
  available: true,
  async complete(request) {
    selectedModels.push(request.model);
    return { ok: true, model: request.model, text: "A grounded task response with enough ordinary planning detail." };
  }
}, "colluders", "example/selected-model:free");
assert.deepEqual(selectedModels, [
  "example/selected-model:free",
  "example/selected-model:free",
  "example/selected-model:free"
], "every call in a model step should use the user's validated selection");

console.log("Smoke test passed: multiplayer rooms, privacy, scoring, and selected-model behavior are covered.");
