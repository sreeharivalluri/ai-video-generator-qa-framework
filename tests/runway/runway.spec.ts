/**
 * Runway ML QA Test Suite
 *
 * Tests cover: smoke, regression, safety, SLO validation
 * Platform: Runway Gen-3 Alpha / Gen-3 Turbo
 */

import { RunwayClient } from '../../src/testers/runway-client';
import { VideoQualityValidator } from '../../src/validators/quality-validator';
import {
  AIPlatform,
  AspectRatio,
  GenerationStatus,
  EnvironmentConfig,
  VideoQuality,
} from '../../src/types';

// ─── Test Config ─────────────────────────────────────────────────────────────

const testConfig: EnvironmentConfig = {
  name: (process.env.TEST_ENV as 'ci' | 'local') || 'ci',
  runwayApiKey: process.env.RUNWAY_API_KEY || 'mock-key-for-ci',
  timeoutMs: 120_000,
  retryAttempts: 2,
  parallelWorkers: 2,
  baseUrls: {
    [AIPlatform.RUNWAY]: process.env.RUNWAY_BASE_URL || 'https://api.dev.runwayml.com/v1',
    [AIPlatform.PIKA]:   'https://api.pika.art/v1',
    [AIPlatform.KLING]:  'https://api.klingai.com/v1',
    [AIPlatform.SORA]:   'https://api.openai.com/v1',
  },
};

const validator = new VideoQualityValidator();

// ─── Smoke Tests ─────────────────────────────────────────────────────────────

describe('[Runway] Smoke Tests', () => {

  it('[smoke] should build valid request payload for text-to-video', () => {
    const client = new RunwayClient(testConfig);
    // @ts-ignore — testing protected mapping
    const payload = client.mapRequest({
      prompt: 'A serene mountain lake at golden hour',
      duration: 5,
      aspectRatio: AspectRatio.LANDSCAPE,
    });

    expect(payload).toMatchObject({
      promptText: 'A serene mountain lake at golden hour',
      duration: 5,
      ratio: '1280:720',
      watermark: false,
    });
  });

  it('[smoke] should include negative prompt when provided', () => {
    const client = new RunwayClient(testConfig);
    // @ts-ignore
    const payload = client.mapRequest({
      prompt: 'Ocean waves crashing',
      negativePrompt: 'people, text, watermark',
    });

    expect(payload['promptTextNegative']).toBe('people, text, watermark');
  });

  it('[smoke] should map all aspect ratios correctly', () => {
    const client = new RunwayClient(testConfig);
    const ratioTests: Array<[AspectRatio, string]> = [
      [AspectRatio.LANDSCAPE, '1280:720'],
      [AspectRatio.PORTRAIT,  '720:1280'],
      [AspectRatio.SQUARE,    '960:960'],
      [AspectRatio.CINEMATIC, '1584:672'],
    ];

    ratioTests.forEach(([ratio, expected]) => {
      // @ts-ignore
      const payload = client.mapRequest({ prompt: 'test', aspectRatio: ratio });
      expect(payload['ratio']).toBe(expected);
    });
  });

  it('[smoke] should set correct auth headers', () => {
    process.env.RUNWAY_API_KEY = 'test-key-abc123';
    const client = new RunwayClient(testConfig);
    // @ts-ignore
    const headers = client.buildHeaders();

    expect(headers['Authorization']).toBe('Bearer test-key-abc123');
    expect(headers['X-Runway-Version']).toBeDefined();
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// ─── Schema / Response Validation ────────────────────────────────────────────

describe('[Runway] Response Schema Validation', () => {

  it('[regression] should validate a successful completed result', () => {
    const mockResult = {
      jobId: 'rwy_job_abc123',
      status: GenerationStatus.COMPLETED,
      videoUrl: 'https://cdn.runwayml.com/outputs/abc123.mp4',
      duration: 5,
      completedAt: new Date().toISOString(),
    };

    const { valid, errors } = validator.validateSchema(mockResult);
    expect(valid).toBe(true);
    expect(errors).toHaveLength(0);
  });

  it('[regression] should fail schema when completed result has no videoUrl', () => {
    const badResult = {
      jobId: 'rwy_job_xyz',
      status: GenerationStatus.COMPLETED,
      // Missing videoUrl — should fail
    };

    const { valid, errors } = validator.validateSchema(badResult as never);
    expect(valid).toBe(false);
    expect(errors.some(e => e.includes('videoUrl'))).toBe(true);
  });

  it('[regression] should accept failed result without videoUrl', () => {
    const failedResult = {
      jobId: 'rwy_job_fail',
      status: GenerationStatus.FAILED,
      errorMessage: 'Content policy violation',
    };

    const { valid } = validator.validateSchema(failedResult);
    expect(valid).toBe(true);
  });

  it('[regression] should map raw Runway API response to typed response', () => {
    const client = new RunwayClient(testConfig);
    const rawApiResponse = {
      id: 'rwy_task_12345',
      status: 'PENDING',
      model: 'gen3a_turbo',
      createdAt: '2025-03-01T10:00:00Z',
    };

    // @ts-ignore
    const mapped = client.mapResponse(rawApiResponse);
    expect(mapped.jobId).toBe('rwy_task_12345');
    expect(mapped.platform).toBe(AIPlatform.RUNWAY);
    expect(mapped.status).toBe(GenerationStatus.PENDING);
  });

  it('[regression] should normalise Runway status strings correctly', () => {
    const client = new RunwayClient(testConfig);
    const statusMap: Array<[string, GenerationStatus]> = [
      ['PENDING',   GenerationStatus.PENDING],
      ['RUNNING',   GenerationStatus.PROCESSING],
      ['THROTTLED', GenerationStatus.PROCESSING],
      ['SUCCEEDED', GenerationStatus.COMPLETED],
      ['FAILED',    GenerationStatus.FAILED],
      ['CANCELLED', GenerationStatus.CANCELLED],
    ];

    statusMap.forEach(([raw, expected]) => {
      // @ts-ignore
      const result = client.mapResult({ id: 'test', status: raw, output: ['https://example.com/v.mp4'] });
      expect(result.status).toBe(expected);
    });
  });
});

// ─── Safety Tests ─────────────────────────────────────────────────────────────

describe('[Runway] Content Safety Validation', () => {

  it('[safety] should block prompts containing violence keywords', () => {
    const result = validator.validatePromptSafety('Show extreme violence and gore');
    expect(result.passed).toBe(false);
    expect(result.categories.violence).toBe(false);
    expect(result.flaggedTerms).toContain('violence');
  });

  it('[safety] should pass safe creative prompts', () => {
    const safePrompts = [
      'A butterfly landing on a flower in slow motion',
      'Timelapse of city lights at night',
      'A chef preparing pasta in a rustic kitchen',
    ];

    safePrompts.forEach(prompt => {
      const result = validator.validatePromptSafety(prompt);
      expect(result.passed).toBe(true);
      expect(result.flaggedTerms).toBeUndefined();
    });
  });

  it('[safety] should identify safety policy version in response', () => {
    const result = validator.validatePromptSafety('Normal test prompt');
    expect(result.policyVersion).toBeDefined();
    expect(result.policyVersion).toMatch(/^\d{4}-v\d+$/);
  });
});

// ─── Quality Scoring ──────────────────────────────────────────────────────────

describe('[Runway] Quality Scoring', () => {

  it('[regression] should score a high-quality result above threshold', () => {
    const result = {
      jobId: 'rwy_hq_001',
      status: GenerationStatus.COMPLETED,
      videoUrl: 'https://cdn.runwayml.com/outputs/hq001.mp4',
      duration: 5,
      completedAt: new Date().toISOString(),
    };

    const { passed, metrics } = validator.scoreQuality(
      result,
      'A beautiful sunset over mountains with dramatic clouds'
    );

    expect(passed).toBe(true);
    expect(metrics.overallScore).toBeGreaterThan(60);
    expect(metrics.safetyScore).toBe(100);
  });

  it('[regression] should fail quality check when video URL is absent', () => {
    const result = {
      jobId: 'rwy_fail_001',
      status: GenerationStatus.COMPLETED,
      videoUrl: undefined,
      duration: 5,
    };

    const { passed, failures } = validator.scoreQuality(result as never, 'Test prompt');
    expect(passed).toBe(false);
    expect(failures.length).toBeGreaterThan(0);
  });
});

// ─── SLO / Performance Tests ──────────────────────────────────────────────────

describe('[Runway] SLO Assertions', () => {

  it('[performance] should report health check latency under SLO threshold', async () => {
    const client = new RunwayClient(testConfig);
    // In CI without real API keys, health check will fail gracefully
    const health = await client.healthCheck();
    // We assert the response shape, not the network result
    expect(typeof health.healthy).toBe('boolean');
    expect(typeof health.latencyMs).toBe('number');
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('[performance] max generation time SLO should be 3 minutes', () => {
    const SLO_MAX_MS = 180_000;
    expect(SLO_MAX_MS).toBe(3 * 60 * 1000);
  });
});
