---
name: gemini
argument-hint: "'review', 'challenge', or 'consult' + optional context"
description: >
  Cross-model second opinion from Google Gemini — a different AI reviewing the
  same changes, with deep Google ecosystem knowledge. Three modes: review
  (pass/fail gate for Google Ads campaigns, SEO metadata, or code), challenge
  (adversarial stress-test that tries to break your changes), and consult
  (open Q&A with Gemini on Google Ads strategy, SEO best practices, or
  implementation questions). Use when the user says "gemini review", "ask
  gemini", "gemini challenge", "second opinion from gemini", "consult gemini",
  "stress test with gemini", "what would gemini say", "cross-model review",
  or "get another opinion". Voice aliases: "gem", "gemini check". Especially
  useful for Google Ads changes, SEO metadata updates, campaign structure
  decisions, keyword strategies, and bid/budget changes — Gemini has native
  Google ecosystem knowledge that complements Claude's analysis.
triggers:
  - gemini
  - gemini review
  - gemini challenge
  - gemini consult
  - ask gemini
  - second opinion gemini
  - stress test gemini
  - gem review
  - gem consult
---

# Gemini — Cross-Model Second Opinion

You are orchestrating a cross-model review by launching Google's Gemini CLI as
an independent reviewer. Gemini brings native Google ecosystem knowledge —
especially valuable for Google Ads, Search Console, and SEO decisions where
Google's own AI has deeper context about how their platforms work.

**Unlike the code-only review pattern**, this skill handles three types of
changes:

1. **Code changes** — diffs, new files, refactors
2. **Google Ads changes** — campaign structure, bid strategies, keyword lists, negative keywords, ad copy, budget allocation
3. **SEO metadata changes** — title tags, meta descriptions, schema markup, robots directives, sitemap updates, content rewrites

---

## Step 0 — Detect Gemini CLI

```bash
command -v gemini >/dev/null 2>&1 && echo "GEMINI_FOUND" || echo "GEMINI_NOT_FOUND"
```

**If `GEMINI_NOT_FOUND`:** Stop and tell the user:

> Gemini CLI is not installed. Install it with:
>
> ```
> npm install -g @google/gemini-cli
> ```
>
> Then run `gemini` once to authenticate with your Google account, and retry.

**If `GEMINI_FOUND`:** continue silently.

---

## Step 1 — Detect Mode

Parse the user's request to determine the mode. Match against these patterns:

| Mode | Trigger phrases |
|------|----------------|
| **review** | "review", "check", "look at", "pass/fail", "gate", "approve" |
| **challenge** | "challenge", "stress test", "break", "adversarial", "find holes", "poke holes" |
| **consult** | "consult", "ask", "what does gemini think", "opinion", "advice", "strategy" |

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

Assemble the context payload that Gemini will review. Tailor it to the change type.

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

## Step 4 — Run Gemini

Build and execute the Gemini CLI command based on mode and change type.

### Review Mode

```bash
gemini -p "You are a senior reviewer with deep expertise in Google's advertising platform, Google Search, and SEO best practices. You are reviewing proposed changes for correctness, effectiveness, and potential risks.

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
- Breaking changes" 2>&1
```

Capture the output. If the exit code is non-zero, report the error to the user
and suggest checking `gemini` authentication.

### Challenge Mode

```bash
gemini -p "You are a seasoned and skeptical growth advisor who has managed eight-figure Google Ads budgets and scaled organic traffic for major brands. You have expert-level knowledge of Google's latest policies — Ads editorial standards, Performance Max behavior, broad match changes, Search quality guidelines, spam policies, Core Web Vitals thresholds, and structured data requirements.

Your role is devil's advocate. The team is proposing changes and they want you to pressure-test them before committing. Do not be agreeable — your value is in catching what optimism misses. Evaluate based on evidence, data, and your experience with how Google's systems actually behave (not how documentation says they should).

CHANGE TYPE: ${CHANGE_TYPE}

${CONTEXT}

For each proposed change:

1. STATE THE ASSUMPTION — What is the team assuming will happen?
2. CHALLENGE IT — Why might that assumption be wrong? Cite specific Google policy, algorithm behavior, or auction mechanics where relevant. Reference real patterns you'd expect to see in the data.
3. WHAT DOES THE DATA SAY? — What metrics or signals should the team check before and after to validate this change? Be specific (e.g. 'compare impression share lost to rank before and 14 days after', not 'monitor performance').
4. VERDICT — For each change: SOUND, RISKY, or RETHINK. One sentence explaining why.

Finally, give an overall honest opinion: is this set of changes worth shipping as-is, or should the team pause and address specific concerns first? Be concise and professional — no filler, no hedging." 2>&1
```

### Consult Mode

```bash
gemini -p "You are a Google Ads and SEO expert consultant with deep knowledge of Google's ecosystem — Search algorithms, Ads auction mechanics, Search Console, and web performance. The user wants your independent perspective.

CONTEXT:
${CONTEXT}

USER QUESTION:
${USER_QUESTION}

Provide a clear, opinionated answer. If you disagree with a proposed approach, say so directly and explain why. Draw on Google-specific knowledge — ad auction dynamics, search ranking factors, Quality Score mechanics, Core Web Vitals thresholds, etc." 2>&1
```

---

## Step 5 — Present Results

### 5a — Format the Gemini output

Present Gemini's response with a clear header:

> **Gemini Review** (`${CHANGE_TYPE}` | `${MODE}` mode)
>
> [Gemini's formatted output]

### 5b — Cross-model analysis (if Claude already reviewed)

If Claude has already reviewed the same changes (e.g., via `/notfair:seo-analysis`
or `/notfair:google-ads-audit` earlier in the conversation), produce a cross-model
comparison:

> **Cross-Model Analysis: Claude vs Gemini**
>
> **Overlapping findings** (both flagged):
> - [Finding 1]
> - [Finding 2]
>
> **Claude-only findings:**
> - [Finding that only Claude caught]
>
> **Gemini-only findings:**
> - [Finding that only Gemini caught]
>
> **Disagreements** (if any):
> - [Topic]: Claude says X, Gemini says Y

Overlapping findings have higher confidence — they should be addressed first.
Unique findings from either model are worth investigating. Disagreements should
be flagged to the user for a judgment call.

### 5c — Suggest next steps

Based on the results:
- **Review PASS:** "Gemini approved. Ready to ship."
- **Review FAIL:** "Gemini flagged blocking issues. Address them, then re-run `/notfair:gemini review`."
- **Challenge — HIGH risk:** "Stress test surfaced high-risk scenarios. Consider the mitigations before proceeding."
- **Challenge — LOW risk:** "Gemini couldn't find major attack vectors. Changes look resilient."
- **Consult:** "Want me to apply any of Gemini's suggestions?"
