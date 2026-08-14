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

# Canonical NotFair workflow

Read [`../../gemini/SKILL.md`](../../gemini/SKILL.md) completely, then follow it as the active workflow. Resolve every relative reference from that file against `../../gemini/`.
