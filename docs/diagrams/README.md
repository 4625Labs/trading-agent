# Diagrams

Five judge-facing diagrams. Each exists as `.excalidraw` (editable), `.svg` and `.png`.

1. `01-agent-overview`: the agent in the middle, with news, preferences, practice money, safety rules, the practice exchange, you, learning and the Trace around it.
2. `02-life-of-a-trade`: ten numbered steps from "news arrives" to "agent learns".
3. `03-why-you-can-trust-it`: four shields (your limits, hard safety rules, everything shown, emergency stop).
4. `04-how-it-keeps-running`: for technical judges. The Freestyle cloud machine (agent worker + dashboard) and the services it talks to.
5. `05-does-it-learn`: the honest version. Left: it ranks planted sources good > random > backwards. Right: real cumulative profit per round, learner vs equal-weight, "within noise on real data" (z = 1.43).

## Open the .excalidraw files
Go to https://excalidraw.com, then use the menu (Open) or drag and drop the file onto the canvas.

## Regenerate
`node scripts/make-diagrams.mjs` (add `--refresh` with `--env-file=.env` to re-query the replay chart data; `--no-png` skips PNGs).
PNGs are rendered with headless Chrome (falls back to qlmanage). Image 5 reads `replay-cum-pnl.json`, the cached result of the latest math-only replay run.
