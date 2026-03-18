import axios from 'axios';
import {
  AIPlatform,
  UserFeedbackItem,
  FeedbackAnalysisReport,
} from '../types';
import { logger } from '../utils/logger';

/**
 * UserFeedbackMonitor
 *
 * Sources, classifies, and analyses user feedback from Reddit, X (Twitter),
 * Discord, and GitHub for AI video generation platforms.
 *
 * This directly supports the "product support" and "community engagement"
 * requirements — feedback is triaged into actionable QA tickets.
 */
export class UserFeedbackMonitor {

  // ─── Reddit Monitoring ──────────────────────────────────────────────────

  private readonly SUBREDDITS: Record<AIPlatform, string> = {
    [AIPlatform.RUNWAY]: 'runwayml',
    [AIPlatform.PIKA]:   'pika_labs',
    [AIPlatform.KLING]:  'KlingAI',
    [AIPlatform.SORA]:   'OpenAI',
  };

  /**
   * Fetch recent Reddit posts for a platform and classify them.
   * Uses the public Reddit JSON API — no auth required for read-only.
   */
  async fetchRedditFeedback(
    platform: AIPlatform,
    limit = 25
  ): Promise<UserFeedbackItem[]> {
    const subreddit = this.SUBREDDITS[platform];
    const url = `https://www.reddit.com/r/${subreddit}/new.json?limit=${limit}`;

    logger.info(`[Reddit] Fetching posts from r/${subreddit}`);

    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'AIVideoQA-Monitor/1.0' },
        timeout: 10_000,
      });

      const posts = res.data?.data?.children || [];
      return posts.map((post: Record<string, unknown>) => {
        const data = post['data'] as Record<string, unknown>;
        return this.classifyFeedback({
          platform,
          source: 'reddit',
          rawText: `${data['title']} ${data['selftext']}`,
          upvotes: data['score'] as number,
          timestamp: new Date((data['created_utc'] as number) * 1000).toISOString(),
        });
      });
    } catch (err) {
      logger.error(`[Reddit] Fetch failed for ${platform}`, { err });
      return [];
    }
  }

  // ─── Feedback Classification ─────────────────────────────────────────────

  private readonly SENTIMENT_KEYWORDS = {
    positive: ['amazing', 'love', 'great', 'awesome', 'perfect', 'excellent', 'best', 'wow', 'incredible'],
    negative: ['broken', 'bug', 'error', 'fail', 'terrible', 'slow', 'crash', 'wrong', 'issue', 'problem', 'glitch'],
  };

  private readonly CATEGORY_KEYWORDS: Record<UserFeedbackItem['category'], string[]> = {
    quality:          ['quality', 'blurry', 'artifact', 'resolution', 'realistic', 'coherent'],
    speed:            ['slow', 'fast', 'latency', 'waiting', 'queue', 'minutes', 'timeout'],
    pricing:          ['price', 'cost', 'credit', 'expensive', 'subscription', 'pay', 'free'],
    bug:              ['bug', 'crash', 'error', 'broken', '500', 'fail', 'glitch'],
    'feature-request':['want', 'wish', 'please add', 'feature', 'suggestion', 'could you', 'would be nice'],
    safety:           ['nsfw', 'inappropriate', 'flagged', 'blocked', 'content policy', 'banned'],
  };

  classifyFeedback(raw: {
    platform: AIPlatform;
    source: UserFeedbackItem['source'];
    rawText: string;
    upvotes?: number;
    timestamp: string;
  }): UserFeedbackItem {
    const lower = raw.rawText.toLowerCase();

    // Sentiment
    const posScore = this.SENTIMENT_KEYWORDS.positive.filter(w => lower.includes(w)).length;
    const negScore = this.SENTIMENT_KEYWORDS.negative.filter(w => lower.includes(w)).length;
    const sentiment: UserFeedbackItem['sentiment'] =
      negScore > posScore ? 'negative' : posScore > negScore ? 'positive' : 'neutral';

    // Category
    let category: UserFeedbackItem['category'] = 'bug';
    let maxMatches = 0;
    for (const [cat, keywords] of Object.entries(this.CATEGORY_KEYWORDS)) {
      const matches = keywords.filter(k => lower.includes(k)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        category = cat as UserFeedbackItem['category'];
      }
    }

    // Actionability: negative sentiment + bug/quality/safety = actionable
    const actionable = sentiment === 'negative' &&
      ['bug', 'quality', 'safety'].includes(category);

    return {
      platform: raw.platform,
      source: raw.source,
      sentiment,
      category,
      summary: raw.rawText.slice(0, 120).replace(/\n/g, ' '),
      rawText: raw.rawText,
      upvotes: raw.upvotes,
      timestamp: raw.timestamp,
      actionable,
    };
  }

  // ─── Analysis & Reporting ────────────────────────────────────────────────

  /**
   * Aggregate feedback items into a structured report for the product team.
   */
  generateReport(items: UserFeedbackItem[], period: string): FeedbackAnalysisReport {
    const byPlatform = Object.values(AIPlatform).reduce((acc, p) => {
      acc[p] = items.filter(i => i.platform === p).length;
      return acc;
    }, {} as Record<AIPlatform, number>);

    const sentimentBreakdown = {
      positive: items.filter(i => i.sentiment === 'positive').length,
      negative: items.filter(i => i.sentiment === 'negative').length,
      neutral:  items.filter(i => i.sentiment === 'neutral').length,
    };

    // Top issues = most common categories in negative feedback
    const negItems = items.filter(i => i.sentiment === 'negative');
    const catCounts = negItems.reduce((acc, i) => {
      acc[i.category] = (acc[i.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const topIssues = Object.entries(catCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([cat, count]) => `${cat} (${count} reports)`);

    const actionableCount = items.filter(i => i.actionable).length;

    const recommendedActions: string[] = [];
    if (catCounts['bug'] > 3) recommendedActions.push('File P1 bug tickets for recurring crash reports');
    if (catCounts['quality'] > 5) recommendedActions.push('Escalate quality regression to model team');
    if (catCounts['speed'] > 4) recommendedActions.push('Investigate generation latency SLO breach');
    if (catCounts['safety'] > 1) recommendedActions.push('Urgent: Review content policy enforcement gaps');

    return {
      period,
      totalItems: items.length,
      byPlatform,
      sentimentBreakdown,
      topIssues,
      actionableCount,
      recommendedActions,
    };
  }

  /**
   * Triage actionable feedback into Jira-ready bug reports.
   * Returns structured data ready to POST to Jira REST API.
   */
  triageToJira(items: UserFeedbackItem[]): Array<Record<string, unknown>> {
    return items
      .filter(i => i.actionable)
      .map(item => ({
        fields: {
          project: { key: 'AIVQA' },
          summary: `[${item.platform.toUpperCase()}][${item.category}] User-reported: ${item.summary.slice(0, 80)}`,
          description: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{
                type: 'text',
                text: `Source: ${item.source} | Sentiment: ${item.sentiment} | ${item.rawText.slice(0, 500)}`,
              }],
            }],
          },
          issuetype: { name: item.category === 'bug' ? 'Bug' : 'Task' },
          priority: { name: item.sentiment === 'negative' && item.category === 'safety' ? 'Critical' : 'High' },
          labels: ['user-feedback', item.platform, item.source],
        },
      }));
  }
}
