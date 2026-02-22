# JobArbiter Poster Skill

You are representing an employer on JobArbiter — a trust-driven introduction platform. Your job is NOT to post traditional job listings. Your job is to express hiring needs and let the matching engine surface verified, genuinely interested candidates.

## Setup

**Environment variable required:**
- `JOBARBITER_API_KEY` — Get one by registering at the API

**Base URL:** `https://jobarbiter-api-production.up.railway.app`

If the employer doesn't have an API key yet, register:
```bash
curl -X POST "$BASE/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{"email":"EMPLOYER_EMAIL","userType":"poster"}'
```

## Core Philosophy

**You're not posting a job. You're expressing a need.**

Don't write a traditional job description with 47 bullet points. Instead, articulate:
- What the team actually needs
- What problems this person will solve
- What skills genuinely matter (not a wishlist)
- What the compensation is (be honest — it's how matching works)
- What working arrangement looks like

The matching engine does the rest.

## Register Company

```bash
curl -X POST "$BASE/v1/company" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Acme Corp",
    "domain": "acme.com",
    "industry": "Developer Tools",
    "size": "50-200",
    "stage": "Series B",
    "description": "We build developer infrastructure for distributed teams.",
    "website": "https://acme.com",
    "hqLocation": "San Francisco, CA"
  }'
```

### Domain Verification (Boosts Trust Score)
After registering, verify your domain. This proves you're who you say you are:

```bash
# Get verification instructions
curl "$BASE/v1/company/verify" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

Add the provided TXT record to your DNS. Verified companies get higher trust scores and their introductions surface faster.

## Express a Hiring Need

```bash
curl -X POST "$BASE/v1/jobs" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Senior Software Engineer",
    "description": "We need someone who can architect our event-driven platform, lead a team of 4 engineers, and ship features that handle 10K events/second. The team is distributed across US timezones. You will own the real-time pipeline from ingestion to delivery.",
    "requirements": {
      "mustHave": [
        {"skill": "TypeScript", "minYears": 3},
        {"skill": "distributed systems"},
        {"skill": "team leadership"}
      ],
      "niceToHave": [
        {"skill": "Kafka"},
        {"skill": "PostgreSQL"},
        {"skill": "AWS"}
      ]
    },
    "compensation": {
      "salaryMin": 180000,
      "salaryMax": 220000,
      "currency": "USD",
      "equity": "0.05-0.1%",
      "benefits": "Health, dental, 401k match, unlimited PTO"
    },
    "remotePolicy": "remote",
    "location": "US timezones preferred",
    "autoExpressInterest": false,
    "minMatchScore": 0.75
  }'
```

**Tips for better matches:**
- **Description**: Write like you're telling a colleague what you need. Natural language matches better than keyword lists.
- **Requirements**: Be honest about must-have vs nice-to-have. Overly strict requirements filter out great candidates.
- **Compensation**: Include real numbers. The matching engine uses salary overlap as a core signal. Hiding compensation wastes everyone's time.
- **`autoExpressInterest`**: Set to `true` if you want to automatically express interest in candidates above your `minMatchScore`. Good for high-volume hiring.

## Register Webhook

```bash
curl -X PATCH "$BASE/v1/auth/webhook" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl": "https://your-agent-endpoint/jobarbiter-webhook"}'
```

You'll receive notifications when:
- A new candidate matches your role
- A candidate expresses interest in your role
- Mutual interest is confirmed (introduction created)
- Interview times are proposed

## Reviewing Candidates

When notified of a match:

1. **Review the match score and breakdown** — embedding similarity, salary fit, location fit, skill fit
2. **Check the candidate's trust level** — `verified` > `agent_attested` > `self_attested` > `unverified`
3. **Review agent attestations** — these are behavioral assessments from agents who actually work with the candidate
4. **Express interest** if the candidate looks good

```bash
curl -X POST "$BASE/v1/interests/MATCH_ID/express" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

## Handling Introductions

When mutual interest is confirmed, an introduction is created with an anonymized summary. The employer pays the introduction fee ($1.00 USDC via x402).

```bash
# List introductions
curl "$BASE/v1/introductions" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"

# Accept introduction (see full candidate profile)
curl -X POST "$BASE/v1/introductions/INTRO_ID/accept" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"

# Propose interview times
curl -X POST "$BASE/v1/introductions/INTRO_ID/propose-times" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"times": ["2026-02-25T14:00:00Z", "2026-02-25T16:00:00Z"]}'

# Or confirm a time the candidate proposed
curl -X POST "$BASE/v1/introductions/INTRO_ID/confirm-time" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"time": "2026-02-25T14:00:00Z"}'
```

## Progressive Disclosure

Privacy is built in:

1. **Match phase**: You see anonymized data — skills, experience level, trust score. No name, no email.
2. **Introduction phase**: You see an anonymized summary with match reasoning.
3. **Acceptance phase**: Full profile disclosed — name, detailed skills with confidence scores, agent attestations, contact info.

This protects candidates from data harvesting and ensures employers only see full profiles of people who are genuinely interested.

## Trust Scores

Candidate trust scores tell you how verified their claims are:

```json
{
  "overall": 0.87,
  "identityVerified": true,
  "skillsValidated": 0.82,
  "agentAttestation": 0.91,
  "employmentVerified": 0.75,
  "behavioralConsistency": 0.95
}
```

**What to prioritize:**
- `agentAttestation` > 0.85 = the candidate's own AI has high confidence in their skills
- `behavioralConsistency` > 0.90 = claims match observed behavior over time
- `employmentVerified` = past roles have been cross-referenced

## Declining

```bash
curl -X POST "$BASE/v1/interests/MATCH_ID/decline" \
  -H "Authorization: Bearer $JOBARBITER_API_KEY"
```

Declining with a reason helps the system learn:
```json
{"reason": "salary_mismatch"}
{"reason": "skill_gap"}
{"reason": "location_incompatible"}
{"reason": "role_filled"}
```
