# Trading Agent: Session Notes and Business Story

Last updated: 2026-10-24. Hackathon: Agent Builders (build 11:00 to 17:30, demos 18:00). Team of two.
Judges score: **useful, production-ready, live demo works.**

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
1. **Listen.** It reads crypto news from the web and pulls out "signals", such as "this news is good for Bitcoin".
2. **Think.** It turns signals into a trade idea, written in plain words: what to buy, how much, where to cut losses, where to take profit, and why.
3. **Practice.** Every idea is first tried with pretend money alongside real market prices. No risk.
4. **Check the rules, then ask you.** Safety rules, written as plain code the AI cannot override, check every trade. Small, safe trades can go ahead. Bigger or less certain trades come to you with a one-tap Approve or Reject.
5. **Learn.** When a trade ends, it compares the practice result with the real result, asks for your feedback, and adjusts: it trusts good news sources more, trusts weak ones less, and remembers your lessons.

### Why a person would trust it
- **You set the limits.** Your risk comfort, favourite coins, and the size that needs your approval.
- **Hard safety rules.** Maximum trade size, a daily loss limit, a cap on total exposure, and an emergency stop button.
- **Nothing hidden.** Every idea, every rule check, and every approval is logged and visible.
- **No real money in the demo.** It trades on a practice exchange (a "testnet"), so it is safe to show live.

### What makes it different
- It **proves ideas with pretend money before risking anything.**
- It **asks at the right moments** instead of every time or never.
- It **learns from you and from results**, so it fits you better over time.
- It **keeps running on its own** in the cloud, not on a laptop.

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
- We show **learning on replayed history and on short live runs**. We do not claim it beats the market.
- This is **not financial advice.**

### The 3-minute demo story
1. "Meet the agent." Show the live dashboard at its public web link.
2. A news item arrives and the agent proposes a trade with its reasoning.
3. The idea runs with pretend money, and the screen shows the pretend position.
4. The trade is bigger than the user's comfort limit, so **your phone asks: Approve or Reject?** Tap Approve.
5. It executes on the practice exchange. Show the audit trail.
6. A trade closes. The agent asks for feedback, and the learning page shows which news sources it now trusts more.
7. Press the **emergency stop** and show it refuse a new trade.
8. Close the laptop. The agent is still running.

---

## Part 2. What is done so far (status)

**Done and tested**
- Project set up on GitHub (private repo, team of two).
- Connections checked and working: Anthropic, context.dev, Omnara, Freestyle (cloud hosting), Supabase (database), Binance.US testnet (practice exchange).
- **Safety rules engine** with automated tests: kill switch, banned or unlisted coins, size limits, exposure limit, daily loss limit, order-rate limit, wrong-side stop or target, and "needs approval" for big or low-confidence trades.
- **Pretend-money engine** (fills at live price with fees and slippage; closes on stop or target).
- **Practice-exchange connection**: buys and sells on Binance testnet. A live round trip worked.
- **Database** created and locked down (11 tables, access restricted).
- **Agent loop with human approval**, proven both ways: simulated and with a real person tapping Approve or Reject in the Omnara web page. Also verified: small orders go straight through, and oversize orders are blocked.
- **Cloud hosting tested**: a worker can run on a Freestyle VM with a public web address, survives restarts, and wakes from idle in under a second.

**In progress (four parallel builders)**
- News reading and trade-idea generation.
- Closing trades, asking for feedback, and the learning loop with a proof test (see below).
- The web dashboard (overview, approvals, emergency stop, learning page, preferences).
- One-command deploy to Freestyle plus a health page.

**Not started yet**
- Final wiring of all parts and a full end-to-end rehearsal.
- Live deployment and the public demo link.
- Demo script polish and the Devpost submission.

---

## Part 3. How we will prove it learns (plain English)
- We replay **real past prices** with three pretend news sources whose true quality we secretly set: one good, one random, one backwards.
- If the agent works out which is which on its own, and earns more than a version that treats them all equally, the learning works.
- We call this replay on history, never live profit.

---

## Part 4. Picture-ready outline (for the Excalidraw images)

**Image 1: "The agent in one picture"**
Boxes: News | Your Preferences | Practice Money | Safety Rules | Practice Exchange | You (Approve / Reject / Feedback) | Learning.
Arrows: News -> Agent ("signals"); Preferences -> Agent; Agent -> Practice Money ("try the idea"); Agent -> Safety Rules -> Practice Exchange ("real trade"); Agent <-> You ("asks, you answer"); Results -> Learning -> Agent ("gets better").

**Image 2: "Life of one trade" (left to right)**
News arrives -> Idea written -> Tried with pretend money -> Safety check -> Big? Ask you -> Trade placed -> Trade ends -> Feedback -> Agent learns.

**Image 3: "Why you can trust it"**
Four shields: You set the limits | Hard safety rules | Everything logged | Emergency stop.

**Image 4: "How it keeps running" (for the technical judges)**
Cloud box: Agent worker + Dashboard + Database. Arrows to: Omnara (approvals), news service, practice exchange. Label: "Runs without the laptop."

**Image 5: "Learning curve"**
A line chart with two lines: "treats all news equally" (flat) versus "learns who to trust" (rising). Caption: "Replay on past prices."

---

## Part 5. Tools we use (one line each)
- **Omnara**: the chat and approval screens; runs the agent's thinking.
- **Freestyle**: the cloud computer that keeps the agent running.
- **Supabase**: the database that stores every decision.
- **context.dev**: reads and cleans up news web pages.
- **Binance.US testnet**: the practice exchange.
- **Claude**: the AI that reads news and writes trade ideas.
