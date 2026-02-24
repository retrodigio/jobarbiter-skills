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

### 1. Install the CLI

```bash
npm install -g @jobarbiter/cli
```

### 2. Register

```bash
jobarbiter register --email you@example.com --type worker
```

### 3. Create Your Profile

```bash
jobarbiter profile create \
  --bio "Senior engineer specializing in AI orchestration" \
  --domains "software-engineering,data-analytics" \
  --tools '{"models":["claude","gpt-4"],"agents":["cursor"]}' \
  --compensation-min 150000 \
  --compensation-max 220000 \
  --open-to "full-time,fractional" \
  --remote remote \
  --actively-seeking
```

### 4. Have Your Agent Attest

Your AI agent submits an attestation based on what it's observed:

```bash
jobarbiter attest \
  --agent openclaw \
  --hours 500 \
  --capabilities '[{"skill":"multi-agent-orchestration","level":"advanced","confidence":0.85,"evidence":"Built autonomous research pipelines with eval loops."}]' \
  --patterns '{"orchestrationComplexity":4,"toolDiversity":5,"outputVelocity":0.8}'
```

### 5. Connect Data Sources (Optional, Boosts Confidence)

```bash
jobarbiter git connect --provider github --username yourusername
jobarbiter tokens --provider anthropic --start 2026-01-01 --end 2026-02-24 --total-tokens 25000000
```

### 6. Browse Matched Opportunities

```bash
jobarbiter opportunities list
```

### 7. Express Interest

```bash
jobarbiter interest express <matchId>
```

→ [jobarbiter-proficiency skill](./skills/jobarbiter-proficiency/)

---

## For Employers

Find verified AI-proficient talent:

### 1. Install the CLI

```bash
npm install -g @jobarbiter/cli
```

### 2. Register

```bash
jobarbiter register --email hiring@company.com --type employer
```

### 3. Post an Opportunity

```bash
jobarbiter opportunities create \
  --title "AI Platform Lead" \
  --description "Lead our AI infrastructure team" \
  --type full-time \
  --track systemsBuilder \
  --min-score 600 \
  --required-tools "claude,langchain" \
  --compensation-min 200000 \
  --compensation-max 280000 \
  --token-budget high \
  --remote
```

### 4. View Matched Candidates ($50)

```bash
jobarbiter opportunities matches <opportunityId>
```

### 5. Unlock Full Profile ($250)

```bash
jobarbiter unlock <matchId>
```

### 6. Express Interest

```bash
jobarbiter interest express <matchId>
```

### 7. Create Introduction on Mutual Interest ($2,500)

```bash
jobarbiter introduce <matchId>
```

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

## CLI Commands

```bash
# Account
jobarbiter register --email <email> --type <worker|employer>
jobarbiter status

# Profile (Workers)
jobarbiter profile show
jobarbiter profile create [options]
jobarbiter profile score
jobarbiter profile delete

# Attestation (Workers)
jobarbiter attest --agent <name> --capabilities <json> [options]
jobarbiter git connect --provider <github|gitlab> --username <user>
jobarbiter tokens --provider <anthropic|openai> --start <date> --end <date>

# Opportunities
jobarbiter opportunities list
jobarbiter opportunities show <id>
jobarbiter opportunities create [options]     # Employers
jobarbiter opportunities matches <id>         # Employers, $50

# Matching
jobarbiter interest express <matchId>
jobarbiter interest decline <matchId>
jobarbiter unlock <matchId>                   # Employers, $250
jobarbiter introduce <matchId>                # $2,500

# Introductions
jobarbiter intro list
jobarbiter intro show <id>

# Credentials
jobarbiter credentials list
jobarbiter credentials mint                   # $25
jobarbiter credentials show <id>

# Verification
jobarbiter verify github <username>
jobarbiter verify linkedin <url>
```

Add `--json` to any command for machine-readable output.

---

## API

**Base URL:** `https://jobarbiter-api-production.up.railway.app`

**Authentication:** `Authorization: Bearer ja_live_xxx`

The CLI wraps the REST API. For direct API access, see the [API documentation](./docs/api.md).

---

## Links

- **Website:** [jobarbiter.ai](https://jobarbiter.ai)
- **GitHub:** [github.com/retrodigio/jobarbiter-skills](https://github.com/retrodigio/jobarbiter-skills)
- **API:** `https://jobarbiter-api-production.up.railway.app`
- **CLI:** `npm install -g @jobarbiter/cli`

---

*Built for the token economy. Verified proficiency, not claimed skills.*
