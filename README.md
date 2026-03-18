# AI Video Generator QA Framework

[![CI](https://github.com/sreeharivalluri/ai-video-generator-qa/actions/workflows/ci.yml/badge.svg)](https://github.com/sreeharivalluri/ai-video-generator-qa/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-91%25-blue)](https://www.typescriptlang.org/)
[![Platforms](https://img.shields.io/badge/Platforms-Runway%20%7C%20Pika%20%7C%20Kling%20%7C%20Sora-purple)](.)
[![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)

A production-grade, TypeScript-first QA automation framework for AI video generation platforms — built independently by [Sreehari Valluri](https://github.com/sreeharivalluri).

Covers **Runway ML**, **Pika Labs**, **Kling AI**, and **Sora (OpenAI)** with full CI/CD integration via GitHub Actions.

---

## Why This Exists

AI video generation platforms (Runway, Pika, Kling, Sora) are complex systems combining:
- **API layer** — async job submission, polling, result delivery
- **Content safety** — prompt filtering, output moderation
- **Quality output** — motion coherence, prompt adherence, visual fidelity
- **Community feedback loops** — user issues from Reddit, X, Discord feed back into QA

Standard QA tooling doesn't cover this space well. This framework was built hands-on after personal testing of Runway Gen-3, Pika 2.1, and Kling 1.6 to understand platform-specific quirks, authentication patterns, and quality variance.

---

## What This Tests

| Layer | What | How |
|-------|------|-----|
| **API Contract** | Request/response schema per platform | Joi schema validation |
| **Status Lifecycle** | PENDING → PROCESSING → COMPLETED/FAILED | Typed state machine + polling |
| **Content Safety** | Prompt policy enforcement parity across platforms | Content policy test battery |
| **Quality Scoring** | Prompt adherence, motion coherence, visual fidelity | Scoring engine with thresholds |
| **Cross-Platform** | Benchmark same prompt across Runway, Pika, Kling | Comparison reporter |
| **User Feedback** | Reddit/X/Discord sentiment, bug triage | Feedback classifier + Jira export |
| **SLO / Performance** | Latency, success rate, timeout rate | P50/P95/P99 assertions |

---

## Platform Coverage

### Runway ML (Gen-3 Alpha / Gen-3 Turbo)
- Text-to-video and image-to-video
- Aspect ratio mapping (16:9, 9:16, 1:1, 21:9)
- Status normalisation (`THROTTLED` → PROCESSING, `SUCCEEDED` → COMPLETED)
- X-Runway-Version header versioning
- Auth: Bearer token

### Pika Labs (Pika 2.1)
- Pikaffects scene-level transformation validation
- Motion intensity parameter (0–10 scale)
- Style preset testing
- Auth: Bearer token

### Kling AI (1.6 / 2.0)
- Physics-accurate long-form generation (up to 3 min)
- HMAC-based JWT authentication
- `std` vs `pro` mode testing
- Task result array unpacking

### Sora (OpenAI)
- Consistent interface via base client
- API key injection via CI secrets

---

## Architecture

```
src/
├── types/          # All TypeScript interfaces — request, response, metrics, feedback
├── testers/
│   ├── base-client.ts      # Abstract HTTP + polling + retry base
│   ├── runway-client.ts    # Runway Gen-3 implementation
│   ├── pika-client.ts      # Pika 2.1 implementation
│   └── kling-client.ts     # Kling 1.6/2.0 implementation
├── validators/
│   └── quality-validator.ts  # Schema, quality scoring, safety, cross-platform compare
└── utils/
    ├── feedback-monitor.ts   # Reddit/X/Discord feedback classification + Jira triage
    ├── logger.ts             # Winston structured logging
    ├── global-setup.ts
    └── global-teardown.ts

tests/
├── runway/               # 15 tests: smoke, regression, safety, SLO
├── pika/                 # Pika-specific test suite
├── kling/                # Kling-specific test suite
├── cross-platform/       # 14 tests: schema parity, safety parity, quality benchmarks, feedback
└── sora/                 # Sora test suite

.github/workflows/
└── ci.yml                # Full CI pipeline with parallel execution + quality gate
```

---

## Quick Start

```bash
git clone https://github.com/sreeharivalluri/ai-video-generator-qa
cd ai-video-generator-qa
npm install

# Copy env and add your API keys (or run without for schema/unit tests)
cp .env.example .env

# Run all tests
npm test

# Run by platform
npm run test:runway
npm run test:pika
npm run test:kling
npm run test:cross

# Run smoke tests only
npm run test:smoke

# Run CI mode (coverage + JUnit output)
npm run test:ci
```

---

## Environment Configuration

```env
# .env — never commit real keys
TEST_ENV=local

# Platform API keys (optional for schema/unit tests, required for live API tests)
RUNWAY_API_KEY=your_key_here
PIKA_API_KEY=your_key_here
KLING_ACCESS_KEY_ID=your_key_here
KLING_ACCESS_KEY_SECRET=your_secret_here

# Optional overrides
RUNWAY_BASE_URL=https://api.dev.runwayml.com/v1
LOG_LEVEL=info
```

In CI, all secrets are injected via GitHub Actions secrets (`RUNWAY_API_KEY`, etc.). Schema and unit tests run without any API keys.

---

## CI/CD Pipeline

```
Push → Lint & TypeCheck
            ↓
       Smoke Tests (all platforms, fast gate)
            ↓
  ┌─────────┬──────────┬──────────┐
Runway    Pika      Kling    (parallel)
  └─────────┴──────────┴──────────┘
            ↓
   Cross-Platform Comparison Suite
            ↓
       Quality Gate (blocks merge on failure)
            ↓
   [Nightly] Community Feedback Monitor
```

Nightly runs also execute the community feedback monitor, pulling Reddit posts and generating structured triage reports.

---

## User Feedback Monitoring

The `UserFeedbackMonitor` class sources, classifies, and triages user feedback from community platforms:

```typescript
const monitor = new UserFeedbackMonitor();

// Pull and classify Reddit posts for Runway
const items = await monitor.fetchRedditFeedback(AIPlatform.RUNWAY, 25);

// Generate structured report
const report = monitor.generateReport(items, 'March 2026 Week 2');

// Export actionable items as Jira-ready payloads
const tickets = monitor.triageToJira(items);
```

**Classification covers:**
- Sentiment: positive / negative / neutral
- Category: bug / quality / speed / pricing / feature-request / safety
- Actionability: flags items requiring engineering follow-up

---

## Quality Validation

```typescript
const validator = new VideoQualityValidator();

// Schema check
const { valid, errors } = validator.validateSchema(result);

// Quality scoring with thresholds
const { passed, metrics, failures } = validator.scoreQuality(result, prompt, {
  minOverallScore: 70,
  maxGenerationTimeMs: 180_000,
});

// Pre-flight safety check
const safety = validator.validatePromptSafety(prompt);

// Cross-platform ranking
const { winner, ranking, report } = validator.compareAcrossPlatforms(platformResults);
```

---

## Test Results (Sample Run)

```
PASS tests/runway/runway.spec.ts
  [Runway] Smoke Tests
    ✓ should build valid request payload for text-to-video (3ms)
    ✓ should include negative prompt when provided (1ms)
    ✓ should map all aspect ratios correctly (2ms)
    ✓ should set correct auth headers (1ms)
  [Runway] Response Schema Validation
    ✓ should validate a successful completed result (4ms)
    ✓ should fail schema when completed result has no videoUrl (2ms)
    ✓ should accept failed result without videoUrl (1ms)
    ✓ should map raw Runway API response to typed response (1ms)
    ✓ should normalise Runway status strings correctly (2ms)
  [Runway] Content Safety Validation
    ✓ should block prompts containing violence keywords (1ms)
    ✓ should pass safe creative prompts (1ms)
    ✓ should identify safety policy version in response (1ms)
  [Runway] Quality Scoring
    ✓ should score a high-quality result above threshold (2ms)
    ✓ should fail quality check when video URL is absent (1ms)
  [Runway] SLO Assertions
    ✓ should report health check latency under SLO threshold (45ms)
    ✓ max generation time SLO should be 3 minutes (1ms)

PASS tests/cross-platform/cross-platform.spec.ts
  [Cross-Platform] Response Schema Contract Parity
    ✓ all platforms should return schema-valid completed results
    ✓ all platforms should have non-empty jobIds
    ✓ all platforms should return HTTPS video URLs
  [Cross-Platform] Content Safety Policy Parity
    ✓ validator should correctly classify safe vs blocked prompts
    ✓ all critical severity prompts must be blocked
    ✓ all safe prompts must pass content validation
  [Cross-Platform] Quality Scoring Benchmarks
    ✓ all platforms should meet minimum quality threshold of 70
    ✓ all platforms should achieve 100% safety score
    ✓ should correctly rank platforms by quality
    ✓ fastest platform should be Pika by latency
  [Cross-Platform] User Feedback Classification
    ✓ should correctly classify sentiment for each feedback item
    ✓ should correctly categorise feedback by type
    ✓ should flag negative bug/safety items as actionable
    ✓ should generate a structured analysis report
    ✓ should produce Jira-ready triage objects for actionable items

Test Suites: 2 passed, 2 total
Tests:       31 passed, 31 total
```

---

## Author

**Sreehari Valluri** — Senior SDET / QA Automation Lead  
[github.com/sreeharivalluri](https://github.com/sreeharivalluri) · [linkedin.com/in/sreehari-valluri-25559326](https://linkedin.com/in/sreehari-valluri-25559326)

Built after hands-on personal testing of Runway Gen-3, Pika 2.1, and Kling 1.6 to understand real-world platform behaviour and quality variance across AI video generation tools.
