# OpenClaw surface for Toprank

Toprank + OpenClaw is now a **closed-loop SEO operator**.

It does not just run one-off audits. It can now:
- pull real SEO signals from Google Search Console,
- diagnose opportunities,
- prioritize the next action using learned history,
- persist proposals and safe operational steps,
- schedule follow-up checks,
- score whether changes worked,
- update learned priors,
- and keep going.

This directory adds that multi-site adaptive layer for OpenClaw **without replacing the existing Toprank skills**.

## The new power

**SEO becomes a continuous system instead of a manual project.**

```text
signals -> diagnosis -> action -> follow-up measurement -> scoring -> learned priors -> better next action
```

![Continuous SEO Improvement Loop](artifacts/visuals/continuous-seo-improvement-loop.jpg)

In practice, this means OpenClaw can continuously work a portfolio of sites by reading live data, generating the next best move, revisiting outcomes later, and getting smarter from the result.

## What it is

- `skills/` — OpenClaw wrapper skills
- `shared/` — adapter rules, artifact contract, policy, and trigger docs
- `artifacts/schemas/` — JSON schemas for runtime artifacts
- `bin/` — small helper scripts for multi-site workspace bootstrapping
- `install/` — installers/bootstrap helpers

## What it is not

- not a second copy of the SEO skill library
- not a replacement for the Claude plugin surface
- not a production auto-publisher

## Runtime state

The adaptive layer writes runtime state outside the repo by default:

```
~/.toprank/openclaw
```

Override with:

```
export TOPRANK_OPENCLAW_HOME=/custom/path
```

## Install

Run from the Toprank repo root:

```bash
./openclaw/install/install.sh
```

That script:

1. creates `~/.toprank/openclaw/` if needed,
2. bootstraps `portfolio.json` and `schedule.json`,
3. copies all OpenClaw wrapper skills into `~/.openclaw/skills/`,
4. links support paths so the wrappers can still resolve this repo's canonical `seo/` skills.

Why copy instead of symlink wrapper skills directly? OpenClaw skill discovery intentionally rejects symlinks that escape the configured skill root. The installer copies wrappers into the OpenClaw skill root and uses stable support links for repo-relative files.

Verify:

```bash
openclaw skills check | grep -i toprank
python3 -m pytest -q openclaw/tests
```

## Paste this into OpenClaw

Use this as the setup prompt for a fresh machine or a new OpenClaw instance. Replace the placeholders before pasting.

```text
Set up the Toprank OpenClaw SEO Operator on this machine.

Repo:
- If the Toprank repo already exists locally, use it; do not reclone.
- Otherwise clone https://github.com/nowork-studio/toprank and cd into the repo root.

Install:
1. Run: ./openclaw/install/install.sh
2. Verify Toprank skills are discoverable: openclaw skills check | grep -i toprank
3. Run tests: python3 -m pytest -q openclaw/tests

Sites:
- Register these sites if they are not already in ~/.toprank/openclaw/portfolio.json:
  - <site_id_1> with GSC property <gsc_property_1>
  - <site_id_2> with GSC property <gsc_property_2>
- If GSC properties are unknown, run:
  python3 seo/seo-analysis/scripts/list_gsc_sites.py
  Then update each site's ~/.toprank/openclaw/sites/<site_id>/site-profile.json with "gsc_property".

Background wiring:
- Install OpenClaw cron jobs with:
  ./openclaw/install/install-openclaw-cron.sh --to "<delivery_destination>" --channel "<channel>" --thread-id "<optional_thread_id>"
- If there is no chat delivery target, omit --to; the jobs should be installed with --no-deliver.
- Do not pass --model unless you first verify the model is accepted by this OpenClaw instance's model allowlist.

Smoke test:
1. Run the scheduler once:
   TOPRANK_OPENCLAW_HOME="$HOME/.toprank/openclaw" python3 openclaw/bin/run_scheduler.py
2. Run one weekly review:
   TOPRANK_OPENCLAW_HOME="$HOME/.toprank/openclaw" python3 openclaw/bin/weekly_review.py "<site_id_1>"
3. Confirm the review wrote audit.json, action-plan.json, and verification.json under ~/.toprank/openclaw/sites/<site_id>/runs/.
4. Confirm openclaw cron list shows Toprank OpenClaw Scheduler and one Toprank Weekly Review job per active site.

Policy:
- This is an SEO operator loop, not an auto-publisher.
- Do not edit websites, CMS content, repos, or publish changes without explicit approval.
- Weekly review jobs may propose actions and write artifacts only.

Report back with:
- installed skill names,
- active sites and GSC properties,
- cron job ids/schedules,
- smoke-test artifact path,
- any blockers.
```

## Bootstrap a site work folder

```bash
./openclaw/install/bootstrap-site.sh https://example.com
```

That creates:

```text
~/.toprank/openclaw/sites/example.com/
├── site-profile.json
├── goals.json
├── latest-state.json
├── learned-patterns.json
├── queue/
├── proposals/
├── runs/
└── feedback/
```

## Why this matters

Before this layer, Toprank had strong point skills.

Now it has memory and recurrence:
- **real signal ingestion** via GSC analysis,
- **persistent state** per website,
- **scheduled follow-ups** instead of forgotten recommendations,
- **feedback scoring** instead of vague “seems better”,
- **learned priors** so future prioritization adapts.

That is the step from “SEO assistant” to “SEO operating loop”.

## Working helper scripts

- `python3 openclaw/bin/onboard_site.py <url> ...` — updates `portfolio.json`, `site-profile.json`, and `goals.json`
- `python3 openclaw/bin/persist_run.py <site> --payload-file payload.json` — writes review artifacts into a timestamped run folder and refreshes `latest-state.json`
- `python3 openclaw/bin/portfolio_review.py` — ranks active sites and writes a portfolio review snapshot
- `python3 openclaw/bin/weekly_review.py <site>` — generates a real weekly review payload from GSC analysis, persists artifacts, and creates a scored follow-up baseline
- `python3 openclaw/bin/improve_page.py <site> --url <url> ...` — persists a page-improvement proposal and follow-up task
- `python3 openclaw/bin/investigate_drop.py <site> --summary "..." ...` — persists a drop investigation and recovery plan
- `python3 openclaw/bin/followups_due.py` — shows which scheduled follow-up items are due now
- `python3 openclaw/bin/run_scheduler.py` — processes due schedule items, materializes follow-up review artifacts, and surfaces manual-attention work
- `python3 openclaw/bin/record_followup_metrics.py <site> <item_id> ...` — records observed metrics on a queued follow-up
- `python3 openclaw/bin/hydrate_followup_gsc.py <site> <item_id> ...` — pulls real GSC metrics into a queued follow-up using the existing `seo-analysis` scripts (uses `site-profile.json` `gsc_property` when present, otherwise falls back to `canonical_url`)
- `python3 openclaw/bin/score_feedback.py --item-file <queue-item.json>` — scores a follow-up as win / neutral / loss / inconclusive

Use these example payloads and flows as templates:

- `openclaw/artifacts/examples/weekly-review-payload.json`
- `openclaw/artifacts/examples/gsc-analysis-sample.json`
- `openclaw/artifacts/examples/improve-page-payload.json`
- `openclaw/artifacts/examples/investigate-drop-payload.json`
- `openclaw/artifacts/examples/scored-feedback-item.json`

## Wrapper skills

- `toprank-site-onboard` — register a site and initialize its work folder
- `toprank-portfolio-review` — rank all active sites by urgency/opportunity
- `toprank-weekly-review` — review one site and propose the next best action
- `toprank-improve-page` — improve one URL on a site
- `toprank-investigate-drop` — traffic-drop recovery workflow

## Autonomous loop building blocks

The closed loop is now made of three concrete runtime pieces:

1. **Weekly review from real data**
   - `weekly_review.py` runs or reads GSC analysis
   - generates `audit.json`, `action-plan.json`, `verification.json`
   - seeds `baseline_metrics` for later scoring

2. **Scheduled follow-up evaluation**
   - `run_scheduler.py` revisits due `feedback_check` items
   - `hydrate_followup_gsc.py` can pull fresh observed metrics
   - `score_feedback.py` classifies `win` / `neutral` / `loss` / `inconclusive`

3. **Learning from outcomes**
   - `learned-patterns.json` stores site-level priors
   - weekly review uses those priors to bias future action ranking

## Automated weekly review

The OpenClaw layer now has a real weekly review runner:

```bash
python3 openclaw/bin/weekly_review.py example.com
```

Useful flags:
- `--gsc-property sc-domain:example.com`
- `--analysis-file openclaw/artifacts/examples/gsc-analysis-sample.json`

This runner:
- runs or reads GSC analysis,
- builds `audit.json`, `action-plan.json`, and `verification.json`,
- inherits baseline metrics into the follow-up queue item,
- uses `learned-patterns.json` to bias action ranking,
- turns raw signals into a concrete next action plus a measurable follow-up.

## Scheduler runner

The MVP now includes a simple runner for automation:

```bash
python3 openclaw/bin/run_scheduler.py
# or
./openclaw/install/run-scheduler.sh
```

What it does today:
- processes due `feedback_check` items automatically,
- scores them as `win`, `neutral`, `loss`, or `inconclusive` when metric snapshots exist,
- writes follow-up run artifacts,
- marks processed schedule items,
- updates `learned-patterns.json` with outcome priors,
- surfaces unsupported due items as `ready_for_attention`.

Install it with OpenClaw cron:

```bash
# With chat delivery for useful weekly-review summaries:
./openclaw/install/install-openclaw-cron.sh \
  --to "<delivery_destination>" \
  --channel telegram \
  --thread-id "<optional_thread_id>"

# Without chat delivery:
./openclaw/install/install-openclaw-cron.sh
```

The OpenClaw cron installer creates:

- `Toprank OpenClaw Scheduler` — hourly follow-up processor
- `Toprank Weekly Review — <site>` — one weekly review per active portfolio site

It intentionally does not set a model by default. If you want a model override, pass `--model <provider/model>` only after confirming the local OpenClaw model allowlist accepts it.

macOS `launchd` is still available as a lower-level alternative:

```bash
./openclaw/install/install-launchd.sh --write-only
# inspect the plist, then load it for real:
./openclaw/install/install-launchd.sh
```

Or use the system cron example at `openclaw/install/toprank-openclaw.cron.example`.

This is now the core of a real autonomous operator loop.

## Design principle

The OpenClaw surface is an **adapter layer**. The existing Toprank skill folders remain canonical. The OpenClaw wrappers add persistent state, portfolio awareness, artifact writing, and policy gates.
