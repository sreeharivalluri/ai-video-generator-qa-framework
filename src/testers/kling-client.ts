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
 * Kling AI API Client (Kling 1.6 / 2.0)
 * Docs: https://klingai.com/api-reference
 *
 * Kling (by Kuaishou) excels at physics-accurate motion and long-form generation.
 * Supports up to 3 minutes of video. Tested for motion quality benchmarking
 * and cross-platform comparison against Runway and Pika.
 */
export class KlingClient extends BaseAIVideoClient {
  private readonly accessKeyId: string;
  private readonly accessKeySecret: string;

  constructor(config: EnvironmentConfig) {
    super(
      AIPlatform.KLING,
      config.baseUrls[AIPlatform.KLING] || 'https://api.klingai.com/v1',
      config
    );
    // Kling uses HMAC-based auth (access key + secret)
    this.accessKeyId = process.env.KLING_ACCESS_KEY_ID || '';
    this.accessKeySecret = process.env.KLING_ACCESS_KEY_SECRET || '';
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.generateJWT()}`,
      'Content-Type': 'application/json',
    };
  }

  protected mapRequest(req: VideoGenerationRequest): Record<string, unknown> {
    return {
      model_name: req.model || 'kling-v1-6',
      prompt: req.prompt,
      negative_prompt: req.negativePrompt,
      cfg_scale: 0.5,
      mode: 'std',                           // 'std' or 'pro'
      aspect_ratio: this.mapAspectRatio(req.aspectRatio || AspectRatio.LANDSCAPE),
      duration: String(req.duration || 5),   // '5' or '10'
      ...(req.referenceImage ? {
        image_url: req.referenceImage,
        image_tail_url: undefined,
      } : {}),
    };
  }

  protected mapResponse(raw: Record<string, unknown>): VideoGenerationResponse {
    const data = (raw['data'] || {}) as Record<string, unknown>;
    return {
      jobId: data['task_id'] as string,
      status: GenerationStatus.PENDING,
      platform: AIPlatform.KLING,
      estimatedDuration: 60,
      createdAt: data['created_at'] as string || new Date().toISOString(),
      metadata: { taskStatus: data['task_status'] },
    };
  }

  protected mapResult(raw: Record<string, unknown>): VideoGenerationResult {
    const data = (raw['data'] || raw) as Record<string, unknown>;
    const taskStatus = data['task_status'] as string;
    const status = this.normalizeStatus(taskStatus);

    const works = (data['task_result'] as Record<string, unknown>)?.['videos'] as Array<Record<string, unknown>> | undefined;
    const firstVideo = works?.[0];

    return {
      jobId: data['task_id'] as string,
      status,
      videoUrl: firstVideo?.['url'] as string | undefined,
      duration: firstVideo?.['duration'] as number | undefined,
      errorMessage: data['task_status_msg'] as string | undefined,
      completedAt: status === GenerationStatus.COMPLETED
        ? new Date((data['updated_at'] as number) * 1000).toISOString()
        : undefined,
    };
  }

  protected getGenerationEndpoint(): string {
    return '/videos/text2video';
  }

  protected getStatusEndpoint(jobId: string): string {
    return `/videos/text2video/${jobId}`;
  }

  private normalizeStatus(raw: string): GenerationStatus {
    switch (raw) {
      case 'submitted':   return GenerationStatus.PENDING;
      case 'processing':  return GenerationStatus.PROCESSING;
      case 'succeed':     return GenerationStatus.COMPLETED;
      case 'failed':      return GenerationStatus.FAILED;
      default:            return GenerationStatus.PROCESSING;
    }
  }

  private mapAspectRatio(ratio: AspectRatio): string {
    const map: Record<AspectRatio, string> = {
      [AspectRatio.LANDSCAPE]: '16:9',
      [AspectRatio.PORTRAIT]:  '9:16',
      [AspectRatio.SQUARE]:    '1:1',
      [AspectRatio.CINEMATIC]: '21:9',
    };
    return map[ratio];
  }

  /**
   * Kling uses JWT auth. In production this signs with the access key secret.
   * For CI environments, inject KLING_JWT directly via secrets.
   */
  private generateJWT(): string {
    if (process.env.KLING_JWT) return process.env.KLING_JWT;
    // Simplified stub — real impl uses jsonwebtoken to sign HS256
    return Buffer.from(`${this.accessKeyId}:${this.accessKeySecret}`).toString('base64');
  }
}
