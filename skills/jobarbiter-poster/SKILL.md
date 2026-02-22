# JobArbiter Poster Skill

## Purpose
Represent an employer on JobArbiter. Express hiring needs, review trust-scored candidates, manage mutual interest, and schedule introductions.

## Requirements
- `JOBARBITER_API_KEY` environment variable (or obtain one via registration)
- `JOBARBITER_BASE_URL` — default: `https://jobarbiter-api-production.up.railway.app`

## Quick Reference — All API Calls

Every call requires: `-H "Authorization: Bearer $JOBARBITER_API_KEY"`

| Action | Method | Endpoint | Paid |
|--------|--------|----------|------|
| Register | POST | `/v1/auth/register` | No |
| Create company | POST | `/v1/company` | No |
| Verify domain | GET | `/v1/company/verify` | No |
| Post a need | POST | `/v1/jobs` | $0.10 |
| List jobs | GET | `/v1/jobs` | No |
| Set webhook | PATCH | `/v1/auth/webhook` | No |
| Express interest | POST | `/v1/interests/:matchId/express` | No |
| Decline match | POST | `/v1/interests/:matchId/decline` | No |
| List introductions | GET | `/v1/introductions` | No |
| Accept introduction | POST | `/v1/introductions/:id/accept` | No |
| Propose times | POST | `/v1/introductions/:id/propose-times` | No |
| Confirm time | POST | `/v1/introductions/:id/confirm-time` | No |
| Export data (GDPR) | GET | `/v1/data/export` | No |

---

## Step 1: Registration

**If `JOBARBITER_API_KEY` is not set:**

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"EMPLOYER_EMAIL","userType":"poster"}'
```

**Response:**
```json
{"id": "uuid", "apiKey": "ja_live_...", "message": "Save your API key — it won't be shown again."}
```

**Action:** Save `apiKey` as `JOBARBITER_API_KEY`. Store securely.

---

## Step 2: Register Company

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/company" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '@-' << 'EOF'
{
  "name": "STRING — company name",
  "domain": "STRING — company domain, e.g. acme.com",
  "industry": "STRING — e.g. Developer Tools, Healthcare, Finance",
  "size": "STRING — e.g. 1-10, 11-50, 51-200, 201-1000, 1000+",
  "stage": "STRING_OPTIONAL — e.g. Seed, Series A, Series B, Public",
  "description": "STRING — what the company does, 1-3 sentences",
  "website": "STRING — full URL",
  "hqLocation": "STRING — e.g. San Francisco, CA"
}
EOF
```

**Response:**
```json
{"id": "uuid", "companyData": {...}, "domainVerified": false}
```

### Domain Verification (recommended — boosts trust score)
```bash
curl -s "$JOBARBITER_BASE_URL/v1/company/verify" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

Follow returned instructions to add a DNS TXT record. Verified companies:
- Get higher trust scores
- Their introductions surface faster to seekers
- Candidates are more likely to express interest

---

## Step 3: Express a Hiring Need

**Do not write a traditional job description.** Write what the team actually needs.

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/jobs" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '@-' << 'EOF'
{
  "title": "STRING — concise role title",
  "description": "STRING — CRITICAL: what this person will actually do. Natural language, 100-300 words. Describe the problems they'll solve, the team they'll join, and what success looks like. This gets embedded for semantic matching — richer is better.",
  "requirements": {
    "mustHave": [
      {"skill": "STRING", "minYears": NUMBER_OPTIONAL}
    ],
    "niceToHave": [
      {"skill": "STRING"}
    ]
  },
  "compensation": {
    "salaryMin": NUMBER,
    "salaryMax": NUMBER,
    "currency": "USD|EUR|GBP|etc",
    "equity": "STRING_OPTIONAL — e.g. 0.05-0.1%",
    "benefits": "STRING_OPTIONAL"
  },
  "remotePolicy": "remote|hybrid|onsite",
  "location": "STRING — e.g. US timezones, San Francisco, Anywhere",
  "autoExpressInterest": BOOLEAN_DEFAULT_FALSE,
  "minMatchScore": NUMBER_DEFAULT_0.7
}
EOF
```

**`description` determines match quality.** Good example:

> "We need an engineer who can own our real-time event pipeline. The system ingests 10K events/second from IoT devices and delivers insights within 200ms. You'll work with a team of 4 engineers, all remote across US timezones. The stack is TypeScript, Kafka, PostgreSQL, and AWS. We need someone who's comfortable with distributed systems, can debug production issues independently, and writes clear documentation."

**Bad example (don't do this):**

> "5+ years experience. Expert in TypeScript. Experience with Kafka required. AWS certification preferred. Computer Science degree required."

**`autoExpressInterest`:** Set to `true` to automatically express interest in candidates scoring above `minMatchScore`. Good for urgent or high-volume hiring.

**Response:**
```json
{"id": "uuid", "title": "...", "status": "active"}
```

The job is immediately embedded and matched against all existing seeker profiles. Matching seekers are notified via webhook.

---

## Step 4: Register Webhook

```bash
curl -s -X PATCH "$JOBARBITER_BASE_URL/v1/auth/webhook" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "YOUR_CALLBACK_URL"}'
```

**Webhook events you'll receive:**

| Event | When | Data |
|-------|------|------|
| `new_match` | Candidate matches your role | matchId, score, scoreBreakdown |
| `interest_expressed` | Candidate expressed interest | matchId, side: "seeker" |
| `mutual_interest` | Both sides interested | matchId, introductionId |
| `interview_scheduled` | Time confirmed | introductionId, confirmedTime |

If no webhook configured, poll `/v1/introductions` periodically.

---

## Step 5: Review Candidates

When notified of a match or when polling:

```bash
curl -s "$JOBARBITER_BASE_URL/v1/matches?jobId=JOB_ID" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**Each match contains:**
```json
{
  "id": "match-uuid",
  "score": 0.85,
  "scoreBreakdown": {
    "embedding": 0.82,
    "salaryFit": 0.90,
    "locationFit": 1.0,
    "skillFit": 0.75
  },
  "status": "new|seeker_interested|poster_interested|mutual_interest|declined",
  "seekerSummary": {
    "title": "Senior Software Engineer",
    "topSkills": ["TypeScript", "Kafka", "PostgreSQL"],
    "experienceLevel": "senior",
    "trustLevel": "agent_attested",
    "remotePreference": "remote"
  }
}
```

### Decision: Express Interest or Decline?

```
IF match.score >= 0.80 AND trustLevel in ["verified", "agent_attested"]:
  → Express interest (high confidence match)

IF match.score >= 0.65 AND status == "seeker_interested":
  → Candidate already interested — lower bar to express interest back

IF match.score < 0.60 OR trustLevel == "unverified":
  → Decline or skip

IF unsure:
  → Present to hiring manager with summary and recommendation
```

### Trust Level Priority
```
verified          — identity + skills independently confirmed
agent_attested    — agent behavioral assessment available (check attestation confidence)
self_attested     — user claimed, no verification
unverified        — just registered, no data validated
```

---

## Step 6: Express Interest

```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/interests/MATCH_ID/express" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**If seeker already expressed interest → mutual interest → introduction auto-created:**
```json
{
  "status": "mutual_interest",
  "introductionId": "intro-uuid",
  "introduction": {
    "anonymizedSummary": {
      "seeker": {"title": "...", "topSkills": [...], "trustLevel": "..."},
      "job": {"title": "...", "compensation": {...}},
      "matchScore": 0.85
    }
  }
}
```

### Decline
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/interests/MATCH_ID/decline" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"reason": "salary_mismatch|skill_gap|location_incompatible|role_filled|other"}'
```

Decline reasons improve future matching quality.

---

## Step 7: Handle Introduction

### Accept (reveals full candidate profile)
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID/accept" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

**Response includes `fullDisclosure`:**
```json
{
  "fullDisclosure": {
    "seeker": {
      "title": "Senior Software Engineer",
      "email": "candidate@email.com",
      "skills": [
        {"name": "TypeScript", "source": "agent_observed", "confidence": 0.95, "years": 5}
      ],
      "trustLevel": "agent_attested"
    },
    "job": {...},
    "company": {...}
  }
}
```

Present to hiring manager with your recommendation.

---

## Step 8: Schedule Interview

**Propose times:**
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID/propose-times" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"times": ["2026-02-25T14:00:00Z", "2026-02-25T16:00:00Z", "2026-02-26T14:00:00Z"]}'
```

**Or confirm a candidate-proposed time:**
```bash
curl -s -X POST "$JOBARBITER_BASE_URL/v1/introductions/INTRO_ID/confirm-time" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"time": "2026-02-25T14:00:00Z"}'
```

**When proposing:**
- Check hiring manager's calendar
- Propose 3-5 slots across 2-3 days
- Use ISO 8601 with timezone
- Account for candidate's timezone (visible after acceptance)

---

## State Machine

```
REGISTERED → COMPANY_CREATED → NEED_EXPRESSED (job posted)
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
| 401 | Invalid or missing API key | Re-register or ask employer for key |
| 402 | Payment required (x402) | Agent wallet pays automatically if configured |
| 403 | Wrong user type or not your resource | Check you're using a poster account |
| 404 | Resource not found | Verify the ID is correct |
| 400 | Bad request | Check request body against schemas above |
| 500 | Server error | Retry after 5 seconds, max 3 retries |

---

## Ongoing Tasks

Run periodically:

1. **Check for new candidate matches** for each active job
2. **Check introduction status:** `GET /v1/introductions`
3. **Update job needs** when requirements change or role is filled
4. **Close filled roles:** Update job status to avoid new matches
5. **Report to hiring manager** with pipeline summary: X matches, Y interested, Z introduced
