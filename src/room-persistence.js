import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dumpRooms, loadRooms } from "./server-game.js";

export async function readPersistedRooms(filePath, { readFileFn = readFile, deserialize = loadRooms } = {}) {
  try {
    return deserialize(await readFileFn(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw new Error(`Unable to load room persistence: ${error?.message || "unknown error"}`, { cause: error });
  }
}

export function createRoomPersister(filePath, {
  serialize = dumpRooms,
  mkdirFn = mkdir,
  writeFileFn = writeFile,
  renameFn = rename,
  unlinkFn = unlink
} = {}) {
  let queue = Promise.resolve();
  let sequence = 0;

  return function persistRooms(rooms) {
    const snapshot = serialize(rooms);
    const operation = queue.then(async () => {
      await mkdirFn(dirname(filePath), { recursive: true });
      const tempFile = `${filePath}.${process.pid}.${sequence += 1}.tmp`;
      try {
        await writeFileFn(tempFile, snapshot, { encoding: "utf8", mode: 0o600 });
        await renameFn(tempFile, filePath);
      } catch (error) {
        try {
          await unlinkFn(tempFile);
        } catch (cleanupError) {
          if (cleanupError?.code !== "ENOENT") error.cleanupError = cleanupError;
        }
        throw error;
      }
    });

    queue = operation.catch(() => {});
    return operation;
  };
}
