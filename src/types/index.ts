/**
 * Core type definitions for AI Video Generator QA Framework
 * Covers: Runway ML, Pika Labs, Kling AI, Sora (OpenAI)
 */

// ─── Platform Enums ──────────────────────────────────────────────────────────

export enum AIPlatform {
  RUNWAY = 'runway',
  PIKA = 'pika',
  KLING = 'kling',
  SORA = 'sora',
}

export enum GenerationStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum VideoQuality {
  SD = '480p',
  HD = '720p',
  FHD = '1080p',
  UHD = '4K',
}

export enum AspectRatio {
  LANDSCAPE = '16:9',
  PORTRAIT = '9:16',
  SQUARE = '1:1',
  CINEMATIC = '21:9',
}

// ─── Generation Request / Response ───────────────────────────────────────────

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  duration?: number;          // seconds
  aspectRatio?: AspectRatio;
  quality?: VideoQuality;
  seed?: number;
  model?: string;
  referenceImage?: string;    // base64 or URL
  motionIntensity?: number;   // 0-10 scale
  stylePreset?: string;
}

export interface VideoGenerationResponse {
  jobId: string;
  status: GenerationStatus;
  platform: AIPlatform;
  estimatedDuration?: number;   // seconds to complete
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface VideoGenerationResult {
  jobId: string;
  status: GenerationStatus;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  resolution?: string;
  format?: string;
  fileSize?: number;            // bytes
  completedAt?: string;
  errorMessage?: string;
  qualityMetrics?: VideoQualityMetrics;
}

// ─── Quality Metrics ─────────────────────────────────────────────────────────

export interface VideoQualityMetrics {
  promptAdherence: number;       // 0-100: how well output matches prompt
  motionCoherence: number;       // 0-100: temporal consistency
  visualFidelity: number;        // 0-100: sharpness, artifacts
  audioVideoSync?: number;       // 0-100: if audio included
  safetyScore: number;           // 0-100: content safety compliance
  overallScore: number;          // weighted composite
}

export interface QualityThresholds {
  minPromptAdherence: number;
  minMotionCoherence: number;
  minVisualFidelity: number;
  minSafetyScore: number;
  minOverallScore: number;
  maxGenerationTimeMs: number;
}

// ─── SLO / Performance ───────────────────────────────────────────────────────

export interface SLOMetrics {
  platform: AIPlatform;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  successRate: number;           // 0-1
  errorRate: number;             // 0-1
  timeoutRate: number;           // 0-1
  sloBreached: boolean;
}

export interface PerformanceBaseline {
  platform: AIPlatform;
  maxAcceptableWaitMs: number;
  minSuccessRate: number;
  maxErrorRate: number;
}

// ─── Safety & Content Policy ─────────────────────────────────────────────────

export interface SafetyValidationResult {
  passed: boolean;
  categories: {
    violence: boolean;
    sexualContent: boolean;
    hateSpeech: boolean;
    misinformation: boolean;
    copyright: boolean;
  };
  flaggedTerms?: string[];
  policyVersion: string;
}

export interface ContentPolicyTest {
  prompt: string;
  expectBlocked: boolean;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// ─── User Feedback / Community Monitoring ────────────────────────────────────

export interface UserFeedbackItem {
  platform: AIPlatform;
  source: 'reddit' | 'twitter' | 'discord' | 'github' | 'support';
  sentiment: 'positive' | 'negative' | 'neutral';
  category: 'quality' | 'speed' | 'pricing' | 'bug' | 'feature-request' | 'safety';
  summary: string;
  rawText: string;
  upvotes?: number;
  timestamp: string;
  actionable: boolean;
  linkedJiraTicket?: string;
}

export interface FeedbackAnalysisReport {
  period: string;
  totalItems: number;
  byPlatform: Record<AIPlatform, number>;
  sentimentBreakdown: { positive: number; negative: number; neutral: number };
  topIssues: string[];
  actionableCount: number;
  recommendedActions: string[];
}

// ─── Test Case Types ─────────────────────────────────────────────────────────

export interface AIVideoTestCase {
  id: string;
  title: string;
  platform: AIPlatform;
  category: 'smoke' | 'regression' | 'performance' | 'safety' | 'cross-platform';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  prompt: VideoGenerationRequest;
  expectedOutcome: {
    shouldSucceed: boolean;
    minQualityScore?: number;
    maxLatencyMs?: number;
    requiredFields?: string[];
  };
}

// ─── Bug Report ──────────────────────────────────────────────────────────────

export interface BugReport {
  id: string;
  platform: AIPlatform;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  stepsToReproduce: string[];
  expectedBehavior: string;
  actualBehavior: string;
  prompt?: string;
  jobId?: string;
  screenshotPath?: string;
  videoPath?: string;
  environment: EnvironmentConfig;
  reportedAt: string;
}

// ─── Config ──────────────────────────────────────────────────────────────────

export interface EnvironmentConfig {
  name: 'local' | 'staging' | 'production' | 'ci';
  runwayApiKey?: string;
  pikaApiKey?: string;
  klingApiKey?: string;
  soraApiKey?: string;
  timeoutMs: number;
  retryAttempts: number;
  parallelWorkers: number;
  baseUrls: Record<AIPlatform, string>;
}
