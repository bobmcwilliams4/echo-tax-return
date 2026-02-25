# Echo Tax Return

A Cloudflare Worker that provides tax preparation intelligence with 14 specialized domain engines. Handles client management, return calculation, document processing, deduction optimization, and e-filing — backed by IRC citation lookup and tax case law search.

## Features

- **Client Management** — Create and manage tax clients with dependents, filing status, SSN encryption
- **Return Calculation** — Multi-bracket federal tax computation with credits and deductions
- **Document Processing** — Upload and parse W-2s, 1099s, receipts with auto-extraction
- **Deduction Optimizer** — AI-powered analysis to find missed deductions and credits
- **14 Tax Engines** — Specialized knowledge across income, deductions, credits, self-employment, crypto, oil & gas, estate planning, and more
- **IRC Lookup** — Direct Internal Revenue Code section citation and interpretation
- **E-File Support** — Electronic filing preparation and validation
- **Stripe Billing** — Tiered pricing for tax preparation services

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/client` | Manage tax clients |
| `POST` | `/return` | Create/calculate returns |
| `POST` | `/document` | Upload and parse documents |
| `POST` | `/knowledge` | Query tax knowledge engines |
| `GET` | `/health` | Health check and stats |

## Deploy

```bash
git clone https://github.com/bobmcwilliams4/echo-tax-return.git
cd echo-tax-return
npm install
npx wrangler d1 create echo-tax
npx wrangler d1 execute echo-tax --remote --file=schema.sql
npx wrangler deploy
```

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: Hono
- **Database**: Cloudflare D1
- **Storage**: Cloudflare R2 (documents)
- **Billing**: Stripe
- **Language**: TypeScript

## Part of Echo Omega Prime

Echo Tax Return is the tax intelligence layer of [Echo Omega Prime](https://github.com/bobmcwilliams4/Echo-Omega-Prime).

## Author

**Bobby Don McWilliams II** · bobmcwilliams4@outlook.com

## License

MIT
