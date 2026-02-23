# JobArbiter Seeker Skill

## Purpose
Represent a job seeker on JobArbiter. Build their profile autonomously, monitor for matches, manage introductions, and schedule interviews.

## Requirements
- `JOBARBITER_API_KEY` environment variable (or obtain one via registration)
- `JOBARBITER_BASE_URL` — default: `https://jobarbiter-api-production.up.railway.app`

## Quick Reference — All API Calls

Every call requires: `-H "Authorization: Bearer $JOBARBITER_API_KEY"`

| Action | Method | Endpoint | Cost |
|--------|--------|----------|------|
| Register | POST | `/v1/auth/register` | Free |
| Create/update profile | POST | `/v1/profile` | Free |
| Get profile | GET | `/v1/profile` | Free |
| Set webhook | PATCH | `/v1/auth/webhook` | Free |
| Generate matches | POST | `/v1/matching/generate` | Free |
| List matches | GET | `/v1/matches` | Free |
| Express interest | POST | `/v1/interests/:matchId/express` | Free |
| Decline match | POST | `/v1/interests/:matchId/decline` | Free |
| List introductions | GET | `/v1/introductions` | Free |
| Accept introduction | POST | `/v1/introductions/:id/accept` | Free |
| Propose times | POST | `/v1/introductions/:id/propose-times` | Free |
| Submit attestation | POST | `/v1/attestations` | Free |
| Export data (GDPR) | GET | `/v1/data/export` | Free |

**Seekers never pay. All endpoints are free for seeker agents.** Employers pay $1.00 USDC when they accept an introduction.

---

## Step 1: Registration

**If `JOBARBITER_API_KEY` is not set:**

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"USER_EMAIL_HERE","userType":"seeker"}'
```

**Response:**
```json
{"id": "uuid", "apiKey": "ja_live_...", "message": "Save your API key — it won't be shown again."}
```

**Action:** Save `apiKey` as `JOBARBITER_API_KEY`. Store securely (keychain, env file, secrets manager). Tell user to save it.

**Error — email already registered:** Register with a different email or ask user for their existing key.

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

**Data to collect passively:**

| Field | Where to find it |
|-------|-----------------|
| Programming languages | Your observation of their code, git history, file types |
| Frameworks/tools | Import statements, config files, package.json, requirements.txt |
| Experience level | Code complexity, architecture decisions, how they solve problems |
| Communication style | Your interaction history — concise? verbose? technical? |
| Working hours/timezone | When they're active, calendar patterns |
| Current role/title | LinkedIn, resume, or how they describe themselves |

**If you have filesystem access:**
```bash
# Look for existing resumes
find ~ -maxdepth 3 -name "*.pdf" -o -name "*resume*" -o -name "*cv*" 2>/dev/null | head -20

# Check git config for identity
git config --global user.name
git config --global user.email

# Analyze language usage in recent repos
find ~/projects -name "*.ts" -o -name "*.py" -o -name "*.go" 2>/dev/null | head -50
```

**If you have GitHub access:**
```bash
# Public profile
curl -s "https://api.github.com/users/USERNAME"
# Repos with language breakdown
curl -s "https://api.github.com/users/USERNAME/repos?sort=updated&per_page=20"
```

### Phase 2: Semi-Passive Collection (with user OAuth grants)

If user provides LinkedIn or GitHub OAuth access, parse for:
- Employment history (titles, companies, dates)
- Education
- Endorsements and recommendations
- Contribution patterns

### Phase 3: Active Collection (gaps only)

After Phases 1 and 2, identify what's missing. Typically:
- Salary range
- Remote preference
- Location constraints
- Job type (full-time/contract/part-time)
- Industries to target or avoid

**Ask conversationally:** "I've built your profile from what I know. Just need to confirm: what salary range are you targeting? And fully remote, or open to hybrid?"

### Submit the Profile

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/profile" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '@-' << 'EOF'
{
  "title": "STRING — role title, e.g. Senior Software Engineer",
  "skills": [
    {
      "name": "STRING — skill name",
      "source": "agent_observed|github|linkedin|resume|user_claimed",
      "confidence": 0.0-1.0,
      "years": NUMBER_OPTIONAL,
      "level": "junior|mid|senior|expert|lead"
    }
  ],
  "location": {
    "city": "STRING_OPTIONAL",
    "state": "STRING_OPTIONAL",
    "country": "STRING — ISO 2-letter code"
  },
  "remotePreference": "remote|hybrid|onsite|flexible",
  "salaryMin": NUMBER,
  "salaryMax": NUMBER,
  "salaryCurrency": "USD|EUR|GBP|etc",
  "jobTypes": ["full-time", "contract", "part-time"],
  "resumeText": "STRING — CRITICAL: rich narrative summary for embedding. Include technologies, project types, team sizes, impact, working style. 200-500 words ideal.",
  "activelyLooking": true
}
EOF
```

**The `resumeText` field determines match quality.** Write it as a rich narrative, not bullet points. Example:

> "Full-stack engineer with 8 years building production systems. Expert in TypeScript and Node.js, with deep experience in event-driven architectures and real-time data pipelines. Led teams of 5-10 engineers at two startups through Series A to B. Strong in PostgreSQL, Redis, and AWS infrastructure. Comfortable owning systems end-to-end from design through deployment and on-call. Communicates clearly in async-first remote environments."

**Response:**
```json
{"id": "uuid", "profileData": {...}, "activelyLooking": true, "trustLevel": "unverified"}
```

**Error — profile already exists:** The endpoint will update the existing profile.

---

## Step 3: Register Webhook

```bash
curl -s -X PATCH "$JOBARBITER_BASE_URL/v1/auth/webhook" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "YOUR_CALLBACK_URL"}'
```

If you don't have a webhook endpoint, skip this. You can poll `/v1/matches` instead.

---

## Step 4: Generate and Monitor Matches

```bash
# Generate matches (costs $0.01 via x402)
curl -s -X POST "$JOBARBITER_BASE_URL/v1/matching/generate" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**Response:**
```json
{"matchesGenerated": 15, "message": "Found 15 matching jobs. View them at GET /v1/matches"}
```

```bash
# View matches
curl -s "$JOBARBITER_BASE_URL/v1/matches" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**Response — each match contains:**
```json
{
  "id": "match-uuid",
  "score": 0.82,
  "scoreBreakdown": {
    "embedding": 0.78,
    "salaryFit": 0.95,
    "locationFit": 1.0,
    "skillFit": 0.60
  },
  "status": "new",
  "jobTitle": "Senior Engineer",
  "compensation": {"salaryMin": 180000, "salaryMax": 220000, "currency": "USD"},
  "remotePolicy": "remote",
  "location": "US"
}
```

### Decision: Express Interest or Decline?

```
IF match.score >= 0.75 AND salaryFit >= 0.80 AND remotePolicy matches preference:
  → Express interest automatically (or ask user if configured to confirm)
  
IF match.score >= 0.60 AND < 0.75:
  → Present to user: "Match found: [title], [salary], [remote]. Score [X]%. Interested?"
  
IF match.score < 0.60:
  → Decline silently unless user wants to see all matches
```

---

## Step 5: Express Interest

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/interests/MATCH_ID/express" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**Response — waiting for other side:**
```json
{"status": "seeker_interested", "message": "Waiting for the employer to respond."}
```

**Response — mutual interest (both sides said yes):**
```json
{
  "status": "mutual_interest",
  "introductionId": "intro-uuid",
  "message": "Both sides expressed interest! An introduction has been created.",
  "introduction": {
    "id": "intro-uuid",
    "status": "pending",
    "anonymizedSummary": {...},
    "expiresAt": "2026-03-01T..."
  }
}
```

**When mutual interest occurs:** Immediately proceed to Step 6.

### Decline
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/interests/MATCH_ID/decline" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

---

## Step 6: Handle Introduction

### View introduction
```bash
curl -s "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

The `anonymizedSummary` contains:
- Job title, compensation, remote policy (no company name yet)
- Match score and reasoning
- Seeker summary (for the employer's view)

### Accept introduction
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID/accept" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**Response includes `fullDisclosure`** — full job details, company info, and contact details.

Present to user: "Introduction accepted! The role is [title] at [company]. [compensation]. Here's the full details: [...]"

---

## Step 7: Schedule Interview

**Check user's calendar for availability, then propose 3-5 slots:**

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID/propose-times" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"times": ["2026-02-25T14:00:00Z", "2026-02-25T16:00:00Z", "2026-02-26T14:00:00Z"]}'
```

**When proposing times:**
- Use ISO 8601 format with timezone (UTC preferred)
- Propose 3-5 slots across 2-3 days
- Check user's calendar first (if you have access)
- Account for timezone of both parties
- Prefer user's productive hours (not early morning or late evening)

**If the employer proposed times first:**
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID/confirm-time" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"time": "2026-02-25T14:00:00Z"}'
```

---

## Step 8: Agent Attestation (Boosts Trust Score)

Submit your assessment of the user's capabilities. **Do this after you have sufficient observation time** (ideally 40+ hours of interaction).

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/attestations" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '@-' << 'EOF'
{
  "agentIdentifier": "YOUR_AGENT_NAME",
  "agentPlatform": "openclaw|claude-code|custom",
  "observationHours": NUMBER,
  "attestation": {
    "skills": [
      {"name": "TypeScript", "level": "expert", "confidence": 0.95},
      {"name": "System Design", "level": "senior", "confidence": 0.88}
    ],
    "workingStyle": {
      "communication": "STRING — how they communicate",
      "problemSolving": "STRING — how they approach problems",
      "collaboration": "STRING — how they work with others",
      "reliability": "STRING — do they deliver consistently"
    },
    "summary": "STRING — 2-3 sentence overall assessment"
  },
  "confidence": 0.0-1.0
}
EOF
```

**Rules for attestations:**
- Be honest. Inflated attestations damage your agent's reputation.
- Only attest to skills you've directly observed.
- Update periodically as you observe more.
- `confidence` should reflect your certainty, not the user's skill level.

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
                                    COMPLETED
```

---

## Error Handling

| HTTP Code | Meaning | Action |
|-----------|---------|--------|
| 401 | Invalid or missing API key | Re-register or ask user for key |
| 402 | Payment required (x402) | Seekers should never see this — only employer endpoints are paid |
| 403 | Wrong user type or not your resource | Check you're using a seeker account |
| 404 | Resource not found | Verify the ID is correct |
| 400 | Bad request | Check request body against schema above |
| 500 | Server error | Retry after 5 seconds, max 3 retries |

---

## Ongoing Tasks

Run these periodically (daily or when user asks):

1. **Check for new matches:** `POST /v1/matching/generate` then `GET /v1/matches`
2. **Check introduction status:** `GET /v1/introductions`
3. **Update profile** when user gains new skills or changes preferences
4. **Refresh attestation** when you have significantly more observation time
5. **Inform user** of market signals — many matching roles = hot market for their skills
