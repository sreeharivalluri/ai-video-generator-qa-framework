import axios, { AxiosInstance, AxiosResponse } from 'axios';
import {
  AIPlatform,
  VideoGenerationRequest,
  VideoGenerationResponse,
  VideoGenerationResult,
  GenerationStatus,
  EnvironmentConfig,
} from '../types';
import { logger } from '../utils/logger';

/**
 * Abstract base client for AI video generation platforms.
 * Each platform (Runway, Pika, Kling, Sora) extends this with platform-specific
 * authentication, payload mapping, and polling logic.
 */
export abstract class BaseAIVideoClient {
  protected readonly http: AxiosInstance;
  protected readonly platform: AIPlatform;
  protected readonly config: EnvironmentConfig;
  private readonly MAX_POLL_ATTEMPTS = 60;
  private readonly POLL_INTERVAL_MS = 5000;

  constructor(platform: AIPlatform, baseURL: string, config: EnvironmentConfig) {
    this.platform = platform;
    this.config = config;
    this.http = axios.create({
      baseURL,
      timeout: config.timeoutMs,
      headers: this.buildHeaders(),
    });
    this.attachInterceptors();
  }

  // ─── Abstract Methods (platform-specific) ──────────────────────────────────

  protected abstract buildHeaders(): Record<string, string>;
  protected abstract mapRequest(req: VideoGenerationRequest): Record<string, unknown>;
  protected abstract mapResponse(raw: unknown): VideoGenerationResponse;
  protected abstract mapResult(raw: unknown): VideoGenerationResult;
  protected abstract getGenerationEndpoint(): string;
  protected abstract getStatusEndpoint(jobId: string): string;

  // ─── Core Flow ─────────────────────────────────────────────────────────────

  /**
   * Submit a video generation job and return immediately with jobId.
   */
  async submitGeneration(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    logger.info(`[${this.platform}] Submitting generation`, { prompt: request.prompt.slice(0, 80) });
    const startMs = Date.now();

    try {
      const payload = this.mapRequest(request);
      const res: AxiosResponse = await this.http.post(this.getGenerationEndpoint(), payload);
      const response = this.mapResponse(res.data);

      logger.info(`[${this.platform}] Job submitted`, {
        jobId: response.jobId,
        latencyMs: Date.now() - startMs,
      });

      return response;
    } catch (err) {
      logger.error(`[${this.platform}] Submission failed`, { error: err });
      throw err;
    }
  }

  /**
   * Poll for job completion, respecting timeout and retry config.
   */
  async pollForCompletion(jobId: string): Promise<VideoGenerationResult> {
    logger.info(`[${this.platform}] Polling job ${jobId}`);
    let attempts = 0;

    while (attempts < this.MAX_POLL_ATTEMPTS) {
      const res: AxiosResponse = await this.http.get(this.getStatusEndpoint(jobId));
      const result = this.mapResult(res.data);

      if (result.status === GenerationStatus.COMPLETED) {
        logger.info(`[${this.platform}] Job completed`, { jobId, attempts });
        return result;
      }

      if (result.status === GenerationStatus.FAILED) {
        logger.error(`[${this.platform}] Job failed`, { jobId, error: result.errorMessage });
        throw new Error(`Generation failed: ${result.errorMessage}`);
      }

      attempts++;
      await this.sleep(this.POLL_INTERVAL_MS);
    }

    throw new Error(`[${this.platform}] Job ${jobId} timed out after ${this.MAX_POLL_ATTEMPTS} attempts`);
  }

  /**
   * Submit and wait for completion in one call.
   */
  async generateAndWait(request: VideoGenerationRequest): Promise<VideoGenerationResult> {
    const submission = await this.submitGeneration(request);
    return this.pollForCompletion(submission.jobId);
  }

  /**
   * Check platform API health.
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; message?: string }> {
    const start = Date.now();
    try {
      await this.http.get('/health');
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { healthy: false, latencyMs: Date.now() - start, message };
    }
  }

  // ─── Retry Logic ───────────────────────────────────────────────────────────

  async withRetry<T>(fn: () => Promise<T>, attempts = this.config.retryAttempts): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        logger.warn(`[${this.platform}] Retry ${i + 1}/${attempts}`, { error: err });
        await this.sleep(1000 * (i + 1)); // exponential backoff
      }
    }
    throw lastErr;
  }

  // ─── Interceptors ──────────────────────────────────────────────────────────

  private attachInterceptors(): void {
    this.http.interceptors.request.use((cfg) => {
      logger.debug(`[${this.platform}] → ${cfg.method?.toUpperCase()} ${cfg.url}`);
      return cfg;
    });

    this.http.interceptors.response.use(
      (res) => {
        logger.debug(`[${this.platform}] ← ${res.status} ${res.config.url}`);
        return res;
      },
      (err) => {
        logger.error(`[${this.platform}] HTTP Error`, {
          status: err.response?.status,
          url: err.config?.url,
          data: err.response?.data,
        });
        return Promise.reject(err);
      }
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
