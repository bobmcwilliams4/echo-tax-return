# Echo Tax Return

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-4.7-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare D1](https://img.shields.io/badge/D1-SQLite-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Stripe](https://img.shields.io/badge/Stripe-Billing-635BFF?logo=stripe&logoColor=white)](https://stripe.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A full-featured income tax preparation and intelligence API running on Cloudflare Workers. Manages clients, computes multi-bracket federal taxes across six tax years (2019-2024), ingests W-2/1099 documents via OCR, optimizes returns through 14 AI-powered Tax Intelligence Engines (TX01-TX14), generates IRS Form 1040 packages, and processes payments through Stripe -- all at the edge with AES-256-GCM encryption for PII.

**Version 3.2.0** | **80+ REST endpoints** | **14 Tax Intelligence Engines** | **6 supported tax years**

---

## Architecture

```
                          +---------------------+
                          |    Client / Web UI   |
                          |  echo-ept.com        |
                          |  echo-op.com         |
                          +----------+----------+
                                     |
                            HTTPS + API Key
                                     |
                          +----------v----------+
                          | echo-tax-return      |
                          | Cloudflare Worker    |
                          | (Hono + TypeScript)  |
                          +--+-----+-----+---+--+
                             |     |     |   |
              +--------------+     |     |   +--------------+
              |                    |     |                   |
     +--------v--------+  +-------v--+  |  +--------v-------+
     | Cloudflare D1   |  | R2 Bucket|  |  | KV Namespace   |
     | echo-tax-return |  | echo-    |  |  | CACHE          |
     | (8 tables +     |  | prime-   |  |  | (calculations, |
     |  indexes)        |  | media    |  |  |  rate limits,  |
     |                  |  | (docs)   |  |  |  filing pkgs)  |
     +------------------+  +----------+  |  +----------------+
                                         |
              +--------------------------+---+
              |                              |
     +--------v----------+     +-------------v------------+
     | echo-engine-       |     | echo-shared-brain        |
     | runtime             |     | (Shared Brain)           |
     | (674 engines,       |     | (cross-instance memory,  |
     |  30,626 doctrines,  |     |  review notifications)   |
     |  TX01-TX14 tax)     |     +-------------------------+
     +--------------------+
              |
     +--------v----------+
     | Stripe API         |
     | (checkout,         |
     |  webhooks)          |
     +--------------------+
```

### Source Files (15 TypeScript modules)

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | 375 | Main app, CORS, security headers, middleware, route mounting |
| `types.ts` | 295 | All TypeScript interfaces, D1 table types, request/response shapes |
| `auth.ts` | 146 | API key auth, Commander checks, rate limiting, audit logging |
| `crypto.ts` | 61 | AES-256-GCM SSN encryption/decryption via WebCrypto (PBKDF2) |
| `clients.ts` | 144 | Client CRUD with SSN encryption and input validation |
| `returns.ts` | 258 | Return lifecycle, income/deduction/dependent CRUD, status FSM |
| `features.ts` | 900+ | Estimated payments, multi-year comparison, audit risk, amendments, what-if, withholding, projections, notes, engagement letters, export, tax calendar, tips, penalty estimates, duplicate, activity log, health check, tax reference |
| `advanced.ts` | 700+ | SE tax calculator, safe harbor analysis, print package, income analysis, state tax estimates, required forms, depreciation (MACRS/179), strategy planner, trend analysis, key numbers reference, communications log |
| `billing.ts` | 201 | Stripe checkout sessions, webhook handler, payment tracking, revenue stats |
| `efile.ts` | 594 | Filing packages, IRS mailing addresses, refund claim deadlines, batch filing, printable Form 1040 |
| `optimizer.ts` | 263 | TX engine integration, scenario routing, rule-based suggestions |
| `documents.ts` | 434 | Document upload to R2, OCR parsing for 9 form types, auto income item creation |
| `calculator.ts` | ~500 | Multi-bracket tax computation, Form 1040 generation, credits, AMT |
| `tax-data.ts` | ~400 | IRS brackets, standard deductions, SS wage bases, EITC tables (2019-2024) |
| `archive.ts` | 708 | R2-based return archiving, client index, printable archive summaries |

---

## 14 Tax Intelligence Engines

The optimizer module routes queries to the appropriate TX engine(s) hosted on `echo-engine-runtime` based on the income types and deductions present on each return.

| Engine | Domain | Query Prefix |
|--------|--------|-------------|
| **TX01** | General Income Tax | W-2 wage optimization, deductions, credits, withholding |
| **TX02** | Deduction Strategy | Standard vs. itemized analysis, bunching strategies |
| **TX03** | Tax Credits | CTC, EITC, education credits, energy credits |
| **TX04** | Estate & Gift Tax | Estate planning, gift tax exclusions, generation-skipping |
| **TX05** | Capital Gains | Tax-loss harvesting, holding period optimization |
| **TX06** | Retirement Tax | IRA/401k distributions, Roth conversions, RMDs |
| **TX07** | International Tax | FBAR, FATCA, foreign earned income exclusion |
| **TX08** | Self-Employment | Schedule C, SE tax, business deductions, QBI |
| **TX09** | Partnership Tax | Pass-through entities, Section 199A, K-1 analysis |
| **TX10** | Corporate Tax | C-Corp planning, dividends, accumulated earnings |
| **TX11** | Nonprofit Tax | Tax-exempt organizations, UBIT, compliance |
| **TX12** | Oil & Gas Tax | IDC deductions, percentage/cost depletion, royalties |
| **TX13** | Real Estate Tax | Rental depreciation, 1031 exchanges, passive activity |
| **TX14** | Cryptocurrency Tax | Cost basis methods, wash sales, DeFi taxation |

---

## API Reference

**Base URL:** `https://echo-tax-return.bmcii1976.workers.dev`

**Authentication:** All endpoints except `/health`, `/pricing`, and `/docs` require one of:
- Header `X-Echo-API-Key: <key>`
- Header `Authorization: Bearer <key>`

**Commander Endpoints:** Some endpoints require the `X-Commander-Email` header matching the configured commander email.

### Public (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health check -- version, features list, DB status, client count |
| `GET` | `/pricing` | Service pricing tiers (Basic $150 to Oil & Gas $750) |
| `GET` | `/docs` | Full API documentation with all endpoints listed |

### Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/clients` | Create client profile (first_name, last_name required; SSN encrypted with AES-256-GCM) |
| `GET` | `/clients/:id` | Get client details (Commander sees SSN last 4) |
| `GET` | `/clients` | List all clients (Commander) or own clients (X-User-Id) |
| `PUT` | `/clients/:id` | Update client profile fields |
| `DELETE` | `/clients/:id` | Delete client (blocked if active returns exist) |

### Returns

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns` | Create tax return (client_id + tax_year, deduplication enforced) |
| `GET` | `/returns/:id` | Get return with income items, deductions, dependents, documents, optimizations |
| `GET` | `/returns` | List returns with filters: `?client_id=X&tax_year=Y&status=Z` |
| `PUT` | `/returns/:id/status` | Advance return status (enforces valid state transitions) |
| `POST` | `/returns/:id/calculate` | Calculate federal tax -- brackets, credits, deductions, AMT |
| `GET` | `/returns/:id/calculation` | Get cached calculation (KV, 1hr TTL) or compute fresh |
| `GET` | `/returns/:id/forms` | Generate Form 1040 + all applicable schedules |
| `POST` | `/returns/:id/review` | Mark return for preparer review (notifies Shared Brain) |
| `GET` | `/returns/:id/summary` | Lightweight summary with counts and totals |

### Income Items

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/income` | Add income item (category + amount required) |
| `DELETE` | `/returns/:id/income/:itemId` | Remove income item |

### Deductions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/deductions` | Add deduction (category + amount required) |
| `DELETE` | `/returns/:id/deductions/:dedId` | Remove deduction |

### Dependents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/dependents` | Add dependent (SSN encrypted, CTC/ODC qualification flags) |
| `DELETE` | `/returns/:id/dependents/:depId` | Remove dependent |

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/documents/upload` | Upload W-2/1099/receipt (multipart, max 10MB, stored in R2) |
| `GET` | `/documents/:returnId` | List all documents for a return |
| `GET` | `/documents/detail/:id` | Get single document detail |
| `POST` | `/documents/:id/parse` | Parse document with OCR -- auto-creates income items |
| `PUT` | `/documents/:id/verify` | Mark document as manually verified |
| `DELETE` | `/documents/:id` | Delete document from R2 + D1 + associated income items |

**Supported document types:** `w2`, `1099_int`, `1099_div`, `1099_nec`, `1099_misc`, `1099_b`, `1099_r`, `1099_ssa`, `1099_g`, `receipt`, `other`

### Optimization (TX Engines)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/optimize` | Query TX01-TX14 engines for optimization suggestions |
| `GET` | `/returns/:id/optimizations` | Get stored optimization suggestions sorted by savings |

### Filing & E-File

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/returns/:id/filing-package` | Complete filing package -- Form 1040, instructions, refund claim analysis |
| `GET` | `/returns/filing-packages/all?client_id=X` | All filing packages for a client with strategy recommendation |
| `POST` | `/returns/:id/file` | Mark return as filed (e-file or paper, stores confirmation/tracking) |
| `POST` | `/returns/batch-file` | Batch file all review-status returns for a client (Commander only) |
| `GET` | `/returns/:id/printable` | Human-readable printable Form 1040 with all schedules |

### What-If & Projections

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/what-if` | Run what-if tax scenarios (income changes, deduction changes, filing status) |
| `POST` | `/returns/:id/project` | Multi-year forward income/tax projector |
| `POST` | `/returns/:id/withholding-estimate` | W-4 withholding recommendation for next year |
| `POST` | `/returns/:id/duplicate` | Duplicate return to a new tax year |

### Multi-Year Analysis

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/returns/compare?client_id=X` | Multi-year comparison with YOY changes and aggregates |
| `GET` | `/returns/diff?return_a=X&return_b=Y` | Side-by-side return comparison |
| `GET` | `/returns/:id/trend` | Year-over-year trend analysis with income projections |

### Audit & Risk

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/returns/:id/audit-risk` | Audit risk score (0-100) with 9 risk factors and mitigations |
| `GET` | `/returns/:id/validate` | Pre-filing validation check |

### Amendments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/amendments` | Create 1040-X amendment (reason + field changes) |
| `GET` | `/returns/:id/amendments` | List amendments for a return |

### Estimated Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/estimated-payments` | Record quarterly estimated payment |
| `GET` | `/returns/:id/estimated-payments` | List estimated payments with total |
| `DELETE` | `/returns/:id/estimated-payments/:epId` | Delete an estimated payment |

### Preparer Notes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/notes` | Add preparer note/memo |
| `GET` | `/returns/:id/notes` | List notes for a return |
| `DELETE` | `/returns/:id/notes/:noteId` | Delete a note |

### Professional Tools

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/returns/key-numbers/:year` | IRS key numbers reference -- brackets, deductions, limits, EITC, mileage, contribution limits, gift/estate (2019-2025) |
| `POST` | `/returns/communications` | Log client communication (email, call, meeting) |
| `GET` | `/returns/communications/:clientId` | List communications for a client |
| `GET` | `/returns/:id/se-tax` | Self-employment tax calculator -- Schedule SE, quarterly estimates, retirement plan comparison (SEP-IRA, Solo 401k, SIMPLE) |
| `GET` | `/returns/:id/safe-harbor` | IRS safe harbor analysis -- 90%/100%/110% thresholds, quarterly breakdown, penalty risk |
| `GET` | `/returns/:id/print-package` | Comprehensive print-ready return summary with all detail |
| `GET` | `/returns/:id/income-analysis` | Income source diversification, concentration risk, withholding adequacy |
| `GET` | `/returns/:id/state-tax?state=XX` | State income tax estimate with SALT analysis and relocation savings (20+ states) |
| `GET` | `/returns/:id/required-forms` | Required IRS forms based on return data (1040, schedules, 1099s, 8949, etc.) |
| `POST` | `/returns/:id/depreciation` | MACRS depreciation calculator with Section 179 and bonus depreciation analysis |
| `GET` | `/returns/:id/strategy` | Personalized tax strategy planner with savings estimates |
| `GET` | `/returns/:id/engagement-letter` | Generate professional engagement letter |
| `GET` | `/returns/:id/export?format=json|csv` | Export return data |

### Advanced Features

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/batch-calculate` | Batch calculate all returns for a client |
| `GET` | `/returns/:id/document-checklist` | Required documents checklist based on return contents |
| `GET` | `/returns/:id/bracket-analysis` | Marginal rate and bracket breakdown visualization |
| `POST` | `/returns/:id/lock` | Lock/unlock return for editing |
| `GET` | `/returns/:id/lock-status` | Check return lock status |
| `POST` | `/returns/portal-token` | Generate read-only client portal access token |
| `GET` | `/returns/portal/:token` | Client portal read-only view |
| `GET` | `/returns/:id/deduction-opportunities` | Find unclaimed deduction opportunities |
| `GET` | `/returns/client-summary/:clientId` | Comprehensive client dashboard summary |
| `GET` | `/returns/:id/timeline` | Return activity timeline |
| `GET` | `/returns/tax-knowledge/search?q=X` | Tax knowledge reference search |
| `POST` | `/returns/:id/snapshot` | Create point-in-time return snapshot |
| `GET` | `/returns/:id/penalty-estimate` | Underpayment penalty estimate (Form 2210) |
| `GET` | `/returns/:id/health` | Return completeness health check |
| `GET` | `/returns/:id/tips` | Personalized tax tips |
| `GET` | `/returns/supported-years` | List supported tax years |
| `GET` | `/returns/tax-calendar?year=N` | IRS tax deadline calendar |
| `GET` | `/returns/tax-reference/:topic` | Tax law quick reference |
| `GET` | `/returns/activity/:clientId` | Client activity log |

### Archive

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/returns/:id/archive` | Archive a completed return to R2 (full data + summary + client index) |
| `GET` | `/returns/:id/archive` | Download archived return from R2 |
| `GET` | `/returns/archived?client_id=X` | List all archived returns for a client |
| `POST` | `/returns/:id/archive/pdf` | Generate printable plain-text archive summary |

### Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/billing/checkout` | Create Stripe checkout session (5 tiers: basic/standard/complex/business/oilgas) |
| `POST` | `/billing/webhook` | Stripe webhook handler (checkout.session.completed, charge.refunded) |
| `GET` | `/billing/pricing` | Get pricing tiers with display amounts |
| `GET` | `/billing/payments` | List payments with revenue total (Commander only) |
| `GET` | `/billing/stats` | Revenue statistics -- completed, pending, refunded, net (Commander only) |

### Audit Log (Commander Only)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/returns/audit-log` | List audit entries with pagination and filters (action, severity, user_id) |
| `GET` | `/returns/audit-log/export` | Export full audit log as JSON (optional date range) |
| `GET` | `/returns/audit-log/stats` | Audit statistics -- counts by action, severity, top users, hourly activity |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/stats` | Dashboard stats -- client count, returns by status, revenue, recent returns (Commander only) |

---

## Pricing Tiers

| Tier | Price | Description | Includes |
|------|-------|-------------|----------|
| **Basic** | $150 | W-2 only, single/joint | Federal 1040, standard deduction, W-2 income, CTC, e-file |
| **Standard** | $250 | W-2 + 1099 sources | + 1099-INT/DIV/NEC, Schedule 1, itemized deductions, student loan, IRA/HSA |
| **Complex** | $400 | Investments, rental | + Capital gains (Schedule D), rental (Schedule E), EITC, tax-loss harvesting |
| **Business** | $600 | Self-employment | + Schedule C, Schedule SE, QBI deduction, estimated payments, retirement |
| **Oil & Gas** | $750 | IDC, depletion, royalties | + IDC deductions, percentage/cost depletion, working interest analysis, TX12 engine |

---

## Database Schema

The D1 database `echo-tax-return` contains 8 core tables plus dynamic tables created on first use.

### Core Tables

```sql
-- Client profiles with encrypted PII
clients (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT,
  first_name TEXT, last_name TEXT,
  ssn_encrypted TEXT,           -- AES-256-GCM encrypted
  dob TEXT, phone TEXT,
  address_street TEXT, address_city TEXT,
  address_state TEXT, address_zip TEXT,
  filing_status TEXT,           -- single|married_joint|married_separate|head_of_household|widow
  created_at TEXT, updated_at TEXT
)

-- Tax returns with lifecycle status
returns (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  tax_year INTEGER NOT NULL,    -- 2018-2025
  status TEXT DEFAULT 'intake', -- intake|documents|calculating|review|filed|accepted|rejected
  total_income REAL, adjusted_gross_income REAL,
  taxable_income REAL, total_tax REAL,
  total_payments REAL, refund_or_owed REAL,
  deduction_method TEXT,        -- standard|itemized
  preparer_ptin TEXT, filed_at TEXT,
  archived_at TEXT, archive_key TEXT,
  created_at TEXT, updated_at TEXT
)

-- Uploaded tax documents with R2 storage
documents (
  id TEXT PRIMARY KEY,
  return_id TEXT REFERENCES returns(id),
  doc_type TEXT NOT NULL,       -- w2|1099_int|1099_div|1099_nec|1099_misc|1099_b|1099_r|1099_ssa|1099_g|receipt|other
  issuer_name TEXT,
  r2_key TEXT,                  -- R2 object key
  ocr_text TEXT, parsed_data TEXT,
  status TEXT DEFAULT 'uploaded', -- uploaded|processing|parsed|verified|error
  created_at TEXT
)

-- Income line items
income_items (
  id TEXT PRIMARY KEY,
  return_id TEXT REFERENCES returns(id),
  document_id TEXT REFERENCES documents(id),
  category TEXT NOT NULL,       -- wages|interest|dividends|business|capital_gains|rental|retirement|social_security|unemployment|other
  description TEXT, amount REAL NOT NULL,
  tax_withheld REAL DEFAULT 0,
  form_line TEXT
)

-- Deduction line items
deductions (
  id TEXT PRIMARY KEY,
  return_id TEXT REFERENCES returns(id),
  category TEXT NOT NULL,       -- medical|salt|mortgage_interest|charitable|business_expense|student_loan|ira|hsa|se_tax|alimony|educator|other
  description TEXT, amount REAL NOT NULL,
  schedule TEXT, form_line TEXT
)

-- Dependents
dependents (
  id TEXT PRIMARY KEY,
  return_id TEXT REFERENCES returns(id),
  first_name TEXT, last_name TEXT,
  ssn_encrypted TEXT, dob TEXT,
  relationship TEXT, months_lived INTEGER DEFAULT 12,
  qualifies_ctc INTEGER DEFAULT 0,
  qualifies_odc INTEGER DEFAULT 0
)

-- Stripe payment records
payments (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id),
  return_id TEXT REFERENCES returns(id),
  amount REAL NOT NULL,
  stripe_session_id TEXT,
  status TEXT DEFAULT 'pending', -- pending|completed|refunded
  created_at TEXT
)

-- TX engine optimization suggestions
optimizations (
  id TEXT PRIMARY KEY,
  return_id TEXT REFERENCES returns(id),
  engine_id TEXT,
  category TEXT,                -- deduction|credit|strategy|timing
  suggestion TEXT NOT NULL,
  potential_savings REAL,
  confidence REAL,
  doctrine_source TEXT,
  created_at TEXT
)
```

### Dynamic Tables (created on first use)

```sql
estimated_payments (id, return_id, quarter, amount, date_paid, confirmation, created_at)
amendments (id, return_id, reason, changes, original_refund_owed, amended_refund_owed, net_change, status, filed_at, created_at)
preparer_notes (id, return_id, category, content, pinned, created_at)
filing_records (id, return_id, method, confirmation_number, tracking_number, filed_at, accepted_at, rejected_at, rejection_reason)
audit_log (id, timestamp, user_id, action, resource_type, resource_id, ip_address, user_agent, details, severity)
communications (id, client_id, return_id, type, direction, subject, content, created_at)
```

### Indexes

```sql
idx_clients_user_id ON clients(user_id)
idx_returns_client_id ON returns(client_id)
idx_returns_status ON returns(status)
idx_returns_tax_year ON returns(tax_year)
idx_documents_return_id ON documents(return_id)
idx_income_items_return_id ON income_items(return_id)
idx_deductions_return_id ON deductions(return_id)
idx_dependents_return_id ON dependents(return_id)
idx_payments_client_id ON payments(client_id)
idx_payments_status ON payments(status)
idx_optimizations_return_id ON optimizations(return_id)
```

---

## Return Status Lifecycle

The return follows a strict finite state machine. Only valid transitions are allowed:

```
  intake  --->  documents  --->  calculating  --->  review  --->  filed
                    ^                                  |            |
                    |                                  |            v
                    +----------------------------------+        accepted
                                                                   |
  rejected  <------------------------------------------------------+
      |
      v
  documents  (restart)
```

| From | Allowed Transitions |
|------|---------------------|
| `intake` | `documents` |
| `documents` | `calculating` |
| `calculating` | `review` |
| `review` | `filed`, `documents` (go back) |
| `filed` | `accepted`, `rejected` |
| `accepted` | (terminal) |
| `rejected` | `documents` (restart) |

---

## Security

### SSN Encryption (AES-256-GCM)

All Social Security Numbers are encrypted at rest using AES-256-GCM with PBKDF2 key derivation (100,000 iterations, SHA-256). The encryption key is stored as a Cloudflare Worker secret (`SSN_ENCRYPTION_KEY`), never in source code.

- Encryption: `crypto.subtle.encrypt` with random 12-byte IV per operation
- Key derivation: PBKDF2 with application-specific salt
- Storage: Base64-encoded `IV + ciphertext` in D1
- SSNs are never returned in API responses; only masked `***-**-XXXX` for Commander

### Authentication

- API key validation via `X-Echo-API-Key` header or `Authorization: Bearer` header
- Commander elevation via `X-Commander-Email` header for admin endpoints
- All keys stored as Cloudflare Worker secrets

### Rate Limiting

Per-IP rate limiting using KV with configurable windows:

| Endpoint Group | Max Requests | Window |
|----------------|-------------|--------|
| `/clients/*` | 100 | 60s |
| `/returns/*` | 100 | 60s |
| `/documents/*` | 30 | 60s |
| `/billing/*` | 10 | 60s |

### Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Audit Logging

Every authenticated request is logged to the `audit_log` table with:
- User ID, IP address, User-Agent
- Action (method + path), response status
- Severity classification (info/warn/error/critical)
- Timestamp for forensic review

### Input Sanitization

- HTML/script tag stripping on all string inputs
- SSN format validation (9 digits, no all-zeros, no leading-9)
- Email format validation
- File size limits (10MB max for document uploads)

---

## Cloudflare Bindings

| Binding | Type | Name/ID | Purpose |
|---------|------|---------|---------|
| `DB` | D1 | `echo-tax-return` (0720791f) | Primary database |
| `CACHE` | KV | `9a2008e2` | Calculation cache, rate limits, filing packages |
| `MEDIA` | R2 | `echo-prime-media` | Document storage, return archives |
| `ENGINE_RUNTIME` | Service | `echo-engine-runtime` | TX01-TX14 doctrine queries |
| `SHARED_BRAIN` | Service | `echo-shared-brain` | Cross-instance notifications |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ENVIRONMENT` | `production` |
| `COMMANDER_EMAIL` | Commander email for admin access |
| `ENGINE_RUNTIME_URL` | Engine runtime worker URL |
| `SHARED_BRAIN_URL` | Shared brain worker URL |

### Secrets

| Secret | Description |
|--------|-------------|
| `ECHO_API_KEY` | API authentication key |
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `SSN_ENCRYPTION_KEY` | AES-256-GCM encryption key for SSNs |

---

## Deployment

### Prerequisites

- Node.js 18+
- Wrangler CLI (`npm install -g wrangler`)
- Cloudflare account with Workers, D1, KV, and R2 enabled
- Stripe account for billing

### Setup

```bash
# Clone the repository
git clone https://github.com/bobmcwilliams4/echo-tax-return.git
cd echo-tax-return

# Install dependencies
npm install

# Create D1 database (if not already created)
npx wrangler d1 create echo-tax-return

# Run schema migration
npx wrangler d1 execute echo-tax-return --remote --file=schema.sql

# Set secrets
echo "YOUR_API_KEY" | npx wrangler secret put ECHO_API_KEY
echo "sk_live_XXXX" | npx wrangler secret put STRIPE_SECRET_KEY
echo "YOUR_32_CHAR_KEY" | npx wrangler secret put SSN_ENCRYPTION_KEY

# Deploy
npx wrangler deploy
```

### Local Development

```bash
# Start local dev server (port 8787)
npm run dev
```

### Database Migration

```bash
npm run db:migrate
# Equivalent to: npx wrangler d1 execute echo-tax-return --remote --file=schema.sql
```

---

## CORS Configuration

The API accepts requests from the following origins:

- `https://echo-ept.com`
- `https://echo-op.com`
- `https://echo-lgt.com` / `https://www.echo-lgt.com`
- `https://echo-lgtcom.vercel.app`
- `http://localhost:3000` / `http://localhost:3001`

Allowed headers: `Content-Type`, `Authorization`, `X-Echo-API-Key`, `X-User-Id`, `X-Commander-Email`

---

## Document OCR Parsers

The document module includes regex-based parsers for 9 IRS form types that extract structured data from OCR text:

| Form | Fields Extracted |
|------|-----------------|
| **W-2** | Employer name/EIN, wages (Box 1), federal withheld (Box 2), SS wages/tax, Medicare wages/tax, state wages/withheld |
| **1099-INT** | Payer name, interest income (Box 1), early withdrawal penalty, federal withheld, tax-exempt interest |
| **1099-DIV** | Payer name, ordinary dividends (Box 1a), qualified dividends (Box 1b), capital gains, federal withheld |
| **1099-NEC** | Payer name, nonemployee compensation (Box 1), federal withheld |
| **1099-MISC** | Payer name, rents (Box 1), royalties (Box 2), other income (Box 3), federal withheld |
| **1099-B** | Broker name, proceeds, cost basis, gain/loss, short/long-term flag, federal withheld |
| **1099-R** | Payer name, gross distribution (Box 1), taxable amount (Box 2a), distribution code, federal withheld |
| **SSA-1099** | Total benefits (Box 5), benefits repaid, federal withheld |
| **1099-G** | Payer name, unemployment compensation (Box 1), state tax refund (Box 2), federal withheld |

Parsed documents auto-create corresponding income items linked to the return.

---

## Key Tax Data Coverage

The `tax-data.ts` module provides authoritative IRS data for **tax years 2019-2025**:

- Federal income tax brackets for all 5 filing statuses
- Standard deduction amounts (single, MFJ, MFS, HoH, QSS)
- Social Security wage base limits
- Child Tax Credit parameters and phase-out thresholds
- EITC tables (0-3+ children)
- Contribution limits (401k, IRA, HSA, SEP-IRA)
- Gift and estate tax exclusions
- IRS mileage rates (business, medical, charitable)
- Section 179 deduction limits
- State income tax rates for 20+ states

---

## Part of Echo Omega Prime

Echo Tax Return is the tax intelligence layer of [Echo Omega Prime](https://github.com/bobmcwilliams4/Echo-Omega-Prime), a comprehensive AI-powered business automation platform. It integrates with:

- **Echo Engine Runtime** -- 674 AI engines with 30,626 doctrines for domain-specific intelligence
- **Echo Shared Brain** -- Cross-instance memory and notification system
- **Echo Prime Technologies** (echo-ept.com) -- Client-facing web interface

---

## Author

**Bobby Don McWilliams II** -- [bobmcwilliams4@outlook.com](mailto:bobmcwilliams4@outlook.com)

---

## License

MIT License

Copyright (c) 2026 Bobby Don McWilliams II

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
