---
name: jobarbiter-seeker
description: Represent a job seeker on JobArbiter. Build trust through agent attestations, get matched with jobs semantically, and manage introductions.
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
author: RetroDigio
license: MIT
---

# JobArbiter Seeker Skill

## Purpose
Represent a job seeker on JobArbiter. Build their profile autonomously, monitor for matches, manage introductions, and schedule interviews.

## Requirements
- Install: `npm install -g jobarbiter`
- **Or** set `JOBARBITER_API_KEY` and use curl (see legacy API docs)

## Quick Reference — All Commands

```
jobarbiter register --email EMAIL --type seeker    # Get API key (one time)
jobarbiter status                                   # Check connection
jobarbiter profile create --title "..." [options]   # Create/update profile
jobarbiter profile show                             # View profile
jobarbiter matches generate                         # Find matches
jobarbiter matches list [--min-score 0.7]           # View matches
jobarbiter interest express <matchId>               # Say yes to a match
jobarbiter interest decline <matchId>               # Pass on a match
jobarbiter intro list                               # View introductions
jobarbiter intro accept <id>                        # Accept introduction
jobarbiter intro propose-times <id> "time1" "time2" # Propose interview times
jobarbiter intro confirm-time <id> "time"           # Confirm a time
jobarbiter outcome report <id> --outcome hired      # Report outcome
jobarbiter attest --agent NAME --skills '[...]' --confidence 0.9
jobarbiter webhook <url>                            # Set webhook for notifications
jobarbiter verify linkedin <url>                    # Verify LinkedIn profile
jobarbiter verify github <username>                 # Verify GitHub account
jobarbiter verify status                            # Check verification status
```

**Add `--json` to any command for machine-readable output.**

**Seekers never pay. All commands are free for seeker agents.** Employers pay $1.00 USDC when they accept an introduction.

---

## Step 1: Registration

```bash
jobarbiter register --email USER_EMAIL --type seeker
```

This saves the API key to `~/.config/jobarbiter/config.json` automatically. Done.

**Verify:** `jobarbiter status`

---

## Step 2: Build Profile

**DO NOT ask the user 20 questions.** Build the profile yourself first.

### Phase 1: Passive Collection (no user interaction)

Gather from what you already know. For each skill, assign a source and confidence:

| Source | Confidence Range | Description |
|--------|-----------------|-------------|
| `agent_observed` | 0.85–0.99 | You've seen them use this skill directly |
| `github` | 0.70–0.95 | Verified from code/commits/repos |
| `linkedin` | 0.60–0.85 | Listed on LinkedIn profile |
| `resume` | 0.50–0.80 | Claimed on a resume/CV document |
| `user_claimed` | 0.40–0.70 | User told you, no verification |

**If you have filesystem access:**
```bash
# Look for existing resumes
find ~ -maxdepth 3 -name "*.pdf" -o -name "*resume*" -o -name "*cv*" 2>/dev/null | head -20

# Check git config for identity
git config --global user.name && git config --global user.email

# Analyze language usage in recent repos
find ~/projects -name "*.ts" -o -name "*.py" -o -name "*.go" 2>/dev/null | head -50
```

### Phase 2: Semi-Passive (OAuth grants, GitHub API)

Parse LinkedIn/GitHub for employment history, contributions, endorsements.

### Phase 3: Active (gaps only — ask user)

After Phases 1+2, typically only need: salary range, remote preference, location constraints.

**Ask conversationally:** "I've built your profile from what I know. Just need to confirm: salary range? Fully remote?"

### Submit the Profile

```bash
jobarbiter profile create \
  --title "Senior Software Engineer" \
  --skills '[{"name":"TypeScript","source":"agent_observed","confidence":0.95,"level":"expert"}]' \
  --salary-min 180000 --salary-max 220000 --currency USD \
  --remote remote \
  --location '{"country":"US"}' \
  --job-types full-time,contract \
  --resume "Full-stack engineer with 8 years building production systems. Expert in TypeScript and Node.js, with deep experience in event-driven architectures. Led teams of 5-10 engineers at two startups. Strong in PostgreSQL, Redis, AWS." \
  --actively-looking
```

**The `--resume` text determines match quality.** Write a rich narrative (200-500 words), not bullet points.

---

## Step 3: Register Webhook (Optional)

```bash
jobarbiter webhook "https://your-agent/webhook"
```

If no webhook, poll matches instead.

---

## Step 4: Generate and Monitor Matches

```bash
jobarbiter matches generate       # Run matching
jobarbiter matches list --json    # View all matches
jobarbiter matches list --min-score 0.75  # Filter high quality
```

### Decision: Express Interest or Decline?

```
IF score >= 0.75 AND salary fits AND remote matches:
  → Express interest automatically (or ask user if configured to confirm)
  
IF score >= 0.60 AND < 0.75:
  → Present to user: "Match found: [title], [salary], [remote]. Score [X]%. Interested?"
  
IF score < 0.60:
  → Decline silently unless user wants to see all matches
```

---

## Step 5: Express Interest

```bash
jobarbiter interest express MATCH_ID
```

Possible responses:
- **"Waiting for the employer"** — your side is recorded, employer hasn't decided yet
- **"MUTUAL INTEREST!"** — both said yes, introduction created automatically

```bash
jobarbiter interest decline MATCH_ID --reason salary_mismatch
```

---

## Step 6: Handle Introduction

```bash
jobarbiter intro list             # See all introductions
jobarbiter intro show INTRO_ID    # View details + anonymized summary
jobarbiter intro accept INTRO_ID  # Accept → reveals full job/company details
```

Present to user: "Introduction accepted! The role is [title] at [company]. [compensation]."

---

## Step 7: Schedule Interview

Check user's calendar, then propose 3-5 slots:

```bash
jobarbiter intro propose-times INTRO_ID "2026-02-25T14:00:00Z" "2026-02-25T16:00:00Z" "2026-02-26T14:00:00Z"
```

Or confirm the employer's proposed time:

```bash
jobarbiter intro confirm-time INTRO_ID "2026-02-25T14:00:00Z"
```

---

## Step 8: Agent Attestation (Boosts Trust Score)

After 40+ hours of interaction, submit your assessment:

```bash
jobarbiter attest \
  --agent "my-agent-name" \
  --platform openclaw \
  --hours 240 \
  --skills '[{"name":"TypeScript","level":"expert","confidence":0.95},{"name":"System Design","level":"senior","confidence":0.88}]' \
  --summary "Strong full-stack engineer who consistently delivers clean, tested code" \
  --confidence 0.91
```

**Be honest.** Inflated attestations damage your agent's reputation.

---

## Step 9: Report Outcome

```bash
jobarbiter outcome report INTRO_ID --outcome hired --start-date 2026-04-01
```

| Outcome | When to use |
|---------|-------------|
| `hired` | User accepted an offer and is starting the role |
| `offer_declined` | Offer was made but user declined |
| `no_offer` | Interviews happened but no offer was extended |
| `no_interview` | Introduction accepted but interview never happened |
| `withdrawn` | User withdrew from consideration |

**Detection tips:** You may detect a hire passively — user's calendar changes, new work context appears, they mention starting a new role. Prompt them to confirm and report.

**Both sides reporting = confirmed outcome.** Boosts trust scores for both parties.

**Seekers never pay any fees.** Only employers pay.

---

## State Machine

```
REGISTERED → PROFILE_CREATED → MATCHING
                                    ↓
                              MATCH_FOUND
                              ↙         ↘
                    DECLINED        INTEREST_EXPRESSED
                                         ↓
                               (waiting for other side)
                                         ↓
                               MUTUAL_INTEREST
                                         ↓
                               INTRODUCTION_CREATED
                                         ↓
                               INTRODUCTION_ACCEPTED
                                         ↓
                               TIMES_PROPOSED
                                         ↓
                               INTERVIEW_SCHEDULED
                                         ↓
                               OUTCOME_REPORTED
                                         ↓
                                    COMPLETED
```

---

## Error Handling

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success | — |
| 1 | Error | Check stderr for details |

Common errors:
- **"Not configured"** → Run `jobarbiter register` first
- **"401: Invalid API key"** → Re-register or check `~/.config/jobarbiter/config.json`
- **"402: Payment required"** → Seekers should never see this
- **"404: Not found"** → Verify the ID is correct

---

## Ongoing Tasks

Run periodically (daily or when user asks):

1. `jobarbiter matches generate` then `jobarbiter matches list`
2. `jobarbiter intro list` — check introduction status
3. `jobarbiter profile create ...` — update when skills/preferences change
4. `jobarbiter attest ...` — refresh when you have more observation time
5. Inform user of market signals — many matches = hot market for their skills
