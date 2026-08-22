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

# Canonical NotFair workflow

Read [`../../orcarouter/SKILL.md`](../../orcarouter/SKILL.md) completely, then follow it as the active workflow. Resolve every relative reference from that file against `../../orcarouter/`.
