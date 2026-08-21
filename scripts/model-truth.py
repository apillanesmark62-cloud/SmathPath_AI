#!/usr/bin/env python3
"""Emit scikit-learn's own predictions, for scripts/model-parity.mjs to check
the browser evaluator against.

    python3 scripts/model-truth.py > /tmp/sklearn_truth.json
    node scripts/model-parity.mjs
"""
import json, random, sys, warnings, pathlib
warnings.filterwarnings("ignore")
import joblib, pandas as pd

src = pathlib.Path("model/cdf2edb7-cddd-4abb-9124-93a90d53d3f2-model.joblib")
bundle = joblib.load(src)
pipe, label_map, columns = bundle["pipeline"], bundle["label_map"], bundle["feature_columns"]
cats = list(pipe.named_steps["prep"].named_transformers_["cat"].named_steps["ordinal"].categories_[0])
numeric = columns[:7]

random.seed(7)
rows = []
for activity in cats + ["not_a_trained_category", "", None]:
    for _ in range(700):
        row = {k: random.randint(1, 5) for k in numeric}
        row["preferred_activity"] = activity
        rows.append(row)
for activity in cats:
    for v in (1, 3, 5):
        row = {k: v for k in numeric}
        row["preferred_activity"] = activity
        rows.append(row)

X = pd.DataFrame(rows)[columns]
pred, proba = pipe.predict(X), pipe.predict_proba(X)
json.dump([
    {"row": rows[i], "strand": label_map[int(pred[i])],
     "proba": {label_map[j]: float(proba[i][j]) for j in range(len(label_map))}}
    for i in range(len(rows))
], sys.stdout)
