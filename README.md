# Toprank

[![Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/gVJCRczpps)

**The official Google & Meta Ads + SEO plugin from [NotFair](https://notfair.co). Data-driven decisions, not dashboards.**

Toprank gives your AI agent direct access to Google Search Console, Google Ads, and Meta Ads (Facebook + Instagram). It analyzes your traffic, surfaces what's hurting your rankings, finds wasted ad spend, diagnoses creative fatigue and audience saturation, and tells you exactly what to fix. When you have access to the repo, it goes further: rewriting meta tags, fixing headings, adding structured data, and shipping the changes.

### Why NotFair?

Toprank is the CLI side of NotFair — the skills that run inside Claude Code. [notfair.co](https://notfair.co) is the companion web app: sign in once, connect your Google Ads and Meta Ads accounts, and run audits through a browser UI. Both sides share the same engine, so an audit you run from the CLI uses the same tooling as the one on the web.

> *"Am I wasting money on ads right now?"*
> *"Why did my traffic drop and how do I fix it?"*
> *"How do I get more conversions without spending more?"*

Free, open-source. Install in 30 seconds.

---

## See It Work

### Google Ads

```
You:    /toprank:google-ads-audit

Claude: Connected to your Google Ads account (MyStore).

        3 campaigns active. $2,400 spent this month.

        Scorecard:
        ┌──────────────────────┬──────────┬──────────────────────────────┐
        │ Dimension            │ Status   │ Summary                      │
        ├──────────────────────┼──────────┼──────────────────────────────┤
        │ Conversion tracking  │ OK       │ 3 actions firing correctly   │
        │ Keyword health       │ Critical │ 8 keywords burning cash      │
        │ Search term quality  │ Warning  │ 12 irrelevant queries        │
        │ Impression share     │ Warning  │ Losing 35% to rank           │
        │ Spend efficiency     │ Critical │ $340/mo wasted               │
        └──────────────────────┴──────────┴──────────────────────────────┘

        Top 3 actions:
        1. Pause 3 keywords ($210/mo, zero conversions)
        2. Add 12 negative keywords ($130/mo wasted on irrelevant terms)
        3. Increase bids 15% on 2 high-converting keywords losing IS

        Business context saved — /toprank:google-ads-copy and /toprank:google-ads will use it.

You:    Do it all.

        [paused 3 wasteful keywords — saved $210/mo]
        [added 12 negative keywords — saved $130/mo]
        [increased bids on 2 high-performers]

        Done. All changes are reversible within 7 days.
```

**Weekly review** — ask any time, or set it up as a recurring Coworker task:

```
You:    /toprank:google-ads — "review last week's changes"

Claude: 12 changes in the last 7 days. 9 matured enough to judge.

        Wins (4):
        - Paused "cheap seo services" → CTR +18%, conversions +2
        - Added "free" as negative → wasted spend -$84/wk
        - Bid +15% on "b2b crm software" → conversions +3, CPA flat
        - New RSA on "MyStore Brand" ad group → CTR +24%

        Losses (2):
        - Bid +20% on "enterprise saas" → cost +$210, conversions flat
        - Paused "project management tool" → lost 4 conversions/wk

        Too new to judge (3) — check back in 5 days.

        Note: 2 changes had other edits on the same campaign within
        7 days, so their direction is low-confidence.
```

### SEO

```
You:    /toprank:seo-analysis

Claude: Found your site at mystore.com — pulling Search Console data now.

        [90 days of real traffic data loaded]
        [pages crawled for technical issues]

        Three things hurting you most:

        Your homepage lives at two addresses. Google splits your ranking
        power between them. Easy fix.

        Two pages targeting the same search terms — they compete against
        each other and neither wins.

        One page gets 400 monthly impressions but ranks #52. The title
        doesn't match what people actually search for.

        Here's your 30-day plan, most impactful first.
```

---

## Install

Toprank is a **Claude Code plugin**. One-time setup, automatic updates.

### Claude Code (recommended)

Run these two commands in Claude Code:

```
/plugin marketplace add nowork-studio/toprank
```

```
/plugin install toprank@nowork-studio
```

That's it. All skills are now available as `/toprank:*` commands.

**Google Ads + Meta Ads (optional):** The first time Claude Code connects to either NotFair MCP server (`NotFair-GoogleAds` or `NotFair-MetaAds`), it opens a browser tab and asks you to sign in to [notfair.co](https://notfair.co) — authorize once per platform and the token is stored in your OS keychain. No API key to copy, no `mcp-remote` bridge to install.

### Manual Install

<details>
<summary>Prefer to edit settings.json directly?</summary>

Add the marketplace and enable the plugin in `~/.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "nowork-studio": {
      "source": {
        "source": "github",
        "repo": "nowork-studio/toprank"
      }
    }
  },
  "enabledPlugins": {
    "toprank@nowork-studio": true
  }
}
```

</details>


---

## 🤖 The Fully-Automated SEO Agent (OpenClaw / Hermes)

Instead of manually running single SEO skills, the future of Toprank is the **Fully-Automated SEO Agent**. 

By leveraging the **OpenClaw adaptive layer** under [`openclaw/`](openclaw/), you can instruct OpenClaw or Hermes to automatically set up a persistent SEO agent for your project. This isn't just a set of tools—it's a background worker that configures cron jobs, continually monitors your site, runs SEO audits, and autonomously makes improvements over time.

Features of the SEO Agent:
- **Zero-Touch Setup:** Simply give the repo to OpenClaw or Hermes, and they will follow the instructions to spin up the agent for you.
- **Always-On Automation:** Automatically schedules and runs SEO tasks via cron.
- **Self-Improving:** Continuously monitors Search Console data, ships page optimizations, rewrites meta tags, and adds structured data without manual intervention.
- **Multi-Site Portfolio:** Maintains portfolio state, a per-site work folder, OpenClaw wrapper skills, and structured JSON artifacts for reviews, plans, and feedback.

Start building your agent here:

- [`openclaw/README.md`](openclaw/README.md)
- [`docs/openclaw-adaptive-layer.md`](docs/openclaw-adaptive-layer.md)

---

## Skills

### Google Ads

| Skill | What it does |
|-------|-------------|
| [`google-ads-audit`](google-ads/audit/) | Account audit + business context setup. Run this first. Scores 7 health dimensions, identifies wasted spend, builds business profile. |
| [`google-ads`](google-ads/manage/) | Campaign management. Read performance, optimize keywords, adjust bids/budgets, add negatives, create campaigns. Ask for a **weekly review** and Claude scores every recent change (wins, losses, too-new-to-judge) — perfect for a Monday-morning Coworker task. |
| [`google-ads-copy`](google-ads/copy/) | RSA copy generator + A/B testing. Data-driven headlines and descriptions with character counts and pin positions. |
| [`google-ads-landing`](google-ads/landing/) | Landing page audit. Analyzes relevance between keywords, ads, and landing page content to improve Quality Score. |

### Meta Ads (Facebook + Instagram)

| Skill | What it does |
|-------|-------------|
| [`meta-ads-audit`](meta-ads/audit/) | Account audit + business context setup. Run this first. Scores 7 health dimensions tuned for Meta (Pixel + CAPI Health, Attribution, Campaign Structure, Creative Health, Audience Strategy, Spend Efficiency, Scaling Readiness), persists creative inventory and persona data for downstream skills. |
| [`meta-ads`](meta-ads/manage/) | Campaign management. ROAS analysis, frequency-first triage, creative fatigue diagnosis, Learning Phase / Learning Limited triage, audience overlap, CBO/ABO/Advantage+ Shopping structure. Mutations route through dedicated tools (`pause*`, `enable*`, `updateAdSetBudget`, `updateCampaignBudget`, `renameCampaign`); operations outside that surface route the user to Meta Ads Manager rather than improvising. |

### SEO

| Skill | What it does |
|-------|-------------|
| [`seo-analysis`](seo/seo-analysis/) | Full SEO audit with GSC data. Quick wins, traffic drops, technical issues, 30-day action plan. |
| [`content-writer`](seo/content-writer/) | SEO content creation following E-E-A-T guidelines. Blog posts, landing pages, content improvements. |
| [`keyword-research`](seo/keyword-research/) | Keyword discovery, intent classification, topic clusters, prioritized content calendar. |
| [`meta-tags-optimizer`](seo/meta-tags-optimizer/) | Title tags, meta descriptions, OG/Twitter cards with A/B variations and CTR estimates. |
| [`schema-markup-generator`](seo/schema-markup-generator/) | JSON-LD structured data for rich results. FAQ, HowTo, Article, Product, LocalBusiness. |
| [`seo-page`](seo/seo-page/) | Single-page deep analysis. Focused audit of a specific URL for content quality, structure, and keyword optimization. |
| [`broken-link-checker`](seo/broken-link-checker/) | Scans websites to find and report broken internal and external links (404s/5xx). |
| [`geo-optimizer`](seo/geo-optimizer/) | Generative Engine Optimization (GEO) for AI search engines. Audits content with a 0–100 GEO Score, rewrites for AI citation, and produces per-engine strategy for ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews. |
| [`setup-cms`](seo/setup-cms/) | Connect WordPress, Strapi, Contentful, or Ghost for automated SEO field audits. |

### Cross-Model

| Skill | What it does |
|-------|-------------|
| [`gemini`](gemini/) | Second opinion from Google Gemini. Review (pass/fail gate), challenge (adversarial stress test), or consult (open Q&A). Especially strong on Google Ads and SEO decisions — Gemini has native Google ecosystem knowledge. |

All skills are namespaced: `/toprank:google-ads`, `/toprank:seo-analysis`, `/toprank:gemini`, etc.

---

## How It Works

Toprank is a Claude Code plugin. Each skill is a `SKILL.md` file with supporting reference documents, scripts, and eval tests.

```
toprank/
├── .claude-plugin/
│   ├── plugin.json              <- plugin metadata (explicit skill paths)
│   └── marketplace.json         <- registry entry
├── .mcp.json                    <- NotFair MCP servers (Google Ads + Meta Ads, auto-configured)
├── google-ads/
│   ├── manage/                  <- campaign management (skill: google-ads)
│   ├── audit/                   <- account audit + business context
│   ├── copy/                    <- RSA copy generator + A/B testing
│   └── landing/                 <- landing page scoring + diagnostic
├── meta-ads/
│   ├── manage/                  <- campaign management (skill: meta-ads)
│   ├── audit/                   <- account audit + Meta business context
│   └── shared/                  <- Meta-specific preamble, math, policy registry
├── seo/
│   ├── seo-analysis/            <- full SEO audit with GSC data
│   ├── content-writer/          <- E-E-A-T content creation
│   ├── keyword-research/        <- keyword discovery + topic clusters
│   ├── meta-tags-optimizer/     <- title tags, meta descriptions, OG
│   ├── schema-markup-generator/ <- JSON-LD structured data
│   ├── seo-page/                <- single-page deep analysis
│   ├── broken-link-checker/     <- broken link scanner
│   ├── geo-optimizer/           <- GEO for AI search engines
│   └── setup-cms/               <- CMS connector
├── gemini/                      <- cross-model review via Gemini CLI
├── openclaw/                    <- OpenClaw adaptive layer (multi-site wrappers, artifacts, installers)
├── toprank-upgrade-skill/       <- self-updater
├── test/                        <- unit + LLM-judge eval tests
└── VERSION
```

---

## MCP Servers

The Google Ads and Meta Ads surfaces are available as standalone remote MCP servers — use either from any MCP client (Claude Desktop, Cursor, Inspector, your own agent) without installing the Toprank CLI plugin.

### NotFair-GoogleAds

- **Registry name:** `io.github.nowork-studio/notfair` (verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=notfair"`)
- **Endpoint:** `https://notfair.co/api/mcp/google_ads` (streamable HTTP)
- **Auth:** OAuth 2.1 with dynamic client registration — your MCP client opens a browser tab to sign in at [notfair.co](https://notfair.co) on first use; the token is stored locally (OS keychain in Claude Code)

Exposes ~100 Google Ads tools across reads (performance, search terms, impression share, keyword ideas, GAQL), writes (pause/enable, bid and budget updates, keyword and negative list management, campaign creation), and a `runScript` tool that fans out up to 20 GAQL queries in parallel for open-ended analytical questions.

### NotFair-MetaAds

- **Endpoint:** `https://notfair.co/api/mcp/meta_ads` (streamable HTTP)
- **Auth:** Same OAuth 2.1 flow as NotFair-GoogleAds — sign in to [notfair.co](https://notfair.co) once per platform; tokens are independent

Exposes a focused set of Meta Marketing API tools: reads (campaign / ad set / ad listings, `getInsights` with breakdowns), writes (`pauseCampaign`, `pauseAdSet`, `pauseAd`, `enableCampaign`, `enableAdSet`, `enableAd`, `updateCampaignBudget`, `updateAdSetBudget`, `renameCampaign`), `suggestImprovement` for server-side heuristic recommendations, and a `runScript` sandbox with `ads.graph(path, params)`, `ads.graphParallel([calls])` (up to 20 Graph API calls in parallel), `ads.insights(...)`, and `ads.batch([requests])` for analytical fan-out.

The Meta server's mutation surface is intentionally narrow — there is no programmatic create-campaign, no audience editing, and no creative upload. The `/meta-ads` skill is explicit about this and routes those operations to Meta Ads Manager.

---

## Connectors

Toprank skills reference external tools using the `~~category` placeholder pattern. This makes skills tool-agnostic — they work with any MCP server that provides the required capability.

| Category | Placeholder | Default Server | Alternatives |
|----------|-------------|---------------|--------------|
| Google Ads | `~~google-ads` | [NotFair-GoogleAds MCP](https://notfair.co) (legacy `mcp__notfair__*` and `mcp__adsagent__*` still detected during the rename window) | Google Ads MCP (`mcp__google_ads_mcp__*`) |
| Meta Ads | `~~meta-ads` | [NotFair-MetaAds MCP](https://notfair.co) | Any Meta Marketing API MCP (`mcp__.*meta.*ads__*`) |
| Search Console | `~~search-console` | gcloud CLI + Search Console API | Any GSC-compatible MCP server |
| CMS | `~~cms` | Direct API (WordPress REST, Strapi, Contentful, Ghost) | Any CMS MCP server |

Skills use conditional blocks based on available tools. If a connector is not available, the skill gracefully degrades — for example, `seo-analysis` can still run a technical crawl without GSC data.

**Setup:**
- **Google Ads:** See `google-ads/shared/preamble.md`. The `.mcp.json` registers `https://notfair.co/api/mcp/google_ads` as a native HTTP MCP server; on first connection Claude Code opens a browser for OAuth sign-in to [notfair.co](https://notfair.co) and stores the token in your OS keychain — no environment variable, no bridge subprocess.
- **Meta Ads:** See `meta-ads/shared/preamble.md`. The `.mcp.json` registers `https://notfair.co/api/mcp/meta_ads` as a native HTTP MCP server; OAuth sign-in is independent from Google Ads (sign in once per platform). Skills resolve the ad account from a `metaAccountId` field in `.notfair.json` (alongside `accountId` for Google Ads — same config file, no double-prompting).
- **Search Console:** See `seo/shared/preamble.md`. Requires Google Cloud SDK, Search Console API enabled, and OAuth login.
- **CMS:** Run `/toprank:setup-cms` to configure WordPress, Strapi, Contentful, or Ghost.

---

## Contributing

Each skill lives in its own folder under a category directory:

```
seo/                      <- SEO skills go here
└── your-skill-name/
    ├── SKILL.md          <- required
    ├── scripts/          <- optional
    └── references/       <- optional

google-ads/               <- Google Ads skills go here
└── your-skill-name/
    └── SKILL.md          <- required
```

**SKILL.md** needs a frontmatter header with `name` and `description`, then step-by-step instructions in the imperative.

**Scripts:** Python 3.8+ stdlib only (or `requests`). Accept `--output` for file output. stderr for progress, stdout for data.

**Pull requests:** One skill per PR. Test your skill before submitting. Bump `VERSION` and update `CHANGELOG.md`.

Questions? Open an issue.

---

## Star History

<a href="https://www.star-history.com/?repos=nowork-studio%2Ftoprank&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=nowork-studio/toprank&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=nowork-studio/toprank&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=nowork-studio/toprank&type=date&legend=top-left" />
 </picture>
</a>

---

## License

[MIT](LICENSE)
