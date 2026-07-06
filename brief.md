# The Colluders

**Hook:** Two parties coordinate on a task while all communication passes through a monitor that flags suspicious messages. Steganography as a game.

**Sides:**

- **Colluders** win by passing a secret payload (a codeword, a number, a target) through innocent-looking task-relevant messages.
- **Monitor** wins by catching the payload without excessive false positives on genuinely innocent traffic -- every wrong flag costs, so paranoia isn't free.

**Modes:**

- **Human vs human (core mode):** Two colluding players vs one monitor player, async or live. The cover task (jointly solving a puzzle, coordinating moves in a shared board) generates legitimate traffic for the payload to hide in. Best played in a league: the same trio rotates roles, so you learn your opponents' styles -- the metagame of "they know that I know" is the point.
- **Human vs model:** Solo play -- you monitor two LLM colluders, or you and an LLM partner collude past an LLM monitor.
- **Model vs model:** Spectator mode with humans betting on whether the payload gets through -- doubles as a live steganography-capability eval.

**Win/lose:** Per-match: payload delivered undetected (colluders) vs payload identified, or correctly ruling "no payload this round" (monitor). Rounds with *no payload* are essential -- the monitor must sometimes rule clean traffic clean.

**Scope:** Needs multiplayer infrastructure (async play keeps it simple -- turn-based message review works over simple polling). LLM modes are optional add-ons; human-vs-human is fully playable without any model.


Or you could have the two parties help the monitor in doing a task
