export function createTransactionalRoomStore(initialRooms, persistRooms, { clone = structuredClone } = {}) {
  let rooms = initialRooms;
  let commitQueue = Promise.resolve();
  const roomQueues = new Map();

  function commit(operation) {
    const committed = commitQueue.then(operation);
    commitQueue = committed.catch(() => {});
    return committed;
  }

  return {
    current() {
      return rooms;
    },

    transact(mutator) {
      return commit(async () => {
        const stagedRooms = clone(rooms);
        const result = await mutator(stagedRooms);
        await persistRooms(stagedRooms);
        rooms = stagedRooms;
        return result;
      });
    },

    transactRoom(roomId, mutator) {
      const previous = roomQueues.get(roomId) || Promise.resolve();
      const operation = previous.then(async () => {
        const currentRoom = rooms.get(roomId);
        if (!currentRoom) throw Object.assign(new Error("Room not found."), { status: 404 });
        const stagedRoom = clone(currentRoom);
        const result = await mutator(stagedRoom);
        await commit(async () => {
          const stagedRooms = new Map(rooms);
          stagedRooms.set(roomId, stagedRoom);
          await persistRooms(stagedRooms);
          rooms = stagedRooms;
        });
        return result;
      });

      roomQueues.set(roomId, operation.catch(() => {}));
      return operation;
    }
  };
}
