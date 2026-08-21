#!/usr/bin/env node
/* Compares the browser evaluator against scikit-learn's own predictions for
   the same model. Any disagreement means the app would show a student
   something the trained model did not say. */
import { readFileSync } from "node:fs";
import { predict, MODEL } from "../src/lib/strandModel.js";

/* Ground truth is produced by scripts/model-truth.py, which runs the real
   scikit-learn pipeline. Generate it first:
     pip install scikit-learn joblib pandas
     python3 scripts/model-truth.py > /tmp/sklearn_truth.json  */
const truth = JSON.parse(readFileSync(process.env.TRUTH || "/tmp/sklearn_truth.json", "utf8"));
let strandMismatch = 0, probaMismatch = 0, worst = 0, firstBad = null;

for (const t of truth) {
  const got = predict(t.row);
  if (got.strand !== t.strand) {
    strandMismatch++;
    if (!firstBad) firstBad = { row: t.row, sklearn: t.strand, js: got.strand };
  }
  for (const [cls, p] of Object.entries(t.proba)) {
    const d = Math.abs((got.probabilities[cls] ?? 0) - p);
    if (d > worst) worst = d;
    if (d > 1e-9) probaMismatch++;
  }
}

console.log("  cases compared        : " + truth.length);
console.log("  predicted-class match : " + (truth.length - strandMismatch) + " / " + truth.length);
console.log("  probability mismatches: " + probaMismatch + " (largest difference " + worst.toExponential(2) + ")");
if (firstBad) console.log("  first disagreement    : " + JSON.stringify(firstBad));

/* The one sample with independent provenance: the user's Testing Console. */
const console_sample = { math_interest:2, science_interest:1, business_interest:2,
  communication_interest:5, technology_interest:2, creative_interest:5, hands_on_interest:3,
  preferred_activity:"public_speaking" };
const cs = predict(console_sample);
console.log("\n  Testing Console sample: " + cs.strand + " @ " + cs.confidence.toFixed(3) +
  "  (expected HUMSS @ 1.000)");
console.log("  decision path length  : " + cs.path.length + " comparisons, leaf built from " +
  cs.leafSamples + " training rows");
console.log("  model sha256          : " + MODEL.sha256.slice(0, 16) + "…");

const ok = strandMismatch === 0 && probaMismatch === 0 && cs.strand === "HUMSS";
console.log("\n  " + (ok ? "PARITY WITH SCIKIT-LEARN: exact" : "PARITY FAILED"));
process.exit(ok ? 0 : 1);
