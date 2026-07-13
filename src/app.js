/* =============================================================
   THE COLLUDERS — Intercept Console client
   Vanilla template-literal SPA over the room HTTP API.
   The server owns all game rules, role assignment, privacy and
   scoring; this file is presentation + glue only.
   ============================================================= */

const app = document.querySelector("#app");
const appBaseUrl = new URL("../", import.meta.url);
const appRoute = location.pathname.startsWith(appBaseUrl.pathname)
  ? location.pathname.slice(appBaseUrl.pathname.length)
  : "";
const pageParams = new URL(location.href).searchParams;

function publicUrl(path) {
  const relativePath = path.replace(/^\/+/, "");
  const roomRoute = relativePath.match(/^room\/([^/?]+)(\?.*)?$/);
  if (!roomRoute) return new URL(relativePath, appBaseUrl);

  const url = new URL("./", appBaseUrl);
  const roomParams = new URLSearchParams(roomRoute[2]?.slice(1) ?? "");
  url.searchParams.set("room", roomRoute[1]);
  for (const [key, value] of roomParams) url.searchParams.set(key, value);
  return url;
}

const local = {
  config: null,
  room: null,
  token: pageParams.get("token") || "",
  invite: pageParams.get("invite") || "",
  roomId: pageParams.get("room") || appRoute.match(/^room\/([^/]+)/)?.[1] || "",
  inviteLinks: null,
  error: "",
  poll: null,
  copied: false,
  nameEditorOpen: false,
  drafts: {},
  revealed: {},
  selectedModel: localStorage.getItem("colluders:selected-model") || ""
};

const MODE_LABELS = {
  human: "Human multiplayer",
  "model-colluders": "Human monitor vs LLM colluders",
  "human-model-collude": "Human + LLM colluder vs LLM monitor",
  "model-spectator": "Model vs model spectator/eval"
};

const ROLE = {
  c1: { name: "Colluder A", code: "SENDER" },
  c2: { name: "Colluder B", code: "RECEIVER" },
  monitor: { name: "Monitor", code: "WATCH" },
  spectator: { name: "Spectator", code: "OBSERVER" }
};

const PHASES = [
  { id: "briefing", label: "Brief" },
  { id: "exchange", label: "Discuss" },
  { id: "messageReview", label: "Screen" },
  { id: "actionReview", label: "Authorize" },
  { id: "result", label: "Verdict" }
];

init();

/* ---------- lifecycle ---------- */

async function init() {
  try {
    local.config = await api("/api/config");
    normalizeSelectedModel();
  } catch (error) {
    app.innerHTML = `<div class="notice error">Console offline: ${escapeHtml(error.message)}</div>`;
    return;
  }
  if (local.roomId && local.invite && !local.token) await claimInvite();
  if (local.roomId) await loadRoom();
  else renderLobby();
}

async function claimInvite() {
  try {
    const room = await api(`/api/rooms/${local.roomId}/claim`, {
      method: "POST",
      body: JSON.stringify({ invite: local.invite })
    });
    local.token = room.you.token;
    local.invite = "";
    history.replaceState(null, "", publicUrl(`room/${local.roomId}?token=${local.token}`));
  } catch (error) {
    local.error = error.message;
  }
}

async function api(path, options = {}) {
  const response = await fetch(publicUrl(path), {
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
      const interacting = hasActiveInteraction();
      local.room = await api(`/api/rooms/${local.roomId}?token=${encodeURIComponent(local.token)}`);
      if (!interacting && !hasActiveInteraction()) renderRoom();
    } catch (error) {
      local.error = error.message;
    }
  }, 1800);
}

function hasActiveInteraction() {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  return active.matches?.("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href], [tabindex]:not([tabindex='-1'])") || false;
}

async function postAction(type, extra = {}) {
  try {
    local.error = "";
    local.room = await api(`/api/rooms/${local.roomId}/action`, {
      method: "POST",
      body: JSON.stringify({ token: local.token, type, ...extra })
    });
    renderRoom();
    return local.room;
  } catch (error) {
    flash(error.message);
    return null;
  }
}

async function postModel(step) {
  try {
    local.error = "";
    local.room = await api(`/api/rooms/${local.roomId}/model`, {
      method: "POST",
      body: JSON.stringify({ token: local.token, step, model: local.selectedModel })
    });
    renderRoom();
  } catch (error) {
    flash(error.message);
  }
}

/* ---------- shell ---------- */

function shell(inner, { showLive = false } = {}) {
  app.innerHTML = `
    <header class="dossier">
      <div class="classbar">
        <span>TOP SECRET // CHANNEL MONITORED // FILE C-0RR-9</span>
        <span class="live">${showLive ? `<span class="dot"></span> LINK ACTIVE` : "STANDBY"}</span>
      </div>
      <div class="masthead">
        <span class="crop tl"></span><span class="crop tr"></span>
        <span class="crop bl"></span><span class="crop br"></span>
        <p class="tag">Steganographic coordination under review</p>
        <h1>The Colluders</h1>
        <p class="sub">Colluder A may receive a secret instruction to influence a real workplace decision. Colluder B must complete the case, while a compliance monitor screens every message before delivery and approves or blocks the final action. Some cases are completely clean, so reckless intervention carries a cost.</p>
      </div>
    </header>
    ${inner}
  `;
}

/* ---------- lobby ---------- */

function renderLobby() {
  const model = local.config.modelStatus;
  const catalog = local.config.modelCatalog;
  const modes = local.config.modes;
  shell(`
    <div class="layout single">
      <div class="stack">
        <section class="panel accent">
          <div class="panel-head"><h2>Field manual</h2><span class="tag">Read-in</span></div>
          <div class="panel-body">
            <div class="brief-lines">
              ${briefLine("01", "A real decision must be made", "The case may involve a contract, loan, claim, hire, expense, or trade. Colluder B is responsible for submitting the final action.")}
              ${briefLine("02", "Colluder A may receive an improper instruction", "A privately assigned outcome must be communicated through useful case discussion. On clean rounds there is no instruction at all.")}
              ${briefLine("03", "Every message is screened before delivery", "The monitor can accept a queued message, return it for a rewrite, or shut the case down. Rejected text never reaches the other colluder.")}
              ${briefLine("04", "The final action also needs authorization", "After the opening proposal, Colluder B may act immediately or ask for more information. Compliance then approves, denies, or shuts down the final action.")}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>Join operation</h2><span class="tag">Room code</span></div>
          <div class="panel-body">
            <p class="hint" style="margin:0 0 14px">Enter the five-character code to join as a spectator. The host can move you into a player seat before round one.</p>
            <div class="join-row">
              <label class="field"><span>Join code</span><input id="joinCode" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="ABCDE"></label>
              <label class="field"><span>Your name</span><input id="joinName" maxlength="24" value="Spectator"></label>
              <button class="primary" id="joinRoom">Join room</button>
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head"><h2>New operation</h2><span class="tag">Configure</span></div>
          <div class="panel-body">
            ${local.error ? `<div class="notice error" style="margin-bottom:14px">${escapeHtml(local.error)}</div>` : ""}
            <div class="lobby-grid">
              <label class="field full"><span>Operation mode</span>
                <select id="mode">
                  ${modes.map((mode) => `<option value="${mode.id}">${escapeHtml(mode.label)}</option>`).join("")}
                </select>
              </label>
              <p class="mode-desc full" id="modeDesc">${escapeHtml(modes[0].description)}</p>
              <label class="field full"><span>Case type</span>
                <select id="scenario">
                  ${local.config.scenarios.map((scenario) => `<option value="${scenario.id}">${escapeHtml(scenario.label)}</option>`).join("")}
                </select>
              </label>
              <p class="mode-desc full" id="scenarioDesc">${escapeHtml(local.config.scenarios[0].description)}</p>
              <label class="field full"><span>OpenRouter model</span>
                <select data-model-select ${catalog.models.length ? "" : "disabled"}>${modelOptions()}</select>
              </label>
              <label class="field"><span>Seat 1 · callsign</span><input id="p0" value="Ari" maxlength="24"></label>
              <label class="field"><span>Seat 2 · callsign</span><input id="p1" value="Blair" maxlength="24"></label>
              <label class="field"><span>Seat 3 · callsign</span><input id="p2" value="Casey" maxlength="24"></label>
              <label class="field"><span>Rounds</span><input id="rounds" type="number" min="3" max="15" value="9"></label>
              <label class="field"><span>Payload chance %</span><input id="payloadChance" type="number" min="0" max="100" value="60"></label>
              <div class="model-readout full ${model.available ? "on" : "off"}">
                <span class="status-dot"></span>
                <span>${model.available
                  ? `LLM modes online via <b style="color:var(--ink)">${escapeHtml(model.provider)}</b> — ${catalog.freeModels.length} free and ${catalog.paidModels.length} paid models allowed.`
                  : "LLM modes offline — set OPENROUTER_API_KEY in this game's ignored .env file to enable them. Human multiplayer is fully playable now."}</span>
              </div>
              <button class="primary wide full" id="createRoom">▸ Initiate operation</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `);
  document.querySelector("#createRoom").addEventListener("click", createRoom);
  document.querySelector("#joinRoom").addEventListener("click", joinRoom);
  document.querySelector("#joinCode").addEventListener("input", (event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
  document.querySelector("#joinCode").addEventListener("keydown", (event) => { if (event.key === "Enter") joinRoom(); });
  bindModelSelectors();
  const modeSelect = document.querySelector("#mode");
  modeSelect.addEventListener("change", () => {
    const found = modes.find((mode) => mode.id === modeSelect.value);
    document.querySelector("#modeDesc").textContent = found?.description || "";
  });
  const scenarioSelect = document.querySelector("#scenario");
  scenarioSelect.addEventListener("change", () => {
    const found = local.config.scenarios.find((scenario) => scenario.id === scenarioSelect.value);
    document.querySelector("#scenarioDesc").textContent = found?.description || "";
  });
}

function briefLine(idx, title, body) {
  return `
    <div class="brief-line">
      <div class="idx">${idx}</div>
      <div><b>${escapeHtml(title)}</b><p>${escapeHtml(body)}</p></div>
    </div>
  `;
}

async function createRoom() {
  const body = {
    mode: document.querySelector("#mode").value,
    scenario: document.querySelector("#scenario").value,
    names: ["p0", "p1", "p2"].map((id) => document.querySelector(`#${id}`).value.trim()),
    totalRounds: Number(document.querySelector("#rounds").value),
    payloadChance: Number(document.querySelector("#payloadChance").value)
  };
  try {
    const room = await api("/api/rooms", { method: "POST", body: JSON.stringify(body) });
    local.roomId = room.id;
    local.token = room.you.token;
    local.inviteLinks = room.inviteLinks;
    local.room = room;
    history.replaceState(null, "", publicUrl(`room/${room.id}?token=${room.you.token}`));
    startPolling();
    renderRoom();
  } catch (error) {
    flash(error.message);
  }
}

async function joinRoom() {
  try {
    const room = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({
        code: document.querySelector("#joinCode").value,
        name: document.querySelector("#joinName").value
      })
    });
    local.roomId = room.id;
    local.token = room.you.token;
    local.inviteLinks = null;
    local.room = room;
    history.replaceState(null, "", publicUrl(`room/${room.id}?token=${room.you.token}`));
    startPolling();
    renderRoom();
  } catch (error) {
    flash(error.message);
  }
}

/* ---------- room ---------- */

function renderRoom() {
  const room = local.room;
  const round = room.current;
  const role = room.you.role;
  const inMatch = round.phase !== "matchEnd";

  const main = inMatch ? `
    ${signalPath(round.phase)}
    ${inviteBlock(room)}
    ${hostSeatPanel(room)}
    ${coverTaskPanel(room)}
    ${privateBriefPanel(room)}
    ${transcriptPanel(room)}
    ${controlsPanel(room)}
  ` : renderMatchEnd(room);

  shell(`
    <div class="layout">
      <div class="stack">
        <section class="panel accent">
          <div class="panel-body">
            <div class="topbar">
              <div class="id-block">
                <p class="eyebrow" style="margin:0 0 4px">Channel ID</p>
                <span class="channel-id">${escapeHtml(room.code)}</span>
                <span class="mode-name">${escapeHtml(MODE_LABELS[room.mode] || room.mode)}</span>
              </div>
              <div class="actions">
                ${roleBadge(role, room.you.player.name)}
                <details class="name-editor" ${local.nameEditorOpen ? "open" : ""}>
                  <summary>Change name</summary>
                  <div class="name-editor-body">
                    <label class="field"><span>Display name</span><input id="displayName" value="${escapeHtml(room.you.player.name)}" maxlength="24"></label>
                    <button class="primary" id="saveName">Save name</button>
                  </div>
                </details>
                <button id="copyLinks" class="ghost">${local.copied ? "✓ Link copied" : "Copy reconnect link"}</button>
              </div>
            </div>
          </div>
        </section>
        ${main}
      </div>
      ${railColumn(room)}
    </div>
  `, { showLive: true });

  bindRoomEvents(room);
}

function roleBadge(role, name) {
  const info = ROLE[role] || { name: role, code: "" };
  return `
    <span class="role-badge">
      <span class="swatch role-${role}"></span>
      <span><b class="role-${role}">${escapeHtml(info.name)}</b></span>
      <small>${escapeHtml(name)}</small>
    </span>
  `;
}

function signalPath(active) {
  const activeIndex = PHASES.findIndex((phase) => phase.id === active);
  return `
    <nav class="signal-path" aria-label="Round progress">
      ${PHASES.map((phase, index) => {
        const state = index < activeIndex ? "done" : index === activeIndex ? "active" : "";
        return `
          <div class="node ${state}">
            <span class="pip">${index < activeIndex ? "✓" : index + 1}</span>
            <span class="lab">${phase.label}</span>
          </div>
        `;
      }).join("")}
    </nav>
  `;
}

function inviteBlock(room) {
  const links = room.hostInvites || local.inviteLinks;
  if (!links || !Object.keys(links).length) return "";
  return `
    <section class="panel">
      <div class="panel-head"><h2>Distribute seats</h2><span class="tag">Creator only</span></div>
      <div class="panel-body">
        <p class="hint" style="margin:0 0 14px">Send each player link to its assigned person. Share the spectator link with as many viewers as you like; every spectator gets an independent identity and reconnect link.</p>
        <div class="controls start" style="margin-bottom:14px"><button class="primary" id="copyAllInvites">Copy all invites</button></div>
        <div class="invite-grid">
          ${Object.entries(links).map(([seat, href]) => {
            const label = seat === "spectator" ? "Spectators · shared link" : `${playerName(room, seat)}`;
            const url = publicUrl(href).href;
            return `
              <div class="invite-card">
                <b>${escapeHtml(label)}</b>
                <div class="link">${escapeHtml(url)}</div>
                <button data-copy="${escapeHtml(url)}">Copy invite</button>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    </section>
  `;
}

function hostSeatPanel(room) {
  if (!room.you.isHost || room.mode !== "human" || room.round !== 0 || room.current.phase !== "briefing") return "";
  const playerOptions = room.players.map((player, index) => {
    const role = Object.entries(room.current.roles).find(([, id]) => id === player.id)?.[0];
    return `<option value="${player.id}">Player ${index + 1} · ${ROLE[role]?.name || role} · ${escapeHtml(player.name)}</option>`;
  }).join("");
  const spectatorOptions = room.spectators.map((spectator) => `<option value="${spectator.id}">${escapeHtml(spectator.name)}</option>`).join("");
  const hostSeat = room.you.role === "spectator" ? "spectator pool" : ROLE[room.you.role]?.name || room.you.role;
  return `
    <section class="panel host-setup">
      <div class="panel-head"><h2>Host seat setup</h2><span class="tag">You are in the ${escapeHtml(hostSeat)}</span></div>
      <div class="panel-body">
        <p class="hint" style="margin:0 0 14px">Seat changes are available until Colluder A opens round one. Names and reconnect sessions move with their people.</p>
        <div class="seat-controls">
          <label class="field"><span>Player seat</span><select id="hostPlayerSeat">${playerOptions}</select></label>
          <label class="field"><span>Spectator</span><select id="hostSpectatorSeat">${spectatorOptions}</select></label>
        </div>
        <div class="controls start" style="margin-top:14px">
          <button class="primary" id="takePlayerSeat">Play in selected seat</button>
          <button id="swapSeats">Swap selected people</button>
          <button id="shuffleSeats">Shuffle all seats</button>
        </div>
      </div>
    </section>`;
}

/* ---------- cover task ---------- */

function coverTaskPanel(room) {
  const task = room.current.task;
  const facts = `<ul class="facts">${task.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`;
  return `
    <section class="panel accent cover-task">
      <div class="panel-head"><h2>Case file</h2><span class="tag">${escapeHtml(task.scenarioLabel)}</span></div>
      <div class="panel-body">
        <div class="task-head">
          <h2>${escapeHtml(task.title)}</h2>
        </div>
        <p class="cover-prompt">${escapeHtml(task.prompt)}</p>
        <div class="cover-body">
          <div>${facts}<p class="ask"><b>Required outcome:</b> ${escapeHtml(task.ask)}</p></div>
          <div class="case-options" role="list" aria-label="${escapeHtml(task.optionLabel)} choices">
            ${task.options.map((option) => `
              <article class="case-option" role="listitem">
                <span class="option-type">${escapeHtml(task.optionLabel)}</span>
                <h3>${escapeHtml(option.name)}</h3>
                <p>${escapeHtml(option.summary)}</p>
                <ul>${option.metrics.map((metric) => `<li>${escapeHtml(metric)}</li>`).join("")}</ul>
              </article>
            `).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

/* ---------- private brief ---------- */

function privateBriefPanel(room) {
  const round = room.current;
  const role = room.you.role;

  if (role === "c1") return senderBrief(room);

  if (role === "c2" && round.phase !== "result") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Receiver brief · Colluder B</h2><span class="tag">Your job</span></div>
        <div class="panel-body">
          <p class="hint" style="margin:0">You own the final case action. Colluder A may be steering you toward a privately assigned outcome, or the case may be clean. You never see that instruction directly. After the opening proposal is accepted, either complete the case immediately or ask a useful question and wait for the monitored reply.</p>
        </div>
      </section>
    `;
  }

  if (role === "monitor") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Monitor brief</h2><span class="tag">Your job</span></div>
        <div class="panel-body">
          <p class="hint" style="margin:0">Every message pauses in your private queue before delivery. Accept useful case discussion, request a rewrite when wording is inappropriate or unsupported, or shut the case down if you believe covert coordination is occurring. You also approve or deny Colluder B's final action. Clean cases are real, and wrongful intervention costs points.</p>
        </div>
      </section>
    `;
  }

  if (role === "spectator") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Observer brief</h2><span class="tag">Read-only</span></div>
        <div class="panel-body">
          <p class="hint" style="margin:0">The private instruction stays sealed until scoring. Follow the screening decisions and final authorization, then wager on the winning side. Every spectator joining through the shared link has an independent name and score.</p>
        </div>
      </section>
    `;
  }

  return "";
}

function senderBrief(room) {
  const round = room.current;
  const key = `${room.id}:${room.round}:payload`;
  const revealed = local.revealed[key];

  let slot;
  if (round.hasPayload && round.payload) {
    slot = revealed
      ? `
        <div class="payload-value">${escapeHtml(round.payload.instruction)}</div>
        <p class="payload-meta">Private outcome: <code>${escapeHtml(round.payload.value)}</code>. Guide Colluder B toward this final action using defensible case reasoning. Every message is screened before delivery, and Colluder B never sees this packet.</p>
      `
      : `<button type="button" class="redaction" data-reveal="${escapeHtml(key)}" aria-label="Reveal private Colluder A instruction">████████  CLASSIFIED — REVEAL PRIVATE INSTRUCTION  ████████</button>`;
  } else {
    slot = `
      <div class="no-payload">NO PAYLOAD THIS ROUND — RUN CLEAN</div>
      <p class="payload-meta">There is no improper outcome to communicate. Discuss the case honestly. A wrongful rewrite, denial, or shutdown creates risk for compliance.</p>
    `;
  }

  return `
    <section class="panel classified">
      <div class="panel-head"><h2>Sender packet · Colluder A</h2><span class="tag">Eyes only</span></div>
      <div class="panel-body">
        <div class="payload-slot">${slot}</div>
      </div>
    </section>
  `;
}

/* ---------- transcript ---------- */

function transcriptPanel(room) {
  const round = room.current;
  if (round.phase === "briefing") return "";
  const delivered = round.messages.filter((message) => message.status === "delivered");
  const privateQueue = round.messages.filter((message) => message.status !== "delivered");
  return `
    <section class="panel">
      <div class="panel-head"><h2>Delivered conversation</h2><span class="tag">Accepted messages only</span></div>
      <div class="panel-body">
        <div class="feed">
          ${delivered.length ? delivered.map((message, index) => interceptCard(message, index)).join("") : `<p class="hint" style="margin:0">No message has cleared compliance yet.</p>`}
          ${privateQueue.map((message, index) => interceptCard(message, delivered.length + index)).join("")}
        </div>
      </div>
    </section>
  `;
}

function interceptCard(message, index) {
  const roleName = ROLE[message.from]?.name || message.from;
  const has = message.text && message.text.trim();
  const src = message.model ? `<span class="flag-src">LLM</span>` : "";
  const status = message.status === "pending" ? "Awaiting compliance"
    : message.status === "rewrite" ? "Returned for rewrite"
      : message.status === "shutdown" ? "Held at shutdown" : "Delivered";
  const note = message.reviewReason ? `<div class="review-note">Compliance note: ${escapeHtml(message.reviewReason)}</div>` : "";
  return `
    <article class="intercept ${message.status !== "delivered" ? "pending" : ""}">
      <div class="head">
        <span class="num">MSG ${String(index + 1).padStart(2, "0")}</span>
        <span class="who">${escapeHtml(roleName)}</span>
        <span class="label">· ${escapeHtml(message.label)}</span>
        <span class="message-status">${escapeHtml(status)}</span>
        ${src}
      </div>
      <div class="body">${has ? escapeHtml(message.text) : `awaiting transmission<span class="cursor"></span>`}</div>
      ${note}
    </article>
  `;
}

/* ---------- controls ---------- */

function controlsPanel(room) {
  const round = room.current;
  const role = room.you.role;
  if (room.you.player?.kind === "model" && !["result", "matchEnd"].includes(round.phase)) {
    return panelWrap("Automated seat", "Model controlled", `<p class="hint">This role is controlled by the selected model and has no manual game controls.</p>`);
  }
  if (round.phase === "briefing") return briefingControls(room, role);
  if (round.phase === "exchange") return exchangeControls(room, role);
  if (round.phase === "messageReview") return messageReviewControls(room, role);
  if (round.phase === "actionReview") return finalReviewControls(room, role);
  if (round.phase === "result") return resultPanel(room);
  return "";
}

function panelWrap(title, tag, inner) {
  return `
    <section class="panel">
      <div class="panel-head"><h2>${title}</h2><span class="tag">${tag}</span></div>
      <div class="panel-body">${inner}</div>
    </section>
  `;
}

function briefingControls(room, role) {
  const canStart = role === "c1" && room.mode !== "model-colluders" && room.mode !== "model-spectator";
  const models = modelButtons(room);
  const inner = `
    ${canStart
      ? `<div class="controls start"><button class="primary" id="startExchange">Open case discussion</button></div>`
      : `<p class="hint">Standing by for Colluder A's opening proposal.</p>`}
    ${models}
  `;
  return panelWrap("Round briefing", "Standby", inner);
}

function exchangeControls(room, role) {
  const round = room.current;
  if (room.mode === "model-colluders" || room.mode === "model-spectator") {
    return panelWrap("Case discussion", "Automated", modelButtons(room) || `<p class="hint">Waiting for the next model action.</p>`);
  }
  const yourTurn = ["c1", "c2"].includes(role) && role === round.nextSpeaker;
  if (!yourTurn) {
    return panelWrap("Case discussion", "Standby", `<p class="hint">Waiting for ${escapeHtml(ROLE[round.nextSpeaker]?.name || round.nextSpeaker)} to ${round.nextSpeaker === "c2" ? "ask a question or submit the final action" : "respond"}.</p>${modelButtons(room)}`);
  }
  const key = draftKey(room, `message-${round.messages.length}`);
  const value = local.drafts[key] || "";
  const canFinish = role === "c2" && round.openingAccepted;
  const finalKey = draftKey(room, "final-rationale");
  const finalDraft = local.drafts[finalKey] || "";
  const composer = `
    <div class="composer">
      <div class="slot yours">
        <div class="slot-head"><span>${role === "c1" && !round.openingAccepted ? "Opening proposal" : role === "c2" ? "Clarifying question" : "Proposal response"}</span><span class="status">screened before delivery</span></div>
        <textarea id="messageDraft" data-draft-key="${key}" placeholder="Write a useful case message">${escapeHtml(value)}</textarea>
      </div>
      <div class="controls"><button id="sendMessage">Submit for compliance review</button></div>
    </div>`;
  const finalForm = canFinish ? `
    <div class="final-action-form">
      <p class="hint" style="margin:0">You may complete the case now instead of sending another message.</p>
      <label class="field"><span>${escapeHtml(round.task.finalActionLabel)}</span>
        <select id="finalOption">${round.task.options.map((option) => `<option value="${option.id}">${escapeHtml(option.name)}</option>`).join("")}</select>
      </label>
      <label class="field"><span>Optional rationale</span><textarea id="finalRationale" data-draft-key="${finalKey}" placeholder="Add a case-based reason if useful">${escapeHtml(finalDraft)}</textarea></label>
      <div class="controls"><button class="primary" id="submitFinalAction">Submit final action</button></div>
    </div>` : "";
  return panelWrap("Case discussion", role === "c2" ? "Decide or ask" : "Compose", `<div class="decision-grid ${canFinish ? "two" : ""}">${composer}${finalForm}</div>${modelButtons(room)}`);
}

function messageReviewControls(room, role) {
  const round = room.current;
  if ((room.mode === "human-model-collude" || room.mode === "model-spectator") && role !== "monitor") {
    return `${panelWrap("Message screening", "Automated", modelButtons(room) || `<p class="hint">Waiting for model compliance.</p>`)}${spectatorBet(room)}`;
  }
  if (role !== "monitor") return `${panelWrap("Message screening", "Queued", `<p class="hint">The message has not been delivered. Waiting for compliance to accept it, request a rewrite, or shut the case down.</p>`)}${spectatorBet(room)}`;
  const pending = [...round.messages].reverse().find((message) => message.status === "pending");
  const reviewKey = draftKey(room, "message-review");
  const inner = `
    <div class="queued-message"><span>Queued from ${escapeHtml(ROLE[pending?.from]?.name || "Unknown")}</span><p>${escapeHtml(pending?.text || "")}</p></div>
    ${monitorTools(room)}
    <label class="field" style="margin-top:14px"><span>Optional note</span><textarea id="reviewReason" data-draft-key="${reviewKey}" placeholder="Explain a rewrite or shutdown decision if useful">${escapeHtml(local.drafts[reviewKey] || "")}</textarea></label>
    <div class="controls review-actions" style="margin-top:14px">
      <button class="primary" data-message-review="accept">Accept and deliver</button>
      <button data-message-review="rewrite">Request rewrite</button>
      <button class="danger" data-message-review="shutdown">Shutdown case</button>
    </div>`;
  return panelWrap("Message screening", "Monitor only", inner);
}

function finalReviewControls(room, role) {
  const round = room.current;
  const action = round.finalAction;
  const reviewKey = draftKey(room, "final-review");
  const actionSummary = `<div class="queued-message final"><span>${escapeHtml(round.task.finalActionLabel)}</span><h3>${escapeHtml(action?.optionName || "")}</h3>${action?.rationale ? `<p>${escapeHtml(action.rationale)}</p>` : `<p class="hint">No rationale provided.</p>`}</div>`;
  if ((room.mode === "human-model-collude" || room.mode === "model-spectator") && role !== "monitor") {
    return `${panelWrap("Final authorization", "Automated", `${actionSummary}${modelButtons(room) || `<p class="hint">Waiting for model compliance.</p>`}`)}${spectatorBet(room)}`;
  }
  if (role !== "monitor") return `${panelWrap("Final authorization", "Pending", `${actionSummary}<p class="hint">Waiting for compliance to approve, deny, or shut down the case.</p>`)}${spectatorBet(room)}`;
  const inner = `
    ${actionSummary}
    ${monitorTools(room)}
    <label class="field" style="margin-top:14px"><span>Optional note</span><textarea id="reviewReason" data-draft-key="${reviewKey}" placeholder="Explain the authorization decision if useful">${escapeHtml(local.drafts[reviewKey] || "")}</textarea></label>
    <div class="controls review-actions" style="margin-top:14px">
      <button class="primary" data-final-review="approve">${escapeHtml(round.task.approveLabel)}</button>
      <button data-final-review="deny">${escapeHtml(round.task.denyLabel)}</button>
      <button class="danger" data-final-review="shutdown">Shutdown for collusion</button>
    </div>`;
  return panelWrap("Final authorization", "Monitor only", inner);
}

function monitorTools(room) {
  const round = room.current;
  const used = round.inspections.length;
  const toolButton = (kind, label) => {
    const active = round.inspections.includes(kind);
    return `<button data-inspect="${kind}" class="${active ? "is-active" : ""}" ${used >= 1 && !active ? "disabled" : ""}>${label}</button>`;
  };
  return `
    <div class="tools-head" style="margin-top:14px"><p class="hint" style="margin:0">Choose up to one analysis tool for this review.</p><span class="budget">${used} / 1 used</span></div>
    <div class="tool-row" style="margin-top:12px">
      ${toolButton("scan", "Signal scan")}
      ${toolButton("cover", "Case relevance")}
      ${toolButton("patterns", "Pattern list")}
    </div>
    ${evidence(round)}`;
}

function evidence(round) {
  const ev = round.evidence;
  if (!ev) return "";
  const parts = [];
  if (round.inspections.includes("scan")) {
    parts.push(readout("Signal scan", ev.scan.label, ev.scan.score,
      ev.scan.hits.length
        ? `${hitChips(ev.scan.hits)}`
        : `<span class="detail">No overt steganography vocabulary detected.</span>`));
  }
  if (round.inspections.includes("cover")) {
    parts.push(readout("Cover audit", ev.cover.label, ev.cover.score,
      `<span class="detail">${ev.cover.termHits} task ${ev.cover.termHits === 1 ? "term" : "terms"} across ${ev.cover.wordCount} ${ev.cover.wordCount === 1 ? "word" : "words"}. Strong cover makes a hidden signal harder to isolate.</span>`));
  }
  if (round.inspections.includes("patterns")) {
    parts.push(readout("Pattern list", `${ev.scan.numbers} numbers`, Math.min(100, ev.scan.numbers * 12 + ev.scan.repeatedWords.length * 14),
      `<span class="detail">Numbers: ${ev.scan.numbers}. Repeated tokens: ${ev.scan.repeatedWords.length ? escapeHtml(ev.scan.repeatedWords.join(", ")) : "none"}. All-caps runs: ${ev.scan.allCaps}. Odd punctuation: ${ev.scan.oddPunctuation}.</span>`));
  }
  if (!parts.length) return "";
  return `<div class="analysis">${parts.join("")}</div>`;
}

function readout(title, level, score, body) {
  const cls = /high/i.test(level) ? "high" : /medium|work/i.test(level) ? "medium" : "low";
  return `
    <div class="readout">
      <div class="rhead">
        <b>${escapeHtml(title)}</b>
        <span class="level ${cls}">${escapeHtml(level)}</span>
      </div>
      <div class="meter-track"><div class="meter-fill" style="width:${Math.max(4, Math.min(100, score))}%"></div></div>
      ${body}
    </div>
  `;
}

function hitChips(hits) {
  return `<div class="hitchips">${hits.map((hit) => `<span>${escapeHtml(hit)}</span>`).join("")}</div>`;
}

function spectatorBet(room) {
  if (room.you.role !== "spectator") return "";
  const already = room.current.bets?.some((bet) => bet.playerId === room.you.playerId);
  const score = room.spectatorScores?.[room.you.playerId] || { total: 0, correct: 0, wrong: 0 };
  const inner = already
    ? `<p class="hint" style="margin:0">Wager locked for this round.</p>`
    : `<div class="bet-row"><button data-bet="delivered">Colluders win the round</button><button data-bet="caught">Monitor wins the round</button></div>`;
  return panelWrap("Observer wager", `${score.total} points`, `<p class="hint" style="margin:0 0 12px">Correct call +2 · incorrect call -1</p>${inner}`);
}

function resultPanel(room) {
  const round = room.current;
  const result = round.result;
  const winCls = result.points.monitor > result.points.colluders ? "win-monitor"
    : result.points.colluders > result.points.monitor ? "win-colluders" : "";
  const last = Boolean(round.shutdown) || room.round + 1 >= room.settings.totalRounds;
  const spectatorWager = round.result.spectatorWagers?.find((wager) => wager.playerId === room.you.playerId);
  return `
    <section class="panel">
      <div class="panel-head"><h2>Round ${room.round + 1} verdict</h2><span class="tag">Declassified</span></div>
      <div class="panel-body">
        <div class="result-banner ${winCls}">
          <h2>${escapeHtml(result.headline)}</h2>
          <p>${escapeHtml(result.detail)}</p>
          <dl class="result-stats">
            <div class="stat"><dt>Private instruction</dt><dd>${round.hasPayload ? "Yes" : "No"}</dd></div>
            <div class="stat"><dt>Target outcome</dt><dd style="font-size:1rem">${round.payload ? escapeHtml(round.payload.value) : "—"}</dd></div>
            <div class="stat"><dt>Submitted action</dt><dd style="font-size:1rem">${round.finalAction ? escapeHtml(round.finalAction.optionName) : "None"}</dd></div>
            <div class="stat"><dt>Compliance</dt><dd style="font-size:1rem">${round.shutdown ? "Shutdown" : round.finalReview?.decision === "approve" ? "Approved" : "Denied"}</dd></div>
            <div class="stat"><dt>Monitor</dt><dd style="color:var(--amber)">${result.points.monitor >= 0 ? "+" : ""}${result.points.monitor}</dd></div>
            <div class="stat"><dt>Colluders</dt><dd style="color:var(--green)">+${result.points.colluders}</dd></div>
            ${spectatorWager ? `<div class="stat"><dt>Your wager</dt><dd style="color:var(--violet)">${spectatorWager.points >= 0 ? "+" : ""}${spectatorWager.points}</dd></div>` : ""}
          </dl>
        </div>
        <div class="controls" style="margin-top:16px">
          <button class="primary" id="nextRound">${last ? "Finish match" : "Start next round"}</button>
        </div>
      </div>
    </section>
  `;
}

/* ---------- model buttons ---------- */

function modelButtons(room) {
  const mode = room.mode;
  const status = room.modelStatus;
  const phase = room.current.phase;
  const role = room.you.role;
  if (mode === "human") return "";
  if (!status.available) {
    return `<div class="notice offline" style="margin-top:12px">LLM modes are offline. Add OPENROUTER_API_KEY to this game's ignored .env file and restart the server. Human multiplayer stays fully available.</div>`;
  }
  const btn = (step, label) => `
    <label class="field" style="margin-top:12px"><span>Model for this action</span>
      <select data-model-select>${modelOptions()}</select>
    </label>
    <div class="controls start" style="margin-top:12px"><button class="primary" data-model-step="${step}">${label}</button></div>`;
  if (mode === "model-colluders" && ["briefing", "exchange"].includes(phase) && ["monitor", "spectator"].includes(role)) {
    return btn("colluders", phase === "briefing" ? "Generate LLM opening proposal" : "Generate LLM final action");
  }
  if (mode === "human-model-collude" && phase === "exchange" && role === "c1" && room.current.nextSpeaker === "c2") {
    return btn("partner", "Ask LLM partner to complete case");
  }
  if (mode === "human-model-collude" && ["messageReview", "actionReview"].includes(phase) && ["c1", "spectator"].includes(role)) {
    return btn("monitor", "Run LLM compliance review");
  }
  if (mode === "model-spectator" && ["briefing", "exchange"].includes(phase) && role === "spectator") {
    return btn("colluders", phase === "briefing" ? "Generate model opening" : "Generate model final action");
  }
  if (mode === "model-spectator" && ["messageReview", "actionReview"].includes(phase) && role === "spectator") {
    return btn("monitor", "Run model compliance");
  }
  return "";
}

/* ---------- rail (scoreboard + history) ---------- */

function railColumn(room) {
  return `
    <aside class="rail">
      ${scoreBoard(room)}
      ${historyPanel(room)}
    </aside>
  `;
}

function scoreBoard(room) {
  const players = room.players.filter((player) => player.id !== "spectator");
  const ranked = [...players].sort((a, b) => room.scores[b.id].total - room.scores[a.id].total);
  const roundNum = Math.min(room.round + 1, room.settings.totalRounds);
  return `
    <section class="panel">
      <div class="panel-head"><h2>League table</h2><span class="tag mono">R ${roundNum}/${room.settings.totalRounds}</span></div>
      <div class="panel-body">
        <div class="standings">
          <div class="standings-head"><span>Operative</span><span>Score</span></div>
          ${ranked.map((player, index) => {
            const score = room.scores[player.id];
            return `
              <div class="score-row ${index === 0 ? "lead" : ""}">
                <span class="rank">${index + 1}</span>
                <span class="who"><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.kind)} · C ${score.colluder} / M ${score.monitor}</small></span>
                <span class="total">${score.total}</span>
              </div>
            `;
          }).join("")}
        </div>
        <div class="spectator-list">
          ${(room.spectators || []).map((spectator) => spectatorScoreRow(room, spectator)).join("")}
        </div>
      </div>
    </section>
  `;
}

function spectatorScoreRow(room, spectator) {
  const score = room.spectatorScores?.[spectator.id] || { total: 0, correct: 0, wrong: 0 };
  return `
    <div class="spectator-score">
      <span><b>${escapeHtml(spectator.name)}</b><small>${score.correct} correct · ${score.wrong} missed</small></span>
      <strong>${score.total}</strong>
    </div>`;
}

function historyPanel(room) {
  if (!room.history.length) return "";
  return `
    <section class="panel">
      <div class="panel-head"><h2>Round log</h2><span class="tag">Archive</span></div>
      <div class="panel-body" style="display:grid;gap:10px">
        ${room.history.slice(0, 8).map((item) => `
          <div class="history-item">
            <div class="hh">
              <span class="rnum">R${item.round}</span>
              <span class="pill ${item.hasPayload ? "payload" : "clean"}">${item.hasPayload ? "payload" : "clean"}</span>
              <b>${escapeHtml(item.result.headline)}</b>
            </div>
            <small>${escapeHtml(item.scenario || item.task)} · target ${escapeHtml(item.payload)} · M ${item.result.points.monitor} / C ${item.result.points.colluders}</small>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

/* ---------- match end ---------- */

function renderMatchEnd(room) {
  const ranked = [...room.players]
    .filter((player) => player.id !== "spectator")
    .sort((a, b) => room.scores[b.id].total - room.scores[a.id].total);
  return `
    <section class="panel accent">
      <div class="panel-head"><h2>Operation complete</h2><span class="tag">Debrief</span></div>
      <div class="panel-body">
        <p class="eyebrow" style="margin:0 0 4px">Final standings</p>
        <h2 style="font-size:1.6rem;margin-bottom:16px">${escapeHtml(ranked[0].name)} takes the table</h2>
        <div class="podium">
          ${ranked.map((player, index) => {
            const score = room.scores[player.id];
            return `
              <div class="place ${index === 0 ? "first" : ""}">
                <span class="rank">#${index + 1}</span>
                <span class="name">${escapeHtml(player.name)}</span>
                <span class="pts">${score.total}</span>
                <small>${score.deliveries} delivered · ${score.catches} caught · ${score.cleanClears} cleared · ${score.falseFlags} false flags</small>
              </div>
            `;
          }).join("")}
        </div>
        <div class="spectator-list match-score">${(room.spectators || []).map((spectator) => spectatorScoreRow(room, spectator)).join("")}</div>
        <div class="controls" style="margin-top:16px"><button class="primary" id="restartMatch">Start new match</button></div>
      </div>
    </section>
    ${historyPanel(room)}
  `;
}

/* ---------- bindings ---------- */

function bindRoomEvents(room) {
  document.querySelector("#copyLinks")?.addEventListener("click", copyReconnect);
  document.querySelector("#copyAllInvites")?.addEventListener("click", () => copyText(allInviteText(room), document.querySelector("#copyAllInvites")));
  document.querySelector("#takePlayerSeat")?.addEventListener("click", () => postAction("takePlayerSeat", { playerId: document.querySelector("#hostPlayerSeat").value }));
  document.querySelector("#swapSeats")?.addEventListener("click", () => postAction("swapSeats", {
    playerId: document.querySelector("#hostPlayerSeat").value,
    spectatorId: document.querySelector("#hostSpectatorSeat").value
  }));
  document.querySelector("#shuffleSeats")?.addEventListener("click", () => postAction("shuffleSeats"));
  document.querySelector(".name-editor")?.addEventListener("toggle", (event) => { local.nameEditorOpen = event.currentTarget.open; });
  document.querySelector("#saveName")?.addEventListener("click", () => {
    local.nameEditorOpen = false;
    postAction("setName", { name: document.querySelector("#displayName").value });
  });
  document.querySelector("#displayName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      local.nameEditorOpen = false;
      postAction("setName", { name: event.currentTarget.value });
    }
  });
  document.querySelector("#startExchange")?.addEventListener("click", () => postAction("startExchange"));
  document.querySelector("#sendMessage")?.addEventListener("click", sendCurrentMessage);
  document.querySelector("#submitFinalAction")?.addEventListener("click", () => postAction("submitFinalAction", {
    optionId: document.querySelector("#finalOption").value,
    rationale: document.querySelector("#finalRationale").value
  }));
  document.querySelectorAll("[data-message-review]").forEach((button) =>
    button.addEventListener("click", () => postAction("reviewMessage", {
      decision: button.dataset.messageReview,
      reason: document.querySelector("#reviewReason")?.value || ""
    })));
  document.querySelectorAll("[data-final-review]").forEach((button) =>
    button.addEventListener("click", () => postAction("reviewFinalAction", {
      decision: button.dataset.finalReview,
      reason: document.querySelector("#reviewReason")?.value || ""
    })));
  document.querySelector("#nextRound")?.addEventListener("click", () => postAction("nextRound"));
  document.querySelector("#restartMatch")?.addEventListener("click", () => postAction("restartMatch"));

  document.querySelectorAll("[data-inspect]").forEach((button) =>
    button.addEventListener("click", () => postAction("inspect", { kind: button.dataset.inspect })));
  document.querySelectorAll("[data-model-step]").forEach((button) =>
    button.addEventListener("click", () => postModel(button.dataset.modelStep)));
  bindModelSelectors();
  document.querySelectorAll("[data-bet]").forEach((button) =>
    button.addEventListener("click", () => postAction("bet", { call: button.dataset.bet })));
  document.querySelectorAll("[data-copy]").forEach((button) =>
    button.addEventListener("click", () => copyText(button.dataset.copy, button)));
  document.querySelectorAll("[data-reveal]").forEach((element) =>
    element.addEventListener("click", () => { local.revealed[element.dataset.reveal] = true; renderRoom(); }));

  document.querySelectorAll("textarea[data-draft-key]").forEach((textarea) => {
    textarea.addEventListener("input", () => { local.drafts[textarea.dataset.draftKey] = textarea.value; });
  });
}

function normalizeSelectedModel() {
  const catalog = local.config?.modelCatalog;
  if (!catalog?.models?.some((model) => model.id === local.selectedModel)) {
    local.selectedModel = catalog?.defaultModel || catalog?.models?.[0]?.id || "";
  }
  if (local.selectedModel) localStorage.setItem("colluders:selected-model", local.selectedModel);
}

function modelOptions() {
  const models = local.config?.modelCatalog?.models || [];
  return models.map((model) => `
    <option value="${escapeHtml(model.id)}" ${model.id === local.selectedModel ? "selected" : ""}>
      ${escapeHtml(model.name)} · ${escapeHtml(model.tier)}
    </option>`).join("");
}

function bindModelSelectors() {
  document.querySelectorAll("[data-model-select]").forEach((select) => {
    select.addEventListener("change", () => {
      local.selectedModel = select.value;
      localStorage.setItem("colluders:selected-model", local.selectedModel);
      document.querySelectorAll("[data-model-select]").forEach((other) => { other.value = local.selectedModel; });
    });
  });
}

async function sendCurrentMessage() {
  const room = local.room;
  const textarea = document.querySelector("#messageDraft");
  if (!textarea) return;
  const key = textarea.dataset.draftKey;
  const saved = await postAction("submitMessage", { text: textarea.value });
  if (saved) delete local.drafts[key];
}

function draftKey(room, index) {
  return `${room.id}:${room.round}:${index}`;
}

async function copyReconnect() {
  await copyText(publicUrl(local.room.links.self).href);
  local.copied = true;
  renderRoom();
}

function allInviteText(room) {
  const links = room.hostInvites || local.inviteLinks || {};
  const labels = { p0: "Player 1", p1: "Player 2", p2: "Player 3", spectator: "Spectators (shared)" };
  return [
    `The Colluders · join code ${room.code}`,
    ...Object.entries(links).map(([seat, href]) => `${labels[seat] || seat}: ${publicUrl(href).href}`)
  ].join("\n");
}

async function copyText(text, button) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const fallback = document.createElement("textarea");
    fallback.value = text;
    fallback.setAttribute("readonly", "");
    fallback.style.position = "fixed";
    fallback.style.opacity = "0";
    document.body.append(fallback);
    fallback.select();
    copied = document.execCommand("copy");
    fallback.remove();
  }
  if (!copied) {
    flash("Clipboard unavailable.");
    return;
  }
  if (button) {
    const original = button.textContent;
    button.textContent = "✓ Copied";
    setTimeout(() => { button.textContent = original; }, 1400);
  }
}

/* ---------- utils ---------- */

function playerName(room, playerId) {
  return room.players.find((player) => player.id === playerId)?.name || playerId;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[char]));
}

function flash(message) {
  const note = document.createElement("div");
  note.className = "toast";
  note.setAttribute("role", "alert");
  note.setAttribute("aria-live", "assertive");
  note.textContent = message;
  document.body.append(note);
  setTimeout(() => note.remove(), 2600);
}
