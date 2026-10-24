# Trading Agent: Session Notes and Business Story

Last updated: 2026-10-24 (evening). Hackathon: Agent Builders (build 11:00 to 17:30, demos 18:00). Team of two.
Judges score: **useful, production-ready, live demo works.**

- Code: github.com/4625Labs/trading-agent (private)
- Live dashboard: https://trading-agent-b9ea.style.dev (password protected)
- Live worker health: https://trading-agent-b9ea-worker.style.dev/health

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
- Learning is shown on **replayed history** and on short live runs. We do not claim it beats the market.
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
- **News to trade ideas:** context.dev searches the web (about 3 searches per cycle, every 30 minutes); Claude Haiku extracts signals; Claude Sonnet writes trade ideas. Every idea is checked in code before it goes anywhere (price forced to the live price, sensible stop and target, size within limits).
- **Safety rules engine:** kill switch, banned or unlisted coins, size limit, exposure limit, daily loss limit, order rate limit, wrong-side stop or target, and "needs approval" for big or low-confidence trades. Unit tested. The AI cannot override it.
- **Pretend-money engine** and **real practice-exchange connection** (Binance.US testnet, buy and sell verified live).
- **Human approvals (Omnara):** approve, reject, small trade goes straight through, and oversize trade is blocked. All tried by hand in the browser. Approving from our own dashboard also works.
- **Close-out and learning:** positions close at stop or target; source weights, confidence calibration, and lessons update. Human feedback is collected directly in the dashboard and applied by the worker.
- **Dashboard** (password protected, installable on a phone): Overview, Feed, Approvals plus "How did we do?" feedback, Demo (guided steps), Trace ("why this trade?" timeline), Integrations (call counts), Safety (kill switch), Learning, Preferences. Top navigation, modern dark theme with light option.
- **Integration usage tracking:** every call to context.dev, Claude, Binance testnet and Omnara is counted. At last check context.dev showed 3 calls, no errors, and 1,025 credits remaining.
- **Database** (Supabase): 12 tables, access locked down, all changes recorded.
- **Tests:** 46 automated tests for the worker and 3 for the dashboard, all passing.

**Proven live**
- Full chain on the deployed system: news, signals, idea, safety check, approval, practice trade, simulated price move, close, trace.
- The deployed worker ran its own news cycle without the laptop.

**Not yet verified (be honest about these)**
- The new design has been checked by page responses only; nobody on the team has reviewed it in a browser or on a phone yet.
- The dashboard's feedback buttons have not been used end to end on the live system.
- A full rehearsal of the demo script, start to finish, with a stopwatch.
- A formal "close the laptop" test (the deployed worker has been running on its own, but we have not staged the moment).
- Devpost submission (live URL, repo, short video).

---

## Part 3. How we prove it learns

**Test (replay on real past prices, 300 rounds, three pretend news sources whose true quality we secretly set: one good, one random, one backwards):**
- The agent worked out the order on its own: final trust good 1.88, random 0.85, backwards 0.27.
- It earned **+$36 (64% of trades won)** versus **-$72 (52% won)** for a version that treats all sources equally.
- Confidence calibration improved only slightly (0.2294 to 0.2280). We will not highlight that number.

**What this proves:** the learning machinery responds to evidence. **What it does not prove:** that the AI's real news signals are profitable. We say "replay on history", never "live profit".

**Live version:** each closed trade plus your feedback adds a lesson and nudges source trust; the Learning page shows it.

---

## Part 4. Decisions and problems solved (for the team)
- **Approvals are handled one at a time.** The agent is a single conversation, so a pending approval blocks anything queued behind it. The Demo page disables "Propose a demo idea" while an approval is pending.
- **Feedback moved out of the agent.** It was blocked behind approvals, so it is now collected directly in the dashboard.
- **A test once closed real demo positions** because its watcher scanned the shared database. Fixed with a scope option, and the damaged rows were repaired.
- **Shorts are practice-only** because the test exchange is spot-only.
- **Omnara cannot hand back stored secrets.** Exchange keys are copied from our local settings file to the cloud machine with owner-only permissions and never printed.
- **Rotate secrets after the event:** a database password appeared once in a tool's output during a misconfiguration. Rotate it before any public sharing of logs.
- **Test data cleared** before deployment; the database starts clean.

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

**Image 5: "Learning curve"**
Line chart: "treats all news equally" (falls, ends -$72) versus "learns who to trust" (rises, ends +$36). Caption: "Replay on past prices, 300 rounds."

---

## Part 6. Tools we use (one line each)
- **Omnara**: the agent's runtime and the approval questions; also holds the model credential.
- **Freestyle**: the cloud computer that keeps the agent and dashboard running, with a public address.
- **Supabase**: the database that stores every idea, decision and result.
- **context.dev**: searches and reads the web for news (counted on the Integrations page).
- **Binance.US testnet**: the practice exchange.
- **Claude**: Haiku reads news and extracts signals; Sonnet writes trade ideas.
