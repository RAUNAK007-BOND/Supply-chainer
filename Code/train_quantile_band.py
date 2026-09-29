"""
Train the p50 / p95 companions to the shipped p85 quantile model.

The shipped `Execution/risk_model.pkl` (p85) was trained by `Code/ML_Model_Real.py` on the
dataset produced by `Code/real_dataset_builder.py`. That builder is fully seeded (SEED=42),
so running it again reproduces the exact same 50,000 rows. We train p50 and p95 models with
the *same* hyper-parameters and the *same* label encoders, which gives the routing engine a
confidence band (p50 / p85 / p95) instead of a single point estimate.

As a guard, we also retrain p85 and check it reproduces the shipped model's predictions — if
it doesn't, the regenerated data isn't the original training data and we refuse to write.

Also exports a small, encoded background sample used for exact Shapley explanations.

Run from the project root:  python Code/train_quantile_band.py
"""
import json
import os
import subprocess
import sys

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split

DATASET = "Execution/Supplychainer_Real_Historical_Dataset.csv"
CATEGORICAL = ["Leg_Type", "Origin_Node", "Destination_Node", "Transport_Mode", "Condition_Flag"]
FEATURES = ["Leg_Type", "Origin_Node", "Destination_Node", "Transport_Mode", "Condition_Flag", "NLP_Severity_Score"]
PARAMS = dict(n_estimators=400, learning_rate=0.05, max_depth=6, random_state=42)


def main():
    if not os.path.exists(DATASET):
        print("Regenerating seeded dataset via Code/real_dataset_builder.py ...")
        subprocess.run([sys.executable, "Code/real_dataset_builder.py"], check=True)

    df = pd.read_csv(DATASET)
    encoders = joblib.load("Execution/label_encoders.pkl")
    for col in CATEGORICAL:
        df[col] = encoders[col].transform(df[col].astype(str))

    X, y = df[FEATURES], df["Delay_Hours"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    shipped = joblib.load("Execution/risk_model.pkl")
    check = GradientBoostingRegressor(loss="quantile", alpha=0.85, **PARAMS).fit(X_train, y_train)
    drift = float(np.max(np.abs(check.predict(X_test[:500]) - shipped.predict(X_test[:500]))))
    print(f"p85 reproduction check: max |retrained - shipped| = {drift:.6f}h")
    if drift > 1e-6:
        raise SystemExit("Regenerated data does not reproduce the shipped model; aborting.")

    report = {}
    for q in (0.50, 0.95):
        model = GradientBoostingRegressor(loss="quantile", alpha=q, **PARAMS).fit(X_train, y_train)
        tag = f"p{int(q * 100)}"
        joblib.dump(model, f"Execution/risk_model_{tag}.pkl")
        coverage = float(np.mean(y_test.values <= model.predict(X_test)))
        report[tag] = {"target_quantile": q, "empirical_test_coverage": round(coverage, 4)}
        print(f"{tag}: test coverage {coverage:.3f} (target {q})")

    report["p85"] = {"target_quantile": 0.85,
                     "empirical_test_coverage": round(float(np.mean(y_test.values <= shipped.predict(X_test))), 4)}

    # Background sample for interventional Shapley values (stratified by mode).
    background = pd.concat([X_train[X_train["Transport_Mode"] == m].sample(16, random_state=7)
                            for m in sorted(X_train["Transport_Mode"].unique())])
    with open("Execution/shap_background.json", "w") as f:
        json.dump({"features": FEATURES, "rows": background[FEATURES].values.tolist()}, f)

    with open("Execution/quantile_band_report.json", "w") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
