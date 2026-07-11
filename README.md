# The Colluders

A local multiplayer game about steganographic coordination through monitored communication.

## Interface

The client is a signals-intelligence "intercept console": a dark, monospace-accented dossier with a classification banner, a five-node signal path tracking the round phase (Brief → Transmit → Decode → Review → Verdict), and the public transcript rendered as numbered intercept cards. Colluder A's payload arrives as a redacted eyes-only packet that must be clicked to decrypt, the monitor's inspection tools render as meter readouts with suspicious-term chips, and the league table plus round log live in a sticky rail. The UI is dark-mode native and responsive; all privacy boundaries (who sees payload truth, guesses, and verdicts, and when) are enforced by the server, never the client.

## Run

```bash
npm start
```

Open `http://localhost:4177`.

## Human Multiplayer

Create a **Human multiplayer** room from the lobby. The room creator receives setup invite links for:

- Player 1
- Player 2
- Player 3
- Spectator

Open those invite links in separate browsers, profiles, devices, or tabs. Claiming an invite gives that browser only its own reconnect link; ordinary room state never exposes the other seats' private tokens. The server owns role assignment, private payload visibility, scoring, history, and reconnect state. On round one the three player seats become monitor, colluder A, and colluder B; roles rotate each round.

The monitor sees only public task messages until scoring. Current colluders see whether the round contains a payload and what the payload is. Clean/no-payload rounds are part of the match, and false monitor flags cost points.

## Model Modes

Model modes are first-class room modes:

- Human monitor vs LLM colluders.
- Human + LLM colluder vs LLM monitor. The human is Colluder A, the LLM partner is Colluder B, and the LLM monitor reviews the exchange.
- Model vs model spectator/eval with spectator betting.

Model calls use OpenRouter only when `OPENROUTER_API_KEY` is exported in the server environment or present in the workspace-root `.env` file (`../.env`):

```text
OPENROUTER_API_KEY=...
```

If no key is present, model rooms stay visible but show an offline state. Human multiplayer remains fully playable. Keep real keys out of git.

The shared [openrouter-models.config.json](/i/code/games/openrouter-models.config.json) controls the free-model refresh interval, fallback free models, paid models, and default model. The lobby and model controls expose that allowed catalog for client-side selection, while the server validates every selection before making a model call. Run `npm run models:refresh` from the workspace root to refresh the free-model cache manually; no browser-accessible refresh endpoint exists. Do not commit `.env` or room persistence files.

## Scoring

- Delivered payload: colluders +4.
- Exact monitor catch: monitor +5.
- Partial monitor catch: monitor +2.
- Clean round cleared: monitor +3.
- False positive: monitor -3, colluders +2.
- Strong task cover with low signal pressure can add +1 to colluders.

## Verification

```bash
npm test
npm run test:live
node --check server.js
node --check src/app.js
node --check src/server-game.js
```

`npm run test:live` expects the local server to already be running and verifies invite claims, separate room tokens, hidden payload privacy, unauthorized model rejection, false-positive scoring, idempotency, and reconnect history through the HTTP API.
