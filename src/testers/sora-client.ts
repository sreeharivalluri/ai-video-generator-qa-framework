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
 * Sora (OpenAI) API Client
 *
 * NOTE: Sora's public API access was limited during initial exploration.
 * Personal experience was primarily through the Sora.com web UI —
 * exploring prompt behaviour, aspect ratio outputs, and generation quality.
 *
 * This client implements the expected API contract based on OpenAI's
 * published API patterns and Sora documentation, making it ready for
 * integration testing once API access is available.
 *
 * Docs: https://platform.openai.com/docs/api-reference/video
 */
export class SoraClient extends BaseAIVideoClient {
  constructor(config: EnvironmentConfig) {
    super(
      AIPlatform.SORA,
      config.baseUrls[AIPlatform.SORA] || 'https://api.openai.com/v1',
      config
    );
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.soraApiKey || process.env.SORA_API_KEY || ''}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'video-v1',
    };
  }

  protected mapRequest(req: VideoGenerationRequest): Record<string, unknown> {
    return {
      model: req.model || 'sora-1',
      prompt: req.prompt,
      n: 1,
      size: this.mapSize(req.aspectRatio || AspectRatio.LANDSCAPE),
      duration: req.duration || 5,
      quality: req.quality || '1080p',
      response_format: 'url',
    };
  }

  protected mapResponse(raw: Record<string, unknown>): VideoGenerationResponse {
    return {
      jobId: raw['id'] as string,
      status: GenerationStatus.PENDING,
      platform: AIPlatform.SORA,
      estimatedDuration: 45,
      createdAt: raw['created'] ? new Date((raw['created'] as number) * 1000).toISOString() : new Date().toISOString(),
    };
  }

  protected mapResult(raw: Record<string, unknown>): VideoGenerationResult {
    const status = this.normalizeStatus(raw['status'] as string);
    const data = raw['data'] as Array<Record<string, unknown>> | undefined;

    return {
      jobId: raw['id'] as string,
      status,
      videoUrl: data?.[0]?.['url'] as string | undefined,
      errorMessage: (raw['error'] as Record<string, unknown>)?.['message'] as string | undefined,
      completedAt: status === GenerationStatus.COMPLETED ? new Date().toISOString() : undefined,
    };
  }

  protected getGenerationEndpoint(): string {
    return '/video/generations';
  }

  protected getStatusEndpoint(jobId: string): string {
    return `/video/generations/${jobId}`;
  }

  private normalizeStatus(raw: string): GenerationStatus {
    switch (raw?.toLowerCase()) {
      case 'queued':      return GenerationStatus.PENDING;
      case 'in_progress': return GenerationStatus.PROCESSING;
      case 'completed':   return GenerationStatus.COMPLETED;
      case 'failed':      return GenerationStatus.FAILED;
      case 'cancelled':   return GenerationStatus.CANCELLED;
      default:            return GenerationStatus.PROCESSING;
    }
  }

  private mapSize(ratio: AspectRatio): string {
    const map: Record<AspectRatio, string> = {
      [AspectRatio.LANDSCAPE]: '1920x1080',
      [AspectRatio.PORTRAIT]:  '1080x1920',
      [AspectRatio.SQUARE]:    '1080x1080',
      [AspectRatio.CINEMATIC]: '2560x1080',
    };
    return map[ratio];
  }
}
