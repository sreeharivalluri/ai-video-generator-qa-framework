import {
  AIPlatform,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationResult,
  GenerationStatus,
  EnvironmentConfig,
} from '../types';
import { BaseAIVideoClient } from './base-client';

/**
 * Pika Labs API Client (Pika 2.1)
 * Docs: https://pika.art/api
 *
 * Pika is known for its strong motion quality and creative style transfers.
 * Pika 2.1 introduced Pikaffects (scene-level transformations) and superior
 * lip-sync capabilities. Tested during QA exploration of AI video generation workflows.
 */
export class PikaClient extends BaseAIVideoClient {
  constructor(config: EnvironmentConfig) {
    super(
      AIPlatform.PIKA,
      config.baseUrls[AIPlatform.PIKA] || 'https://api.pika.art/v1',
      config
    );
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.pikaApiKey || process.env.PIKA_API_KEY || ''}`,
      'Content-Type': 'application/json',
    };
  }

  protected mapRequest(req: VideoGenerationRequest): Record<string, unknown> {
    return {
      promptText: req.prompt,
      negativePrompt: req.negativePrompt || '',
      frameRate: 24,
      resolution: this.mapResolution(req),
      duration: Math.min(req.duration || 3, 10),
      motion: req.motionIntensity ?? 5,
      seed: req.seed,
      style: req.stylePreset || 'default',
      ...(req.referenceImage ? { image: req.referenceImage } : {}),
    };
  }

  protected mapResponse(raw: Record<string, unknown>): VideoGenerationResponse {
    return {
      jobId: raw['id'] as string,
      status: GenerationStatus.PENDING,
      platform: AIPlatform.PIKA,
      estimatedDuration: 20,
      createdAt: raw['timestamp'] as string || new Date().toISOString(),
    };
  }

  protected mapResult(raw: Record<string, unknown>): VideoGenerationResult {
    const data = (raw['data'] || raw) as Record<string, unknown>;
    const status = this.normalizeStatus(raw['status'] as string);

    return {
      jobId: raw['id'] as string,
      status,
      videoUrl: data['resultUrl'] as string | undefined,
      thumbnailUrl: data['thumbnail'] as string | undefined,
      duration: data['duration'] as number | undefined,
      errorMessage: raw['error'] as string | undefined,
      completedAt: status === GenerationStatus.COMPLETED ? new Date().toISOString() : undefined,
    };
  }

  protected getGenerationEndpoint(): string {
    return '/generate';
  }

  protected getStatusEndpoint(jobId: string): string {
    return `/jobs/${jobId}`;
  }

  private normalizeStatus(raw: string): GenerationStatus {
    switch (raw?.toLowerCase()) {
      case 'queued':      return GenerationStatus.PENDING;
      case 'processing':  return GenerationStatus.PROCESSING;
      case 'finished':
      case 'succeeded':   return GenerationStatus.COMPLETED;
      case 'failed':
      case 'error':       return GenerationStatus.FAILED;
      default:            return GenerationStatus.PROCESSING;
    }
  }

  private mapResolution(req: VideoGenerationRequest): string {
    if (req.quality === '4K') return '4K';
    if (req.quality === '1080p') return 'HD';
    return 'SD';
  }
}
