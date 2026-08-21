/* ==========================================================
   SmartPath — the trained AutoTrain Decision Tree, in the browser

   strand-model.json is this project's own model, exported from AutoTrain as
   model.joblib and unpacked verbatim: the same tree, the same thresholds,
   the same class order. Nothing here retrains or adjusts it. The file
   records the source filename and a sha256 of the .joblib it came from, so
   the artifact submitted and the artifact running can be shown to match.

   A decision tree is the one model that ports perfectly to a browser. It is
   a few dozen comparisons — no linear algebra, no runtime, no service to
   call — so the prediction that used to need an API key and a Firebase login
   is now a walk down 53 nodes, offline and instant.

   What this file must get exactly right is scikit-learn's own semantics:

     - the ColumnTransformer's output order (seven numeric columns, then the
       encoded activity), which is why feature_order is read from the export
       rather than assumed
     - `X[feature] <= threshold` goes LEFT, otherwise right
     - an activity the model never saw encodes to unknown_value (-1), which
       is a real branch in the tree and not an error
     - class probabilities are the class distribution of the leaf reached

   parity.test.mjs checks this implementation against scikit-learn's own
   predictions across every category and thousands of rating combinations.
   ========================================================== */

import model from "./strand-model.json" with { type: "json" };

export const MODEL = model;

/* The categories the tree was actually trained on. Anything outside this
   list encodes to -1 — a branch the tree has, but one no training row took,
   so a prediction from it means little. */
export const MODEL_ACTIVITIES = model.categorical.categories;
export const MODEL_CLASSES = model.classes;

/* Human wording for the five values the model knows. The value is what the
   tree sees; the label is what the student reads. */
export const ACTIVITY_LABELS = {
  solving_problems: "Solving problems and puzzles",
  managing_money: "Managing money or running a business",
  public_speaking: "Speaking or presenting",
  building_or_creating: "Building, making or designing things",
  mixed_subjects: "A bit of everything — I like mixed subjects",
};

export function activityLabel(value) {
  return ACTIVITY_LABELS[value] || value;
}

/* ColumnTransformer: seven numeric columns passed through untouched, then
   the activity ordinal-encoded. Missing activity takes the imputer's
   most-frequent value, exactly as the fitted pipeline would. */
export function encode(answers) {
  const cat = model.categorical;
  const row = [];

  for (const key of model.numeric_features) {
    const raw = Number(answers && answers[key]);
    row.push(Number.isFinite(raw) ? raw : NaN);
  }

  let value = answers && answers[cat.column];
  if (value === undefined || value === null || value === "") value = cat.imputer_fill;
  const index = cat.categories.indexOf(value);
  row.push(index === -1 ? cat.unknown_value : index);

  return row;
}

/* Walk the tree, recording each comparison so the route can be shown. */
export function predict(answers) {
  const x = encode(answers);
  const t = model.tree;
  const path = [];

  let node = 0;
  while (t.children_left[node] !== -1) {
    const f = t.feature[node];
    const threshold = t.threshold[node];
    const observed = x[f];
    const goLeft = observed <= threshold;

    path.push({
      node,
      feature: model.feature_order[f],
      isCategory: f >= model.numeric_features.length,
      observed,
      threshold,
      goLeft,
      samples: t.n_node_samples[node],
    });

    node = goLeft ? t.children_left[node] : t.children_right[node];
  }

  const counts = t.value[node];
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const probabilities = {};
  model.classes.forEach((name, i) => {
    probabilities[name] = counts[i] / total;
  });

  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i] > counts[best]) best = i;

  const ranked = model.classes
    .map((name, i) => ({ label: name, score: counts[i] / total }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return {
    strand: model.classes[best],
    confidence: counts[best] / total,
    probabilities,
    ranked,
    leaf: node,
    leafSamples: t.n_node_samples[node],
    path,
    encoded: x,
    unknownActivity: x[x.length - 1] === model.categorical.unknown_value,
    algorithm: model.model_name,
  };
}
