---
name: orcarouter
argument-hint: "'review', 'challenge', or 'consult' + optional context"
description: >
  Cross-model second opinion from OrcaRouter — one OpenAI-compatible endpoint
  that routes each review to the best available model among 150+ (OpenAI,
  Anthropic, Google, DeepSeek, Qwen, xAI, and more). Three modes: review
  (pass/fail gate for Google Ads campaigns, SEO metadata, or code), challenge
  (adversarial stress-test that tries to break your changes), and consult
  (open Q&A on Google Ads strategy, SEO best practices, or implementation
  questions). Use when the user says "orcarouter review", "ask orcarouter",
  "orcarouter challenge", "second opinion from orcarouter", "consult
  orcarouter", "stress test with orcarouter", "what would orcarouter say",
  "cross-model review", or "get another opinion". Voice aliases: "orca review",
  "orca challenge", "orca consult". Unlike the gemini skill, no CLI install is
  needed — just an ORCAROUTER_API_KEY and curl. Especially useful when you want
  a genuinely independent perspective from a different model family than the
  one doing the work, without installing per-vendor CLIs.
triggers:
  - orcarouter
  - orcarouter review
  - orcarouter challenge
  - orcarouter consult
  - ask orcarouter
  - second opinion orcarouter
  - stress test orcarouter
  - orca review
  - orca challenge
  - orca consult
---

# OrcaRouter — Cross-Model Second Opinion

You are orchestrating a cross-model review by calling OrcaRouter, an
OpenAI-compatible routing gateway. OrcaRouter exposes 150+ models from OpenAI,
Anthropic, Google, DeepSeek, Qwen, xAI and others behind a single endpoint and
API key, and its `orcarouter/auto` smart router picks the best upstream model
for each request. That makes it a lightweight way to get a second opinion from
a different model family than the one doing the work — no per-vendor CLI to
install, just an API key.

**Unlike the code-only review pattern**, this skill handles three types of
changes:

1. **Code changes** — diffs, new files, refactors
2. **Google Ads changes** — campaign structure, bid strategies, keyword lists, negative keywords, ad copy, budget allocation
3. **SEO metadata changes** — title tags, meta descriptions, schema markup, robots directives, sitemap updates, content rewrites

---

## Step 0 — Check for an OrcaRouter API key

```bash
if [ -n "$ORCAROUTER_API_KEY" ]; then echo "KEY_FOUND"; else echo "NO_KEY"; fi
```

**If `NO_KEY`:** Stop and tell the user:

> No `ORCAROUTER_API_KEY` is set. Get a key at
> https://www.orcarouter.ai/console (keys start with `sk-orca-`), then run:
>
> ```
> export ORCAROUTER_API_KEY=sk-orca-...
> ```
>
> and retry.

**If `KEY_FOUND`:** continue silently.

---

## Step 0b — Choose the Model

By default the skill uses OrcaRouter's smart router `orcarouter/auto`, which
picks the best upstream model for each request. Users can pin a specific model
with the `ORCAROUTER_MODEL` environment variable:

```bash
MODEL="${ORCAROUTER_MODEL:-orcarouter/auto}"
```

Useful pinned options for a second opinion (full catalog at
https://www.orcarouter.ai/models):

| Model ID | What it is |
|---|---|
| `orcarouter/auto` | Default. Routes each request to the best-fit upstream model. |
| `openai/gpt-5.5` | OpenAI flagship for general reasoning. |
| `anthropic/claude-sonnet-4.6` | Anthropic, strong at nuanced judgment. |
| `deepseek/deepseek-chat` | DeepSeek, economical alternative perspective. |

Note that model IDs are namespaced (for example `openai/...`, `anthropic/...`).
For the most independent second opinion, pick a model family different from the
one doing the work.

---

## Step 1 — Detect Mode

Parse the user's request to determine the mode. Match against these patterns:

| Mode | Trigger phrases |
|------|----------------|
| **review** | "review", "check", "look at", "pass/fail", "gate", "approve" |
| **challenge** | "challenge", "stress test", "break", "adversarial", "find holes", "poke holes" |
| **consult** | "consult", "ask", "what does orcarouter think", "opinion", "advice", "strategy" |

**If ambiguous:** default to **review** for changes that exist in the diff, or
**consult** if the user is asking a question with no pending changes.

---

## Step 2 — Detect Change Type

Determine what kind of changes are being reviewed. Check in this order:

### 2a — Check for Google Ads changes

Look for signs of Ads-related work in the current conversation context:
- Recent MCP tool calls to universal `mcp__NotFair__google_ads_*` tools or a supported dedicated Google Ads namespace
- Discussion of campaigns, keywords, bids, budgets, ad copy, negative keywords
- Files like `.notfair/change-log.json` or Ads-related config changes

If found, set `CHANGE_TYPE=google-ads`.

### 2b — Check for SEO metadata changes

Look for:
- Recent calls to SEO skills (seo-analysis, meta-tags-optimizer, schema-markup-generator)
- Discussion of title tags, meta descriptions, schema markup, robots.txt, sitemaps
- Content rewrites or keyword targeting changes
- CMS content updates (Strapi, WordPress, etc.)

If found, set `CHANGE_TYPE=seo`.

### 2c — Check for code changes

```bash
git diff --stat HEAD 2>/dev/null || echo "NO_GIT_DIFF"
```

If there's a diff, set `CHANGE_TYPE=code`.

### 2d — Mixed or unclear

If multiple types are present, set `CHANGE_TYPE=mixed`. If nothing is found and
mode is **consult**, set `CHANGE_TYPE=consult-only`.

---

## Step 3 — Build the Context

Assemble the context payload that OrcaRouter will send to the routed model.
Tailor it to the change type.

### For `google-ads` changes:

Summarize the proposed Ads changes in a structured block:

```
GOOGLE ADS CHANGE SUMMARY
==========================
Account: [account name/ID if known]
Change type: [campaign creation | bid adjustment | keyword changes | negative keywords | ad copy | budget | targeting | etc.]

BEFORE (current state):
[Describe current campaign/keyword/bid state]

AFTER (proposed changes):
[Describe what will change]

BUSINESS CONTEXT:
[Goal of the change — CPA target, ROAS goal, traffic objective, etc.]
```

### For `seo` changes:

```
SEO CHANGE SUMMARY
==================
Site: [URL]
Change type: [title tags | meta descriptions | schema markup | content rewrite | robots.txt | sitemap | etc.]

BEFORE (current state):
[Current metadata/content]

AFTER (proposed changes):
[New metadata/content]

TARGET KEYWORDS:
[Keywords being targeted, if applicable]

SEARCH INTENT:
[Informational / navigational / commercial / transactional]
```

### For `code` changes:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
DIFF=$(git diff HEAD 2>/dev/null)
STAT=$(git diff --stat HEAD 2>/dev/null)
```

Combine the diff stat and full diff into the context.

### For `mixed` changes:

Combine all applicable sections above.

---

## Step 4 — Run OrcaRouter

Call the OrcaRouter chat completions endpoint with curl, using the prompt for
the detected mode. The model defaults to `orcarouter/auto`.

### Review Mode

```bash
MODEL="${ORCAROUTER_MODEL:-orcarouter/auto}"

cat > /tmp/orcarouter-prompt.txt <<EOF
You are a senior reviewer with deep expertise across paid media, organic
search, and software engineering. You are reviewing proposed changes for
correctness, effectiveness, and potential risks. Your perspective is
independent of the model that produced the changes.

CHANGE TYPE: ${CHANGE_TYPE}

${CONTEXT}

Evaluate these changes and produce a structured review:

1. VERDICT: PASS or FAIL (use FAIL if any blocking issue exists)

2. BLOCKING ISSUES (if any):
   - Issue, why it matters, and how to fix it

3. WARNINGS (non-blocking but worth considering):
   - Concern and recommendation

4. STRENGTHS:
   - What the changes do well

For Google Ads changes, specifically check:
- Policy compliance (disapprovals, trademark issues, restricted content)
- Budget efficiency (is spend allocated to highest-intent keywords?)
- Keyword conflicts (cannibalization, broad match pitfalls, missing negatives)
- Landing page alignment (do ads match what the page delivers?)
- Bid strategy fit (does the strategy match the campaign goal?)

For SEO changes, specifically check:
- Title tag length (under 60 chars) and keyword placement (front-loaded?)
- Meta description length (under 160 chars) and call-to-action presence
- Schema markup validity and completeness
- Potential keyword cannibalization across pages
- Search intent alignment (does the content match what users expect?)
- E-E-A-T signals (expertise, experience, authoritativeness, trustworthiness)
- Internal linking opportunities missed

For code changes, check:
- Correctness and edge cases
- Security issues
- Performance concerns
- Breaking changes
EOF

BODY=$(jq -Rs --arg model "$MODEL" \
  '{model: $model, messages: [{role: "user", content: .}]}' \
  < /tmp/orcarouter-prompt.txt)

RESPONSE=$(curl -s -X POST "https://api.orcarouter.ai/v1/chat/completions" \
  -H "Authorization: Bearer $ORCAROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY")

echo "$RESPONSE" | jq -r '.choices[0].message.content // .error.message // .'
```

Capture the output. If the response contains an `error` field or is empty,
report it to the user and suggest checking the API key and model ID.

### Challenge Mode

```bash
MODEL="${ORCAROUTER_MODEL:-orcarouter/auto}"

cat > /tmp/orcarouter-prompt.txt <<EOF
You are a seasoned and skeptical growth advisor who has managed eight-figure
advertising budgets and scaled organic traffic for major brands. You are
deeply familiar with Google Ads editorial standards, Performance Max behavior,
broad match changes, Search quality guidelines, spam policies, Core Web Vitals
thresholds, and structured data requirements.

Your role is devil's advocate. The team is proposing changes and they want you
to pressure-test them before committing. Do not be agreeable — your value is
in catching what optimism misses. Evaluate based on evidence, data, and
experience with how platforms actually behave (not how documentation says they
should).

CHANGE TYPE: ${CHANGE_TYPE}

${CONTEXT}

For each proposed change:

1. STATE THE ASSUMPTION — What is the team assuming will happen?
2. CHALLENGE IT — Why might that assumption be wrong? Cite specific policy,
   algorithm behavior, or auction mechanics where relevant. Reference real
   patterns you'd expect to see in the data.
3. WHAT DOES THE DATA SAY? — What metrics or signals should the team check
   before and after to validate this change? Be specific (e.g. 'compare
   impression share lost to rank before and 14 days after', not 'monitor
   performance').
4. VERDICT — For each change: SOUND, RISKY, or RETHINK. One sentence
   explaining why.

Finally, give an overall honest opinion: is this set of changes worth shipping
as-is, or should the team pause and address specific concerns first? Be
concise and professional — no filler, no hedging.
EOF

BODY=$(jq -Rs --arg model "$MODEL" \
  '{model: $model, messages: [{role: "user", content: .}]}' \
  < /tmp/orcarouter-prompt.txt)

RESPONSE=$(curl -s -X POST "https://api.orcarouter.ai/v1/chat/completions" \
  -H "Authorization: Bearer $ORCAROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY")

echo "$RESPONSE" | jq -r '.choices[0].message.content // .error.message // .'
```

### Consult Mode

```bash
MODEL="${ORCAROUTER_MODEL:-orcarouter/auto}"

cat > /tmp/orcarouter-prompt.txt <<EOF
You are an expert consultant across paid media, organic search, and web
engineering, with working knowledge of ad auction dynamics, search ranking
factors, Quality Score mechanics, and Core Web Vitals thresholds. The user
wants your independent perspective on their question.

CONTEXT:
${CONTEXT}

USER QUESTION:
${USER_QUESTION}

Provide a clear, opinionated answer. If you disagree with a proposed approach,
say so directly and explain why. If the question is about a platform you know
well, draw on its specific mechanics (auction dynamics, ranking factors,
editorial policies, and so on).
EOF

BODY=$(jq -Rs --arg model "$MODEL" \
  '{model: $model, messages: [{role: "user", content: .}]}' \
  < /tmp/orcarouter-prompt.txt)

RESPONSE=$(curl -s -X POST "https://api.orcarouter.ai/v1/chat/completions" \
  -H "Authorization: Bearer $ORCAROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d "$BODY")

echo "$RESPONSE" | jq -r '.choices[0].message.content // .error.message // .'
```

---

## Step 5 — Present Results

### 5a — Format the OrcaRouter output

Present the response with a clear header that names the routed model (from
`MODEL`):

> **OrcaRouter Review** (`${CHANGE_TYPE}` | `${MODE}` mode | model `$MODEL`)
>
> [OrcaRouter's formatted output]

### 5b — Cross-model analysis (if the working model already reviewed)

If the working model has already reviewed the same changes (e.g., via
`/notfair:seo-analysis` or `/notfair:google-ads-audit` earlier in the
conversation), produce a cross-model comparison:

> **Cross-Model Analysis: Working Model vs OrcaRouter**
>
> **Overlapping findings** (both flagged):
> - [Finding 1]
> - [Finding 2]
>
> **Working-model-only findings:**
> - [Finding that only the working model caught]
>
> **OrcaRouter-only findings:**
> - [Finding that only OrcaRouter's routed model caught]
>
> **Disagreements** (if any):
> - [Topic]: Working model says X, OrcaRouter says Y

Overlapping findings have higher confidence — they should be addressed first.
Unique findings from either side are worth investigating. Disagreements should
be flagged to the user for a judgment call.

### 5c — Suggest next steps

Based on the results:
- **Review PASS:** "OrcaRouter approved. Ready to ship."
- **Review FAIL:** "OrcaRouter flagged blocking issues. Address them, then re-run `/notfair:orcarouter review`."
- **Challenge — HIGH risk:** "Stress test surfaced high-risk scenarios. Consider the mitigations before proceeding."
- **Challenge — LOW risk:** "OrcaRouter couldn't find major attack vectors. Changes look resilient."
- **Consult:** "Want me to apply any of OrcaRouter's suggestions?"
