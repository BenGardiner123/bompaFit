// Insight callouts. Every line on screen traces to a computed condition — there
// are no hardcoded sentences.
//
// Voice: Bompa speaks in the first person about its own decisions. "I pulled
// Thursday's deload forward three days", not "Deload has been rescheduled."

import { MODEL, type Acwr, type Scores } from './calc';
import type { WeekBudget } from './schedule';
import type { Adjustment } from './types';

export type InsightTone = 'action' | 'observation';

export type Insight = {
  id: string;
  tone: InsightTone;
  text: string;
  /** Set when this callout describes something Bompa actually did. */
  adjustmentId?: number;
  /** Higher wins when trimming to the dashboard limit. */
  urgency: number;
};

export const MAX_INSIGHT_CHARS = 140;
const MAX_ON_DASHBOARD = 2;

/**
 * Callouts must fit the card without wrapping into a paragraph. Templates are
 * written short; this is the backstop that keeps a long lift name from blowing
 * the budget.
 */
function clamp(text: string): string {
  if (text.length <= MAX_INSIGHT_CHARS) return text;
  return `${text.slice(0, MAX_INSIGHT_CHARS - 1).trimEnd()}…`;
}

export function buildInsights(args: {
  scores: Scores;
  acwr: Acwr;
  recentAdjustments: Adjustment[];
  daysSinceRest: number;
  now: number;
  /** This week against what it was planned to cost. */
  week?: WeekBudget;
  weekOverBudget?: boolean;
}): Insight[] {
  const { scores, acwr, recentAdjustments, daysSinceRest, week, weekOverBudget } = args;
  const out: Insight[] = [];

  // Nothing logged yet means nothing to say. Filler on an empty dashboard is
  // worse than an empty dashboard.
  if (scores.sessions === 0 && recentAdjustments.length === 0) return [];

  // 1. Something Bompa actually changed. Highest urgency: the user needs to know
  //    their plan moved before they need to know anything else.
  for (const adj of recentAdjustments.filter((a) => !a.revertedAt).slice(0, 2)) {
    out.push({
      id: `adj-${adj.id ?? adj.at}`,
      tone: 'action',
      text: clamp(adj.narrative),
      adjustmentId: adj.id,
      urgency: 100,
    });
  }

  // 2. Workload ramping faster than the body has a base for.
  if (acwr.ratio !== null && acwr.ratio > MODEL.ACWR_DANGER) {
    out.push({
      id: 'acwr-high',
      tone: 'action',
      text: clamp(
        `This week is ${Math.round(acwr.ratio * 100 - 100)}% above the load you've built a base for. Ease the next session or take the rest day early.`,
      ),
      urgency: 90,
    });
  }

  // 3. The week is carrying more than it was built for. Volume arithmetic is
  //    exact the moment an extra session lands, so this is said now rather than
  //    at the week boundary when it is too late to act on.
  //
  //    Suppressed when ACWR is already firing: both report load running ahead of
  //    plan, over different horizons, and saying it twice is noise.
  const acwrFiring = acwr.ratio !== null && acwr.ratio > MODEL.ACWR_DANGER;
  if (weekOverBudget && week && !acwrFiring) {
    const over = Math.round(week.overshoot * 100);
    const trimmable = week.remaining.length;
    out.push({
      id: 'week-over-budget',
      tone: 'action',
      text: clamp(
        trimmable > 0
          ? `You're ${over}% over what this week was built for. Want me to trim the ${trimmable} still to come?`
          : `You're ${over}% over what this week was built for. Nothing left to adjust — worth knowing though.`,
      ),
      urgency: 85,
    });
  }

  // 3. Deep fatigue with no rest behind it.
  if (scores.fatigueScore >= 75 && daysSinceRest >= 4) {
    out.push({
      id: 'fatigue-high',
      tone: 'action',
      text: clamp(`Fatigue is sitting at ${scores.fatigueScore} with ${daysSinceRest} days on the trot. A rest day now buys back more than it costs.`),
      urgency: 80,
    });
  }

  // 4. Fresh and climbing — worth saying, because this is when to push.
  if (!scores.lowConfidence && scores.readiness >= 70 && scores.fatigueScore < 60) {
    out.push({
      id: 'primed',
      tone: 'observation',
      text: clamp('Fitness is climbing faster than fatigue. Good day to push the top set.'),
      urgency: 40,
    });
  }

  // 5. Detraining risk — the opposite failure, and the one nobody notices.
  if (acwr.ratio !== null && acwr.ratio < MODEL.ACWR_LOW && scores.historyDays >= MODEL.MIN_CONFIDENT_DAYS) {
    out.push({
      id: 'acwr-low',
      tone: 'observation',
      text: clamp("You're training well below your recent baseline. Fitness drains slower than fatigue, but it does drain."),
      urgency: 35,
    });
  }

  // 6. Not enough history to be confident, but enough to be encouraging.
  if (scores.lowConfidence && scores.historyDays > 0) {
    out.push({
      id: 'low-confidence',
      tone: 'observation',
      text: clamp(`${MODEL.MIN_CONFIDENT_DAYS - scores.historyDays} more days of logging and I can read your fatigue properly.`),
      urgency: 20,
    });
  }

  return out.sort((a, b) => b.urgency - a.urgency).slice(0, MAX_ON_DASHBOARD);
}
