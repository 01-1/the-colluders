import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { configFromEnv, createModelClient, parseEnv } from "./src/model-adapter.js";
import { modeCatalog } from "./src/game-core.js";
import { applyAction, authorizeModelStep, claimInvite, createRoom, dumpRooms, inviteLinks, loadRooms, runModelStep, sanitizeRoom, tokenPlayerId } from "./src/server-game.js";

const root = new URL(".", import.meta.url).pathname;
const localEnvFile = join(root, ".env");
const dataDir = join(root, "data");
const roomFile = join(dataDir, "rooms.json");
const port = Number(process.env.PORT || 4177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

const rooms = await readRooms();
const openRouterEnv = await readOpenRouterEnv();
const modelClient = createModelClient({
  apiKey: openRouterEnv.OPENROUTER_API_KEY,
  config: configFromEnv(openRouterEnv)
});

async function readOpenRouterEnv() {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile(localEnvFile, "utf8"));
  } catch {
    fileEnv = {};
  }
  return {
    ...fileEnv,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || fileEnv.OPENROUTER_API_KEY || "",
    OPENROUTER_MODELS: process.env.OPENROUTER_MODELS || fileEnv.OPENROUTER_MODELS || ""
  };
}

async function readRooms() {
  try {
    return loadRooms(await readFile(roomFile, "utf8"));
  } catch {
    return new Map();
  }
}

async function persistRooms() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(roomFile, dumpRooms(rooms));
}

function resolvePath(url) {
  const pathname = new URL(url, `http://localhost:${port}`).pathname;
  const requested = pathname === "/" || pathname.startsWith("/room/") ? "/index.html" : pathname;
  const candidate = normalize(join(root, requested));
  if (!candidate.startsWith(root)) return null;
  return candidate;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function modelStatus() {
  return {
    available: modelClient.available,
    provider: modelClient.config.provider,
    freeModels: modelClient.config.freeModels,
    publicModelSource: modelClient.config.publicModelSource,
    timeoutMs: modelClient.config.timeoutMs
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/config") {
    send(res, 200, { modes: modeCatalog, modelStatus: modelStatus() });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const room = createRoom(body);
    rooms.set(room.id, room);
    await persistRooms();
    send(res, 201, { ...sanitizeRoom(room, room.tokens.spectator, modelStatus()), inviteLinks: inviteLinks(room) });
    return true;
  }

  const claimMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/claim$/);
  if (req.method === "POST" && claimMatch) {
    const room = rooms.get(claimMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    try {
      const body = await readBody(req);
      const token = claimInvite(room, body.invite);
      send(res, 200, sanitizeRoom(room, token, modelStatus()));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Invite claim failed." });
    }
    return true;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === "GET" && roomMatch) {
    const room = rooms.get(roomMatch[1]);
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
    const room = rooms.get(actionMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    try {
      const body = await readBody(req);
      applyAction(room, body.token, body);
      await persistRooms();
      send(res, 200, sanitizeRoom(room, body.token, modelStatus()));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Action failed." });
    }
    return true;
  }

  const modelMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/model$/);
  if (req.method === "POST" && modelMatch) {
    const room = rooms.get(modelMatch[1]);
    if (!room) {
      send(res, 404, { error: "Room not found." });
      return true;
    }
    const body = await readBody(req);
    try {
      authorizeModelStep(room, body.token, body.step);
      await runModelStep(room, modelClient, body.step);
      await persistRooms();
      send(res, 200, sanitizeRoom(room, body.token, modelStatus()));
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Model action failed.", modelStatus: modelStatus() });
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
    send(res, 500, { error: error.message || "Server error." });
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
