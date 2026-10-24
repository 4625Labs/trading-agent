# Practice-First Trading Agent

> An AI assistant that reads the crypto news for you, rehearses every idea with pretend money, and asks you before it risks anything that matters.

**Live demo:** https://trading-agent-b9ea.style.dev (password protected; ask the team for access) · **Code:** github.com/4625Labs/trading-agent · **Health:** https://trading-agent-b9ea-worker.style.dev/health

---

## Project brief

Practice-First Trading Agent is an always-on cloud agent that turns crypto news into trade ideas and makes it safe to act on them. Every few minutes it searches the web (context.dev), extracts signals with Claude, and writes a plain-English trade idea. Each idea is **rehearsed with pretend money at live prices**, passed through **safety rules written as ordinary code that the AI cannot override**, and, when it is large or uncertain, sent to the user for a one-tap **Approve or Reject** (via Omnara or our own dashboard). Approved long ideas also place a real order on an exchange **testnet**, so we can compare what the simulator predicted with what the market actually did.

Every step is recorded in a **Trace** that tells the story in plain English: the news it read, the signals it found, its reasoning, the rules it checked, the decision, and the result. The agent learns from outcomes and from human feedback, and a 100-round replay on real historical prices tests whether that learning helps. It runs on a Freestyle machine, keeps its memory in Supabase, and keeps working when the laptop is closed.

**Honest scope:** practice money on a test exchange, not real funds. Not financial advice.

---

## Elevator pitch

**One sentence:** *A trading assistant that reads the news, rehearses every idea with pretend money, and never moves real money without your say-so when it matters.*

**Thirty seconds:** Crypto moves on news nobody has time to read, and handing money to a bot is frightening. Our agent reads the web all day, writes a trade idea in plain English, tries it with pretend money first, and checks it against hard safety rules the AI cannot override. Anything big or uncertain comes to you as a one-tap Approve or Reject, and every step is shown on a Trace page, so nothing is a black box. It runs in the cloud on its own, and we test whether it actually learns, and we show you the honest result.

---

## The story

### Inspiration

The hackathon asked for an agent that does something real, is deployed live, and is judged on how **useful**, **production-ready**, and **demonstrably working** it is. Trading looked like the sharpest test of all three, because it is the setting where an unconstrained AI is most frightening.

Three ordinary problems kept coming up:

1. **Too much noise.** News breaks all day, and nobody can read it all and decide what matters.
2. **Fear of getting burned.** "Let the AI trade for me" is a hard sentence to say out loud.
3. **One-size-fits-all advice.** A cautious saver and an aggressive trader get the same tips.

The idea that tied them together was a *careful junior analyst*: someone who reads everything, rehearses before acting, asks permission at the right moments, shows their work, and gets better with feedback. The product principle became **practice first, ask when it matters, show everything.**

### What it does

1. **Listen.** context.dev searches the web for crypto news; Claude Haiku turns each article into structured signals ("BTC looks bearish, 40% confidence, because...").
2. **Think.** Claude Sonnet reads the last day of signals, the user's preferences, the learned trust in each news source, and past lessons, and proposes ideas with an entry, stop, target, size, and a written rationale. Code validates every idea: the entry is forced to the live price, stops and targets must be on the correct sides, and size is clamped.
3. **Practice.** Every idea runs on a simulator with modelled fills and fees before anything else happens.
4. **Check, then ask.** A deterministic rules engine evaluates the idea (kill switch, banned coins, size, exposure, daily loss, order rate). Small safe trades pass; larger or low-confidence ones go to the user as an Approve/Reject question.
5. **Act.** Approved longs also send a real order to the Binance.US testnet. The testnet is spot-only, so shorts stay practice-only, and we say so everywhere.
6. **Learn.** When a position closes, the user rates it (*Good call / Bad call / Too risky*); the agent updates how much it trusts each source, records a lesson, tightens limits after "Too risky", and recalibrates its own simulator from real fills.

Around that loop sit a mobile-first dashboard (Overview, Approvals, Demo, Trace, Cycles, Replay, Execution, Integrations, Safety, Learning, Preferences), a configurable schedule with a numbered cycle ledger, and an Integrations panel that counts calls to each service.

### The math behind it

We kept the learning deliberately simple and inspectable.

**Source trust.** A source's signal is a *hit* if it agreed with a winning trade or disagreed with a losing one. With $h_i$ hits in $n_i$ resolved trades, we use a Beta(1,1)-smoothed hit rate, then map it to a weight:

$$
\hat p_i = \frac{h_i + 1}{n_i + 2}, \qquad w_i^{\star} = 1 + 6\left(\hat p_i - \tfrac12\right)
$$

and move the live weight a fraction of the way toward that target, bounded:

$$
w_i \leftarrow \operatorname{clip}\!\big(w_i + 0.25\,(w_i^{\star} - w_i),\; 0.05,\; 3\big)
$$

A source at chance ($\hat p_i = 0.5$) has weight $1$; a clearly good one approaches $3$; a clearly bad one approaches $0.05$. The agent's directional view of an asset is the weighted vote over its signals, with $d_k = +1$ for long and $-1$ for short and $c_k$ the stated confidence:

$$
V = \sum_k w_{s(k)}\, c_k\, d_k
$$

**Calibration.** We check whether stated confidence matches reality with the Brier score over forecasts $f_k$ and outcomes $o_k \in \{0,1\}$:

$$
\text{Brier} = \frac{1}{N}\sum_{k=1}^{N}\left(f_k - o_k\right)^2
$$

**Execution model.** A simulated long entry fills at $P_{\text{fill}} = P_{\text{mid}}(1+s)$ with slippage $s$ (initially 5 bps) and pays a fee $\phi$ (initially 10 bps) on each side, so for quantity $q$:

$$
\text{PnL} = q\,(P_{\text{exit}} - P_{\text{fill}}) - \phi\,q\,(P_{\text{fill}} + P_{\text{exit}})
$$

**Simulation vs reality.** For every long trade that has both a practice fill and a real testnet fill, the execution gap in basis points is

$$
g = \frac{P^{\text{real}}_{\text{fill}} - P^{\text{sim}}_{\text{fill}}}{P^{\text{sim}}_{\text{fill}}}\times 10^{4}
$$

and the simulator corrects itself with an exponential moving average, for example for slippage with mean observed gap $\bar g$:

$$
s_{\text{new}} = 0.7\,s + 0.3\,\operatorname{clip}(s + \bar g,\; 0,\; 50)
$$

**Is the improvement real?** We compare two arms with a rough noise check, the z-score of the mean per-cycle profit difference $\bar d$ over $n$ cycles, $z = \dfrac{\bar d}{\sigma_d/\sqrt{n}}$, and treat $|z| < 2$ as "not distinguishable from luck." It is a sanity check, not a formal statistical test, and it is the reason the honest sections below read the way they do.

**Position sizing.** An idea's size is $\min(\text{trade size},\; \rho\, W)$ for wallet $W$ and the user's maximum position fraction $\rho$, and an order needs a human whenever $\text{size} > \theta$ (the user's approval threshold) or confidence is below the user's minimum.

### How we built it

- **Agent runtime: Omnara.** The agent runs as an Omnara-hosted agent with two tools: the built-in `ask_question` for humans, and a custom `place_order` tool. Omnara does not call our code; our worker polls for ready tool calls, runs the guardrails, and posts the result back. Approvals are enforced in code: `place_order` refuses to execute a thesis that needs approval unless an approval record exists, so the model cannot talk its way past it.
- **Hosting: Freestyle.** One VM runs two systemd services (worker and dashboard) with auto-restart and the idle timeout off, behind free `*.style.dev` HTTPS addresses. A deploy script packs the repo, writes the environment, builds the dashboard, and redeploys in about seven seconds.
- **Memory: Supabase (Postgres).** About twenty tables and nine migrations hold signals, theses, approvals, trades, lessons, cycles, replay results, and an `agent_events` table that powers the Trace. Row-level security is on everywhere; the browser never talks to the database.
- **Web reading: context.dev.** Search plus page text as markdown in one call. Every call, and the credits remaining, is recorded and shown in the dashboard.
- **Models: Claude.** Haiku for cheap per-article extraction, Sonnet for trade ideas, via plain `fetch`.
- **Venue: Binance.US testnet.** A spot adapter behind a small `ExchangeAdapter` interface that the simulator also implements.
- **Dashboard: Next.js.** Server routes only, an optional password gate, installable as a phone web app.
- **Team and tooling.** Two humans, plus Claude Code. We split the work into parallel AI builders with strictly **disjoint file ownership** (news and ideas; closing and learning; dashboard; deployment), with one leader integrating, testing, and being the only one to commit. The result is 57 worker tests and 3 dashboard tests, all passing.

### Challenges we faced

- **A single-threaded agent is a bottleneck.** Our agent has one conversation, so a pending approval blocks everything queued behind it, including feedback requests. We found this when feedback questions never appeared. The fix was architectural: feedback is now collected directly in the dashboard and applied by the worker, and the demo page refuses to start a new idea while one is waiting.
- **A test that quietly touched real data.** Our close-out test scanned the shared database and closed our own demo positions at a fake price of 100 USD, showing a total loss of 100% on each. We traced it, scoped the watcher so tests can only touch their own rows, repaired the data, and added a regression test.
- **Integrations that do not behave like the docs imply.** Omnara custom tools are polled, not pushed, and secret values can never be read back through its API, so exchange keys travel from a local file to the VM with owner-only permissions. The Freestyle image has no `node` and runs commands as a non-root user; we ran under `bun` and `linuxUser("root")`. The global Binance testnet returns HTTP 451 from US IPs, so we switched to the Binance.US testnet, which is spot-only and forced us to be explicit that shorts are practice-only.
- **Secrets hygiene.** Early on, a script's error message echoed a connection string. We rotated the credential, then built redaction into every spike and deploy script and ran a scan to confirm no secret appears anywhere in the code or its git history.
- **Making "it learns" honest.** This was the hardest and most valuable challenge (next section).

### What we learned

**Building the evidence mattered more than building the feature.** We built a 100-round walk-forward replay on about 17 days of real 4-hour prices, with a test that rewrites the future and proves cycles up to that point do not change (no look-ahead). Two versions of the agent ran side by side on identical data: one that learns source trust and one that weights everything equally.

| 100 rounds, real historical prices | Learner | Equal-weight baseline |
|---|---|---|
| Final profit (pretend money, USD) | +124 | +74 |
| Trades won | 55% | 47% |

The learner finished ahead, but with $z = 1.43$ that gap is **not distinguishable from luck**, and on the real price-based sources alone it finished 3 USD *behind*. What we *can* claim is narrower and still useful: given sources whose true quality we secretly planted (about 65%, 50%, and 35% accurate), the learner ranked them correctly, with weights near $1.60$, $0.78$, and $0.30$. The mechanism works **when a real edge exists**; on this real data, over this window, we found no reliable edge to learn.

We then asked whether giving Claude our learned lessons improves its own trade ideas (198 Claude calls over the same 100 rounds):

| Claude writing the ideas | Profit | Trades | Won |
|---|---|---|---|
| without lessons | +46 USD | 97 | 59% |
| **with** lessons | −12 USD | 125 | 42% |

Lessons **did not help**; the lessons arm traded more and won less. One run is a single noisy path, so we do not claim the lessons hurt, only that we cannot claim they help. We are investigating why (the prime suspects are directive lesson wording and lessons drawn from very small samples), and we chose to publish the result rather than hide it.

Other lessons, in short:

- **Put safety in code, not in prompts.** The guardrails are plain functions with unit tests; the model's only power is to *ask*.
- **Make every step legible.** The Trace page was built for judges, but it was the fastest way for us to find our own bugs.
- **Label simulations.** Demo price moves, planted sources, and the practice engine are all labelled as simulated wherever they appear, and demo trades are excluded from the simulation-versus-reality comparison.
- **Parallel builders need contracts.** Agreeing on table schemas and file ownership first let four builders work at once without collisions.

### Accomplishments we are proud of

- A live, always-on agent whose every decision can be explained in plain English.
- Human approvals that work from either Omnara or our own dashboard, enforced in code rather than by the prompt.
- A walk-forward replay with a no-look-ahead proof, a planted-truth sanity check, and a verdict that says "within noise" when it is.
- A simulator that corrects itself from real fills, with the gap shown per trade.

### What is next

- Find out why the lessons hurt and test a fix on a full run.
- Replace single-path replay with many seeds and longer history to tighten the statistics.
- Add more genuinely independent signal sources, since two of our four price-based ones carried most of the weight.
- A perpetuals venue so that shorts get a real leg and the simulation-versus-reality comparison covers both sides.
- Per-user accounts, and an adviser mode with audit trails.

### Built with

Omnara · Freestyle · Supabase (Postgres) · context.dev · Claude (Haiku, Sonnet) · Binance.US testnet · Next.js · TypeScript · Bun · Claude Code

---

*Practice money on a test exchange. Replay results are historical and not indicative of future performance. Not financial advice.*
