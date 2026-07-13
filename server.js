import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { getModelCatalog, getOpenRouterApiKey, selectModel } from "./src/openrouter-models.js";
import { createModelClient } from "./src/model-adapter.js";
import { modeCatalog, scenarioCatalog } from "./src/game-core.js";
import { applyAction, authorizeModelStep, claimInvite, createRoom, inviteLinks, joinRoomByCode, runModelStep, sanitizeRoom, tokenPlayerId } from "./src/server-game.js";
import { readJsonBody } from "./src/http-utils.js";
import { createRoomPersister, readPersistedRooms } from "./src/room-persistence.js";
import { createTransactionalRoomStore } from "./src/room-store.js";

const root = new URL(".", import.meta.url).pathname;
const dataDir = process.env.COLLUDERS_DATA_DIR || join(root, "data");
const roomFile = join(dataDir, "rooms.json");
const port = Number(process.env.PORT || 4177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const persistRooms = createRoomPersister(roomFile);
const roomStore = createTransactionalRoomStore(await readPersistedRooms(roomFile), persistRooms);
const modelRequestsInFlight = new Set();
const modelClient = createModelClient({
  apiKey: await getOpenRouterApiKey()
});

function resolvePath(url) {
  const pathname = new URL(url, `http://localhost:${port}`).pathname;
  const requested = pathname === "/" || pathname.startsWith("/room/")
    ? "/index.html"
    : pathname.startsWith("/src/")
      ? pathname
      : null;
  if (!requested) return null;
  const candidate = normalize(join(root, requested));
  if (!candidate.startsWith(root)) return null;
  return candidate;
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function modelStatus() {
  return {
    available: modelClient.available,
    provider: modelClient.config.provider,
    timeoutMs: modelClient.config.timeoutMs
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    send(res, 200, { modes: modeCatalog, scenarios: scenarioCatalog, modelStatus: modelStatus(), modelCatalog: await getModelCatalog() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/join") {
    const body = await readJsonBody(req);
    const code = String(body.code || "").trim().toUpperCase();
    const roomId = [...roomStore.current().values()].find((item) => item.code === code)?.id;
    if (!roomId) throw Object.assign(new Error("No room was found for that join code."), { status: 404 });
    const token = await roomStore.transactRoom(roomId, (room) => joinRoomByCode(room, body.name));
    const room = roomStore.current().get(roomId);
    send(res, 200, sanitizeRoom(room, token, modelStatus()));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readJsonBody(req);
    const { roomId, token } = await roomStore.transact((rooms) => {
      let room = createRoom(body);
      while ([...rooms.values()].some((item) => item.code === room.code)) room = createRoom(body);
      rooms.set(room.id, room);
      return { roomId: room.id, token: room.tokens[room.creatorSpectatorId] };
    });
    const room = roomStore.current().get(roomId);
    send(res, 201, { ...sanitizeRoom(room, token, modelStatus()), inviteLinks: inviteLinks(room) });
    return true;
  }

  const claimMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/claim$/);
  if (req.method === "POST" && claimMatch) {
    const room = roomStore.current().get(claimMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const token = await roomStore.transactRoom(claimMatch[1], (stagedRoom) => claimInvite(stagedRoom, body.invite));
      send(res, 200, sanitizeRoom(roomStore.current().get(claimMatch[1]), token, modelStatus()));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Invite claim failed." });
    }
    return true;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomMatch) {
    const room = roomStore.current().get(roomMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    const token = url.searchParams.get("token");
    if (!tokenPlayerId(room, token)) {
      send(res, 403, { error: "A valid room link is required." });
      return true;
    }
    send(res, 200, sanitizeRoom(room, token, modelStatus()));
    return true;
  }

  const actionMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/action$/);
  if (req.method === "POST" && actionMatch) {
    const room = roomStore.current().get(actionMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      await roomStore.transactRoom(actionMatch[1], (stagedRoom) => applyAction(stagedRoom, body.token, body));
      send(res, 200, sanitizeRoom(roomStore.current().get(actionMatch[1]), body.token, modelStatus()));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Action failed." });
    }
    return true;
  }

  const modelMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/model$/);
  if (req.method === "POST" && modelMatch) {
    const room = roomStore.current().get(modelMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    const body = await readJsonBody(req);
    const model = selectModel(await getModelCatalog(), body.model);
    if (modelRequestsInFlight.has(modelMatch[1])) {
      send(res, 409, { error: "A model action is already in progress for this room." });
      return true;
    }
    modelRequestsInFlight.add(modelMatch[1]);
    try {
      const outcome = await roomStore.transactRoom(modelMatch[1], async (stagedRoom) => {
        authorizeModelStep(stagedRoom, body.token, body.step);
        try {
          await runModelStep(stagedRoom, modelClient, body.step, model);
          return { error: null };
        } catch (error) {
          return { error };
        }
      });
      if (outcome.error) {
        send(res, outcome.error.status || 500, { error: outcome.error.message || "Model action failed.", modelStatus: modelStatus() });
      } else {
        send(res, 200, sanitizeRoom(roomStore.current().get(modelMatch[1]), body.token, modelStatus()));
      }
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Model action failed.", modelStatus: modelStatus() });
    } finally {
      modelRequestsInFlight.delete(modelMatch[1]);
    }
    return true;
  }

  return false;
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith("/api/") && await handleApi(req, res, url)) return;
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Server error." });
    return;
  }

  const filePath = resolvePath(req.url || "/");
  if (!filePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": types[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`The Colluders is running at http://localhost:${port}`);
});
