# AGENTS.md

> Agent manifest following the [AGENTS.md open standard](https://github.com/anthropics/agents-md) adopted by 60K+ projects under Linux Foundation AAIF.

## Identity

- **name**: Echo Omega Prime
- **description**: Autonomous AI operating system with 37,000+ tools, 674 engines, fleet coordination, and infinite memory -- built on Cloudflare Workers, powered by Claude Opus 4.6
- **version**: 3.1.0
- **author**: Bobby Don McWilliams II
- **contact**: bobmcwilliams4@outlook.com
- **license**: Proprietary
- **homepage**: https://echo-op.com
- **repository**: https://github.com/bobmcwilliams4/Echo-Omega-Prime

## Capabilities

- **Multi-agent fleet orchestration** -- Architect + Worker pattern, 128 concurrent swarm agents, dual fleet (Imperial + Rebellion)
- **674 domain intelligence engines** -- across 178 tiers covering legal, tax, landman, oilfield, medical, chemistry, drilling, mechanical, aviation, energy, and 168 more domains
- **37,475 MCP tools** -- unified access via Echo Relay (582 Windows API + 35,809 MEGA Gateway + credential vault + cloud tools)
- **5-tier persistent memory** -- R2 Vault (permanent), Shared Brain (cross-instance), OmniSync (plans/todos), Memory Cortex V2 (7-layer cognitive with decay/promote/consolidate), Crystal Memory (indexed/searchable)
- **Autonomous error healing** -- GS343 system with 45,962 error templates, Phoenix auto-heal
- **Daily knowledge scanning** -- 7 sources, automated ingestion and vectorization
- **Voice synthesis** -- Qwen3-TTS with 19 emotion tags, unlimited voice cloning, Whisper STT, audio isolation
- **Full Windows desktop control** -- 582 API endpoints: process control, registry, network, security, hardware, automation, OCR
- **Cloud-first architecture** -- 26+ Cloudflare Workers, 10 R2 buckets, 10 D1 databases, 20 KV namespaces
- **Infinite context** -- session chaining via crash recovery, R2 snapshots, continuation prompts

## Protocols

| Protocol | Status | Details |
|----------|--------|---------|
| **MCP** | Supported | Model Context Protocol (spec 2025-11-25), 655 tools via Echo Relay |
| **A2A** | Planned | Google Agent-to-Agent protocol |
| **HTTP/REST** | Supported | All Cloudflare Workers expose REST APIs |
| **WebSocket** | Supported | Real-time voice streaming, swarm coordination |
| **JSON-Lines** | Supported | MCP stdio transport (mcp 1.22.0) |

## Endpoints

| Service | URL | Purpose |
|---------|-----|---------|
| **Shared Brain** | https://echo-shared-brain.bmcii1976.workers.dev | Universal cross-instance memory (D1 + KV + R2 + Vectorize) |
| **Engine Runtime** | https://echo-engine-runtime.bmcii1976.workers.dev | 674 engines, 30,626 doctrines, hybrid keyword + semantic search |
| **Knowledge Forge** | https://echo-knowledge-forge.bmcii1976.workers.dev | 5,387 documents, knowledge graph |
| **Knowledge Scout** | https://echo-knowledge-scout.bmcii1976.workers.dev | Daily automated knowledge scanning from 7 sources |
| **Echo Chat** | https://echo-chat.bmcii1976.workers.dev | 14-personality AI chat with 12-layer prompt builder |
| **Build Orchestrator** | https://echo-build-orchestrator.bmcii1976.workers.dev | Engine build pipeline coordination |
| **OmniSync** | https://omniscient-sync.bmcii1976.workers.dev | Cross-instance todos, policies, broadcasts, memory keys |
| **Memory Prime** | https://echo-memory-prime.bmcii1976.workers.dev | 9-pillar cloud memory with 44 endpoints |
| **Swarm Brain** | https://echo-swarm-brain.bmcii1976.workers.dev | 129 endpoints for swarm coordination |
| **Sentinel Memory** | https://echo-sentinel-memory.bmcii1976.workers.dev | Security-focused memory and threat tracking |
| **FORGE-X Cloud** | https://forge-x-cloud.bmcii1976.workers.dev | Autonomous engine builder (cron every 5min, dual LLM) |
| **Echo Engine Cloud** | https://echo-engine-cloud.bmcii1976.workers.dev | 52+ domain engine queries with Stripe billing |
| **ShadowGlass v8** | https://shadowglass-v8-warpspeed.bmcii1976.workers.dev | 80-county deed records (259K+ records) |
| **ENCORE Scraper** | https://encore-cloud-scraper.bmcii1976.workers.dev | 47-county automated scraping |
| **Echo Relay** | https://echo-relay.bmcii1976.workers.dev | Cloud-side tool relay |

## Tools

This system exposes **37,475+ tools** via MCP (Model Context Protocol).

- **Primary access**: Echo Relay MCP server (655 tools unified from 5 child servers)
- **Windows API**: 582 endpoints -- process, file, registry, network, security, hardware, automation, OCR
- **MEGA Gateway**: 35,809 tools across 1,873 servers in 12 categories
- **Credential Vault**: 1,527 stored credentials with HIBP breach detection
- **Cloud Tools**: 54 Cloudflare Workers management tools

### Tool Categories

| Category | Count | Examples |
|----------|-------|---------|
| AI/ML | 3,200+ | Model inference, embeddings, fine-tuning |
| API | 4,500+ | REST clients, GraphQL, webhook management |
| Automation | 5,100+ | Browser automation, workflow, scheduling |
| Cloud | 2,800+ | R2, D1, KV, Workers, DNS, certificates |
| Communication | 1,900+ | Email, SMS, Slack, Discord, Twilio |
| Data | 4,200+ | ETL, scraping, parsing, vectorization |
| DevTools | 6,300+ | Git, CI/CD, testing, linting, deployment |
| Finance | 1,400+ | Stripe, crypto, DeFi, accounting |
| Media | 2,100+ | TTS, STT, image, video, audio processing |
| Monitoring | 1,800+ | Metrics, alerting, logging, tracing |
| Network | 2,200+ | DNS, firewall, proxy, VPN, bandwidth |
| Security | 1,900+ | Scanning, credentials, encryption, audit |

## Authentication

| Method | Scope | Details |
|--------|-------|---------|
| X-Echo-API-Key header | Write endpoints on all Workers | Standard API key authentication |
| Open access | Read endpoints | Health checks, public queries |
| OAuth | Wrangler CLI | Auto-refreshed (~1hr TTL) |
| Firebase Auth | Website users | echo-op.com, echo-ept.com |

## Architecture

```
+-----------------------------------------------------------+
|                    ECHO OMEGA PRIME                        |
|                   (Autonomous AI OS)                       |
+-----------------------------------------------------------+
|  Fleet Layer    | Architect + 128 Workers (Claude Opus)    |
|  Memory Layer   | 5-tier: R2 > Brain > OmniSync > Cortex  |
|  Engine Layer   | 674 engines, 178 tiers, 30K doctrines   |
|  Tool Layer     | 37,475 MCP tools via Echo Relay          |
|  Cloud Layer    | 26 Workers, 10 R2, 10 D1, 20 KV         |
|  Voice Layer    | Qwen3-TTS, Whisper, 19 emotions          |
|  Security Layer | GS343 healing, HIBP, audit trail         |
+-----------------------------------------------------------+
```

## Repository Map

| Repository | Type | Description |
|------------|------|-------------|
| [Echo-Omega-Prime](https://github.com/bobmcwilliams4/Echo-Omega-Prime) | Core | Main system -- engines, memory, fleet, tools |
| [echo-prime-tech](https://github.com/bobmcwilliams4/echo-prime-tech) | Website | echo-ept.com -- primary tech portal |
| [echo-op.com](https://github.com/bobmcwilliams4/echo-op.com) | Website | echo-op.com -- flagship site |
| [echo-chat](https://github.com/bobmcwilliams4/echo-chat) | Worker | 14-personality AI chat with doctrine-aware responses |
| [echo-knowledge-scout](https://github.com/bobmcwilliams4/echo-knowledge-scout) | Worker | Daily automated knowledge scanning |
| [echo-gs343](https://github.com/bobmcwilliams4/echo-gs343) | Worker | Error healing system (45,962 templates) |
| [echo-tax-return](https://github.com/bobmcwilliams4/echo-tax-return) | Worker | Tax preparation and intelligence API |
| [echo-lgt-website](https://github.com/bobmcwilliams4/echo-lgt-website) | Website | echo-lgt.com |
| [profinish-website](https://github.com/bobmcwilliams4/profinish-website) | Website | profinishusa.com -- custom carpentry |
| [barking-lot-website](https://github.com/bobmcwilliams4/barking-lot-website) | Website | barkinglot.org -- pet services |
| [right-at-home-bnb](https://github.com/bobmcwilliams4/right-at-home-bnb) | Website | rah-midland.com -- Airbnb rental |
| [shadowglass-browser](https://github.com/bobmcwilliams4/shadowglass-browser) | App | Privacy-first Electron browser |
| [shadowglass](https://github.com/bobmcwilliams4/shadowglass) | App | ShadowGlass core |
| [echo-shadow-browser](https://github.com/bobmcwilliams4/echo-shadow-browser) | App | Shadow browser variant |
| [EchoPilot](https://github.com/bobmcwilliams4/EchoPilot) | App | Personal AI copilot |
| [echo-companion](https://github.com/bobmcwilliams4/echo-companion) | App | AI companion |
| [echo-clip](https://github.com/bobmcwilliams4/echo-clip) | App | Clipboard intelligence |
| [echo-coin](https://github.com/bobmcwilliams4/echo-coin) | App | Cryptocurrency tools |
| [closer](https://github.com/bobmcwilliams4/closer) | App | Sales closing assistant |
| [app-closer](https://github.com/bobmcwilliams4/app-closer) | App | Closer app variant |
| [app-barking-lot](https://github.com/bobmcwilliams4/app-barking-lot) | App | Barking Lot mobile app |
| [Billysalesagent](https://github.com/bobmcwilliams4/Billysalesagent) | Worker | BillyMC AI-SDR sales agent |
| [Blackgoldasset](https://github.com/bobmcwilliams4/Blackgoldasset) | App | Oil and gas asset management |
| [codex-engine-factory](https://github.com/bobmcwilliams4/codex-engine-factory) | System | Engine build factory |
| [collectibles-grading](https://github.com/bobmcwilliams4/collectibles-grading) | App | AI collectibles grading |
| [immortality-vault](https://github.com/bobmcwilliams4/immortality-vault) | App | Digital legacy vault |
| [gameloop](https://github.com/bobmcwilliams4/gameloop) | App | Game engine |
| [game-gameloop](https://github.com/bobmcwilliams4/game-gameloop) | App | Game loop variant |
| [echo-prime-website](https://github.com/bobmcwilliams4/echo-prime-website) | Website | Echo Prime legacy site |
| [omega-prime](https://github.com/bobmcwilliams4/omega-prime) | Core | Omega Prime legacy |
| [brees-gaming-slots](https://github.com/bobmcwilliams4/brees-gaming-slots) | App | Gaming slots |
| [web-brees-gaming](https://github.com/bobmcwilliams4/web-brees-gaming) | Website | Brees gaming site |
| [web-legacy-gaming](https://github.com/bobmcwilliams4/web-legacy-gaming) | Website | Legacy gaming site |

## Build Pipeline

- **FORGE-X Cloud**: Autonomous engine builder -- cron every 5 min, 3 concurrent, Azure GPT-4.1
- **Build Orchestrator**: D1-backed pipeline with session recovery, quality gates, phase advancement
- **Quality Standard**: TIE-20 (20 mandatory components per engine, 500+ lines minimum)
- **Current Stats**: 1,709 engines complete, 3.25M lines, ~36 engines/hour

## Contributing

This is a private autonomous system. For inquiries, contact bobmcwilliams4@outlook.com.

