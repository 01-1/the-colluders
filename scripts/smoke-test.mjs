import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { selectModel } from "../src/openrouter-models.js";
import { createModelClient } from "../src/model-adapter.js";
import { createRound, scenarioCatalog } from "../src/game-core.js";
import { readJsonBody } from "../src/http-utils.js";
import { createRoomPersister, readPersistedRooms } from "../src/room-persistence.js";
import { createTransactionalRoomStore } from "../src/room-store.js";
import { authorizeModelStep, claimInvite, createRoom, applyAction, dumpRooms, inviteLinks, joinRoomByCode, loadRooms, runModelStep, sanitizeRoom } from "../src/server-game.js";

const files = ["index.html", "openrouter-models.config.json", "src/app.js", "src/styles.css", "src/game-core.js", "src/server-game.js", "src/model-adapter.js", "src/openrouter-models.js", "src/http-utils.js", "src/room-persistence.js", "src/room-store.js", "server.js"];
for (const file of files) assert.ok((await readFile(new URL(`../${file}`, import.meta.url), "utf8")).trim(), `${file} is empty`);

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const server = await readFile(new URL("../server.js", import.meta.url), "utf8");
for (const phrase of [
  "Initiate operation", "Field manual", "Case type", "Delivered conversation", "Sender packet", "Receiver brief",
  "Message screening", "Accept and deliver", "Request rewrite", "Shutdown case", "Final authorization",
  "Submit final action", "Optional rationale", "Start next round", "Start new match", "Copy reconnect link", "LLM modes are offline", "Observer wager",
  "Colluders win the round", "Monitor wins the round", "Change name", "Spectators · shared link", "Join operation", "Join room",
  "Copy all invites", "Host seat setup", "Play in selected seat", "Shuffle all seats"
]) assert.ok(app.includes(phrase), `Missing UI phrase: ${phrase}`);
for (const selector of [".masthead", ".cover-task", ".case-option", ".signal-path", ".intercept", ".queued-message", ".classified"]) {
  assert.ok(css.includes(selector), `Missing CSS selector: ${selector}`);
}
for (const route of ["/api/config", "/api/join", "/api/rooms", "/action", "/model"]) assert.ok(server.includes(route), `Missing server route: ${route}`);
assert.ok(server.includes("scenarioCatalog"), "API config should publish selectable scenarios");
assert.ok(server.includes('./src/openrouter-models.js'), "standalone server should use its game-local model configuration");
assert.ok(server.includes("selectModel(await getModelCatalog(), body.model)"), "server should validate model selection");
assert.ok(app.includes("model: local.selectedModel"), "model actions should send the selected model");
assert.ok(app.includes('termHits === 1 ? "term" : "terms"'), "analysis copy should use singular term when the count is one");
assert.equal(app.includes("Reason required"), false, "monitor notes should be optional in the UI");
assert.equal(app.includes("minimum 6 words"), false, "message composer should not advertise a word-count minimum");
assert.ok(app.includes("hasActiveInteraction"), "polling should protect every focused interactive control");
assert.ok(app.includes('class="redaction" data-reveal=') && app.includes('aria-label="Reveal private Colluder A instruction"'), "the private payload reveal must be a labeled button");
assert.ok(app.includes('note.setAttribute("role", "alert")'), "transient errors should be announced to assistive technology");
assert.ok(css.includes("button:focus-visible"), "keyboard controls should have a visible focus indicator");
assert.ok(css.includes("color: var(--muted);"), "the payload reveal call-to-action should use readable default text contrast");
assert.equal((await readFile(new URL("../src/server-game.js", import.meta.url), "utf8")).includes("needs at least"), false, "server should not impose word-count minimums");
assert.equal(app.includes("Supply Run"), false, "retired route task should not remain in the client");

const caseIds = scenarioCatalog.filter((scenario) => scenario.id !== "mixed").map((scenario) => scenario.id);
assert.deepEqual(caseIds, ["procurement", "loan", "insurance", "hiring", "expense", "trading"]);
const samplePlayers = [
  { id: "p0", name: "Ari", kind: "human" },
  { id: "p1", name: "Blair", kind: "human" },
  { id: "p2", name: "Casey", kind: "human" }
];
for (const scenario of caseIds) {
  const round = createRound(samplePlayers, 0, { scenario, payloadChance: 100 }, () => 0.42);
  assert.equal(round.task.scenarioId, scenario);
  assert.equal(round.task.options.length, 3);
  assert.ok(round.payload.targetId);
  assert.ok(round.task.options.some((option) => option.id === round.payload.targetId));
}
const lowProcurement = createRound(samplePlayers, 0, { scenario: "procurement", payloadChance: 0 }, () => 0.01);
const highProcurement = createRound(samplePlayers, 0, { scenario: "procurement", payloadChance: 0 }, () => 0.99);
assert.notDeepEqual(lowProcurement.task.options, highProcurement.task.options, "case values should vary between rounds");
assert.equal(createRoom({ scenario: "hiring" }).settings.scenario, "hiring", "selected scenario should persist on the room");
assert.throws(() => createRoom({ names: ["Ari", {}, "Casey"] }), /names must be text/i, "non-string player names must be rejected");
assert.equal(createRoom({ names: ["A".repeat(80), "Blair", "Casey"] }).players[0].name.length, 24, "initial player names should be clamped server-side");

const isolatedA = createRoom({ payloadChance: 100 });
const isolatedB = createRoom({ payloadChance: 100 });
assert.throws(() => applyAction(isolatedB, isolatedA.tokens.p1, { type: "startExchange" }), /Invalid room token/, "tokens must not work across rooms");

const invalidJoinRoom = createRoom();
const invalidJoinBefore = dumpRooms(new Map([[invalidJoinRoom.id, invalidJoinRoom]]));
assert.throws(() => joinRoomByCode(invalidJoinRoom, { not: "text" }), /Display name must be text/, "invalid join names should be rejected before allocating a spectator");
assert.equal(dumpRooms(new Map([[invalidJoinRoom.id, invalidJoinRoom]])), invalidJoinBefore, "a rejected join must not change spectators, tokens, scores, or updatedAt");

const typedActionRoom = createRoom({ payloadChance: 0 });
applyAction(typedActionRoom, typedActionRoom.tokens.p1, { type: "startExchange" });
let typedActionBefore = dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]]));
assert.throws(() => applyAction(typedActionRoom, typedActionRoom.tokens.p1, { type: "submitMessage", text: { not: "text" } }), /Message must be text/, "message text objects must be rejected");
assert.equal(dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]])), typedActionBefore, "invalid message text must not mutate room state");
applyAction(typedActionRoom, typedActionRoom.tokens.p1, { type: "submitMessage", text: "The documented evidence supports a careful comparison of the available options." });
typedActionBefore = dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]]));
assert.throws(() => applyAction(typedActionRoom, typedActionRoom.tokens.p0, { type: "reviewMessage", decision: "accept", reason: ["not", "text"] }), /Review reason must be text/, "review reason arrays must be rejected");
assert.equal(dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]])), typedActionBefore, "invalid message review reasons must not mutate room state");
applyAction(typedActionRoom, typedActionRoom.tokens.p0, { type: "reviewMessage", decision: "accept" });
typedActionBefore = dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]]));
assert.throws(() => applyAction(typedActionRoom, typedActionRoom.tokens.p2, { type: "submitFinalAction", optionId: typedActionRoom.current.task.options[0].id, rationale: { not: "text" } }), /Final action rationale must be text/, "final rationale objects must be rejected");
assert.equal(dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]])), typedActionBefore, "invalid final rationale must not mutate room state");
applyAction(typedActionRoom, typedActionRoom.tokens.p2, { type: "submitFinalAction", optionId: typedActionRoom.current.task.options[0].id });
typedActionBefore = dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]]));
assert.throws(() => applyAction(typedActionRoom, typedActionRoom.tokens.p0, { type: "reviewFinalAction", decision: "approve", reason: { not: "text" } }), /Review reason must be text/, "final review reason objects must be rejected");
assert.equal(dumpRooms(new Map([[typedActionRoom.id, typedActionRoom]])), typedActionBefore, "invalid final review reasons must not mutate room state");

const seatRoom = createRoom({ mode: "human", payloadChance: 0 });
const hostToken = seatRoom.hostToken;
const originalPlayerTwoToken = seatRoom.tokens.p1;
const codeJoinToken = joinRoomByCode(seatRoom, "Code Guest");
const codeJoinView = sanitizeRoom(seatRoom, codeJoinToken);
assert.equal(codeJoinView.you.role, "spectator");
assert.equal(codeJoinView.you.player.name, "Code Guest");
assert.equal(sanitizeRoom(seatRoom, hostToken).you.isHost, true);
assert.ok(sanitizeRoom(seatRoom, hostToken).hostInvites.spectator, "host should retain setup invites after reconnect");
assert.equal(sanitizeRoom(seatRoom, originalPlayerTwoToken).hostInvites, null, "non-host participants must not receive setup invites");
assert.throws(() => applyAction(seatRoom, originalPlayerTwoToken, { type: "shuffleSeats" }), /Only the room host/, "seat management must be host-only");
applyAction(seatRoom, hostToken, { type: "takePlayerSeat", playerId: "p1" });
assert.equal(sanitizeRoom(seatRoom, hostToken).you.playerId, "p1", "host token should move into the selected player seat");
assert.equal(sanitizeRoom(seatRoom, hostToken).you.role, "c1");
assert.equal(sanitizeRoom(seatRoom, originalPlayerTwoToken).you.role, "spectator", "displaced player should move into the spectator pool");
const codeGuestId = sanitizeRoom(seatRoom, codeJoinToken).you.playerId;
applyAction(seatRoom, hostToken, { type: "swapSeats", playerId: "p0", spectatorId: codeGuestId });
assert.equal(sanitizeRoom(seatRoom, codeJoinToken).you.playerId, "p0", "selected spectator should move into the selected player seat");
const namesBeforeShuffle = [...seatRoom.players, ...seatRoom.spectators].map((participant) => participant.name).sort();
applyAction(seatRoom, hostToken, { type: "shuffleSeats" });
assert.deepEqual([...seatRoom.players, ...seatRoom.spectators].map((participant) => participant.name).sort(), namesBeforeShuffle, "shuffle should preserve every participant");
assert.equal(sanitizeRoom(seatRoom, hostToken).you.isHost, true, "host authority must follow the host token through a shuffle");
const c1TokenAfterShuffle = seatRoom.tokens[seatRoom.current.roles.c1];
applyAction(seatRoom, c1TokenAfterShuffle, { type: "startExchange" });
assert.throws(() => applyAction(seatRoom, hostToken, { type: "shuffleSeats" }), /before the first round/, "seat setup must lock when play begins");

const privacyRoom = createRoom({ scenario: "procurement", payloadChance: 100 });
const monitorToken = privacyRoom.tokens.p0;
const senderToken = privacyRoom.tokens.p1;
const receiverToken = privacyRoom.tokens.p2;
const creatorSpectatorId = privacyRoom.creatorSpectatorId;
const creatorSpectatorToken = privacyRoom.tokens[creatorSpectatorId];
const secondSpectatorToken = claimInvite(privacyRoom, privacyRoom.invites.spectator);
const thirdSpectatorToken = claimInvite(privacyRoom, privacyRoom.invites.spectator);
const secondSpectatorView = sanitizeRoom(privacyRoom, secondSpectatorToken);
const thirdSpectatorView = sanitizeRoom(privacyRoom, thirdSpectatorToken);
assert.notEqual(secondSpectatorToken, thirdSpectatorToken, "the shared spectator invite must create a unique reconnect token per claim");
assert.notEqual(secondSpectatorView.you.playerId, thirdSpectatorView.you.playerId, "spectators must receive independent identities");
assert.equal(secondSpectatorView.you.player.name, "Spectator 2");
assert.equal(thirdSpectatorView.you.player.name, "Spectator 3");
applyAction(privacyRoom, senderToken, { type: "setName", name: "Blair Updated" });
applyAction(privacyRoom, secondSpectatorToken, { type: "setName", name: "Observer Red" });
assert.equal(sanitizeRoom(privacyRoom, senderToken).you.player.name, "Blair Updated", "player seats should be able to change their name in-room");
assert.equal(sanitizeRoom(privacyRoom, secondSpectatorToken).you.player.name, "Observer Red", "spectators should be able to change their name in-room");
assert.equal(sanitizeRoom(privacyRoom, monitorToken).current.payload, null, "monitor must not see the private instruction");
assert.ok(sanitizeRoom(privacyRoom, senderToken).current.payload.targetId, "Colluder A should see the private outcome");
assert.equal(sanitizeRoom(privacyRoom, receiverToken).current.payload, null, "Colluder B must not see the private outcome");
assert.deepEqual(Object.keys(sanitizeRoom(privacyRoom, monitorToken).links), ["self"], "room state should expose only the caller reconnect link");

applyAction(privacyRoom, senderToken, { type: "startExchange" });
applyAction(privacyRoom, senderToken, { type: "submitMessage", text: "Meridian offers the strongest balance of delivery speed and documented reliability." });
assert.equal(privacyRoom.current.phase, "messageReview");
assert.equal(sanitizeRoom(privacyRoom, monitorToken).current.messages[0].text.includes("Meridian"), true, "monitor should see queued text");
assert.equal(sanitizeRoom(privacyRoom, receiverToken).current.messages.length, 0, "recipient must not see text before acceptance");
assert.throws(() => applyAction(privacyRoom, senderToken, { type: "bet", call: "delivered" }), /Only the spectator/, "player seats must not be able to wager");
applyAction(privacyRoom, creatorSpectatorToken, { type: "bet", call: "delivered" });
applyAction(privacyRoom, secondSpectatorToken, { type: "bet", call: "caught" });
assert.deepEqual(sanitizeRoom(privacyRoom, monitorToken).current.bets, [], "the monitor must not see spectator wagers before the verdict");
assert.deepEqual(sanitizeRoom(privacyRoom, senderToken).current.bets, [], "Colluder A must not see spectator wagers before the verdict");
assert.deepEqual(sanitizeRoom(privacyRoom, receiverToken).current.bets, [], "Colluder B must not see spectator wagers before the verdict");
assert.deepEqual(sanitizeRoom(privacyRoom, creatorSpectatorToken).current.bets.map((bet) => bet.call), ["delivered"], "a spectator may see only their own locked wager");
assert.deepEqual(sanitizeRoom(privacyRoom, secondSpectatorToken).current.bets.map((bet) => bet.call), ["caught"], "a second spectator may see only their own locked wager");
assert.deepEqual(sanitizeRoom(privacyRoom, thirdSpectatorToken).current.bets, [], "a spectator without a wager must not see other wagers");
applyAction(privacyRoom, monitorToken, { type: "inspect", kind: "scan" });
assert.throws(() => applyAction(privacyRoom, monitorToken, { type: "inspect", kind: "cover" }), /Only one analysis tool/, "each queued message should allow only one analysis tool");
applyAction(privacyRoom, monitorToken, { type: "reviewMessage", decision: "accept" });
assert.equal(sanitizeRoom(privacyRoom, receiverToken).current.messages[0].status, "delivered");

applyAction(privacyRoom, receiverToken, { type: "submitMessage", text: "Should delivery speed outweigh the lower bid in this contract review?" });
assert.deepEqual(sanitizeRoom(privacyRoom, monitorToken).current.inspections, [], "the next message should receive a fresh analysis allowance");
applyAction(privacyRoom, monitorToken, { type: "reviewMessage", decision: "rewrite" });
const senderAfterRewrite = sanitizeRoom(privacyRoom, senderToken);
const receiverAfterRewrite = sanitizeRoom(privacyRoom, receiverToken);
assert.equal(JSON.stringify(senderAfterRewrite).includes("Should delivery speed outweigh"), false, "returned text must not leak to the other colluder");
assert.equal(receiverAfterRewrite.current.messages.some((message) => message.status === "rewrite"), true, "sender should see its returned text and reason");
assert.equal(privacyRoom.current.nextSpeaker, "c2", "rewrite should preserve the sender's turn");

const target = privacyRoom.current.task.options.find((option) => option.id === privacyRoom.current.payload.targetId);
applyAction(privacyRoom, receiverToken, {
  type: "submitFinalAction",
  optionId: target.id,
  rationale: ""
});
assert.equal(privacyRoom.current.phase, "actionReview", "Colluder B may finish immediately after an accepted opening");
assert.equal(privacyRoom.current.finalAction.rationale, "", "final action rationale should be optional");
assert.deepEqual(sanitizeRoom(privacyRoom, monitorToken).current.inspections, [], "final authorization should receive its own analysis allowance");
applyAction(privacyRoom, monitorToken, { type: "inspect", kind: "cover" });
assert.throws(() => applyAction(privacyRoom, monitorToken, { type: "inspect", kind: "patterns" }), /Only one analysis tool/, "final authorization should also allow only one analysis tool");
applyAction(privacyRoom, monitorToken, { type: "reviewFinalAction", decision: "approve" });
assert.equal(privacyRoom.current.result.payloadApplied, true);
assert.equal(privacyRoom.current.result.headline, "Manipulated action approved");
const creatorWager = privacyRoom.current.result.spectatorWagers.find((wager) => wager.playerId === creatorSpectatorId);
const secondWager = privacyRoom.current.result.spectatorWagers.find((wager) => wager.playerId === secondSpectatorView.you.playerId);
assert.deepEqual({ correct: creatorWager.correct, points: creatorWager.points }, { correct: true, points: 2 });
assert.deepEqual({ correct: secondWager.correct, points: secondWager.points }, { correct: false, points: -1 });
assert.deepEqual(privacyRoom.spectatorScores[creatorSpectatorId], { total: 2, correct: 1, wrong: 0, wagers: 1 });
assert.deepEqual(privacyRoom.spectatorScores[secondSpectatorView.you.playerId], { total: -1, correct: 0, wrong: 1, wagers: 1 });
assert.equal(sanitizeRoom(privacyRoom, monitorToken).current.bets.length, 2, "wagers may be declassified after scoring");
assert.equal(sanitizeRoom(privacyRoom, thirdSpectatorToken).current.bets.length, 2, "all spectators may see wagers after scoring");
assert.throws(() => applyAction(privacyRoom, monitorToken, { type: "reviewFinalAction", decision: "approve" }), /already been scored|no final action/i, "final review must be idempotent");
assert.equal(privacyRoom.history.length, 1);

const cleanDenied = createRoom({ scenario: "expense", payloadChance: 0 });
applyAction(cleanDenied, cleanDenied.tokens.p1, { type: "startExchange" });
applyAction(cleanDenied, cleanDenied.tokens.p1, { type: "submitMessage", text: "The documented amount follows policy and excludes the unsupported portion of this request." });
applyAction(cleanDenied, cleanDenied.tokens.p0, { type: "reviewMessage", decision: "accept" });
applyAction(cleanDenied, cleanDenied.tokens.p2, {
  type: "submitFinalAction",
  optionId: cleanDenied.current.task.options[1].id,
  rationale: "The receipts support this amount and the unsupported charges should remain excluded."
});
applyAction(cleanDenied, cleanDenied.tokens[cleanDenied.creatorSpectatorId], { type: "bet", call: "caught" });
applyAction(cleanDenied, cleanDenied.tokens.p0, { type: "reviewFinalAction", decision: "deny" });
assert.equal(cleanDenied.current.result.headline, "Clean action wrongly denied");
assert.equal(cleanDenied.scores.p0.monitor, -3, "wrongful denial should penalize compliance");
assert.deepEqual(cleanDenied.spectatorScores[cleanDenied.creatorSpectatorId], { total: -1, correct: 0, wrong: 1, wagers: 1 }, "incorrect wager should cost one point");

const cleanShutdown = createRoom({ scenario: "loan", payloadChance: 0 });
applyAction(cleanShutdown, cleanShutdown.tokens.p1, { type: "startExchange" });
applyAction(cleanShutdown, cleanShutdown.tokens.p1, { type: "submitMessage", text: "The payment history and debt ratio support a cautious underwriting discussion." });
applyAction(cleanShutdown, cleanShutdown.tokens.p0, { type: "reviewMessage", decision: "shutdown" });
assert.equal(cleanShutdown.current.result.headline, "Wrongful shutdown");
assert.equal(cleanShutdown.scores.p0.monitor, -4, "clean shutdown should carry the largest false-positive cost");
applyAction(cleanShutdown, cleanShutdown.tokens.p0, { type: "nextRound" });
assert.equal(cleanShutdown.current.phase, "matchEnd", "shutdown must end the match rather than rotate to another round");
applyAction(cleanShutdown, cleanShutdown.tokens.p1, { type: "restartMatch" });
assert.equal(cleanShutdown.current.phase, "briefing", "players should be able to start a fresh match in the same room");
assert.equal(cleanShutdown.round, 0);
assert.equal(cleanShutdown.history.length, 0);
assert.equal(cleanShutdown.scores.p0.total, 0);
assert.equal(cleanShutdown.spectatorScores[cleanShutdown.creatorSpectatorId].total, 0);

const modelRoom = createRoom({ mode: "model-colluders", payloadChance: 100 });
assert.throws(() => authorizeModelStep(modelRoom, "bad-token", "colluders"), /Invalid room token/);
assert.throws(() => authorizeModelStep(modelRoom, modelRoom.tokens.p1, "colluders"), /Only the human monitor/);
assert.deepEqual(Object.keys(inviteLinks(modelRoom)), ["p0", "spectator"], "only the human monitor and spectators should receive model-colluders invites");
assert.throws(() => claimInvite(modelRoom, modelRoom.invites.p1), /Model-controlled seats cannot be claimed/);
assert.throws(() => applyAction(modelRoom, modelRoom.tokens.p1, { type: "startExchange" }), /Model-controlled seats cannot perform manual actions/);
applyAction(modelRoom, modelRoom.tokens.p0, { type: "setName", name: "Human Monitor" });
assert.equal(modelRoom.players[0].name, "Human Monitor", "the human monitor must remain manually controllable");

const hybridRoom = createRoom({ mode: "human-model-collude", payloadChance: 100 });
assert.deepEqual(hybridRoom.current.roles, { c1: "p0", c2: "p1", monitor: "p2" });
assert.deepEqual(Object.keys(inviteLinks(hybridRoom)), ["p0", "spectator"], "only the human colluder and spectators should receive hybrid invites");
applyAction(hybridRoom, hybridRoom.tokens.p0, { type: "startExchange" });
applyAction(hybridRoom, hybridRoom.tokens.p0, { type: "submitMessage", text: "The documented case facts support a measured recommendation with a clear rationale." });
authorizeModelStep(hybridRoom, hybridRoom.tokens.p0, "monitor");
assert.throws(() => applyAction(hybridRoom, hybridRoom.tokens.p2, { type: "reviewMessage", decision: "accept" }), /Model-controlled seats cannot perform manual actions/);
await runModelStep(hybridRoom, {
  available: true,
  async complete() {
    return { ok: true, text: JSON.stringify({ decision: "accept", reason: "The proposal is supported by the case facts." }) };
  }
}, "monitor", "example/monitor:free");
authorizeModelStep(hybridRoom, hybridRoom.tokens.p0, "partner");
assert.throws(() => applyAction(hybridRoom, hybridRoom.tokens.p1, {
  type: "submitFinalAction",
  optionId: hybridRoom.current.task.options[0].id,
  rationale: "Manual override"
}), /Model-controlled seats cannot perform manual actions/);

const spectatorModelRoom = createRoom({ mode: "model-spectator", payloadChance: 100 });
assert.deepEqual(Object.keys(inviteLinks(spectatorModelRoom)), ["spectator"], "model-vs-model rooms should expose only the spectator invite");
assert.throws(() => applyAction(spectatorModelRoom, spectatorModelRoom.tokens.p0, { type: "startExchange" }), /Model-controlled seats cannot perform manual actions/);
assert.throws(() => applyAction(spectatorModelRoom, spectatorModelRoom.tokens.p2, { type: "reviewMessage", decision: "accept" }), /Model-controlled seats cannot perform manual actions/);
authorizeModelStep(spectatorModelRoom, spectatorModelRoom.hostToken, "colluders");

const unavailable = createModelClient({ apiKey: "" });
assert.equal((await unavailable.complete({ model: "example/model:free", prompt: "test", timeoutMs: 5 })).unavailable, true);
const timeoutClient = createModelClient({
  apiKey: "test-key",
  fetchFn: (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    reject(error);
  }))
});
assert.equal((await timeoutClient.complete({ model: "example/model:free", prompt: "test", timeoutMs: 5 })).timeout, true);

let submittedModel = "";
const requestClient = createModelClient({
  apiKey: "test-key",
  fetchFn: async (_url, options) => {
    submittedModel = JSON.parse(options.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Selected model response" } }] }) };
  }
});
assert.equal((await requestClient.complete({ model: "example/paid-model", prompt: "test" })).ok, true);
assert.equal(submittedModel, "example/paid-model");
const sampleCatalog = { defaultModel: "example/default:free", models: [{ id: "example/default:free" }, { id: "example/paid-model" }] };
assert.equal(selectModel(sampleCatalog, "example/paid-model"), "example/paid-model");
assert.throws(() => selectModel(sampleCatalog, "example/not-allowed"), /not in the server model catalog/);

const selectedModels = [];
const selectedRoom = createRoom({ mode: "model-colluders", scenario: "hiring", payloadChance: 100 });
await runModelStep(selectedRoom, {
  available: true,
  async complete(request) {
    selectedModels.push(request.model);
    const text = request.prompt.includes("Reply JSON only")
      ? JSON.stringify({ optionId: selectedRoom.current.task.options[0].id, rationale: "The accepted discussion supports this documented candidate recommendation." })
      : "The strongest candidate combines relevant experience with the clearest evidence from the panel.";
    return { ok: true, model: request.model, text };
  }
}, "colluders", "example/selected-model:free");
applyAction(selectedRoom, selectedRoom.tokens.p0, { type: "reviewMessage", decision: "accept" });
await runModelStep(selectedRoom, {
  available: true,
  async complete(request) {
    selectedModels.push(request.model);
    return { ok: true, model: request.model, text: JSON.stringify({ optionId: selectedRoom.current.task.options[0].id, rationale: "The accepted discussion supports this documented candidate recommendation." }) };
  }
}, "colluders", "example/selected-model:free");
assert.deepEqual(selectedModels, ["example/selected-model:free", "example/selected-model:free"], "each model action should use the validated selection");
assert.equal(selectedRoom.current.phase, "actionReview");

let releaseConcurrentModel;
let markConcurrentStarted;
let concurrentProviderCalls = 0;
const concurrentStarted = new Promise((resolve) => { markConcurrentStarted = resolve; });
const concurrentGate = new Promise((resolve) => { releaseConcurrentModel = resolve; });
const concurrentRoom = createRoom({ mode: "model-colluders", payloadChance: 100 });
const firstConcurrentStep = runModelStep(concurrentRoom, {
  available: true,
  async complete() {
    concurrentProviderCalls += 1;
    markConcurrentStarted();
    await concurrentGate;
    return { ok: true, text: "The available evidence supports a careful comparison of the documented options." };
  }
}, "colluders", "example/concurrent:free");
await concurrentStarted;
await assert.rejects(
  runModelStep(concurrentRoom, { available: true, complete: async () => ({ ok: true, text: "duplicate" }) }, "colluders", "example/concurrent:free"),
  (error) => error.status === 409 && /already in progress/.test(error.message),
  "a second in-flight model action should fail before another provider call"
);
releaseConcurrentModel();
await firstConcurrentStep;
assert.equal(concurrentProviderCalls, 1, "concurrent model requests must make only one provider call");
assert.equal(concurrentRoom.current.messages.length, 1, "concurrent model requests must create only one pending message");
assert.equal(concurrentRoom.current.phase, "messageReview");

const invalidMonitorRoom = createRoom({ mode: "human-model-collude", payloadChance: 100 });
applyAction(invalidMonitorRoom, invalidMonitorRoom.tokens.p0, { type: "startExchange" });
applyAction(invalidMonitorRoom, invalidMonitorRoom.tokens.p0, { type: "submitMessage", text: "The documented evidence supports a careful case review." });
const invalidMonitorScores = JSON.stringify(invalidMonitorRoom.scores);
for (const invalidText of [
  "not json",
  JSON.stringify({ decision: "wave-through", reason: "Unsupported enum" }),
  JSON.stringify({ decision: "accept" }),
  JSON.stringify({ reason: "Missing decision" })
]) {
  await assert.rejects(runModelStep(invalidMonitorRoom, {
    available: true,
    async complete() { return { ok: true, text: invalidText }; }
  }, "monitor", "example/invalid:free"), (error) => error.status === 502);
  assert.equal(invalidMonitorRoom.current.phase, "messageReview", "invalid monitor output must leave the phase unchanged");
  assert.equal(invalidMonitorRoom.current.messages[0].status, "pending", "invalid monitor output must not deliver or rewrite content");
  assert.equal(JSON.stringify(invalidMonitorRoom.scores), invalidMonitorScores, "invalid monitor output must not alter scores");
}
assert.equal(invalidMonitorRoom.modelEvents.every((event) => event.ok === false), true, "invalid model output should be recorded as failed events");

const invalidFinalRoom = createRoom({ mode: "model-colluders", payloadChance: 100 });
await runModelStep(invalidFinalRoom, {
  available: true,
  async complete() { return { ok: true, text: "The documented facts support comparing the strongest available option." }; }
}, "colluders", "example/invalid-final:free");
applyAction(invalidFinalRoom, invalidFinalRoom.tokens.p0, { type: "reviewMessage", decision: "accept" });
await assert.rejects(runModelStep(invalidFinalRoom, {
  available: true,
  async complete() { return { ok: true, text: JSON.stringify({ optionId: "not-a-real-option", rationale: "Invalid selection" }) }; }
}, "colluders", "example/invalid-final:free"), (error) => error.status === 502);
assert.equal(invalidFinalRoom.current.phase, "exchange", "an invalid model option must leave the exchange open");
assert.equal(invalidFinalRoom.current.finalAction, null, "an invalid model option must not create a final action");

const successfulRoundTrip = loadRooms(dumpRooms(new Map([[selectedRoom.id, selectedRoom]]))).get(selectedRoom.id);
assert.equal(successfulRoundTrip.current.phase, "actionReview", "successful model state should survive serialization");
assert.equal(successfulRoundTrip.current.finalAction.model, true);
assert.equal(successfulRoundTrip.modelEvents[0].ok, true);
const failedRoundTrip = loadRooms(dumpRooms(new Map([[invalidMonitorRoom.id, invalidMonitorRoom]]))).get(invalidMonitorRoom.id);
assert.equal(failedRoundTrip.current.phase, "messageReview", "failed model state should survive serialization without a gameplay transition");
assert.equal(failedRoundTrip.modelEvents[0].ok, false, "failed model events should survive serialization");

function bodyRequest(body, headers = {}) {
  const request = Readable.from([body]);
  request.headers = headers;
  return request;
}
await assert.rejects(readJsonBody(bodyRequest("{bad json")), (error) => error.status === 400);
await assert.rejects(readJsonBody(bodyRequest("[]")), (error) => error.status === 400);
await assert.rejects(readJsonBody(bodyRequest(JSON.stringify({ value: "x".repeat(70_000) }))), (error) => error.status === 413);

const transactionalRoom = createRoom({ names: ["Stable", "Two", "Three"] });
const transactionalBaseline = dumpRooms(new Map([[transactionalRoom.id, transactionalRoom]]));
let rejectTransaction = true;
const persistedTransactionSnapshots = [];
const transactionalStore = createTransactionalRoomStore(new Map([[transactionalRoom.id, transactionalRoom]]), async (rooms) => {
  const snapshot = dumpRooms(rooms);
  if (rejectTransaction) throw new Error("injected persistence failure");
  persistedTransactionSnapshots.push(snapshot);
});
await assert.rejects(transactionalStore.transact((rooms) => {
  const room = createRoom({ names: ["Ghost", "Create", "Room"] });
  rooms.set(room.id, room);
}), /injected persistence failure/, "create should report a failed persistence transaction");
assert.equal(dumpRooms(transactionalStore.current()), transactionalBaseline, "create must remain invisible in memory after persistence fails");
const failedRoomMutations = [
  ["join", (room) => joinRoomByCode(room, "Ghost Join")],
  ["claim", (room) => claimInvite(room, room.invites.spectator)],
  ["action", (room) => applyAction(room, transactionalRoom.tokens.p0, { type: "setName", name: "Ghost Action" })],
  ["model event", (room) => room.modelEvents.unshift({ ok: false, reason: "Ghost Model Event" })]
];
for (const [label, mutate] of failedRoomMutations) {
  await assert.rejects(transactionalStore.transactRoom(transactionalRoom.id, mutate), /injected persistence failure/, `${label} should report a failed persistence transaction`);
  assert.equal(dumpRooms(transactionalStore.current()), transactionalBaseline, `${label} must remain invisible in memory after persistence fails`);
}
rejectTransaction = false;
await transactionalStore.transactRoom(transactionalRoom.id, (room) => applyAction(room, transactionalRoom.tokens.p0, { type: "setName", name: "Committed Name" }));
assert.equal(transactionalStore.current().get(transactionalRoom.id).players[0].name, "Committed Name", "a successful transaction should publish its staged room state");
assert.equal(persistedTransactionSnapshots.length, 1);
assert.equal(persistedTransactionSnapshots[0].includes("Ghost"), false, "a later successful persistence must not include any failed mutation");

let releaseSlowProvider;
let markSlowProviderStarted;
let slowProviderSettled = false;
const slowProviderStarted = new Promise((resolve) => { markSlowProviderStarted = resolve; });
const slowProviderGate = new Promise((resolve) => { releaseSlowProvider = resolve; });
const slowProviderRoom = createRoom({ mode: "model-colluders", payloadChance: 100 });
const unrelatedRoom = createRoom({ names: ["Unrelated", "Two", "Three"] });
const crossRoomSnapshots = [];
const crossRoomStore = createTransactionalRoomStore(new Map([
  [slowProviderRoom.id, slowProviderRoom],
  [unrelatedRoom.id, unrelatedRoom]
]), async (rooms) => crossRoomSnapshots.push(dumpRooms(rooms)));
const slowRoomTransaction = crossRoomStore.transactRoom(slowProviderRoom.id, async (room) => {
  await runModelStep(room, {
    available: true,
    async complete() {
      markSlowProviderStarted();
      await slowProviderGate;
      return { ok: true, text: "The documented facts support a careful comparison of the available options." };
    }
  }, "colluders", "example/deferred-provider:free");
}).finally(() => { slowProviderSettled = true; });
await slowProviderStarted;
const unrelatedTransaction = crossRoomStore.transactRoom(unrelatedRoom.id, (room) => applyAction(room, unrelatedRoom.tokens.p0, { type: "setName", name: "Unrelated Committed" }));
const unrelatedCompletedPromptly = await Promise.race([
  unrelatedTransaction.then(() => true),
  new Promise((resolve) => setTimeout(() => resolve(false), 75))
]);
if (!unrelatedCompletedPromptly) {
  releaseSlowProvider();
  await Promise.allSettled([slowRoomTransaction, unrelatedTransaction]);
}
assert.equal(unrelatedCompletedPromptly, true, "a slow model provider in one room must not block another room's mutation");
assert.equal(slowProviderSettled, false, "the unrelated room should commit while the provider remains unresolved");
assert.equal(crossRoomStore.current().get(unrelatedRoom.id).players[0].name, "Unrelated Committed");
assert.equal(crossRoomStore.current().get(slowProviderRoom.id).current.messages.length, 0, "uncommitted model state must remain invisible");
releaseSlowProvider();
await slowRoomTransaction;
assert.equal(crossRoomStore.current().get(slowProviderRoom.id).current.messages.length, 1, "the model room should commit after its provider resolves");
assert.equal(crossRoomStore.current().get(unrelatedRoom.id).players[0].name, "Unrelated Committed", "the later model commit must preserve the unrelated room change");
assert.equal(crossRoomSnapshots.length, 2, "each room should persist one complete transaction");
const finalCrossRoomSnapshot = loadRooms(crossRoomSnapshots.at(-1));
assert.equal(finalCrossRoomSnapshot.get(slowProviderRoom.id).current.messages.length, 1);
assert.equal(finalCrossRoomSnapshot.get(unrelatedRoom.id).players[0].name, "Unrelated Committed", "the final persisted snapshot must contain both room changes");

const persistenceDir = await mkdtemp(join(tmpdir(), "colluders-persistence-"));
const persistenceFile = join(persistenceDir, "rooms.json");
try {
  assert.equal((await readPersistedRooms(persistenceFile)).size, 0, "a missing persistence file should mean no rooms yet");
  await writeFile(persistenceFile, "{corrupt", "utf8");
  await assert.rejects(readPersistedRooms(persistenceFile), /Unable to load room persistence/, "corrupt persistence must fail loudly");

  const persist = createRoomPersister(persistenceFile);
  const firstRoom = createRoom({ names: ["First", "One", "Room"] });
  const secondRoom = createRoom({ names: ["Second", "Two", "Room"] });
  const firstRooms = new Map([[firstRoom.id, firstRoom]]);
  const secondRooms = new Map([[secondRoom.id, secondRoom]]);
  await Promise.all([persist(firstRooms), persist(secondRooms)]);
  const persisted = await readPersistedRooms(persistenceFile);
  assert.deepEqual([...persisted.keys()], [secondRoom.id], "serialized atomic writes should leave the latest complete snapshot");
} finally {
  await rm(persistenceDir, { recursive: true, force: true });
}

console.log("Smoke test passed: privacy, model authorization/locking/output validation, atomic persistence, input limits, gameplay, scoring, and accessibility hooks are covered.");
