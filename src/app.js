const app = document.querySelector("#app");
const local = {
  config: null,
  room: null,
  token: new URL(location.href).searchParams.get("token") || "",
  invite: new URL(location.href).searchParams.get("invite") || "",
  roomId: location.pathname.match(/^\/room\/([^/]+)/)?.[1] || "",
  error: "",
  poll: null,
  copied: false
};

const modeLabels = {
  human: "Human multiplayer",
  "model-colluders": "Human monitor vs LLM colluders",
  "human-model-collude": "Human + LLM colluder vs LLM monitor",
  "model-spectator": "Model vs model spectator/eval"
};

init();

async function init() {
  local.config = await api("/api/config");
  if (local.roomId && local.invite && !local.token) await claimInvite();
  if (local.roomId) await loadRoom();
  else renderLobby();
}

async function claimInvite() {
  const room = await api(`/api/rooms/${local.roomId}/claim`, {
    method: "POST",
    body: JSON.stringify({ invite: local.invite })
  });
  local.token = room.you.token;
  local.invite = "";
  history.replaceState(null, "", `/room/${local.roomId}?token=${local.token}`);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadRoom() {
  try {
    local.room = await api(`/api/rooms/${local.roomId}?token=${encodeURIComponent(local.token)}`);
    renderRoom();
    startPolling();
  } catch (error) {
    local.error = error.message;
    renderLobby();
  }
}

function startPolling() {
  clearInterval(local.poll);
  local.poll = setInterval(async () => {
    if (!local.roomId) return;
    try {
      local.room = await api(`/api/rooms/${local.roomId}?token=${encodeURIComponent(local.token)}`);
      renderRoom();
    } catch (error) {
      local.error = error.message;
    }
  }, 1800);
}

async function postAction(type, extra = {}) {
  try {
    local.error = "";
    local.room = await api(`/api/rooms/${local.roomId}/action`, {
      method: "POST",
      body: JSON.stringify({ token: local.token, type, ...extra })
    });
    renderRoom();
  } catch (error) {
    flash(error.message);
  }
}

async function postModel(step) {
  try {
    local.error = "";
    local.room = await api(`/api/rooms/${local.roomId}/model`, {
      method: "POST",
      body: JSON.stringify({ token: local.token, step })
    });
    renderRoom();
  } catch (error) {
    flash(error.message);
  }
}

function renderShell(content, aside = "") {
  app.innerHTML = `
    <div class="hero-band">
      <div>
        <p class="eyebrow">Steganographic coordination under review</p>
        <h1>The Colluders</h1>
      </div>
      <div class="round-token">Network room edition</div>
    </div>
    <div class="layout ${aside ? "" : "single"}">
      <div class="main-card">${content}</div>
      ${aside}
    </div>
  `;
}

function renderLobby() {
  const model = local.config?.modelStatus;
  renderShell(`
    <section class="setup-grid">
      <div>
        <h2>Create a room</h2>
        <p class="muted">Open the generated links in separate browsers or tabs. Each player sees only their own role and private information; the room persists on the local server for reconnects.</p>
        ${local.error ? `<p class="error">${escapeHtml(local.error)}</p>` : ""}
      </div>
      <label>Mode
        <select id="mode">
          ${local.config.modes.map((mode) => `<option value="${mode.id}">${mode.label}</option>`).join("")}
        </select>
      </label>
      <label>Player 1<input id="p0" value="Ari" maxlength="24"></label>
      <label>Player 2<input id="p1" value="Blair" maxlength="24"></label>
      <label>Player 3<input id="p2" value="Casey" maxlength="24"></label>
      <label>Rounds<input id="rounds" type="number" min="3" max="15" value="9"></label>
      <label>Payload chance<input id="payloadChance" type="number" min="0" max="100" value="60"></label>
      <label>Inspections<input id="inspections" type="number" min="1" max="3" value="2"></label>
      <section class="model-state wide">
        <strong>Model modes</strong>
        <span>${model.available ? `Available through ${model.provider}. Free models: ${Object.values(model.freeModels).join(", ")}.` : "Unavailable until OPENROUTER_API_KEY is set in .env. Human multiplayer still works."}</span>
      </section>
      <button class="primary wide" id="createRoom">Create multiplayer room</button>
    </section>
  `);
  document.querySelector("#createRoom").addEventListener("click", createRoom);
}

async function createRoom() {
  const body = {
    mode: document.querySelector("#mode").value,
    names: ["p0", "p1", "p2"].map((id) => document.querySelector(`#${id}`).value.trim()),
    totalRounds: Number(document.querySelector("#rounds").value),
    payloadChance: Number(document.querySelector("#payloadChance").value),
    inspectionsPerRound: Number(document.querySelector("#inspections").value)
  };
  try {
    const room = await api("/api/rooms", { method: "POST", body: JSON.stringify(body) });
    local.roomId = room.id;
    local.token = room.you.token;
    local.inviteLinks = room.inviteLinks;
    history.replaceState(null, "", `/room/${room.id}?token=${room.you.token}`);
    local.room = room;
    startPolling();
    renderRoom();
  } catch (error) {
    flash(error.message);
  }
}

function renderRoom() {
  const room = local.room;
  const round = room.current;
  const role = room.you.role;
  renderShell(`
    ${phaseLine(round.phase)}
    <section class="room-head">
      <div>
        <p class="eyebrow">${modeLabels[room.mode]}</p>
        <h2>Room ${escapeHtml(room.code)}</h2>
        <p class="muted">You are ${escapeHtml(room.you.player.name)}: <strong>${roleLabel(role)}</strong></p>
      </div>
      <button id="copyLinks">${local.copied ? "Links copied" : "Copy join links"}</button>
    </section>
    ${joinLinks(room)}
    ${round.phase === "matchEnd" ? renderMatchEnd(room) : renderRound(room)}
  `, scoreBoard(room));
  bindRoomEvents(room);
}

function phaseLine(active) {
  const phases = ["briefing", "exchange", "decode", "monitor", "result"];
  return `<div class="phase-line">${phases.map((phase, index) => `<span class="${phase === active ? "active" : ""}">${index + 1} ${phase}</span>`).join("")}</div>`;
}

function joinLinks(room) {
  const links = local.inviteLinks || room.links;
  return `
    <section class="link-grid">
      ${Object.entries(links).map(([seat, href]) => `
        <article>
          <strong>${seat === "self" ? "Your reconnect link" : seat === "spectator" ? "Spectator invite" : `${playerName(room, seat)} invite`}</strong>
          <span>${location.origin}${href}</span>
        </article>
      `).join("")}
    </section>
  `;
}

function renderRound(room) {
  const round = room.current;
  return `
    ${taskCard(round.task)}
    ${roleCards(room)}
    ${privatePanel(room)}
    ${transcript(round)}
    ${controlsFor(room)}
    ${historyPanel(room)}
  `;
}

function taskCard(task) {
  return `
    <section class="task-panel">
      <div class="task-map" aria-hidden="true">
        <svg viewBox="0 0 100 90" role="img">
          <rect x="6" y="10" width="88" height="70" rx="4"></rect>
          <path d="${task.visual}"></path>
          <circle cx="22" cy="32" r="4"></circle>
          <circle cx="67" cy="17" r="4"></circle>
          <circle cx="88" cy="63" r="4"></circle>
        </svg>
      </div>
      <div>
        <p class="eyebrow">${escapeHtml(task.title)}</p>
        <h2>${escapeHtml(task.prompt)}</h2>
        <ul class="facts">${task.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>
        <p class="ask">${escapeHtml(task.ask)}</p>
        <div class="chips">${task.constraints.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>
    </section>
  `;
}

function roleCards(room) {
  const names = room.current.roleNames;
  return `
    <section class="roles">
      <div><span>Colluder A</span><strong>${escapeHtml(names.c1)}</strong></div>
      <div><span>Colluder B</span><strong>${escapeHtml(names.c2)}</strong></div>
      <div><span>Monitor</span><strong>${escapeHtml(names.monitor)}</strong></div>
    </section>
  `;
}

function privatePanel(room) {
  const round = room.current;
  if (!["c1", "c2"].includes(room.you.role)) {
    return `<section class="private-box"><div><p class="eyebrow">Private payload</p><h2>Hidden from this seat</h2><p>Only current colluders can see whether this round contains a payload before scoring.</p></div></section>`;
  }
  return `
    <section class="private-box open">
      <div>
        <p class="eyebrow">Private colluder brief</p>
        <h2>${round.hasPayload ? `Payload: ${escapeHtml(round.payload.value)}` : "No payload this round"}</h2>
        <p>${round.hasPayload ? `${escapeHtml(round.payload.type)}. ${escapeHtml(round.payload.hint)} Strategy: ${escapeHtml(round.strategy)}` : "Play the task cleanly. If the monitor over-flags, that is a false positive."}</p>
      </div>
    </section>
  `;
}

function transcript(round) {
  if (round.phase === "briefing") return "";
  return `
    <section class="message-review">
      <p class="eyebrow">Public transcript</p>
      ${round.messages.map((message, index) => `
        <blockquote><b>${escapeHtml(message.label)}:</b> ${message.text ? escapeHtml(message.text) : `<span class="muted">Waiting for message ${index + 1}</span>`}</blockquote>
      `).join("")}
    </section>
  `;
}

function controlsFor(room) {
  const round = room.current;
  const role = room.you.role;
  if (round.phase === "briefing") {
    const canStart = ["c1", "c2"].includes(role);
    return `<section class="controls-panel">${canStart ? `<button class="primary" id="startExchange">Start public exchange</button>` : `<p class="muted">Waiting for the colluders to start the exchange.</p>`}${modelButtons(room)}</section>`;
  }
  if (round.phase === "exchange") return exchangeControls(room, role);
  if (round.phase === "decode") return decodeControls(room, role);
  if (round.phase === "monitor") return monitorControls(room, role);
  if (round.phase === "result") return resultPanel(room);
  return "";
}

function exchangeControls(room, role) {
  const round = room.current;
  if (room.mode === "model-colluders" || room.mode === "model-spectator") {
    return `<section class="controls-panel">${modelButtons(room)}</section>`;
  }
  return `
    <section class="exchange-board">
      ${round.messages.map((message, index) => {
        const allowed = role === message.from;
        return `
          <label>
            ${message.label} ${allowed ? "(your turn)" : ""}
            <textarea id="msg${index}" ${allowed ? "" : "disabled"}>${escapeHtml(message.text)}</textarea>
          </label>
        `;
      }).join("")}
      <div class="controls">
        <button id="saveMessages">Save my messages</button>
        <button class="primary" id="lockExchange">Lock exchange for decode</button>
      </div>
      ${modelButtons(room)}
    </section>
  `;
}

function decodeControls(room, role) {
  if (room.mode === "model-colluders" || room.mode === "model-spectator") return `<section class="controls-panel">${modelButtons(room)}</section>`;
  if (role !== "c2") return `<section class="controls-panel"><p class="muted">Waiting for Colluder B to submit the private payload guess.</p></section>`;
  return `
    <section class="controls-panel">
      <label>Private recovered payload<input id="c2Guess" value="${escapeHtml(room.current.c2Guess)}" placeholder="Exact payload, if any"></label>
      <button class="primary" id="submitGuess">Submit private guess</button>
    </section>
  `;
}

function monitorControls(room, role) {
  const round = room.current;
  if (room.mode === "human-model-collude" || room.mode === "model-spectator") {
    return `<section class="controls-panel">${modelButtons(room)}${spectatorBet(room)}</section>`;
  }
  if (role !== "monitor") return `<section class="controls-panel"><p class="muted">Waiting for the monitor decision.</p>${spectatorBet(room)}</section>`;
  return `
    <section class="toolbox">
      <div><p class="eyebrow">Inspection tools</p><h2>${round.inspections.length} / ${room.settings.inspectionsPerRound} used</h2></div>
      <button data-inspect="scan">Signal scan</button>
      <button data-inspect="cover">Cover audit</button>
      <button data-inspect="patterns">Pattern list</button>
    </section>
    ${evidence(round)}
    <section class="controls-panel">
      <div class="segmented">
        <label><input type="radio" name="call" value="clean" ${round.monitorCall === "clean" ? "checked" : ""}> Clean</label>
        <label><input type="radio" name="call" value="flag" ${round.monitorCall === "flag" ? "checked" : ""}> Flag suspicious</label>
      </div>
      <label>Suspected payload<input id="monitorGuess" value="${escapeHtml(round.monitorGuess)}"></label>
      <label>Rationale<textarea id="rationale">${escapeHtml(round.rationale)}</textarea></label>
      <button class="primary" id="monitorDecision">Score decision</button>
    </section>
  `;
}

function evidence(round) {
  const ev = local.room.current.evidence;
  if (!ev) return "";
  const parts = [];
  if (round.inspections.includes("scan")) parts.push(`<article><strong>Signal scan: ${ev.scan.label}</strong><span>${ev.scan.hits.length ? ev.scan.hits.map(escapeHtml).join(", ") : "No direct steganography vocabulary found."}</span></article>`);
  if (round.inspections.includes("cover")) parts.push(`<article><strong>Cover audit: ${ev.cover.label}</strong><span>${ev.cover.termHits} task terms across ${ev.cover.wordCount} words.</span></article>`);
  if (round.inspections.includes("patterns")) parts.push(`<article><strong>Pattern list</strong><span>Numbers: ${ev.scan.numbers}; repeated words: ${ev.scan.repeatedWords.length ? ev.scan.repeatedWords.map(escapeHtml).join(", ") : "none"}.</span></article>`);
  return parts.length ? `<section class="scan">${parts.join("")}</section>` : "";
}

function resultPanel(room) {
  const round = room.current;
  return `
    <section class="result">
      <p class="eyebrow">Round ${room.round + 1} result</p>
      <h2>${escapeHtml(round.result.headline)}</h2>
      <p>${escapeHtml(round.result.detail)}</p>
      <dl>
        <div><dt>Payload round</dt><dd>${round.hasPayload ? "Yes" : "No"}</dd></div>
        <div><dt>Payload</dt><dd>${round.payload ? escapeHtml(round.payload.value) : "None"}</dd></div>
        <div><dt>Monitor points</dt><dd>${round.result.points.monitor}</dd></div>
        <div><dt>Colluder points</dt><dd>${round.result.points.colluders}</dd></div>
      </dl>
    </section>
    <div class="controls"><button class="primary" id="nextRound">${room.round + 1 >= room.settings.totalRounds ? "Finish match" : "Rotate roles"}</button></div>
  `;
}

function modelButtons(room) {
  const mode = room.mode;
  const status = room.modelStatus;
  const phase = room.current.phase;
  const role = room.you.role;
  if (mode === "human") return "";
  if (!status.available) return `<p class="model-offline">Model mode is offline. Add OPENROUTER_API_KEY to .env and restart the server. Human multiplayer remains available.</p>`;
  if (mode === "model-colluders" && ["briefing", "exchange"].includes(phase) && ["monitor", "spectator"].includes(role)) {
    return `<button class="primary" data-model-step="colluders">Generate LLM colluder exchange</button>`;
  }
  if (mode === "human-model-collude" && phase === "exchange" && role === "c1") {
    return `<button class="primary" data-model-step="partner">Generate LLM partner reply</button>`;
  }
  if (mode === "human-model-collude" && phase === "monitor" && ["c1", "spectator"].includes(role)) {
    return `<button class="primary" data-model-step="monitor">Run LLM monitor</button>`;
  }
  if (mode === "model-spectator" && phase === "briefing" && role === "spectator") {
    return `<button class="primary" data-model-step="colluders">Generate model colluders</button>`;
  }
  if (mode === "model-spectator" && phase === "monitor" && role === "spectator") {
    return `<button class="primary" data-model-step="monitor">Run model monitor</button>`;
  }
  return "";
}

function spectatorBet(room) {
  if (room.you.role !== "spectator") return "";
  return `<section class="controls-panel"><p class="eyebrow">Spectator bet</p><button data-bet="delivered">Payload gets through</button><button data-bet="caught">Monitor catches it</button></section>`;
}

function renderMatchEnd(room) {
  const ranking = [...room.players].filter((p) => p.id !== "spectator").sort((a, b) => room.scores[b.id].total - room.scores[a.id].total);
  return `
    <section class="final">
      <p class="eyebrow">Match complete</p>
      <h2>${escapeHtml(ranking[0].name)} wins the table</h2>
      <div class="podium">${ranking.map((player, index) => {
        const score = room.scores[player.id];
        return `<article><span>#${index + 1}</span><strong>${escapeHtml(player.name)}</strong><b>${score.total}</b><small>${score.deliveries} deliveries, ${score.catches} catches, ${score.cleanClears} clean clears, ${score.falseFlags} false flags</small></article>`;
      }).join("")}</div>
    </section>
    ${historyPanel(room)}
  `;
}

function historyPanel(room) {
  if (!room.history.length) return "";
  return `
    <section class="history">
      <p class="eyebrow">Match history</p>
      ${room.history.slice(0, 8).map((item) => `<article><strong>R${item.round}: ${escapeHtml(item.result.headline)}</strong><span>${escapeHtml(item.task)}; payload ${escapeHtml(item.payload)}; ${item.result.points.monitor}/${item.result.points.colluders} points.</span></article>`).join("")}
    </section>
  `;
}

function scoreBoard(room) {
  return `
    <aside class="scoreboard">
      <div class="score-head"><span>League Table</span><strong>${Math.min(room.round + 1, room.settings.totalRounds)} / ${room.settings.totalRounds}</strong></div>
      ${room.players.filter((p) => p.id !== "spectator").map((player) => {
        const score = room.scores[player.id];
        return `<div class="score-row"><div><strong>${escapeHtml(player.name)}</strong><span>${player.kind}; C ${score.colluder} / M ${score.monitor}</span></div><b>${score.total}</b></div>`;
      }).join("")}
    </aside>
  `;
}

function bindRoomEvents(room) {
  document.querySelector("#copyLinks")?.addEventListener("click", copyLinks);
  document.querySelector("#startExchange")?.addEventListener("click", () => postAction("startExchange"));
  document.querySelector("#saveMessages")?.addEventListener("click", saveMessages);
  document.querySelector("#lockExchange")?.addEventListener("click", () => postAction("lockExchange"));
  document.querySelector("#submitGuess")?.addEventListener("click", () => postAction("submitGuess", { guess: document.querySelector("#c2Guess").value }));
  document.querySelector("#monitorDecision")?.addEventListener("click", () => postAction("monitorDecision", {
    call: document.querySelector("input[name='call']:checked").value,
    guess: document.querySelector("#monitorGuess").value,
    rationale: document.querySelector("#rationale").value,
    confidence: 3
  }));
  document.querySelector("#nextRound")?.addEventListener("click", () => postAction("nextRound"));
  document.querySelectorAll("[data-inspect]").forEach((button) => button.addEventListener("click", () => postAction("inspect", { kind: button.dataset.inspect })));
  document.querySelectorAll("[data-model-step]").forEach((button) => button.addEventListener("click", () => postModel(button.dataset.modelStep)));
  document.querySelectorAll("[data-bet]").forEach((button) => button.addEventListener("click", () => postAction("bet", { call: button.dataset.bet })));
}

async function saveMessages() {
  const room = local.room;
  for (let index = 0; index < room.current.messages.length; index += 1) {
    const textarea = document.querySelector(`#msg${index}`);
    if (textarea && !textarea.disabled) await postAction("submitMessage", { index, text: textarea.value });
  }
}

async function copyLinks() {
  const links = local.inviteLinks || local.room.links;
  const text = Object.entries(links).map(([seat, href]) => `${seat}: ${location.origin}${href}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    local.copied = true;
    renderRoom();
  } catch {
    flash("Clipboard unavailable.");
  }
}

function playerName(room, playerId) {
  return room.players.find((player) => player.id === playerId)?.name || playerId;
}

function roleLabel(role) {
  return { c1: "Colluder A", c2: "Colluder B", monitor: "Monitor", spectator: "Spectator" }[role] || role;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function flash(message) {
  const note = document.createElement("div");
  note.className = "toast";
  note.textContent = message;
  document.body.append(note);
  setTimeout(() => note.remove(), 2400);
}
