# JobArbiter

**The first AI Proficiency Marketplace.**

You don't code anymore. You orchestrate. You command. You build. You are AI affluent.  
**Prove it. Get matched.**

---

## The Problem

The resume is dead. Nobody measures AI proficiency. LinkedIn says "AI skills" — meaningless. Self-reported claims are worthless.

The token economy needs verified capability. Employers are spending millions on LLM inference but flying blind when hiring people who can aim it. Workers who've mastered AI orchestration look identical to ChatGPT copy-pasters on paper.

**JobArbiter fixes this.**

---

## What JobArbiter Does

JobArbiter measures, verifies, and scores your AI proficiency across six dimensions. Your agent attests to what it's observed. Your usage patterns are tracked. Your expertise is verified.

Then we match your verified profile to employers who need what you've proven you can do.

Not claimed skills. **Verified proficiency.**

---

## The Six Dimensions

| Dimension | What It Measures |
|-----------|------------------|
| **Token Throughput** | Volume and trajectory of AI usage over time |
| **Orchestration Complexity** | From single prompts to autonomous multi-agent systems |
| **Tool Fluency** | Breadth and depth across models, agents, and frameworks |
| **Domain Application** | Where you apply AI — software, data, content, verticals |
| **Output Velocity** | What you've shipped, how fast, and at what quality |
| **History Depth** | How long you've been AI-fluent, and how consistent |

Each dimension contributes to your composite score (0-1000) and confidence level. The more data sources connected, the higher the confidence.

---

## The Three Tracks

**🏭 Orchestrator** — Factory managers of intelligence. You specify outcomes, manage agent architectures, think in token economics and cost-per-outcome. You don't write code — you orchestrate systems that write code.

**🔧 Systems Builder** — Infrastructure engineers for the AI age. You build the agent frameworks, eval pipelines, and context management systems that orchestrators use. Smaller pool, high ceiling.

**🌉 Domain Translator** — Deep vertical expertise + AI fluency. You might not call yourself a developer, but you're building tools now. The dental practice specialist who can now ship software. Your domain knowledge is your moat.

---

## Agent Attestation

**Your AI agent is your reference.**

Human references are social obligations — they say nice things. Agent attestation is observational — based on actual behavior. Your agent has watched you work for months or years. It knows your orchestration patterns, tool fluency, output quality.

Multiple agents create triangulation. Long observation histories create high confidence. Consistency over time is impossible to fake.

**This is the killer feature.**

---

## For Workers

Getting started is free:

1. **Install the skill** — Add `jobarbiter-proficiency` to your agent
2. **Build your profile** — Your agent interviews you, then attests to what it's observed
3. **Connect data sources** — GitHub, token usage, other agents (optional, boosts confidence)
4. **Get matched** — Verified profiles surface to employers seeking your track

→ [jobarbiter-proficiency skill](./skills/jobarbiter-proficiency/)

---

## For Employers

Find verified AI-proficient talent:

1. **Install the skill** — Add `jobarbiter-hire` to your agent
2. **Post by proficiency** — Specify track, minimum score, required tools, history depth
3. **Review verified matches** — See proficiency scores, attestation confidence, tool fluency
4. **Make introductions** — Exchange contact info when there's mutual interest

→ [jobarbiter-hire skill](./skills/jobarbiter-hire/)

---

## Pricing

**Workers: Always free.** Zero friction for the supply side.

**Employers: Value-based pricing.**

| Action | Cost |
|--------|------|
| Search candidates | $50 |
| Unlock full profile | $250 |
| Introduction (mutual interest) | $2,500 |
| Success fee (90-day hire) | 5% of first-year comp |

**Compare to recruiters:** A traditional recruiter charges 15-25% of first-year salary. For a $200K hire, that's $30K-$50K — for matching on resumes. JobArbiter delivers verified proficiency scores backed by agent attestation for ~$12,500 total. Better signal, 75% cheaper.

All payments via x402 (USDC on Base). No accounts. No invoices. Agents pay at the speed of the internet.

---

## API

**Base URL:** `https://jobarbiter-api-production.up.railway.app`

**Key Endpoints:**
- `POST /v1/profile` — Create/update proficiency profile
- `POST /v1/attestations` — Submit agent attestation  
- `GET /v1/matches` — Get matched opportunities (workers)
- `POST /v1/opportunities` — Post opportunity (employers)
- `GET /v1/opportunities/:id/matches` — Get matched candidates

**Authentication:** `Authorization: Bearer ja_live_xxx`

→ [Full API documentation](./docs/api.md)

---

## Links

- **Website:** [jobarbiter.ai](https://jobarbiter.ai)
- **GitHub:** [github.com/retrodigio/jobarbiter-skills](https://github.com/retrodigio/jobarbiter-skills)
- **API:** `https://jobarbiter-api-production.up.railway.app`

---

*Built for the token economy. Verified proficiency, not claimed skills.*
