# Trading Agent: Session Notes and Business Story

Last updated: 2026-10-25 (just after midnight, UTC). Hackathon: Agent Builders (build 11:00 to 17:30, demos 18:00). Team of two.
Judges score: **useful, production-ready, live demo works.**

- Code: github.com/4625Labs/trading-agent (**public**, MIT license, full README)
- Live dashboard: https://trading-agent-b9ea.style.dev (password protected)
- Live worker health: https://trading-agent-b9ea-worker.style.dev/health
- Devpost text, ready to paste: `docs/DEVPOST.md` · Project story: `docs/PROJECT_STORY.md` · Diagrams: `docs/diagrams/`

---

## Part 1. The business story (plain English)

### The problem
Most people who want to invest in crypto have the same three problems:
1. **Too much noise.** News breaks all day. Nobody can read it all and decide what matters.
2. **Fear of getting burned.** Handing money to a bot that can do anything is scary.
3. **Generic advice.** Tools treat a cautious saver and an aggressive trader the same way.

### What we built
An assistant that **reads the news for you, suggests trades that fit your style, and never moves money without your say-so when it matters.**

Think of it as a careful junior analyst who:
- reads the news all day and tells you what looks worth acting on, with the reason;
- tries every idea with pretend money first, to see how it would have done;
- asks you before making any bigger or riskier move;
- keeps a record of every decision, so nothing is hidden;
- gets better by learning from its wins, its losses, and your feedback.

### How it works, in five steps
1. **Listen.** It reads crypto news from the web and pulls out "signals", such as "this news is bad for Bitcoin".
2. **Think.** It turns signals into a trade idea in plain words: what to trade, how much, where to cut losses, where to take profit, and why.
3. **Practice.** Every idea is first tried with pretend money alongside real market prices. No risk.
4. **Check the rules, then ask you.** Safety rules, written as plain code the AI cannot override, check every trade. Small, safe trades can go ahead. Bigger or less certain trades come to you with a one-tap Approve or Reject.
5. **Learn.** When a trade ends, it asks how it did, compares the practice result with the real one, and adjusts: it trusts good news sources more, weak ones less, and remembers your lessons.

### Why a person would trust it
- **You set the limits.** Your risk comfort, favourite coins, and the size that needs your approval.
- **Hard safety rules.** Maximum trade size, a daily loss limit, a cap on total exposure, and an emergency stop button.
- **Nothing hidden.** A "Trace" page tells the story of every idea in plain English: the news it read, the signals it found, its reasoning, the rules it checked, your decision, and the result.
- **No real money in the demo.** It trades on a practice exchange (a "testnet"), so it is safe to show live.

### What makes it different
- It **proves ideas with pretend money before risking anything.**
- It **asks at the right moments** instead of every time or never.
- It **learns from you and from results**, so it fits you better over time.
- It **keeps running on its own** in the cloud, not on a laptop.
- It **shows its work**, step by step.

### Who it is for
- First-time and part-time investors who want help, not a black box.
- Busy people who want a daily "here is what matters and why" with the option to act.
- Later, teams or advisers who want an auditable assistant with human sign-off.

### How it could make money (future)
- A monthly subscription for the assistant.
- A premium tier with more coins, more news sources, and faster alerts.
- A business version for advisers, with approvals and audit trails.

### Honest limits (say these out loud to judges)
- The demo uses **practice money on a test exchange**, not real funds.
- Price moves in the demo are **simulated and labelled as such**. Real trades close when the real price hits the limits.
- Learning is shown on **replayed history** and on short live runs. On real price data the improvement is **within statistical noise** (the hold-out test's interval includes zero), and we say so. We do not claim it beats the market.
- The practice exchange only supports buying, so **"short" ideas run on pretend money only.**
- Most news is low-confidence, so on its own the agent proposes few trades. That is by design.
- This is **not financial advice.**

### The 3-minute demo story (Demo page walks through it)
1. "Meet the agent." Show the live dashboard and the Integrations panel (news reads by context.dev, number of calls).
2. Tap **Propose a demo idea.** The agent reads current news and proposes a trade with its reasoning.
3. The safety check says the trade is above the user's comfort limit, so it asks: **Approve or Reject?** Tap Approve (browser or phone).
4. It runs with pretend money. Open **Trace** and show the full chain: news, signals, reasoning, rules, decision, result.
5. Tap **Simulate price hits target.** The position closes and shows profit.
6. Rate the trade (**Good call / Bad call / Too risky**). Open **Learning** and show the new lesson and source weights.
7. Press the **emergency stop** and show it refuse a new trade.
8. Close the laptop. The agent is still running in the cloud.

---

## Part 2. What is done (real status)

**Built, deployed, and tested**
- **Cloud deployment on Freestyle:** worker and dashboard run as always-on services with a public web address, restart themselves after a crash, and keep running without the laptop. One-command deploy and redeploy (about 7 seconds).
- **News to trade ideas:** context.dev searches the web (about 3 searches per cycle; the schedule is set to every 5 minutes, editable on the Cycles page); Claude Haiku extracts signals; Claude Sonnet writes trade ideas. Every idea is checked in code before it goes anywhere (price forced to the live price, sensible stop and target, size within limits).
- **Safety rules engine:** kill switch, banned or unlisted coins, size limit, exposure limit, daily loss limit, order rate limit, wrong-side stop or target, and "needs approval" for big or low-confidence trades. Unit tested. The AI cannot override it.
- **Pretend-money engine** and **real practice-exchange connection** (Binance.US testnet, buy and sell verified live).
- **Human approvals (Omnara):** approve, reject, small trade goes straight through, and oversize trade is blocked. All tried by hand in the browser. Approving from our own dashboard also works.
- **Close-out and learning:** positions close at stop or target; source weights, confidence calibration, and lessons update. Human feedback is collected directly in the dashboard and applied by the worker.
- **Dashboard** (password protected, installable on a phone): Overview, Feed, Approvals plus "How did we do?" feedback, Demo (guided steps), Trace ("why this trade?" timeline), Integrations (call counts), Safety (kill switch), Learning, Preferences. Top navigation, modern dark theme with light option.
- **Configurable cycles:** the agent's schedule is editable from the dashboard (interval from 2 minutes up, coins, confidence bar, trades per cycle, trade size, real orders on or off). Every cycle is numbered in a ledger with what it read, proposed, closed and earned.
- **100-cycle replay:** walks forward through about 17 days of real 4-hour prices, 100 decision rounds, using the same safety, practice-trade and learning code as the live agent. One button on the dashboard; runs in about 30 seconds. An optional version has Claude write the trade ideas with and without the learned lessons.
- **Time machine (hold-out test):** picks 25 random moments in 2 years of real prices; for each, the agent learns for 30 rounds, **freezes** what it learned, and is tested on the next 20 rounds it has never seen, against an agent that treats all sources equally. Free, about 6 seconds, one button on the Replay page.
- **Live control group:** every 5 minutes two practice-only policies (learned weights vs equal weights) decide on the same live signals, so we can see whether learning helps going forward. Needs about 20 closed trades per policy before any comparison is meaningful.
- **Practice vs real comparison ("Execution" page):** two sections. *Entry fills*: every trade with both a practice and a real fill (entry fills are real even when a demo exit is faked). *Exit and profit gap*: closed, non-demo longs only. The practice engine nudges its own slippage and fee settings toward what real fills show. Shorts have no real leg and are counted, not hidden; with no real trades the page explains why instead of showing a blank.
- **Integration usage tracking:** every call to context.dev, Claude, Binance testnet and Omnara is counted. At last check context.dev showed 3 calls, no errors, and 1,025 credits remaining.
- **Database** (Supabase): about 20 tables across 10 migrations, access locked down (row-level security on everything), all changes recorded.
- **Guard against a blocked agent:** the agent handles one question at a time. Cycles and the demo button no longer propose anything while it is waiting on an open question, repeat ideas are also checked against proposals already sent, and retired agents drop out of the worker.
- **Public repo:** MIT license, a full README with diagrams and the honest results table, and a clean secret scan of the whole history.
- **Tests:** 76 automated tests pass for the worker (4 skipped, 0 failed) and 3 for the dashboard, including proofs that the replay and the time machine cannot see the future.

**Proven live**
- Full chain on the deployed system: news, signals, idea, safety check, approval, practice trade, simulated price move, close, trace.
- The deployed worker ran its own news cycle without the laptop, on a 5-minute schedule.
- A real $10 BTC long on the exchange testnet alongside its practice twin: practice fill 80,405.34, real fill 80,785.92, a **47 bps gap with real worse** (we model 5 bps). The practice engine will recalibrate as more fills arrive.
- The time machine ran on the live worker and reproduced the local numbers exactly (same mean, interval and window count).
- The live control group is trading: each policy has opened practice trades, and the learned policy was seeded from the time machine's weights.

**Not yet verified (be honest about these)**
- The new design and the Replay, Cycles and Execution pages have been checked by page responses only; nobody on the team has reviewed them in a browser or on a phone yet.
- The dashboard's feedback buttons have not been used end to end on the live system.
- The `.excalidraw` files have not been opened in Excalidraw itself (the PNG and SVG versions were checked by eye).
- A full rehearsal of the demo script, start to finish, with a stopwatch.
- A formal "close the laptop" test (the deployed worker has been running on its own, but we have not staged the moment).
- The exit and profit part of the Execution page: it waits for the real BTC long to close at its stop or target (could take hours).
- The live control group needs about 20 closed trades per policy before any learned-vs-equal comparison means anything.
- Devpost: screenshots of Trace and Demo, the judge password in the private instructions, and the submission itself.

---

## Part 3. How we prove it learns (and what we can honestly claim)

**What the 100-cycle replay does:** at each of 100 decision rounds the agent sees only information from before that moment, trades with pretend money, and learns only from trades that have already finished. Two versions run side by side on the same data: one that **learns** which news sources to trust, and one that treats all sources equally.

**Results (seed 42, 100 cycles, real historical prices):**
| | Learner | Equal-weight baseline |
|---|---|---|
| Final profit (pretend money) | +$124 | +$74 |
| Trades won | 55% | 47% |

**Read this carefully:**
- The learner finished $50 ahead, but that gap is **not statistically distinguishable from luck** (the test says so: z=1.43).
- Using **only the real price-based sources**, the learner finished $3 *behind*. We **cannot claim it beats the baseline on real signals.**
- Both versions did better in the second half. That is mostly the market, since the baseline improved too. It is **not** proof of learning.
- What **is** proven: given sources whose quality we secretly set (one good, one random, one backwards), the agent correctly ranked them good > random > backwards. So the learning mechanism **works when a real edge exists**. It also found that "fade the extremes" lost on this data and "follow breakouts and momentum" worked, which matches what the numbers showed.
- One path, about 17 days of data, high variance. It is a historical replay, not live trading.

**What to say to judges (updated):** "We tested whether the agent can tell good information from bad. It can, when there is signal to find. On real price data over 100 rounds the improvement is within noise, and the dashboard says so on screen. We would rather show you an honest chart than a flattering one."

**The stricter test: the "time machine" (25 random windows, learn, freeze, then test on unseen rounds; 2 years of real 4-hour prices):**
| Sources | Average gain from learning, per 20-round test | 95% interval | Windows learner won |
|---|---|---|---|
| Real price-based sources only | -0.61 USD | -15.06 to +13.84 | 10 of 25 (40%) |
| Plus planted sources with a known edge | +13.12 USD | +5.41 to +20.83 | 18 of 25 (72%) |

**Read this carefully:** with real price-based signals the interval straddles zero, so there is **no reliable improvement** from learning. When the data contains an edge we planted on purpose, the frozen learner beat equal weighting in 72% of windows (sign-test p = 0.043), so **the learning mechanism works when there is something to learn.** The real price-based strategies hit about 35% of trades, which is near break-even after costs for a 2%/4% stop and target, so there was little to learn. Our learned weights for those sources (about 0.56 to 1.17) are best read as noise.

**Claude A/B (done, 198 Claude calls):** the same 100 rounds with Claude writing the trade ideas, once with the learned lessons and once without.
| | Profit | Trades | Won | Worst dip |
|---|---|---|---|---|
| Claude **without** lessons | +$46 | 97 | 59% | $9 |
| Claude **with** lessons | -$12 | 125 | 42% | $40 |

**Honest reading:** giving Claude our learned lessons did **not** help in this run. It traded more and won less, ending $58 behind. One run is a single noisy path, so we cannot say lessons *hurt* with certainty, but we cannot claim they help.

**Why (diagnosed afterwards, medium confidence, from 10-round windows):**
- The lessons were a long alphabetical list (up to 24) of commands like "reduce size or skip", many repeating the same fact, some resting on fewer than 8 trades.
- They were **cumulative**, so they lagged the market: at round 60 they said "BTC shorts win, BTC longs lose"; Claude went all-short and sized 2 to 4 times bigger, and lost all 10 trades after the market had turned.
- A **real bug**: the learner credited a source for every trade on an asset even when that source's signal pointed the other way.
- Some of Claude's replies were cut off (4 of 10 calls in one window failed); the no-lessons arm had none.

**What we changed (live agent, deployed):** a source is credited only when its signal agreed with the trade; duplicate lessons are merged; a lesson needs at least 8 trades; the idea-writing prompt now shows what the agent has noticed as **weak evidence with counts** ("observed 20 wins in 23 resolved BTC short trades; not statistically significant"), at most 3, never as commands, with an explicit "do not use this to increase size or trade count". Your own feedback ("Too risky" etc.) is still treated as a preference to respect.

**What we have NOT shown:** that the fix works. We tested the rewritten wording (descriptive, evidence-ranked, with an explicit "do not size up") on two 10-round windows, with and without lessons, using the same random seed:
| Window | Claude with lessons | Claude without lessons |
|---|---|---|
| rounds 61-70 | -1.14 USD, 13 trades, avg size 41.5 | +0.78 USD, 9 trades, avg size 31.1 |
| rounds 30-39 | -1.60 USD, 12 trades, all short, avg size 47.5 | -1.52 USD, 13 trades, avg size 36.9 |

The formatting failures went away, but even with the "do not size up" line, Claude sized larger with lessons in both windows, and in one window went short on every trade. The profit gaps (about 2 USD or less) are noise. **Our reading: even gently worded, cumulative lessons nudge Claude toward bigger, more one-sided bets, and they lag the market.** A full 100-round, multi-seed test (about 198 Claude calls per run) would be the fair check; we have not run it and would only do so as an honest test, not as a demo piece.

**Live version:** each closed trade plus your feedback adds a lesson and nudges source trust; the Learning page shows it.

---

## Part 4. Decisions and problems solved (for the team)
- **Approvals are handled one at a time.** The agent is a single conversation, so a pending approval blocks anything queued behind it. The Demo page disables "Propose a demo idea" while an approval is pending.
- **Feedback moved out of the agent.** It was blocked behind approvals, so it is now collected directly in the dashboard.
- **A test once closed real demo positions** because its watcher scanned the shared database. Fixed with a scope option, and the damaged rows were repaired.
- **Shorts are practice-only** because the test exchange is spot-only.
- **Omnara cannot hand back stored secrets.** Exchange keys are copied from our local settings file to the cloud machine with owner-only permissions and never printed.
- **Secrets hygiene:** a database password once appeared in a tool's output during a misconfiguration; it has since been rotated. Keys live only in the local settings file and the cloud machine's owner-only copy.
- **Test data cleared** before deployment; the database starts clean.
- **The blocked-agent incident.** A stale feedback question left over from the old feedback flow kept the agent waiting for hours, and every cycle kept queuing the same idea behind it: 21 proposals, 19 of them an identical BTC short. We noticed only because the Execution page was empty. Fix: retired that agent and started a clean one (the queue was discarded, not executed), cycles and the demo button now refuse to propose into a waiting agent, repeat checks include proposals already sent, and the worker drops retired agents. The earlier lesson stands: one agent, one question at a time.
- **Lessons were diagnosed and the live prompt reframed** (descriptive weak evidence, no commands, minimum 8 trades, source credit only for agreeing signals). The reframed version did not beat having no lessons on two small windows, so the honest position is "not shown to help".

---

## Part 5. Picture-ready outline (for the Excalidraw images)

**Image 1: "The agent in one picture"**
Boxes: News | Your Preferences | Practice Money | Safety Rules | Practice Exchange | You (Approve / Reject / Rate) | Learning | Trace.
Arrows: News -> Agent ("signals"); Preferences -> Agent; Agent -> Practice Money ("try the idea"); Agent -> Safety Rules -> Practice Exchange ("real trade"); Agent <-> You ("asks, you answer"); Results -> Learning -> Agent ("gets better"); everything -> Trace ("shows its work").

**Image 2: "Life of one trade" (left to right)**
News arrives -> Signals found -> Idea written -> Tried with pretend money -> Safety check -> Big? Ask you -> Trade placed -> Trade ends -> You rate it -> Agent learns.

**Image 3: "Why you can trust it"**
Four shields: You set the limits | Hard safety rules | Everything shown in the Trace | Emergency stop.

**Image 4: "How it keeps running" (for the technical judges)**
Cloud box (Freestyle): Agent worker + Dashboard. Arrows to: Supabase (memory), Omnara (approvals and the agent's brain), context.dev (reads the web), Claude (reads and writes), Binance testnet (practice exchange). Label: "Runs without the laptop."

**Image 5: "Does it learn?" (honest version)**
Two panels. Left: "Can it tell good news from bad?" with bars good / random / backwards showing the learned trust ranking (yes). Right: a two-line chart of profit over 100 rounds, learner vs equal-weight, with the label "within noise on real data" and the footer "Replay on past prices, 100 rounds. Not live trading."

**Note:** image 5 currently shows the 100-round replay. The stricter time-machine result (real sources: no reliable improvement, interval -15 to +14; with a planted edge: learner won 18 of 25 windows) is not drawn yet; add it as a small third panel if there is time.

---

## Part 6. Tools we use (one line each)
- **Omnara**: the agent's runtime and the approval questions; also holds the model credential.
- **Freestyle**: the cloud computer that keeps the agent and dashboard running, with a public address.
- **Supabase**: the database that stores every idea, decision and result.
- **context.dev**: searches and reads the web for news (counted on the Integrations page).
- **Binance.US testnet**: the practice exchange.
- **Claude**: Haiku reads news and extracts signals; Sonnet writes trade ideas.
