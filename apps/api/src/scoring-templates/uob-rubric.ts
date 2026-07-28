/**
 * The UOB Innovation Challenge judging rubric, as a loadable template.
 *
 * Two levels: categories, and the scoring rows beneath them. Every row is
 * scored independently — the rubric document groups some rows under a single
 * shared score ("10 if both questions fulfilled, 5 if one"), but that collapses
 * two separate judgements into one. A team with a strong delivery plan and no
 * scalability story would score the same as the reverse, and the result would
 * not say which. Splitting them keeps the same totals and says more.
 *
 * The guiding question is the row label — it is what the judge is actually
 * answering. The anchors sit beneath as reference text, informing the score
 * without constraining it: a judge can score 8 where the rubric names 10 and 5.
 *
 * Totals: 20 + 40 + 10 + 20 + 10 = 100 across 12 rows.
 */

export type RubricRow = {
  /** The guiding question. Shown as the row label. */
  name: string;
  maxScore: number;
  /** Anchor guidance, shown beneath the slider. */
  guidanceText?: string;
  requiresComment?: boolean;
};

export type RubricCategory = {
  name: string;
  maxScore: number;
  /** Shown behind an info affordance on the category header. */
  description?: string;
  rows: RubricRow[];
};

export const UOB_RUBRIC: { name: string; description: string; categories: RubricCategory[] } = {
  name: 'UOB Innovation Challenge',
  description: 'Judging criteria version 1',
  categories: [
    {
      name: 'Innovative & Differentiated Approach',
      maxScore: 20,
      description:
        "Demonstrates the ability to clearly identify and effectively address a specific pain point, with a high degree of originality and an innovative approach reflected in the solution's uniqueness and value proposition.",
      rows: [
        {
          name: 'Does the solution fully address the problem statement?',
          maxScore: 10,
          guidanceText: '10 if it fully satisfies · 5 if it partially satisfies',
        },
        {
          name: 'Is the solution innovative?',
          maxScore: 10,
          guidanceText: '10 if original (pioneer) · 5 if innovative or differentiated',
        },
      ],
    },
    {
      name: 'Business Impact',
      maxScore: 40,
      description:
        'Demonstrates tangible value with credible metrics or estimates across revenue uplift, efficiency gains, or loss avoidance.',
      rows: [
        {
          name: 'How many value types does the POC address?',
          maxScore: 10,
          guidanceText: '10 if more than one value type · 5 if one value type',
        },
        {
          name: 'Are the metrics outlined sound and comprehensive?',
          maxScore: 5,
          guidanceText: '5 if fully satisfies · 0 if it does not',
        },
        {
          name: 'Does the solution meet all the success metrics outlined?',
          maxScore: 10,
          guidanceText: '10 if fully satisfies · 5 if partially satisfies',
        },
        {
          name: 'Is the potential value from the POC more than USD 500k per annum?',
          maxScore: 10,
          guidanceText: '10 if at or above USD 500k · 5 if below · 0 if no quantitative benefit',
        },
        {
          name: 'Does the solution improve customer experience, internal or external?',
          maxScore: 5,
          guidanceText: '5 if it satisfies',
        },
      ],
    },
    {
      name: 'Feasibility & Scalability',
      maxScore: 10,
      description:
        'Demonstrates a practical solution with a clear path to delivery, and the ability to scale across similar use cases, teams, processes or markets.',
      rows: [
        {
          name: 'Is the solution and delivery plan clear?',
          maxScore: 5,
          guidanceText: '5 if clear · 0 if not',
        },
        {
          name: 'Is the solution scalable across other use cases?',
          maxScore: 5,
          guidanceText: '5 if scalable across teams, markets or processes · 0 if not',
        },
      ],
    },
    {
      name: 'Team Collaboration & Resourcefulness',
      maxScore: 20,
      description:
        'Demonstrates strong teamwork with cross-functional collaboration, prioritising the integration of existing enterprise tools, data and platforms. PoCs may explore new tools where appropriate, while minimising the need for additional investment.',
      rows: [
        {
          name: 'Does the team portray teamwork, including cross-functional collaboration?',
          maxScore: 10,
          guidanceText: '10 if fulfilled · 5 if partially',
        },
        {
          name: 'Does the team leverage at least one existing enterprise tool?',
          maxScore: 10,
          guidanceText: '10 if fulfilled · 5 if partially',
        },
      ],
    },
    {
      name: "Judge's Bonus",
      maxScore: 10,
      description: 'Bonus points at the judge\u2019s discretion.',
      rows: [
        {
          name: 'Bonus points at your discretion',
          maxScore: 10,
          guidanceText:
            'No anchors — use your judgement. A reason is required so the score can be understood later.',
          requiresComment: true,
        },
      ],
    },
  ],
};

/** Sanity check, run at import time — a miscounted rubric should fail loudly. */
const categoryTotal = UOB_RUBRIC.categories.reduce((sum, c) => sum + c.maxScore, 0);
const rowTotal = UOB_RUBRIC.categories.reduce(
  (sum, c) => sum + c.rows.reduce((s, r) => s + r.maxScore, 0),
  0,
);
if (categoryTotal !== 100 || rowTotal !== 100) {
  throw new Error(
    `UOB rubric does not total 100: categories ${categoryTotal}, rows ${rowTotal}`,
  );
}
