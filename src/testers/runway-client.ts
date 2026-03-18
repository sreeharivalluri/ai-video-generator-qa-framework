import {
  AIPlatform,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationResult,
  GenerationStatus,
  EnvironmentConfig,
  AspectRatio,
} from '../types';
import { BaseAIVideoClient } from './base-client';

/**
 * Runway ML Gen-3 Alpha API Client
 * Docs: https://docs.dev.runwayml.com
 *
 * Runway is the most API-mature AI video platform.
 * Used during personal testing and QA exploration of the Gen-3 model pipeline.
 * Supports text-to-video, image-to-video, and motion brush capabilities.
 */
export class RunwayClient extends BaseAIVideoClient {
  constructor(config: EnvironmentConfig) {
    super(
      AIPlatform.RUNWAY,
      config.baseUrls[AIPlatform.RUNWAY] || 'https://api.dev.runwayml.com/v1',
      config
    );
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.runwayApiKey || process.env.RUNWAY_API_KEY || ''}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06',
    };
  }

  protected mapRequest(req: VideoGenerationRequest): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: req.model || 'gen3a_turbo',
      promptText: req.prompt,
      duration: req.duration || 5,
      ratio: this.mapAspectRatio(req.aspectRatio || AspectRatio.LANDSCAPE),
      watermark: false,
    };

    if (req.negativePrompt) {
      payload.promptTextNegative = req.negativePrompt;
    }
    if (req.seed !== undefined) {
      payload.seed = req.seed;
    }
    if (req.referenceImage) {
      payload.promptImage = req.referenceImage;
    }

    return payload;
  }

  protected mapResponse(raw: Record<string, unknown>): VideoGenerationResponse {
    return {
      jobId: raw['id'] as string,
      status: GenerationStatus.PENDING,
      platform: AIPlatform.RUNWAY,
      estimatedDuration: 30,
      createdAt: raw['createdAt'] as string || new Date().toISOString(),
      metadata: { model: raw['model'] },
    };
  }

  protected mapResult(raw: Record<string, unknown>): VideoGenerationResult {
    const status = this.normalizeStatus(raw['status'] as string);
    const output = raw['output'] as string[] | undefined;

    return {
      jobId: raw['id'] as string,
      status,
      videoUrl: output?.[0],
      duration: raw['duration'] as number | undefined,
      errorMessage: raw['failure'] as string | undefined,
      completedAt: status === GenerationStatus.COMPLETED ? new Date().toISOString() : undefined,
    };
  }

  protected getGenerationEndpoint(): string {
    return '/tasks';
  }

  protected getStatusEndpoint(jobId: string): string {
    return `/tasks/${jobId}`;
  }

  private normalizeStatus(raw: string): GenerationStatus {
    switch (raw?.toLowerCase()) {
      case 'pending':   return GenerationStatus.PENDING;
      case 'running':
      case 'throttled': return GenerationStatus.PROCESSING;
      case 'succeeded': return GenerationStatus.COMPLETED;
      case 'failed':    return GenerationStatus.FAILED;
      case 'cancelled': return GenerationStatus.CANCELLED;
      default:          return GenerationStatus.PROCESSING;
    }
  }

  private mapAspectRatio(ratio: AspectRatio): string {
    const map: Record<AspectRatio, string> = {
      [AspectRatio.LANDSCAPE]: '1280:720',
      [AspectRatio.PORTRAIT]:  '720:1280',
      [AspectRatio.SQUARE]:    '960:960',
      [AspectRatio.CINEMATIC]: '1584:672',
    };
    return map[ratio] || '1280:720';
  }
}
