# Diagrams

Five judge-facing diagrams. Each exists as `.excalidraw` (editable), `.svg` and `.png`.

1. `01-agent-overview`: the agent in the middle, with news, preferences, practice money, safety rules, the practice exchange, you, learning and the Trace around it.
2. `02-life-of-a-trade`: ten numbered steps from "news arrives" to "agent learns".
3. `03-why-you-can-trust-it`: four shields (your limits, hard safety rules, everything shown, emergency stop).
4. `04-how-it-keeps-running`: for technical judges. The Freestyle cloud machine (agent worker + dashboard) and the services it talks to.
5. `05-does-it-learn`: the honest version, three panels. (a) It ranks planted sources good > random > backwards. (b) Real cumulative profit per round, learner vs equal-weight: +$124 vs +$74, "within noise on real data" (z = 1.43). (c) The time machine: at 25 random moments in 2 years of real prices the agent learns 30 rounds, is frozen, then tested on 20 unseen rounds. Real sources: mean gain -$0.61, 95% interval -$15.06 to +$13.84, won 10 of 25 (no reliable improvement). With planted sources of known edge: +$13.12, interval +$5.41 to +$20.83, won 18 of 25 (p = 0.043). Data caches: `replay-cum-pnl.json`, `rolling-deltas.json`.

## Open the .excalidraw files
Go to https://excalidraw.com, then use the menu (Open) or drag and drop the file onto the canvas.

## Regenerate
`node scripts/make-diagrams.mjs` (add `--refresh` with `--env-file=.env` to re-query the replay chart data; `--no-png` skips PNGs).
PNGs are rendered with headless Chrome (falls back to qlmanage). Image 5 reads the cached JSON files above (latest math-only replay run and latest finished rolling run).
