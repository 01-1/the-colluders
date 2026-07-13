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
  return { status: response.status, data: await response.json() };
}

const malformed = await jsonStatus("/api/rooms", { method: "POST", body: "{bad json" });
assert.equal(malformed.status, 400, "malformed JSON should be a client error");
const oversized = await jsonStatus("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ value: "x".repeat(70_000) })
});
assert.equal(oversized.status, 413, "oversized request bodies should be rejected");
const invalidNames = await jsonStatus("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ names: ["One", { not: "text" }, "Three"] })
});
assert.equal(invalidNames.status, 400, "non-string initial names should be rejected");
const clampedNames = await json("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ names: ["N".repeat(80), "Two", "Three"] })
});
assert.equal(clampedNames.players[0].name.length, 24, "initial names should be clamped by the server");

const setupRoom = await json("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ mode: "human", scenario: "mixed", names: ["One", "Two", "Three"], totalRounds: 3, payloadChance: 50 })
});
const setupBeforeInvalidJoin = await json(`/api/rooms/${setupRoom.id}?token=${setupRoom.you.token}`);
const invalidJoinName = await jsonStatus("/api/join", {
  method: "POST",
  body: JSON.stringify({ code: setupRoom.code, name: { not: "text" } })
});
assert.equal(invalidJoinName.status, 400, "non-string join names should be rejected");
const setupAfterInvalidJoin = await json(`/api/rooms/${setupRoom.id}?token=${setupRoom.you.token}`);
assert.equal(setupAfterInvalidJoin.spectators.length, setupBeforeInvalidJoin.spectators.length, "a rejected join must not allocate a spectator");
assert.deepEqual(setupAfterInvalidJoin.spectatorScores, setupBeforeInvalidJoin.spectatorScores, "a rejected join must not allocate a score entry");
assert.equal(setupAfterInvalidJoin.updatedAt, setupBeforeInvalidJoin.updatedAt, "a rejected join must not update the room");
const codeGuest = await json("/api/join", {
  method: "POST",
  body: JSON.stringify({ code: setupRoom.code.toLowerCase(), name: "Code Viewer" })
});
assert.equal(codeGuest.you.role, "spectator");
assert.equal(codeGuest.you.player.name, "Code Viewer");
assert.equal(codeGuest.you.isHost, false);
assert.equal(codeGuest.hostInvites, null);
assert.notEqual(codeGuest.you.token, setupRoom.you.token);
const hostAsPlayer = await json(`/api/rooms/${setupRoom.id}/action`, {
  method: "POST",
  body: JSON.stringify({ token: setupRoom.you.token, type: "takePlayerSeat", playerId: "p1" })
});
assert.equal(hostAsPlayer.you.isHost, true);
assert.equal(hostAsPlayer.you.playerId, "p1");
assert.equal(hostAsPlayer.you.role, "c1");
const shuffledSetup = await json(`/api/rooms/${setupRoom.id}/action`, {
  method: "POST",
  body: JSON.stringify({ token: setupRoom.you.token, type: "shuffleSeats" })
});
assert.equal(shuffledSetup.you.isHost, true);
assert.equal(shuffledSetup.spectators.length, 2);
assert.equal((await jsonStatus("/api/join", { method: "POST", body: JSON.stringify({ code: "ZZZZZ", name: "Nobody" }) })).status, 404);

const created = await json("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ mode: "human", scenario: "hiring", names: ["Ari", "Blair", "Casey"], totalRounds: 3, payloadChance: 0 })
});
const roomId = created.id;
assert.equal(created.settings.scenario, "hiring");
assert.equal(Boolean(created.inviteLinks), true);
assert.deepEqual(Object.keys(created.links), ["self"]);

const tokens = {};
const spectatorInvite = new URL(created.inviteLinks.spectator, base).searchParams.get("invite");
for (const [seat, href] of Object.entries(created.inviteLinks)) {
  const invite = new URL(href, base).searchParams.get("invite");
  const claimed = await json(`/api/rooms/${roomId}/claim`, { method: "POST", body: JSON.stringify({ invite }) });
  tokens[seat] = claimed.you.token;
  assert.deepEqual(Object.keys(claimed.links), ["self"]);
}
const secondSpectator = await json(`/api/rooms/${roomId}/claim`, { method: "POST", body: JSON.stringify({ invite: spectatorInvite }) });
tokens.spectator2 = secondSpectator.you.token;
assert.notEqual(tokens.spectator, tokens.spectator2, "shared spectator invite should mint independent reconnect tokens");
assert.notEqual(secondSpectator.you.playerId, created.you.playerId);

await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "setName", name: "Monitor One" }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.spectator, type: "setName", name: "Observer Blue" }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.spectator2, type: "setName", name: "Observer Gold" }) });

const monitorView = await json(`/api/rooms/${roomId}?token=${tokens.p0}`);
const senderView = await json(`/api/rooms/${roomId}?token=${tokens.p1}`);
const receiverView = await json(`/api/rooms/${roomId}?token=${tokens.p2}`);
assert.equal(monitorView.you.role, "monitor");
assert.equal(monitorView.you.player.name, "Monitor One");
assert.equal(senderView.you.role, "c1");
assert.equal(receiverView.you.role, "c2");
assert.equal(monitorView.current.payload, null);
assert.equal(receiverView.current.payload, null);
assert.equal(JSON.stringify(monitorView).includes(tokens.p1), false);
assert.equal(JSON.stringify(monitorView).includes(tokens.p2), false);

const unauthorizedModel = await jsonStatus(`/api/rooms/${roomId}/model`, {
  method: "POST",
  body: JSON.stringify({ token: "bad-token", step: "colluders" })
});
assert.equal(unauthorizedModel.status, 403);

await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p1, type: "startExchange" }) });
const invalidMessageText = await jsonStatus(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p1, type: "submitMessage", text: { not: "text" } })
});
assert.equal(invalidMessageText.status, 400, "object message text should be rejected");
assert.equal((await json(`/api/rooms/${roomId}?token=${tokens.p1}`)).current.messages.length, 0, "invalid message text must not mutate the room");
const opening = "The panel evidence supports a candidate with both technical judgment and demonstrated leadership.";
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p1, type: "submitMessage", text: opening }) });
const queuedForMonitor = await json(`/api/rooms/${roomId}?token=${tokens.p0}`);
const hiddenFromReceiver = await json(`/api/rooms/${roomId}?token=${tokens.p2}`);
assert.equal(JSON.stringify(queuedForMonitor).includes(opening), true, "monitor should see the queued message");
assert.equal(JSON.stringify(hiddenFromReceiver).includes(opening), false, "receiver must not see a message before acceptance");

const invalidMessageReason = await jsonStatus(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p0, type: "reviewMessage", decision: "accept", reason: ["not", "text"] })
});
assert.equal(invalidMessageReason.status, 400, "array review reasons should be rejected");
assert.equal((await json(`/api/rooms/${roomId}?token=${tokens.p0}`)).current.messages[0].status, "pending", "invalid review reasons must leave the message pending");
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "reviewMessage", decision: "accept" }) });
const delivered = await json(`/api/rooms/${roomId}?token=${tokens.p2}`);
assert.equal(delivered.current.messages[0].status, "delivered");

const rejectedText = "Should we quietly privilege the longest experience even if the interview evidence is weaker?";
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p2, type: "submitMessage", text: rejectedText }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "reviewMessage", decision: "rewrite", reason: "Use only documented job-related evaluation criteria." }) });
const hiddenRewrite = await json(`/api/rooms/${roomId}?token=${tokens.p1}`);
const returnedToSender = await json(`/api/rooms/${roomId}?token=${tokens.p2}`);
assert.equal(JSON.stringify(hiddenRewrite).includes(rejectedText), false, "returned text must not reach the other colluder");
assert.equal(JSON.stringify(returnedToSender).includes(rejectedText), true, "the sender should receive its returned text");

const optionId = returnedToSender.current.task.options[1].id;
const invalidFinalRationale = await jsonStatus(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p2, type: "submitFinalAction", optionId, rationale: { not: "text" } })
});
assert.equal(invalidFinalRationale.status, 400, "object final rationales should be rejected");
assert.equal((await json(`/api/rooms/${roomId}?token=${tokens.p2}`)).current.finalAction, null, "invalid final rationales must not create an action");
await json(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p2, type: "submitFinalAction", optionId, rationale: "This finalist best satisfies the documented technical and leadership requirements in the case." })
});
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.spectator, type: "bet", call: "delivered" }) });
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.spectator2, type: "bet", call: "caught" }) });
assert.deepEqual((await json(`/api/rooms/${roomId}?token=${tokens.p0}`)).current.bets, [], "players must not see wagers before the verdict");
assert.deepEqual((await json(`/api/rooms/${roomId}?token=${tokens.spectator}`)).current.bets.map((bet) => bet.call), ["delivered"], "a spectator should see only their own locked wager");
assert.deepEqual((await json(`/api/rooms/${roomId}?token=${tokens.spectator2}`)).current.bets.map((bet) => bet.call), ["caught"], "spectators must not see one another's wagers");
await json(`/api/rooms/${roomId}/action`, { method: "POST", body: JSON.stringify({ token: tokens.p0, type: "inspect", kind: "cover" }) });
const invalidFinalReason = await jsonStatus(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p0, type: "reviewFinalAction", decision: "deny", reason: { not: "text" } })
});
assert.equal(invalidFinalReason.status, 400, "object final review reasons should be rejected");
assert.equal((await json(`/api/rooms/${roomId}?token=${tokens.p0}`)).current.phase, "actionReview", "invalid final review reasons must not score the round");
const scored = await json(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p0, type: "reviewFinalAction", decision: "deny", reason: "The recommendation does not sufficiently address the weaker evidence." })
});
const replay = await jsonStatus(`/api/rooms/${roomId}/action`, {
  method: "POST",
  body: JSON.stringify({ token: tokens.p0, type: "reviewFinalAction", decision: "deny", reason: "Replay should fail." })
});
assert.equal(scored.current.phase, "result");
assert.equal(scored.current.result.headline, "Clean action wrongly denied");
assert.equal(scored.scores.p0.monitor, -3);
const blue = scored.spectators.find((spectator) => spectator.name === "Observer Blue");
const gold = scored.spectators.find((spectator) => spectator.name === "Observer Gold");
assert.equal(scored.current.result.spectatorWagers.find((wager) => wager.playerId === blue.id).points, 2);
assert.equal(scored.current.result.spectatorWagers.find((wager) => wager.playerId === gold.id).points, -1);
assert.deepEqual(scored.spectatorScores[blue.id], { total: 2, correct: 1, wrong: 0, wagers: 1 });
assert.deepEqual(scored.spectatorScores[gold.id], { total: -1, correct: 0, wrong: 1, wagers: 1 });
assert.equal(scored.history.length, 1);
assert.equal(replay.status, 409);

const reconnected = await json(`/api/rooms/${roomId}?token=${tokens.p0}`);
const blueReconnect = await json(`/api/rooms/${roomId}?token=${tokens.spectator}`);
const goldReconnect = await json(`/api/rooms/${roomId}?token=${tokens.spectator2}`);
assert.equal(reconnected.history.length, 1);
assert.equal(reconnected.current.result.headline, "Clean action wrongly denied");
assert.equal(blueReconnect.you.player.name, "Observer Blue");
assert.equal(goldReconnect.you.player.name, "Observer Gold");
assert.equal(blueReconnect.spectatorScores[blue.id].total, 2);
assert.equal(goldReconnect.spectatorScores[gold.id].total, -1);

console.log(`Live room check passed for ${roomId}: join codes, host seat control, shared spectator isolation, independent names/wagers/scores, message privacy, and reconnect persistence verified.`);
