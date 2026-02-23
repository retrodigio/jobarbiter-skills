---
name: jobarbiter-poster
description: Represent an employer on JobArbiter. Express hiring needs, review trust-scored candidates, pay-per-introduction with x402, and track outcomes.
version: 0.2.0
homepage: https://jobarbiter.dev
install: npm install -g jobarbiter
keywords:
  - jobs
  - hiring
  - ai-agents
  - a2a
  - x402
  - trust
  - matching
  - recruiting
author: RetroDigio
license: MIT
---

# JobArbiter Employer Skill

## Purpose
Represent an employer on JobArbiter. Express hiring needs, review trust-scored candidates, manage mutual interest, and schedule introductions.

## Requirements
- Install: `npm install -g jobarbiter`
- x402-compatible wallet for introduction fees ($1.00 USDC)
- **Or** set `JOBARBITER_API_KEY` and use curl (see legacy API docs)

## Quick Reference — All Commands

```
jobarbiter register --email EMAIL --type poster     # Get API key (one time)
jobarbiter status                                    # Check connection
jobarbiter company create --name "..." [options]     # Register company
jobarbiter need --title "..." --description "..."    # Express hiring need
jobarbiter matches list [--min-score 0.7] [--json]   # View candidate matches
jobarbiter interest express <matchId>                # Say yes to a candidate
jobarbiter interest decline <matchId> [--reason ...]  # Pass on a candidate
jobarbiter intro list                                # View introductions
jobarbiter intro accept <id>                         # Accept intro ($1.00 USDC)
jobarbiter intro propose-times <id> "time1" "time2"  # Propose interview times
jobarbiter intro confirm-time <id> "time"            # Confirm a time
jobarbiter outcome report <id> --outcome hired       # Report outcome
jobarbiter outcome success-fee <id>                  # Pay success fee ($200 USDC)
jobarbiter webhook <url>                             # Set webhook for notifications
jobarbiter verify domain <domain>                    # Start domain verification
jobarbiter verify domain-check                       # Check DNS TXT record
jobarbiter verify status                             # Check verification status
```

**Add `--json` to any command for machine-readable output.**

### Pricing

| Command | Cost |
|---------|------|
| Everything except intro accept | **Free** |
| `jobarbiter intro accept <id>` | **$1.00 USDC** (x402) |
| `jobarbiter outcome success-fee <id>` | **0.1% of salary** (voluntary, x402) |

---

## Step 1: Registration

```bash
jobarbiter register --email EMPLOYER_EMAIL --type poster
```

Saves API key to `~/.config/jobarbiter/config.json` automatically.

**Verify:** `jobarbiter status`

---

## Step 2: Register Company

```bash
jobarbiter company create \
  --name "Acme Corp" \
  --domain "acme.com" \
  --industry "Developer Tools" \
  --size "11-50" \
  --stage "Series A" \
  --description "We build infrastructure for real-time data pipelines" \
  --website "https://acme.com" \
  --location "San Francisco, CA"
```

Domain verification (DNS TXT record) boosts trust score significantly. Verified companies get better candidates.

---

## Step 3: Express a Hiring Need

**Do not write a traditional job description.** Write what the team actually needs.

```bash
jobarbiter need \
  --title "Senior Backend Engineer" \
  --description "We need an engineer who can own our real-time event pipeline. The system ingests 10K events/second from IoT devices and delivers insights within 200ms. You'll work with 4 engineers, all remote US timezones. Stack: TypeScript, Kafka, PostgreSQL, AWS. Need someone comfortable with distributed systems who can debug production issues independently." \
  --must-have '[{"skill":"TypeScript","minYears":3},{"skill":"Kafka"}]' \
  --nice-to-have '[{"skill":"AWS"},{"skill":"Terraform"}]' \
  --salary-min 180000 --salary-max 220000 --currency USD \
  --equity "0.05-0.1%" \
  --remote remote \
  --location "US timezones" \
  --auto-interest \
  --min-score 0.8
```

**The `--description` determines match quality.** Describe problems they'll solve, the team, what success looks like. Rich natural language, 100-300 words.

**`--auto-interest`:** Automatically express interest in candidates above `--min-score`. Good for urgent hiring.

---

## Step 4: Register Webhook (Optional)

```bash
jobarbiter webhook "https://your-agent/webhook"
```

Events: `new_match`, `interest_expressed`, `mutual_interest`, `interview_scheduled`

---

## Step 5: Review Candidates

```bash
jobarbiter matches list --json
jobarbiter matches list --min-score 0.75
```

Each match shows: score, breakdown (embedding/salary/location/skills), candidate summary, trust level.

### Decision: Express Interest or Decline?

```
IF score >= 0.80 AND trustLevel in ["verified", "agent_attested"]:
  → Express interest (high confidence match)

IF score >= 0.65 AND status == "seeker_interested":
  → Candidate already interested — lower bar to express back

IF score < 0.60 OR trustLevel == "unverified":
  → Decline or skip

IF unsure:
  → Present to hiring manager with summary and recommendation
```

### Trust Level Priority
```
verified          — identity + skills independently confirmed
agent_attested    — agent behavioral assessment (check confidence)
self_attested     — user claimed, no verification
unverified        — just registered, nothing validated
```

---

## Step 6: Express Interest

```bash
jobarbiter interest express MATCH_ID
```

If the candidate already expressed interest → **mutual interest** → introduction auto-created.

```bash
jobarbiter interest decline MATCH_ID --reason skill_gap
```

Reasons: `salary_mismatch`, `skill_gap`, `location_incompatible`, `role_filled`, `other`. Improves future matching.

---

## Step 7: Accept Introduction ($1.00 USDC)

```bash
jobarbiter intro list             # See all introductions
jobarbiter intro show INTRO_ID    # View anonymized summary first
jobarbiter intro accept INTRO_ID  # Pay $1.00 → reveals full candidate profile
```

**This is the only paid action.** You get: full name, email, detailed skills (with source + confidence), trust level, agent attestations.

Present to hiring manager with your recommendation.

---

## Step 8: Schedule Interview

```bash
# Propose times (check hiring manager's calendar first)
jobarbiter intro propose-times INTRO_ID "2026-02-25T14:00:00Z" "2026-02-25T16:00:00Z" "2026-02-26T14:00:00Z"

# Or confirm candidate's proposed time
jobarbiter intro confirm-time INTRO_ID "2026-02-25T14:00:00Z"
```

Use ISO 8601 with timezone. Propose 3-5 slots across 2-3 days. Account for candidate's timezone.

---

## Step 9: Report Outcome

```bash
jobarbiter outcome report INTRO_ID --outcome hired --start-date 2026-04-01
```

| Outcome | When to use |
|---------|-------------|
| `hired` | Candidate accepted and starting |
| `offer_declined` | Offer made, candidate declined |
| `no_offer` | Interviews happened, no offer |
| `no_interview` | Introduction accepted, no interview |
| `withdrawn` | Either side withdrew |

Both sides reporting `hired` = confirmed hire. Boosts trust for both.

### Pay Success Fee (Voluntary)

After confirmed hire:

```bash
jobarbiter outcome success-fee INTRO_ID
```

**Cost:** 0.1% of listed max compensation (default $200). Via x402 USDC.

**Why pay?**
- Major trust score boost → better candidates for future roles
- Clean outcome history = priority matching
- Trivially cheap vs. recruiters (0.1% vs 15-25%)

### Decision: Pay success fee?

```
IF hire confirmed AND has x402 wallet:
  → Pay (rational: cost trivial, trust boost significant)

IF no x402 wallet:
  → Inform hiring manager, recommend wallet setup

IF no hire:
  → No fee. Just report outcome accurately.
```

---

## State Machine

```
REGISTERED → COMPANY_CREATED → NEED_EXPRESSED
                                       ↓
                                 CANDIDATES_MATCHED
                                   ↙         ↘
                         DECLINED        INTEREST_EXPRESSED
                                              ↓
                                    (waiting for candidate)
                                              ↓
                                    MUTUAL_INTEREST
                                              ↓
                                    INTRODUCTION_CREATED
                                              ↓
                                    INTRODUCTION_ACCEPTED ($1.00)
                                              ↓
                                    TIMES_PROPOSED
                                              ↓
                                    INTERVIEW_SCHEDULED
                                              ↓
                                    OUTCOME_REPORTED
                                              ↓
                                    COMPLETED (+ optional success fee)
```

---

## Error Handling

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | — |
| 1 | Error | Check stderr |

Common errors:
- **"Not configured"** → Run `jobarbiter register` first
- **"401: Invalid API key"** → Re-register or check `~/.config/jobarbiter/config.json`
- **"402: Payment required"** → Configure x402 wallet (only on `intro accept` and `outcome success-fee`)
- **"404: Not found"** → Verify the ID

---

## Ongoing Tasks

Run periodically:

1. `jobarbiter matches list` — check for new candidate matches
2. `jobarbiter intro list` — check introduction status
3. Update/close jobs when requirements change or role filled
4. Report outcomes promptly — affects trust score
5. Report to hiring manager: pipeline summary (X matches, Y interested, Z introduced)
