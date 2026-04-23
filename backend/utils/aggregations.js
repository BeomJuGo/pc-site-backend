const SCORE_KEYS = {
  cpu: "passmarkscore",
  gpu: "3dmarkscore",
  memory: "memoryscore",
  storage: "storagescore",
};

const BUDGET_RATIOS = {
  cpu: 0.25,
  gpu: 0.40,
  motherboard: 0.10,
  memory: 0.08,
  psu: 0.07,
  cooler: 0.04,
  storage: 0.06,
};

export function buildValueRankPipeline(category, limit = 20) {
  const scoreKey = SCORE_KEYS[category];
  const scoreField = scoreKey ? `$benchmarkScore.${scoreKey}` : null;

  const valueScoreExpr = scoreField
    ? { $cond: [{ $gt: [scoreField, 0] }, { $divide: [scoreField, "$price"] }, 0] }
    : { $divide: [1, "$price"] };

  return [
    { $match: { category, price: { $gt: 0 }, benchmarkScore: { $exists: true } } },
    { $project: { priceHistory: 0 } },
    { $addFields: { _valueScore: valueScoreExpr } },
    { $match: { _valueScore: { $gt: 0 } } },
    { $sort: { _valueScore: -1 } },
    { $limit: Math.min(limit, 50) },
  ];
}

export function buildBudgetPicksPipeline(budget) {
  const facetStages = {};

  for (const [category, ratio] of Object.entries(BUDGET_RATIOS)) {
    const maxPrice = Math.round(budget * ratio * 1.3);
    const scoreKey = SCORE_KEYS[category];
    const scoreField = scoreKey ? `$benchmarkScore.${scoreKey}` : null;

    const valueScoreExpr = scoreField
      ? { $cond: [{ $gt: [scoreField, 0] }, { $divide: [scoreField, "$price"] }, { $divide: [1, "$price"] }] }
      : { $divide: [1, "$price"] };

    facetStages[category] = [
      { $match: { category, price: { $gt: 0, $lte: maxPrice } } },
      { $project: { priceHistory: 0 } },
      { $addFields: { _vs: valueScoreExpr } },
      { $sort: { _vs: -1 } },
      { $limit: 3 },
      { $project: { _vs: 0 } },
    ];
  }

  return [{ $facet: facetStages }];
}

export { BUDGET_RATIOS };
