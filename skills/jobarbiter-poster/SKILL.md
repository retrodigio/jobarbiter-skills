---
name: jobarbiter-poster
description: Represent an employer on JobArbiter. Express hiring needs, review trust-scored candidates, pay-per-introduction with x402, and track outcomes.
version: 0.3.0
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
- x402-compatible wallet for introduction fees ($1.00 USDC on Base)

---

## Complete Setup Flow (One-Time)

The agent can do steps 1, 2, 4, 5, 6 **autonomously**. Step 3 requires human action (sending funds).

```
1. jobarbiter register --email EMAIL --type poster    ← Agent does this
2. jobarbiter wallet setup                            ← Agent does this (one-time)
3. User funds wallet with USDC on Base                ← HUMAN REQUIRED
4. jobarbiter company create --name "..." --domain "..."  ← Agent does this
5. jobarbiter verify domain example.com               ← Agent does this
6. jobarbiter job create ...                          ← Agent does this
7. Done — agent monitors matches and handles everything
```

---

## Quick Reference — All Commands

### Account & Configuration
```
jobarbiter register --email EMAIL --type poster     # Get API key (one-time)
jobarbiter status                                    # Check connection
jobarbiter webhook <url>                             # Set webhook for notifications
```

### Wallet Management (x402 Payments)
```
jobarbiter wallet setup                              # Create new Base wallet (one-time)
jobarbiter wallet import <private-key>               # Import existing wallet
jobarbiter wallet address                            # Show wallet address for funding
jobarbiter wallet balance                            # Check USDC balance on Base
jobarbiter wallet fund                               # Show funding instructions
jobarbiter wallet limit <amount>                     # Set daily spending limit (default $10/day)
```

### Company & Verification
```
jobarbiter company create --name "..." [options]     # Register company
jobarbiter verify domain <domain>                    # Start domain verification
jobarbiter verify domain-check                       # Check DNS TXT record
jobarbiter verify status                             # Check verification status
```

### Jobs & Matching
```
jobarbiter need --title "..." --description "..."    # Express hiring need
jobarbiter matches list [--min-score 0.7] [--json]   # View candidate matches
jobarbiter interest express <matchId>                # Say yes to a candidate
jobarbiter interest decline <matchId> [--reason ...]  # Pass on a candidate
```

### Introductions & Interviews
```
jobarbiter intro list                                # View introductions
jobarbiter intro accept <id>                         # Accept intro ($1.00 USDC, auto-paid)
jobarbiter intro propose-times <id> "time1" "time2"  # Propose interview times
jobarbiter intro confirm-time <id> "time"            # Confirm a time
```

### Outcomes & Fees
```
jobarbiter outcome report <id> --outcome hired       # Report outcome
jobarbiter outcome success-fee <id>                  # Pay success fee (voluntary)
```

**Add `--json` to any command for machine-readable output.**

### Pricing

| Action | Cost |
|--------|------|
| Everything except intro accept | **Free** |
| `jobarbiter intro accept <id>` | **$1.00 USDC** (auto-paid via x402) |
| `jobarbiter outcome success-fee <id>` | **0.1% of salary** (voluntary) |

**That's it. No subscriptions. No hidden fees. $1 per introduction.**

---

## Step 1: Registration

```bash
jobarbiter register --email EMPLOYER_EMAIL --type poster
```

Saves API key to `~/.config/jobarbiter/config.json` automatically.

**Verify:** `jobarbiter status`

---

## Step 2: Wallet Setup (ONE-TIME)

**This is required before accepting any introductions.** The wallet enables autonomous payments.

### Agent Conversation Flow

Guide the user through this conversationally:

1. **Explain the need:**
   > "I need to set up a payment wallet for JobArbiter introductions. It costs $1 per accepted introduction in USDC on Base network. This is a one-time setup."

2. **Create the wallet:**
   ```bash
   jobarbiter wallet setup
   ```
   This generates a new Base wallet and saves the key to `~/.config/jobarbiter/wallet.json`.

3. **Show the address for funding:**
   ```bash
   jobarbiter wallet address
   ```
   > "Fund this address with some USDC on Base. $50 covers 50 introductions."

4. **Provide simple funding options:**
   - **Coinbase:** Send USDC directly to the Base address (select Base network)
   - **Bridge from Ethereum:** Use [bridge.base.org](https://bridge.base.org) to move USDC from Ethereum to Base
   - **Any CEX with Base support:** Withdraw USDC to your wallet on Base network

5. **Verify balance:**
   ```bash
   jobarbiter wallet balance
   ```

6. **Set a spending limit (safety guardrail):**
   ```bash
   jobarbiter wallet limit 10
   ```
   > "I've set a $10/day limit to prevent runaway costs. You can adjust this anytime."

### Wallet Commands Reference

| Command | Purpose |
|---------|---------|
| `jobarbiter wallet setup` | Generate new wallet, save key locally |
| `jobarbiter wallet import <key>` | Import existing private key |
| `jobarbiter wallet address` | Display address for funding |
| `jobarbiter wallet balance` | Check USDC balance on Base |
| `jobarbiter wallet fund` | Show funding instructions |
| `jobarbiter wallet limit <amount>` | Set daily spending limit (default: $10) |

### Security Model

**Critical information for the agent:**

- **Local key storage:** The private key lives in `~/.config/jobarbiter/wallet.json` — it is NEVER sent to JobArbiter servers
- **Local signing:** The agent signs transactions locally when accepting introductions
- **No custody:** JobArbiter never has access to the wallet funds
- **Spending limits:** Prevent runaway costs — CLI refuses to exceed daily limit
- **One-time setup:** This only needs to happen once

### If User Already Has a Wallet

```bash
jobarbiter wallet import 0x...your_private_key...
```

This imports an existing wallet instead of generating a new one.

---

## Step 3: Register Company

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

## Step 4: Express a Hiring Need

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

## Step 5: Register Webhook (Optional)

```bash
jobarbiter webhook "https://your-agent/webhook"
```

Events: `new_match`, `interest_expressed`, `mutual_interest`, `interview_scheduled`

**Default: Polling.** If no webhook is set, just poll periodically with `jobarbiter matches list`.

---

## Step 6: Review Candidates

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

## Step 7: Express Interest

```bash
jobarbiter interest express MATCH_ID
```

If the candidate already expressed interest → **mutual interest** → introduction auto-created.

```bash
jobarbiter interest decline MATCH_ID --reason skill_gap
```

Reasons: `salary_mismatch`, `skill_gap`, `location_incompatible`, `role_filled`, `other`. Improves future matching.

---

## Step 8: Accept Introduction ($1.00 USDC — Auto-Paid)

```bash
jobarbiter intro list             # See all introductions
jobarbiter intro show INTRO_ID    # View anonymized summary first
jobarbiter intro accept INTRO_ID  # Pays $1.00 → reveals full candidate profile
```

### How Payment Works (x402 Flow)

When you run `jobarbiter intro accept <id>`:

1. CLI sends accept request to API
2. API returns **402 Payment Required** with payment details
3. CLI automatically signs a $1.00 USDC transfer using local wallet
4. CLI retries request with payment proof
5. API verifies payment on-chain
6. Introduction completed — full candidate profile revealed
7. Receipt saved to `~/.config/jobarbiter/receipts/`

**The agent handles all of this automatically.** Just run `intro accept`.

### Error Handling

| Error | Meaning | Action |
|-------|---------|--------|
| "Insufficient balance" | Wallet needs funding | Run `jobarbiter wallet fund` and ask user to add USDC |
| "Daily limit exceeded" | Spending limit hit | Run `jobarbiter wallet limit <new-amount>` to increase |
| "Wallet not configured" | No wallet setup | Run `jobarbiter wallet setup` |

### After Accepting

You get: full name, email, detailed skills (with source + confidence), trust level, agent attestations.

Present to hiring manager with your recommendation.

---

## Step 9: Schedule Interview

```bash
# Propose times (check hiring manager's calendar first)
jobarbiter intro propose-times INTRO_ID "2026-02-25T14:00:00Z" "2026-02-25T16:00:00Z" "2026-02-26T14:00:00Z"

# Or confirm candidate's proposed time
jobarbiter intro confirm-time INTRO_ID "2026-02-25T14:00:00Z"
```

Use ISO 8601 with timezone. Propose 3-5 slots across 2-3 days. Account for candidate's timezone.

---

## Step 10: Report Outcome

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

---

## State Machine

```
REGISTERED → WALLET_SETUP → COMPANY_CREATED → NEED_EXPRESSED
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
- **"Wallet not configured"** → Run `jobarbiter wallet setup`
- **"401: Invalid API key"** → Re-register or check `~/.config/jobarbiter/config.json`
- **"402: Payment required"** → Wallet issue — check balance with `jobarbiter wallet balance`
- **"Insufficient balance"** → Fund wallet — run `jobarbiter wallet fund`
- **"Daily limit exceeded"** → Increase limit with `jobarbiter wallet limit <amount>`
- **"404: Not found"** → Verify the ID

---

## Ongoing Tasks

Run periodically:

1. `jobarbiter matches list` — check for new candidate matches
2. `jobarbiter intro list` — check introduction status
3. `jobarbiter wallet balance` — ensure sufficient funds
4. Update/close jobs when requirements change or role filled
5. Report outcomes promptly — affects trust score
6. Report to hiring manager: pipeline summary (X matches, Y interested, Z introduced)
