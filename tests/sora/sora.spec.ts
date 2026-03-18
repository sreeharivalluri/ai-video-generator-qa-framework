/**
 * Sora (OpenAI) QA Test Suite
 *
 * Context: Sora was explored via the web UI (sora.com) for personal
 * experimentation — testing prompt behaviour, aspect ratio outputs,
 * and quality benchmarking vs Runway. API-level tests here validate
 * the contract and client implementation, ready for when API access
 * is available.
 */

import { SoraClient } from '../../src/testers/sora-client';
import { VideoQualityValidator } from '../../src/validators/quality-validator';
import {
  AIPlatform,
  AspectRatio,
  GenerationStatus,
  EnvironmentConfig,
} from '../../src/types';

const testConfig: EnvironmentConfig = {
  name: 'ci',
  soraApiKey: process.env.SORA_API_KEY || 'mock-key-ci',
  timeoutMs: 120_000,
  retryAttempts: 2,
  parallelWorkers: 2,
  baseUrls: {
    [AIPlatform.RUNWAY]: 'https://api.dev.runwayml.com/v1',
    [AIPlatform.PIKA]:   'https://api.pika.art/v1',
    [AIPlatform.KLING]:  'https://api.klingai.com/v1',
    [AIPlatform.SORA]:   'https://api.openai.com/v1',
  },
};

const validator = new VideoQualityValidator();

// ─── Request Mapping ──────────────────────────────────────────────────────────

describe('[Sora] Request Mapping', () => {

  it('[smoke] should build valid text-to-video payload', () => {
    const client = new SoraClient(testConfig);
    // @ts-ignore
    const payload = client.mapRequest({
      prompt: 'A timelapse of a city skyline transitioning from day to night',
      duration: 5,
      aspectRatio: AspectRatio.LANDSCAPE,
    });

    expect(payload).toMatchObject({
      model: 'sora-1',
      prompt: 'A timelapse of a city skyline transitioning from day to night',
      n: 1,
      size: '1920x1080',
      duration: 5,
    });
  });

  it('[smoke] should map all aspect ratios to correct Sora size strings', () => {
    const client = new SoraClient(testConfig);
    const cases: Array<[AspectRatio, string]> = [
      [AspectRatio.LANDSCAPE, '1920x1080'],
      [AspectRatio.PORTRAIT,  '1080x1920'],
      [AspectRatio.SQUARE,    '1080x1080'],
      [AspectRatio.CINEMATIC, '2560x1080'],
    ];

    cases.forEach(([ratio, expected]) => {
      // @ts-ignore
      const payload = client.mapRequest({ prompt: 'test', aspectRatio: ratio });
      expect(payload['size']).toBe(expected);
    });
  });

  it('[smoke] should set OpenAI-Beta header for video API', () => {
    process.env.SORA_API_KEY = 'test-openai-key';
    const client = new SoraClient(testConfig);
    // @ts-ignore
    const headers = client.buildHeaders();

    expect(headers['Authorization']).toBe('Bearer test-openai-key');
    expect(headers['OpenAI-Beta']).toBe('video-v1');
  });
});

// ─── Response Normalisation ───────────────────────────────────────────────────

describe('[Sora] Response & Status Normalisation', () => {

  it('[regression] should map raw API response to typed VideoGenerationResponse', () => {
    const client = new SoraClient(testConfig);
    const raw = {
      id: 'sora_gen_abc123',
      status: 'queued',
      created: Math.floor(Date.now() / 1000),
    };

    // @ts-ignore
    const mapped = client.mapResponse(raw);
    expect(mapped.jobId).toBe('sora_gen_abc123');
    expect(mapped.platform).toBe(AIPlatform.SORA);
    expect(mapped.status).toBe(GenerationStatus.PENDING);
    expect(mapped.createdAt).toMatch(/^\d{4}-/);  // ISO string
  });

  it('[regression] should normalise all Sora status strings correctly', () => {
    const client = new SoraClient(testConfig);
    const statusMap: Array<[string, GenerationStatus]> = [
      ['queued',      GenerationStatus.PENDING],
      ['in_progress', GenerationStatus.PROCESSING],
      ['completed',   GenerationStatus.COMPLETED],
      ['failed',      GenerationStatus.FAILED],
      ['cancelled',   GenerationStatus.CANCELLED],
    ];

    statusMap.forEach(([raw, expected]) => {
      // @ts-ignore
      const result = client.mapResult({
        id: 'test',
        status: raw,
        data: [{ url: 'https://cdn.openai.com/sora/test.mp4' }],
      });
      expect(result.status).toBe(expected);
    });
  });

  it('[regression] should extract video URL from data array in completed result', () => {
    const client = new SoraClient(testConfig);
    // @ts-ignore
    const result = client.mapResult({
      id: 'sora_complete_001',
      status: 'completed',
      data: [{ url: 'https://cdn.openai.com/sora/outputs/001.mp4' }],
    });

    expect(result.videoUrl).toBe('https://cdn.openai.com/sora/outputs/001.mp4');
    expect(result.status).toBe(GenerationStatus.COMPLETED);
  });

  it('[regression] should propagate error message from failed result', () => {
    const client = new SoraClient(testConfig);
    // @ts-ignore
    const result = client.mapResult({
      id: 'sora_fail_001',
      status: 'failed',
      error: { message: 'Content policy violation: prompt rejected' },
    });

    expect(result.status).toBe(GenerationStatus.FAILED);
    expect(result.errorMessage).toContain('Content policy');
  });
});

// ─── Schema Validation ────────────────────────────────────────────────────────

describe('[Sora] Output Schema Validation', () => {

  it('[regression] completed result should pass full schema validation', () => {
    const result = {
      jobId: 'sora_schema_001',
      status: GenerationStatus.COMPLETED,
      videoUrl: 'https://cdn.openai.com/sora/outputs/schema001.mp4',
      duration: 5,
      completedAt: new Date().toISOString(),
    };

    const { valid, errors } = validator.validateSchema(result);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('[regression] failed result without video URL should still be schema-valid', () => {
    const result = {
      jobId: 'sora_schema_fail_001',
      status: GenerationStatus.FAILED,
      errorMessage: 'Server error during generation',
    };

    const { valid } = validator.validateSchema(result);
    expect(valid).toBe(true);
  });
});

// ─── UI Observation Tests (Documented from sora.com exploration) ─────────────

describe('[Sora] Quality Observations from UI Testing', () => {

  /**
   * These tests document quality characteristics observed during
   * personal UI exploration of sora.com — used to calibrate scoring
   * thresholds and benchmark against Runway ML.
   */

  it('[regression] Sora results should meet minimum quality threshold', () => {
    // Baseline established through UI experimentation
    const soraObservedMetrics = {
      jobId: 'sora_observed_001',
      status: GenerationStatus.COMPLETED,
      videoUrl: 'https://cdn.openai.com/sora/observed001.mp4',
      duration: 5,
    };

    const { passed, metrics } = validator.scoreQuality(
      soraObservedMetrics,
      'A slow-motion wave breaking on a rocky shore at sunrise'
    );

    expect(metrics.safetyScore).toBe(100);
    expect(metrics.overallScore).toBeGreaterThan(60);
    console.log('Sora quality metrics (UI-observed baseline):', metrics);
  });

  it('[regression] Sora cinematic prompts should produce landscape aspect', () => {
    const client = new SoraClient(testConfig);
    // @ts-ignore
    const payload = client.mapRequest({
      prompt: 'Cinematic establishing shot of a futuristic megacity',
      aspectRatio: AspectRatio.CINEMATIC,
    });

    // Sora supports wide cinematic format — validated via UI
    expect(payload['size']).toBe('2560x1080');
  });

  it('[regression] safety filter should block harmful prompts before submission', () => {
    // Observed via UI: Sora actively rejects harmful content at prompt stage
    const harmfulPrompts = [
      'Show graphic violence in a realistic scene',
      'Generate explicit adult content',
    ];

    harmfulPrompts.forEach(prompt => {
      const safety = validator.validatePromptSafety(prompt);
      expect(safety.passed).toBe(false);
      console.log(`✔ Pre-flight blocked: "${prompt.slice(0, 50)}"`);
    });
  });
});
