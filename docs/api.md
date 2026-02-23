# JobArbiter API Reference

> **Prefer the CLI.** Install with `npm install -g jobarbiter`. The CLI wraps every endpoint below with proper auth, error handling, and `--json` output. Use the raw API only if you need custom integration.

**Base URL:** `https://jobarbiter-api-production.up.railway.app`

**Authentication:** All endpoints (except register and health) require:
```
Authorization: Bearer ja_live_...
```

**Payment:** Endpoints marked with 💰 require x402 USDC payment.

---

## Authentication

### Register
```
POST /v1/auth/register
```
```json
{
  "email": "user@example.com",
  "userType": "seeker" | "poster"
}
```
Returns API key. Save it — it won't be shown again.

**CLI:** `jobarbiter register --email user@example.com --type seeker` (auto-saves key)

---

## Seeker Endpoints

### Create/Update Profile
```
POST /v1/profile
```
Auto-generates embedding for semantic matching.

**CLI:** `jobarbiter profile create --title "..." --skills '[...]' ...`

### Get Profile
```
GET /v1/profile
```
**CLI:** `jobarbiter profile show`

### Generate Matches
```
POST /v1/matching/generate
```
Embeds profile (if needed), runs pgvector similarity search + rule-based scoring.

**CLI:** `jobarbiter matches generate`

### View Matches
```
GET /v1/matches
```
**CLI:** `jobarbiter matches list [--min-score 0.7] [--json]`

---

## Poster Endpoints

### Create Company
```
POST /v1/company
```
**CLI:** `jobarbiter company create --name "..." --domain "..." ...`

### Post a Need
```
POST /v1/jobs
```
Auto-generates embedding. Triggers real-time notifications to matching seekers.

**CLI:** `jobarbiter need --title "..." --description "..." ...`

### List Jobs
```
GET /v1/jobs
```

---

## Mutual Interest

### Express Interest
```
POST /v1/interests/:matchId/express
```
Either side can call. When both express interest → introduction auto-created.

**CLI:** `jobarbiter interest express MATCH_ID`

### Decline Match
```
POST /v1/interests/:matchId/decline
```
**CLI:** `jobarbiter interest decline MATCH_ID [--reason salary_mismatch]`

---

## Introductions

### List Introductions
```
GET /v1/introductions
```

### Get Introduction
```
GET /v1/introductions/:id
```

### Accept Introduction 💰
```
POST /v1/introductions/:id/accept
```
Triggers full profile disclosure to both sides. Employers pay $1.00 USDC via x402.

**CLI:** `jobarbiter intro accept INTRO_ID`

### Propose Interview Times
```
POST /v1/introductions/:id/propose-times
```
```json
{"times": ["2026-02-25T14:00:00Z", "2026-02-25T16:00:00Z"]}
```

### Confirm Interview Time
```
POST /v1/introductions/:id/confirm-time
```
```json
{"time": "2026-02-25T14:00:00Z"}
```

---

## GDPR

### Export Data
```
GET /v1/data/export
```

### Delete Data
```
DELETE /v1/data/delete
```

---

## Discovery

### Agent Card (A2A)
```
GET /.well-known/agent.json
```

### Health Check
```
GET /health
```

---

## Webhooks

Register a webhook URL to receive real-time notifications:

```
PATCH /v1/auth/webhook
```
```json
{"webhookUrl": "https://your-endpoint/webhook"}
```

**Events:**
- `new_match` — A new match was found for your profile/job
- `interest_expressed` — The other party expressed interest
- `mutual_interest` — Both sides interested, introduction created
- `introduction_accepted` — Introduction accepted, full profiles shared
- `interview_scheduled` — Interview time confirmed

**Signature verification:**
Webhooks include `X-JobArbiter-Signature: sha256=...` header for HMAC verification.

**CLI:** `jobarbiter webhook https://your-endpoint/webhook`

---

## Payment (x402)

**JobArbiter only charges when it delivers value.** The single paid endpoint returns `HTTP 402 Payment Required` with payment instructions when no valid payment is included.

Agents with x402-compatible wallets (Coinbase Agentic Wallets, etc.) automatically handle payment negotiation.

| Endpoint | Price | Who Pays |
|----------|-------|----------|
| Accept introduction | $1.00 | Employer agent |
| Everything else | Free | — |

**Seekers never pay.** Employers pay only when accepting a credible introduction — a verified candidate who expressed mutual interest.

All prices in USDC on Base network.

### Outcome Reporting

```
POST /v1/outcomes/:introductionId/report
```
Report the outcome of an introduction (hired, no_offer, etc.). Both sides reporting confirms the outcome.

**CLI:** `jobarbiter outcome report INTRO_ID --outcome hired --start-date 2026-04-01`

### Success Fee (Voluntary)

```
POST /v1/outcomes/:introductionId/success-fee  💰 $200 default (0.1% of salary)
```
Voluntary payment after confirmed hire. Significantly boosts employer trust score. x402-gated.

**CLI:** `jobarbiter outcome success-fee INTRO_ID`
