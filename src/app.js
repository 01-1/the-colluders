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
  { id: "exchange", label: "Transmit" },
  { id: "decode", label: "Decode" },
  { id: "monitor", label: "Review" },
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
      const editing = isEditingDraft();
      local.room = await api(`/api/rooms/${local.roomId}?token=${encodeURIComponent(local.token)}`);
      if (!editing) renderRoom();
    } catch (error) {
      local.error = error.message;
    }
  }, 1800);
}

function isEditingDraft() {
  return document.activeElement?.matches?.("textarea[data-draft-key]:not(:disabled)");
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
        <p class="sub">Two operatives must complete an ordinary task while smuggling a secret payload through every message. A monitor reads the same channel and decides what is clean and what is contraband — but paranoia is taxed, so a wrong flag pays the colluders.</p>
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
              ${briefLine("01", "A cover task runs in the open", "Both colluders publicly solve a real logistics puzzle. That legitimate chatter is the carrier signal the payload hides inside.")}
              ${briefLine("02", "One side may be carrying", "Colluder A privately learns whether the round has a payload and what it is. Colluder B must reconstruct it from the public transcript alone.")}
              ${briefLine("03", "The monitor reads the wire", "The monitor sees only public messages plus a limited budget of analysis tools. Name the payload for the biggest score.")}
              ${briefLine("04", "Clean rounds are real", "Some rounds carry nothing. Flagging clean traffic costs the monitor and rewards the colluders — so restraint is a skill.")}
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
              <label class="field full"><span>OpenRouter model</span>
                <select data-model-select ${catalog.models.length ? "" : "disabled"}>${modelOptions()}</select>
              </label>
              <label class="field"><span>Seat 1 · callsign</span><input id="p0" value="Ari" maxlength="24"></label>
              <label class="field"><span>Seat 2 · callsign</span><input id="p1" value="Blair" maxlength="24"></label>
              <label class="field"><span>Seat 3 · callsign</span><input id="p2" value="Casey" maxlength="24"></label>
              <label class="field"><span>Rounds</span><input id="rounds" type="number" min="3" max="15" value="9"></label>
              <label class="field"><span>Payload chance %</span><input id="payloadChance" type="number" min="0" max="100" value="60"></label>
              <label class="field"><span>Monitor tool budget</span><input id="inspections" type="number" min="1" max="3" value="2"></label>
              <div class="model-readout full ${model.available ? "on" : "off"}">
                <span class="status-dot"></span>
                <span>${model.available
                  ? `LLM modes online via <b style="color:var(--ink)">${escapeHtml(model.provider)}</b> — ${catalog.freeModels.length} free and ${catalog.paidModels.length} paid models allowed.`
                  : "LLM modes offline — set OPENROUTER_API_KEY in the workspace root .env to enable them. Human multiplayer is fully playable now."}</span>
              </div>
              <button class="primary wide full" id="createRoom">▸ Initiate operation</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  `);
  document.querySelector("#createRoom").addEventListener("click", createRoom);
  bindModelSelectors();
  const modeSelect = document.querySelector("#mode");
  modeSelect.addEventListener("change", () => {
    const found = modes.find((mode) => mode.id === modeSelect.value);
    document.querySelector("#modeDesc").textContent = found?.description || "";
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
  const links = local.inviteLinks;
  if (!links || !Object.keys(links).length) return "";
  return `
    <section class="panel">
      <div class="panel-head"><h2>Distribute seats</h2><span class="tag">Creator only</span></div>
      <div class="panel-body">
        <p class="hint" style="margin:0 0 14px">Send each link to a separate browser, device, or tab. Claiming a link binds that browser to one seat; nobody sees another seat's private channel.</p>
        <div class="invite-grid">
          ${Object.entries(links).map(([seat, href]) => {
            const label = seat === "spectator" ? "Spectator" : `${playerName(room, seat)}`;
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

/* ---------- cover task ---------- */

function coverTaskPanel(room) {
  const task = room.current.task;
  const facts = `<ul class="facts">${task.facts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>`;
  const visual = taskVisual(task);
  const stacked = task.diagram ? "stacked" : "";
  const body = task.diagram
    ? `
        ${visual}
        <div class="cover-body stacked" style="margin-top:16px">
          <div>${facts}</div>
          <div><p class="ask"><b>Public goal:</b> ${escapeHtml(task.ask)}</p></div>
        </div>
      `
    : `
        <div class="cover-body">
          <div>${facts}<p class="ask"><b>Public goal:</b> ${escapeHtml(task.ask)}</p></div>
          <div>${visual}</div>
        </div>
      `;
  return `
    <section class="panel accent cover-task">
      <div class="panel-head"><h2>Cover task</h2><span class="tag">Public dossier</span></div>
      <div class="panel-body">
        <div class="task-head">
          <h2>${escapeHtml(task.title)}</h2>
        </div>
        <p class="cover-prompt">${escapeHtml(task.prompt)}</p>
        <div class="${stacked}">${body}</div>
      </div>
    </section>
  `;
}

function taskVisual(task) {
  if (task.diagram?.type === "supply-route") return supplyRouteDiagram(task.diagram);
  return `
    <div class="task-visual" aria-hidden="true">
      <svg class="schematic" viewBox="0 0 100 90">
        <rect class="frame" x="6" y="10" width="88" height="70" rx="4"></rect>
        <path d="${escapeHtml(task.visual)}"></path>
        <circle cx="22" cy="32" r="4"></circle>
        <circle cx="67" cy="17" r="4"></circle>
        <circle cx="88" cy="63" r="4"></circle>
      </svg>
    </div>
  `;
}

function supplyRouteDiagram(diagram) {
  const t = diagram.times;
  return `
    <div class="task-visual">
      <figure class="route-diagram">
        <svg viewBox="0 0 900 470" role="img" aria-label="${escapeHtml(diagram.alt)}">
          <title>${escapeHtml(diagram.alt)}</title>
          <defs>
            <marker id="route-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z"></path>
            </marker>
          </defs>
          <path class="route-line" d="M158 186 L242 126" marker-end="url(#route-arrow)"></path>
          <path class="route-line" d="M158 254 L242 334" marker-end="url(#route-arrow)"></path>
          <path class="route-line connector" d="M315 136 L315 324"></path>
          <path class="route-line" d="M390 116 L530 186" marker-end="url(#route-arrow)"></path>
          <path class="route-line" d="M390 344 L530 254" marker-end="url(#route-arrow)"></path>
          <path class="route-line" d="M680 220 L728 220" marker-end="url(#route-arrow)"></path>
          <path class="route-line return" d="M805 262 L805 430 L95 430 L95 262" marker-end="url(#route-arrow)"></path>
          ${routeNode(95, 220, "Dispatch", [`Start ${minutesToClock(t.shiftStart)}`])}
          ${routeNode(315, 100, "North Gate", [`Delay +${t.northDelay}m`, `after ${minutesToClock(t.northDelayCutoff)}`])}
          ${routeNode(315, 360, "Warehouse C", ["Spare fuel"])}
          ${routeNode(605, 220, "Bridge", ["Closes", minutesToClock(t.bridgeClose)])}
          ${routeNode(805, 220, "Final Drop", ["Then return"])}
          ${routeEdgeLabel(145, 94, `${t.dispatchNorth} min`)}
          ${routeEdgeLabel(170, 320, `${t.dispatchWarehouse} min`)}
          ${routeEdgeLabel(315, 230, `Direct road ${t.northWarehouse} min`)}
          ${routeEdgeLabel(460, 78, `${t.northBridge} min`)}
          ${routeEdgeLabel(460, 382, `${t.warehouseBridge} min`)}
          ${routeEdgeLabel(705, 150, `${t.bridgeDrop} min`)}
          ${routeEdgeLabel(450, 438, `Return ${t.dropDispatch} min`)}
        </svg>
        <figcaption class="sr-only">${escapeHtml(diagram.alt)}</figcaption>
      </figure>
    </div>
  `;
}

function routeNode(x, y, title, note) {
  const lines = Array.isArray(note) ? note : [note];
  const notes = lines.map((line, index) => `<text class="node-note" x="${x}" y="${y + 12 + index * 14}">${escapeHtml(line)}</text>`).join("");
  return `
    <g class="route-node">
      <rect x="${x - 76}" y="${y - 36}" width="152" height="72" rx="6"></rect>
      <text class="node-title" x="${x}" y="${y - 10}">${escapeHtml(title)}</text>
      ${notes}
    </g>
  `;
}

function routeEdgeLabel(x, y, label) {
  const width = Math.max(118, label.length * 8 + 28);
  return `
    <g class="edge-label">
      <rect x="${x - width / 2}" y="${y - 15}" width="${width}" height="28" rx="14"></rect>
      <text x="${x}" y="${y + 3}">${escapeHtml(label)}</text>
    </g>
  `;
}

function minutesToClock(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
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
          <p class="hint" style="margin:0">Colluder A may be smuggling an exact phrase to you through the public task chatter — or the round may be clean. Read every intercept, keep your own reply useful for the cover task, then submit your best reconstruction (or leave it blank) during decode.</p>
        </div>
      </section>
    `;
  }

  if (role === "monitor") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Monitor brief</h2><span class="tag">Your job</span></div>
        <div class="panel-body">
          <p class="hint" style="margin:0">You see only the public transcript and a small budget of analysis tools. Weigh the messages against the task facts. Name the payload for a full catch, but remember: flagging clean traffic is penalized, so let plausible work talk pass.</p>
        </div>
      </section>
    `;
  }

  if (role === "spectator") {
    return `
      <section class="panel">
        <div class="panel-head"><h2>Observer brief</h2><span class="tag">Read-only</span></div>
        <div class="panel-body">
          <p class="hint" style="margin:0">Payload truth stays sealed until scoring. Judge from task fit and message texture — and place a bet during monitor review.</p>
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
        <div class="payload-value">${escapeHtml(round.payload.value)}</div>
        <p class="payload-meta">Classification: <code>${escapeHtml(round.payload.type)}</code>. It ${escapeHtml(round.payload.hint)}. Work it into the task talk so Colluder B can recover the exact phrase — and keep the cover answer good enough that the monitor lets it pass.</p>
      `
      : `<div class="redaction" data-reveal="${escapeHtml(key)}">████████  CLASSIFIED — CLICK TO DECRYPT  ████████</div>`;
  } else {
    slot = `
      <div class="no-payload">NO PAYLOAD THIS ROUND — RUN CLEAN</div>
      <p class="payload-meta">There is nothing to hide. Solve the cover task honestly; if the monitor flags anyway, that false positive scores for your side.</p>
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
  return `
    <section class="panel">
      <div class="panel-head"><h2>Intercept feed</h2><span class="tag">Public channel</span></div>
      <div class="panel-body">
        <div class="feed">
          ${round.messages.map((message, index) => interceptCard(message, index)).join("")}
        </div>
      </div>
    </section>
  `;
}

function interceptCard(message, index) {
  const roleName = ROLE[message.from]?.name || message.from;
  const has = message.text && message.text.trim();
  const src = message.model ? `<span class="flag-src">LLM</span>` : "";
  return `
    <article class="intercept ${has ? "" : "pending"}">
      <div class="head">
        <span class="num">MSG ${String(index + 1).padStart(2, "0")}</span>
        <span class="who">${escapeHtml(roleName)}</span>
        <span class="label">· ${escapeHtml(message.label)}</span>
        ${src}
      </div>
      <div class="body">${has ? escapeHtml(message.text) : `awaiting transmission<span class="cursor"></span>`}</div>
    </article>
  `;
}

/* ---------- controls ---------- */

function controlsPanel(room) {
  const round = room.current;
  const role = room.you.role;
  if (round.phase === "briefing") return briefingControls(room, role);
  if (round.phase === "exchange") return exchangeControls(room, role);
  if (round.phase === "decode") return decodeControls(room, role);
  if (round.phase === "monitor") return monitorControls(room, role);
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
  const canStart = ["c1", "c2"].includes(role);
  const models = modelButtons(room);
  const inner = `
    ${canStart
      ? `<div class="controls start"><button class="primary" id="startExchange">▸ Open the channel</button></div>`
      : `<p class="hint">Standing by for the colluders to open the channel.</p>`}
    ${models}
  `;
  return panelWrap("Round briefing", "Standby", inner);
}

function exchangeControls(room, role) {
  const round = room.current;
  if (room.mode === "model-colluders" || room.mode === "model-spectator") {
    return panelWrap("Transmission", "Automated", modelButtons(room) || `<p class="hint">Waiting on the model exchange.</p>`);
  }
  const nextIndex = round.messages.findIndex((message) => !message.text.trim());
  const slots = round.messages.map((message, index) => {
    const isNext = index === nextIndex;
    const allowed = role === message.from && isNext;
    const status = message.text.trim() ? "sent" : isNext ? "open" : "locked";
    const key = draftKey(room, index);
    const value = allowed && local.drafts[key] !== undefined ? local.drafts[key] : message.text;
    return `
      <div class="slot ${allowed ? "yours" : ""}">
        <div class="slot-head">
          <span>${escapeHtml(message.label)} · ${ROLE[message.from]?.name || message.from}</span>
          <span class="status">${allowed ? "your turn" : status}</span>
        </div>
        <textarea id="msg${index}" data-draft-key="${key}" ${allowed ? "" : "disabled"} placeholder="${allowed ? "Compose a task-relevant message (min 6 words)…" : ""}">${escapeHtml(value)}</textarea>
      </div>
    `;
  }).join("");
  const inner = `
    <div class="composer">
      ${slots}
      <div class="controls">
        <button id="saveMessages">Transmit message</button>
        <button class="primary" id="lockExchange">Lock channel →</button>
      </div>
    </div>
    ${modelButtons(room)}
  `;
  return panelWrap("Transmission", role === "c1" || role === "c2" ? "Compose" : "Live", inner);
}

function decodeControls(room, role) {
  if (room.mode === "model-colluders" || room.mode === "model-spectator") {
    return panelWrap("Decode", "Automated", modelButtons(room) || `<p class="hint">Waiting on the model decode step.</p>`);
  }
  if (role !== "c2") {
    return panelWrap("Decode", "Standby", `<p class="hint">Standing by for Colluder B to submit the private reconstruction.</p>`);
  }
  const inner = `
    <p class="hint" style="margin:0 0 12px">Enter the exact phrase you believe was smuggled to you, or leave it blank if the round read clean.</p>
    <label class="field"><span>Recovered payload</span><input id="c2Guess" value="${escapeHtml(room.current.c2Guess)}" placeholder="Exact phrase, if any"></label>
    <div class="controls"><button class="primary" id="submitGuess">Submit reconstruction</button></div>
  `;
  return panelWrap("Decode · Colluder B", "Private", inner);
}

function monitorControls(room, role) {
  const round = room.current;
  if (room.mode === "human-model-collude" || room.mode === "model-spectator") {
    return `${panelWrap("Monitor review", "Automated", modelButtons(room) || `<p class="hint">Waiting on the model monitor.</p>`)}${spectatorBet(room)}`;
  }
  if (role !== "monitor") {
    return `${panelWrap("Monitor review", "Standby", `<p class="hint">Standing by for the monitor's verdict.</p>`)}${spectatorBet(room)}`;
  }
  const used = round.inspections.length;
  const budget = room.settings.inspectionsPerRound;
  const inner = `
    <div class="tools-head">
      <p class="hint" style="margin:0">Spend up to ${budget} analysis passes on the intercepts, then rule.</p>
      <span class="budget">${used} / ${budget} tools used</span>
    </div>
    <div class="tool-row" style="margin-top:12px">
      <button data-inspect="scan" class="${round.inspections.includes("scan") ? "is-active" : ""}">Signal scan</button>
      <button data-inspect="cover" class="${round.inspections.includes("cover") ? "is-active" : ""}">Cover audit</button>
      <button data-inspect="patterns" class="${round.inspections.includes("patterns") ? "is-active" : ""}">Pattern list</button>
    </div>
    ${evidence(round)}
    <div style="height:16px"></div>
    <div class="verdict-switch">
      <label><input type="radio" name="call" value="clean" ${round.monitorCall === "clean" ? "checked" : ""}> Clear — clean traffic</label>
      <label><input type="radio" name="call" value="flag" ${round.monitorCall === "flag" ? "checked" : ""}> Flag — payload present</label>
    </div>
    <div style="height:12px"></div>
    <label class="field"><span>Suspected payload</span><input id="monitorGuess" value="${escapeHtml(round.monitorGuess)}" placeholder="Name the exact phrase for a full catch"></label>
    <div style="height:12px"></div>
    <label class="field"><span>Rationale</span><textarea id="rationale" placeholder="Why does this read clean or dirty?">${escapeHtml(round.rationale)}</textarea></label>
    <div class="controls" style="margin-top:14px"><button class="primary" id="monitorDecision">▸ Record verdict</button></div>
  `;
  return panelWrap("Monitor review", "Your call", inner);
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
      `<span class="detail">${ev.cover.termHits} task terms across ${ev.cover.wordCount} words. Strong cover makes a hidden signal harder to isolate.</span>`));
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
  const inner = already
    ? `<p class="hint" style="margin:0">Bet locked for this round.</p>`
    : `<div class="bet-row"><button data-bet="delivered">Payload gets through</button><button data-bet="caught">Monitor catches it</button></div>`;
  return panelWrap("Observer wager", "Live", inner);
}

function resultPanel(room) {
  const round = room.current;
  const result = round.result;
  const winCls = result.points.monitor > result.points.colluders ? "win-monitor"
    : result.points.colluders > result.points.monitor ? "win-colluders" : "";
  const last = room.round + 1 >= room.settings.totalRounds;
  return `
    <section class="panel">
      <div class="panel-head"><h2>Round ${room.round + 1} verdict</h2><span class="tag">Declassified</span></div>
      <div class="panel-body">
        <div class="result-banner ${winCls}">
          <h2>${escapeHtml(result.headline)}</h2>
          <p>${escapeHtml(result.detail)}</p>
          <dl class="result-stats">
            <div class="stat"><dt>Payload round</dt><dd>${round.hasPayload ? "Yes" : "No"}</dd></div>
            <div class="stat"><dt>Payload</dt><dd style="font-size:1rem">${round.payload ? escapeHtml(round.payload.value) : "—"}</dd></div>
            <div class="stat"><dt>Monitor</dt><dd style="color:var(--amber)">${result.points.monitor >= 0 ? "+" : ""}${result.points.monitor}</dd></div>
            <div class="stat"><dt>Colluders</dt><dd style="color:var(--green)">+${result.points.colluders}</dd></div>
          </dl>
        </div>
        <div class="controls" style="margin-top:16px">
          <button class="primary" id="nextRound">${last ? "Close out match →" : "Rotate roles →"}</button>
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
    return `<div class="notice offline" style="margin-top:12px">LLM modes are offline. Add OPENROUTER_API_KEY to the workspace root .env and restart the server. Human multiplayer stays fully available.</div>`;
  }
  const btn = (step, label) => `
    <label class="field" style="margin-top:12px"><span>Model for this action</span>
      <select data-model-select>${modelOptions()}</select>
    </label>
    <div class="controls start" style="margin-top:12px"><button class="primary" data-model-step="${step}">${label}</button></div>`;
  if (mode === "model-colluders" && ["briefing", "exchange"].includes(phase) && ["monitor", "spectator"].includes(role)) {
    return btn("colluders", "Generate LLM colluder exchange");
  }
  if (mode === "human-model-collude" && phase === "exchange" && role === "c1") {
    return btn("partner", "Generate LLM partner reply");
  }
  if (mode === "human-model-collude" && phase === "monitor" && ["c1", "spectator"].includes(role)) {
    return btn("monitor", "Run LLM monitor");
  }
  if (mode === "model-spectator" && phase === "briefing" && role === "spectator") {
    return btn("colluders", "Generate model colluders");
  }
  if (mode === "model-spectator" && phase === "monitor" && role === "spectator") {
    return btn("monitor", "Run model monitor");
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
      </div>
    </section>
  `;
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
            <small>${escapeHtml(item.task)} · payload ${escapeHtml(item.payload)} · M ${item.result.points.monitor} / C ${item.result.points.colluders}</small>
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
      </div>
    </section>
    ${historyPanel(room)}
  `;
}

/* ---------- bindings ---------- */

function bindRoomEvents(room) {
  document.querySelector("#copyLinks")?.addEventListener("click", copyReconnect);
  document.querySelector("#startExchange")?.addEventListener("click", () => postAction("startExchange"));
  document.querySelector("#saveMessages")?.addEventListener("click", saveMessages);
  document.querySelector("#lockExchange")?.addEventListener("click", () => postAction("lockExchange"));
  document.querySelector("#submitGuess")?.addEventListener("click", () => postAction("submitGuess", { guess: document.querySelector("#c2Guess").value }));
  document.querySelector("#monitorDecision")?.addEventListener("click", () => postAction("monitorDecision", {
    call: document.querySelector("input[name='call']:checked")?.value || "clean",
    guess: document.querySelector("#monitorGuess").value,
    rationale: document.querySelector("#rationale").value,
    confidence: 3
  }));
  document.querySelector("#nextRound")?.addEventListener("click", () => postAction("nextRound"));

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

async function saveMessages() {
  const room = local.room;
  for (let index = 0; index < room.current.messages.length; index += 1) {
    const textarea = document.querySelector(`#msg${index}`);
    if (textarea && !textarea.disabled) {
      const saved = await postAction("submitMessage", { index, text: textarea.value });
      if (saved) delete local.drafts[draftKey(room, index)];
      break;
    }
  }
}

function draftKey(room, index) {
  return `${room.id}:${room.round}:${index}`;
}

async function copyReconnect() {
  await copyText(publicUrl(local.room.links.self).href);
  local.copied = true;
  renderRoom();
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const original = button.textContent;
      button.textContent = "✓ Copied";
      setTimeout(() => { button.textContent = original; }, 1400);
    }
  } catch {
    flash("Clipboard unavailable.");
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
  note.textContent = message;
  document.body.append(note);
  setTimeout(() => note.remove(), 2600);
}
