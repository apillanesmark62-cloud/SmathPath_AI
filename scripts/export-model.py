#!/usr/bin/env python3
"""Unpack the AutoTrain model.joblib into src/lib/strand-model.json.

The browser cannot run scikit-learn, but a decision tree is only a table of
comparisons, so the tree is exported verbatim — same thresholds, same class
order, same categories — and walked in JavaScript instead. Nothing is
retrained and no parameter is altered; the sha256 of the source .joblib is
recorded in the output so the two can always be shown to match.

    pip install scikit-learn joblib pandas
    python3 scripts/export-model.py model/<file>.joblib
"""
import datetime
import hashlib
import json
import pathlib
import sys

import joblib

src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1
                   else "model/cdf2edb7-cddd-4abb-9124-93a90d53d3f2-model.joblib")
bundle = joblib.load(src)
pipe, label_map, columns = bundle["pipeline"], bundle["label_map"], bundle["feature_columns"]
prep, clf = pipe.named_steps["prep"], pipe.named_steps["model"]
tree = clf.tree_

numeric = list(prep.transformers_[0][2])
categorical = list(prep.transformers_[1][2])
encoder = prep.named_transformers_["cat"].named_steps["ordinal"]
imputer = prep.named_transformers_["cat"].named_steps["imputer"]

out = {
    "_comment": "Exported verbatim from the AutoTrain Decision Tree. Not retrained, not modified.",
    "source_file": src.name,
    "sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
    "exported_at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
    "model_name": bundle["model_name"],
    "problem_type": bundle["problem_type"],
    "target_column": bundle["target_column"],
    "params": bundle["params"],
    "feature_columns": columns,
    # ColumnTransformer emits the numeric block first, then the encoded category
    "feature_order": numeric + categorical,
    "numeric_features": numeric,
    "categorical": {
        "column": categorical[0],
        "categories": [str(c) for c in encoder.categories_[0]],
        "unknown_value": int(encoder.unknown_value),
        "imputer_fill": str(imputer.statistics_[0]),
    },
    "classes": [label_map[int(c)] for c in clf.classes_],
    "label_map": {str(k): v for k, v in label_map.items()},
    "tree": {
        "node_count": int(tree.node_count),
        "max_depth": int(clf.get_depth()),
        "n_leaves": int(clf.get_n_leaves()),
        "children_left": [int(x) for x in tree.children_left],
        "children_right": [int(x) for x in tree.children_right],
        "feature": [int(x) for x in tree.feature],
        "threshold": [float(x) for x in tree.threshold],
        "n_node_samples": [int(x) for x in tree.n_node_samples],
        "value": [[float(v) for v in tree.value[i][0]] for i in range(tree.node_count)],
    },
}

dest = pathlib.Path("src/lib/strand-model.json")
dest.write_text(json.dumps(out, indent=1))
print(f"wrote {dest} ({dest.stat().st_size} bytes)")
print(f"  {out['tree']['node_count']} nodes, {out['tree']['n_leaves']} leaves, "
      f"depth {out['tree']['max_depth']}, {out['tree']['n_node_samples'][0]} training rows")
print(f"  classes: {', '.join(out['classes'])}")
print(f"  sha256:  {out['sha256']}")
