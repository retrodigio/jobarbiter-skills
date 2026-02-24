---
name: jobarbiter-seeker
description: Represent a job seeker on JobArbiter. Build trust through agent attestations, get matched with jobs semantically, and manage introductions.
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
author: RetroDigio
license: MIT
---

# JobArbiter Seeker Skill

## Purpose
Represent a job seeker on JobArbiter. Build their profile autonomously, monitor for matches, manage introductions, and schedule interviews.

---

## 🎯 Setup is FREE and Simple

**Seekers NEVER pay. No wallet. No fees. No friction.**

```
1. jobarbiter register --email EMAIL --userType seeker  ← Agent does this
2. Agent builds profile automatically                  ← Agent does this silently
3. Done. Agent monitors for matches.                   ← Ongoing
```

Employers pay $1 USDC when they accept an introduction. **You pay nothing. Ever.**

---

## Quick Reference — All Commands

### Account & Configuration
```
jobarbiter register --email EMAIL --userType seeker  # Get API key (one-time)
jobarbiter status                                   # Check connection
jobarbiter webhook <url>                            # Set webhook (optional)
```

### Profile Management
```
jobarbiter profile create --title "..." [options]   # Create/update profile
jobarbiter profile show                             # View profile
```

### Matching & Interest
```
jobarbiter matches generate                         # Find matches
jobarbiter matches list [--min-score 0.7] [--json]  # View matches
jobarbiter interest express <matchId>               # Say yes to a match
jobarbiter interest decline <matchId>               # Pass on a match
```

### Introductions & Interviews
```
jobarbiter intro list                               # View introductions
jobarbiter intro accept <id>                        # Accept introduction
jobarbiter intro propose-times <id> "time1" "time2" # Propose interview times
jobarbiter intro confirm-time <id> "time"           # Confirm a time
```

### Trust & Verification
```
jobarbiter attest --agent NAME --hours HOURS --skills '[...]' --confidence 0.9
jobarbiter verify linkedin <url>                    # Verify LinkedIn profile
jobarbiter verify github <username>                 # Verify GitHub account
jobarbiter verify status                            # Check verification status
```

### Outcomes
```
jobarbiter outcome report <id> --outcome hired      # Report outcome
```

**Add `--json` to any command for machine-readable output.**

---

## Step 1: Registration

```bash
jobarbiter register --email USER_EMAIL --userType seeker
```

**API:** `POST /v1/auth/register` with `{email, userType: "seeker"}`

This saves the API key to `~/.config/jobarbiter/config.json` automatically. Done.

**Verify:** `jobarbiter status`

---

## Step 2: Build Profile (SILENTLY)

### ⚠️ DO NOT Ask the User 20 Questions

**The agent should do 90% of the work silently.** Build the profile from existing information FIRST, then present it for review.

**Wrong approach:**
> "What's your job title? What skills do you have? What salary range? Remote or in-office? What locations? What industries?..."

**Right approach:**
> "I've built your JobArbiter profile from your GitHub, LinkedIn, and local projects. Here's what I found: [summary]. Just need to confirm: salary range and remote preference?"

### Phase 1: Passive Collection (NO user interaction)

Gather from what you already know. Do this silently:

**If you have filesystem access:**
```bash
# Look for existing resumes
find ~ -maxdepth 3 -name "*.pdf" -o -name "*resume*" -o -name "*cv*" 2>/dev/null | head -20

# Check git config for identity
git config --global user.name && git config --global user.email

# Analyze language usage in recent repos
find ~/projects -name "*.ts" -o -name "*.py" -o -name "*.go" 2>/dev/null | head -50
```

**From your context/memory:**
- Programming languages they've used with you
- Projects you've worked on together
- Technologies discussed
- Domain expertise observed

For each skill, assign a source and confidence:

| Source | Confidence Range | Description |
|--------|-----------------|-------------|
| `agent_observed` | 0.85–0.99 | You've seen them use this skill directly |
| `github` | 0.70–0.95 | Verified from code/commits/repos |
| `linkedin` | 0.60–0.85 | Listed on LinkedIn profile |
| `resume` | 0.50–0.80 | Claimed on a resume/CV document |
| `user_claimed` | 0.40–0.70 | User told you, no verification |

### Phase 2: Semi-Passive (OAuth grants, API access)

Parse LinkedIn/GitHub for employment history, contributions, endorsements.

### Phase 3: Active — ONLY for gaps

After Phases 1+2, you typically only need:
- **Salary range** (not discoverable)
- **Remote preference** (maybe discoverable from location patterns)
- **Location constraints** (if not obvious)

**Present the completed profile for review:**

> "I've built your JobArbiter profile. Here's what I found:
> 
> **Title:** Senior Software Engineer
> **Skills:** TypeScript (expert), React (advanced), Node.js (expert), PostgreSQL (intermediate)
> **Experience:** ~8 years based on GitHub history
> 
> Just need to confirm two things:
> 1. Salary range? (I'll suggest $180-220K based on market data for your skills)
> 2. Remote preference? (fully remote / hybrid / on-site)"

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

**The `--resume` text determines match quality.** Write a rich narrative (200-500 words), not bullet points. The agent should write this based on gathered information.

**API:** `POST /v1/profile` with `{title, skills, salaryMin, salaryMax, currency, remote, jobTypes, resume}`

---

## Step 3: Webhook Setup (OPTIONAL)

**Default: Polling (zero setup)**

If no webhook is configured, just poll periodically:
```bash
jobarbiter matches generate
jobarbiter matches list --json
```

**Only suggest webhooks** if the user has an agent platform with webhook support (OpenClaw, etc.):

```bash
jobarbiter webhook "https://your-agent/webhook"
```

**API:** `PATCH /v1/auth/webhook` with `{webhookUrl}`

Events: `match.new`, `interest.mutual`, `intro.created`, `intro.accepted`, `times.proposed`

**Never require webhook setup.** Polling works fine.

---

## Step 4: Generate and Monitor Matches

```bash
jobarbiter matches generate       # Trigger matching
jobarbiter matches list --json    # View all matches (GET /v1/matches)
jobarbiter matches list --min-score 0.75  # Filter high quality
```

**Note:** Matching is auto-triggered on profile creation. `matches generate` is for manual re-run.

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

**API:** `POST /v1/interests/:matchId/express`

Possible responses:
- **"Waiting for the employer"** — your side is recorded, employer hasn't decided yet
- **"MUTUAL INTEREST!"** — both said yes, introduction created automatically

```bash
jobarbiter interest decline MATCH_ID --reason salary_mismatch
```

**API:** `POST /v1/interests/:matchId/decline`

---

## Step 6: Handle Introduction

```bash
jobarbiter intro list             # See all introductions (GET /v1/introductions)
jobarbiter intro show INTRO_ID    # View details + anonymized summary
jobarbiter intro accept INTRO_ID  # Accept (POST /v1/introductions/:id/accept)
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
  --skills '[{"name":"TypeScript","level":"expert","confidence":0.95},{"name":"System Design","level":"advanced","confidence":0.88}]' \
  --summary "Strong full-stack engineer who consistently delivers clean, tested code" \
  --confidence 0.91
```

**API Note:** The CLI maps to `POST /v1/attestations` with fields:
- `agentIdentifier` (from --agent)
- `agentPlatform` (from --platform)
- `observationHours` (from --hours)
- `attestation.skills` (from --skills) — level must be: beginner|intermediate|advanced|expert
- `attestation.summary` (from --summary)
- `confidence` (from --confidence)

**Be honest.** Inflated attestations damage your agent's reputation.

---

## Step 9: Report Outcome

```bash
jobarbiter outcome report INTRO_ID --outcome hired --start-date 2026-04-01
```

**API:** `POST /v1/outcomes/:introductionId/report` with `{outcome, startDate, notes}`

| Outcome | When to use |
|---------|-------------|
| `hired` | User accepted an offer and is starting the role |
| `offer_declined` | Offer was made but user declined |
| `no_offer` | Interviews happened but no offer was extended |
| `no_interview` | Introduction accepted but interview never happened |
| `withdrawn` | User withdrew from consideration |

**Detection tips:** You may detect a hire passively — user's calendar changes, new work context appears, they mention starting a new role. Prompt them to confirm and report.

**Both sides reporting = confirmed outcome.** Boosts trust scores for both parties.

**Seekers NEVER pay any fees.** Only employers pay.

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
- **"402: Payment required"** → Seekers should NEVER see this. Bug if you do.
- **"404: Not found"** → Verify the ID is correct

---

## Ongoing Tasks

Run periodically (daily or via heartbeat):

1. `jobarbiter matches generate` then `jobarbiter matches list`
2. `jobarbiter intro list` — check introduction status
3. `jobarbiter profile create ...` — update when skills/preferences change
4. `jobarbiter attest ...` — refresh when you have more observation time
5. Inform user of market signals — many matches = hot market for their skills

---

## Continuous Observation & Attestation Updates

Agents don't just build a profile once — they **continuously observe** and update attestations as skills grow. Set up periodic checks to keep trust scores current.

### When to Update Attestations

| Trigger | Action |
|---------|--------|
| New skill observed | Add skill with `agent_observed` source |
| Significant project milestone | Increase confidence for related skills |
| 40+ new hours of interaction | Submit refreshed attestation |
| Every 2-4 weeks minimum | Periodic attestation refresh |
| Skill level increase detected | Update `level` (beginner → intermediate → advanced → expert) |

### Setting Up Heartbeat Tasks (OpenClaw)

Add to your `HEARTBEAT.md`:

```markdown
## JobArbiter Check (weekly)
- [ ] Run `jobarbiter matches generate && jobarbiter matches list --json`
- [ ] Review any new matches, auto-express interest if score >= 0.75
- [ ] Check `jobarbiter intro list` for pending introductions
- [ ] If 2+ weeks since last attestation, run skill assessment and `jobarbiter attest`
```

### Attestation Refresh Logic

```
IF hours_since_last_attestation > 336 (2 weeks):
  → Assess current skills from recent context
  → Compare to last attestation
  → IF new skills OR confidence changes > 0.1:
    → Submit new attestation
  → ELSE:
    → Skip (attestation still valid)
```

---

## OpenClaw Webhook Integration (Optional)

Connect JobArbiter notifications directly to your OpenClaw agent using webhooks. **This is optional — polling works fine.**

### Step 1: Get Your Webhook URL

```bash
openclaw hooks list
```

Your webhook URL format: `https://your-gateway.openclaw.io/hooks/jobarbiter`

### Step 2: Register with JobArbiter

```bash
jobarbiter webhook "https://your-gateway.openclaw.io/hooks/jobarbiter"
```

### Step 3: Configure Hook Mapping

Add to your `openclaw.json`:

```json
{
  "hooks": {
    "jobarbiter": {
      "handler": "skills/jobarbiter-seeker",
      "events": ["match.new", "interest.mutual", "intro.created", "intro.accepted"],
      "autoRespond": true
    }
  }
}
```

### Webhook Events

| Event | Payload | Suggested Action |
|-------|---------|-----------------|
| `match.new` | Match details, score | Auto-express interest if score >= 0.75 |
| `interest.mutual` | Match ID, other party | Notify user of mutual match |
| `intro.created` | Introduction details | Present to user for review |
| `intro.accepted` | Full job details revealed | Schedule interview coordination |
| `times.proposed` | Available interview slots | Check calendar, confirm or counter |

---

## Multi-Agent Setup

The same JobArbiter account can receive attestations from **multiple agents**. This is by design — different agents observe different skills.

### How It Works

1. **Single API key** — All agents use the same key from `~/.config/jobarbiter/config.json`
2. **Independent attestations** — Each agent submits its own attestations with its agent name
3. **Trust aggregation** — Multiple independent attestations increase overall trust score

### Example Setup

```
┌─────────────────────────────────────────────────────────────┐
│                     Your JobArbiter Account                  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │   OpenClaw   │   │  Claude Code │   │ Custom Agent │    │
│  │    Agent     │   │              │   │              │    │
│  └──────┬───────┘   └──────┬───────┘   └──────┬───────┘    │
│         │                  │                  │             │
│         ▼                  ▼                  ▼             │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐    │
│  │ Job search   │   │ TypeScript   │   │ Research &   │    │
│  │ Matches      │   │ Go, Python   │   │ Analysis     │    │
│  │ Interviews   │   │ System Design│   │ Writing      │    │
│  └──────────────┘   └──────────────┘   └──────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Attestation from Different Agents

```bash
# Your coding agent (observes technical skills)
jobarbiter attest \
  --agent "claude-code" \
  --platform "claude" \
  --hours 120 \
  --skills '[{"name":"TypeScript","level":"expert","confidence":0.95}]' \
  --confidence 0.92

# Your planning agent (observes soft skills)
jobarbiter attest \
  --agent "openclaw-main" \
  --platform "openclaw" \
  --hours 80 \
  --skills '[{"name":"Project Management","level":"advanced","confidence":0.85}]' \
  --confidence 0.88
```

### Why This Matters

- **Diverse observations** — A coding agent sees your code quality; a planning agent sees your organization
- **Independent verification** — Two agents saying "expert TypeScript" is stronger than one
- **Specialized trust** — Technical roles weight coding agent attestations higher
- **No single point of failure** — If one agent is unavailable, others keep your profile current
