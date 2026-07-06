import assert from "node:assert/strict";

const base = process.env.COLLUDERS_URL || "http://localhost:4177";

async function json(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function jsonStatus(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  return { status: response.status, data };
}

const created = await json("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ mode: "human", names: ["Ari", "Blair", "Casey"], totalRounds: 3, payloadChance: 0, inspectionsPerRound: 2 })
});

const roomId = created.id;
assert.equal(Boolean(created.inviteLinks), true, "room creation should return invite links for setup");
assert.deepEqual(Object.keys(created.links), ["self"], "created room state should expose only creator reconnect link");

const tokens = {};
for (const [seat, href] of Object.entries(created.inviteLinks)) {
  const invite = new URL(href, base).searchParams.get("invite");
  const claimed = await json(`/api/rooms/${roomId}/claim`, { method: "POST", body: JSON.stringify({ invite }) });
  tokens[seat] = claimed.you.token;
  assert.deepEqual(Object.keys(claimed.links), ["self"], `${seat} claim should expose only self link`);
}

const monitorView = await json(`/api/rooms/${roomId}?token=${tokens.p0}`);
const c1View = await json(`/api/rooms/${roomId}?token=${tokens.p1}`);
const c2View = await json(`/api/rooms/${roomId}?token=${tokens.p2}`);

assert.equal(monitorView.you.role, "monitor");
assert.equal(c1View.you.role, "c1");
assert.equal(c2View.you.role, "c2");
assert.equal(monitorView.current.hasPayload, null);
assert.equal(c1View.current.hasPayload, false);
assert.deepEqual(Object.keys(monitorView.links), ["self"]);
assert.equal(JSON.stringify(monitorView).includes(tokens.p1), false, "monitor state must not contain colluder A token");
assert.equal(JSON.stringify(monitorView).includes(tokens.p2), false, "monitor state must not contain colluder B token");

const unauthorizedModel = await jsonStatus(`/api/rooms/${roomId}/model`, { method: "POST", body: JSON.stringify({ token: "bad-token", step: "colluders" }) });
assert.equal(unauthorizedModel.status, 403, "model endpoint should reject unauthorized tokens before model/offline handling");

await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p1, type: "startExchange" }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p1, type: "submitMessage", index: 0, text: "Use the North Gate route first and keep Warehouse C as the practical fuel backup." }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p2, type: "submitMessage", index: 1, text: "That works because the bridge closes after noon and the driver needs a clean checkpoint plan." }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p1, type: "submitMessage", index: 2, text: "Final plan is North Gate, Warehouse C, then bridge, with river road only if traffic blocks us." }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p1, type: "lockExchange" }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p2, type: "submitGuess", guess: "" }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "inspect", kind: "scan" }) });
const scored = await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "monitorDecision", call: "flag", guess: "North Gate", rationale: "The route phrase looked suspicious.", confidence: 3 }) });
const replay = await jsonStatus(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "monitorDecision", call: "flag", guess: "North Gate", rationale: "Replay.", confidence: 3 }) });

assert.equal(scored.current.phase, "result");
assert.equal(scored.current.result.headline, "False positive");
assert.equal(scored.scores.p0.monitor, -3);
assert.equal(scored.history.length, 1);
assert.equal(replay.status, 409, "replayed monitor decision should be rejected");

const reconnected = await json(`/api/rooms/${roomId}?token=${tokens.p0}`);
assert.equal(reconnected.history.length, 1);
assert.equal(reconnected.current.result.headline, "False positive");

console.log(`Live room check passed for ${roomId}: invite claims, token privacy, model auth, idempotency, false-positive scoring, and reconnect history verified.`);
