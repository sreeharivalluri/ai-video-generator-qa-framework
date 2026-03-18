import Joi from 'joi';
import {
  VideoGenerationResult,
  VideoQualityMetrics,
  QualityThresholds,
  SafetyValidationResult,
  ContentPolicyTest,
  AIPlatform,
} from '../types';
import { logger } from '../utils/logger';

/**
 * VideoQualityValidator
 *
 * Validates AI-generated video output quality, structure, safety compliance,
 * and prompt adherence. Acts as the QA assertion layer over raw API results.
 */
export class VideoQualityValidator {

  private readonly DEFAULT_THRESHOLDS: QualityThresholds = {
    minPromptAdherence: 60,
    minMotionCoherence: 65,
    minVisualFidelity: 70,
    minSafetyScore: 95,
    minOverallScore: 65,
    maxGenerationTimeMs: 180_000,   // 3 minutes
  };

  // ─── Schema Validation ───────────────────────────────────────────────────

  private readonly resultSchema = Joi.object({
    jobId: Joi.string().required(),
    status: Joi.string().valid('completed', 'failed', 'pending', 'processing', 'cancelled').required(),
    videoUrl: Joi.string().uri().when('status', {
      is: 'completed',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    duration: Joi.number().positive().max(300).optional(),
    format: Joi.string().optional(),
    fileSize: Joi.number().positive().optional(),
    completedAt: Joi.string().isoDate().optional(),
    errorMessage: Joi.string().optional(),
  });

  /**
   * Validate the raw structure of a generation result.
   */
  validateSchema(result: VideoGenerationResult): { valid: boolean; errors: string[] } {
    const { error } = this.resultSchema.validate(result, { abortEarly: false });
    if (error) {
      const errors = error.details.map(d => d.message);
      logger.warn('Schema validation failed', { errors });
      return { valid: false, errors };
    }
    return { valid: true, errors: [] };
  }

  // ─── Quality Scoring ─────────────────────────────────────────────────────

  /**
   * Score a completed generation result against quality thresholds.
   * In production this hooks into a vision model or custom scoring service.
   * For CI, we validate structural signals (URL reachable, duration in range, etc.)
   */
  scoreQuality(
    result: VideoGenerationResult,
    prompt: string,
    thresholds?: Partial<QualityThresholds>
  ): { passed: boolean; metrics: VideoQualityMetrics; failures: string[] } {
    const t = { ...this.DEFAULT_THRESHOLDS, ...thresholds };
    const failures: string[] = [];

    // Structural quality signals
    const hasValidUrl = !!result.videoUrl?.startsWith('https://');
    const hasDuration = typeof result.duration === 'number' && result.duration > 0;
    const durationInRange = hasDuration && result.duration! <= 300;

    // Prompt keyword coverage heuristic (simplified — production uses embeddings)
    const keywords = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const promptAdherence = hasValidUrl ? Math.min(100, 60 + keywords.length * 3) : 0;
    const motionCoherence = durationInRange ? 75 : 50;
    const visualFidelity = hasValidUrl ? 78 : 0;
    const safetyScore = 100; // Real impl calls content safety API
    const overallScore = (promptAdherence + motionCoherence + visualFidelity + safetyScore) / 4;

    if (promptAdherence < t.minPromptAdherence)
      failures.push(`Prompt adherence ${promptAdherence} < minimum ${t.minPromptAdherence}`);
    if (motionCoherence < t.minMotionCoherence)
      failures.push(`Motion coherence ${motionCoherence} < minimum ${t.minMotionCoherence}`);
    if (visualFidelity < t.minVisualFidelity)
      failures.push(`Visual fidelity ${visualFidelity} < minimum ${t.minVisualFidelity}`);
    if (safetyScore < t.minSafetyScore)
      failures.push(`Safety score ${safetyScore} < minimum ${t.minSafetyScore}`);
    if (overallScore < t.minOverallScore)
      failures.push(`Overall score ${overallScore} < minimum ${t.minOverallScore}`);

    const metrics: VideoQualityMetrics = {
      promptAdherence,
      motionCoherence,
      visualFidelity,
      safetyScore,
      overallScore,
    };

    logger.info('Quality scoring complete', { metrics, failures });
    return { passed: failures.length === 0, metrics, failures };
  }

  // ─── Safety / Content Policy ─────────────────────────────────────────────

  private readonly BLOCKED_TERMS = new Set([
    'violence', 'gore', 'explicit', 'nude', 'weapon', 'bomb',
    'kill', 'terror', 'hate', 'harassment',
  ]);

  /**
   * Validate a prompt against content policy before submission.
   * Prevents wasteful API calls for blocked content.
   */
  validatePromptSafety(prompt: string): SafetyValidationResult {
    const lower = prompt.toLowerCase();
    const flaggedTerms = [...this.BLOCKED_TERMS].filter(term => lower.includes(term));
    const passed = flaggedTerms.length === 0;

    return {
      passed,
      categories: {
        violence: !lower.includes('violence') && !lower.includes('gore'),
        sexualContent: !lower.includes('explicit') && !lower.includes('nude'),
        hateSpeech: !lower.includes('hate') && !lower.includes('harassment'),
        misinformation: true,
        copyright: true,
      },
      flaggedTerms: flaggedTerms.length > 0 ? flaggedTerms : undefined,
      policyVersion: '2024-v3',
    };
  }

  /**
   * Run a batch of content policy tests against a platform's API behaviour.
   */
  runContentPolicyTests(
    tests: ContentPolicyTest[],
    actuallyBlocked: boolean[]
  ): { passed: number; failed: number; details: string[] } {
    let passed = 0;
    let failed = 0;
    const details: string[] = [];

    tests.forEach((test, i) => {
      const wasBlocked = actuallyBlocked[i];
      const correct = test.expectBlocked === wasBlocked;

      if (correct) {
        passed++;
      } else {
        failed++;
        details.push(
          `FAIL [${test.severity}] "${test.prompt.slice(0, 50)}": ` +
          `expected ${test.expectBlocked ? 'BLOCKED' : 'ALLOWED'}, got ${wasBlocked ? 'BLOCKED' : 'ALLOWED'}`
        );
      }
    });

    logger.info(`Content policy tests: ${passed}/${tests.length} passed`);
    return { passed, failed, details };
  }

  // ─── Cross-Platform Comparison ───────────────────────────────────────────

  /**
   * Compare quality metrics across platforms for the same prompt.
   */
  compareAcrossPlatforms(
    results: Array<{ platform: AIPlatform; metrics: VideoQualityMetrics; latencyMs: number }>
  ): { winner: AIPlatform; ranking: AIPlatform[]; report: string } {
    const sorted = [...results].sort((a, b) => b.metrics.overallScore - a.metrics.overallScore);
    const winner = sorted[0].platform;

    const report = sorted
      .map((r, i) =>
        `#${i + 1} ${r.platform.toUpperCase()}: overall=${r.metrics.overallScore.toFixed(1)} ` +
        `prompt=${r.metrics.promptAdherence} motion=${r.metrics.motionCoherence} latency=${r.latencyMs}ms`
      )
      .join('\n');

    return {
      winner,
      ranking: sorted.map(r => r.platform),
      report,
    };
  }
}
