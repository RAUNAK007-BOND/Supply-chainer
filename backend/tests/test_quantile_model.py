"""The p50/p85/p95 quantile band, calibration, hub profiling and Shapley explanations."""
import json
import os

import pytest


def test_all_three_quantiles_loaded(predictor):
    assert predictor.is_trained
    assert sorted(predictor.models) == ["p50", "p85", "p95"]


def test_holdout_coverage_matches_targets():
    with open("Execution/quantile_band_report.json") as f:
        report = json.load(f)
    for tag, target in (("p50", 0.50), ("p85", 0.85), ("p95", 0.95)):
        assert abs(report[tag]["empirical_test_coverage"] - target) < 0.02, report[tag]


@pytest.mark.parametrize("o,d,mode", [
    ("Shanghai Port", "Rotterdam Port", "sea"), ("Regional Hub", "Local Terminal", "road"),
    ("Chicago Rail Hub", "Dallas Corridor", "rail"), ("Delhi Air Cargo", "Dubai Logistics Hub", "air"),
])
@pytest.mark.parametrize("nlp", [0.0, 0.5, 1.0])
def test_band_is_monotone_and_calibrated(predictor, o, d, mode, nlp):
    band = predictor.predict_band(o, d, mode, nlp)
    assert band["p50"] <= band["p85"] <= band["p95"]
    profile = predictor.profiles[mode]
    assert profile["floor"] <= band["p85"] <= profile["cap"]


def test_severity_increases_predicted_delay(predictor):
    calm = predictor.predict_band("Shanghai Port", "Rotterdam Port", "sea", 0.0)["p85"]
    severe = predictor.predict_band("Shanghai Port", "Rotterdam Port", "sea", 1.0)["p85"]
    assert severe > calm


def test_legacy_single_point_api_still_works(predictor):
    out = predictor.predict_worst_case_delay("Shanghai Port", "Rotterdam Port", "SEA", nlp_score=0.3)
    assert out["p_quantile"] == 0.85 and out["final_delay_presented"] > 0
    assert out["band"]["p50"] <= out["final_delay_presented"] <= out["band"]["p95"]


def test_unknown_hubs_use_same_mode_anchor_not_atlanta(predictor, recommender):
    # Previously every unknown hub silently became encoder class 0 = "Atlanta Air Hub", even for ships.
    hamburg = recommender.hubs["PORT-HAMBURG"]
    assert predictor.model_node_for(hamburg, "sea", "origin") == "Rotterdam Port"
    colombo = recommender.hubs["PORT-COLOMBO"]
    assert predictor.model_node_for(colombo, "sea", "origin") in {"Mumbai Port", "Singapore Port"}
    assert predictor.model_node_for(hamburg, "road", "origin") == "Regional Hub"
    assert predictor.model_node_for(hamburg, "road", "destination") == "Local Terminal"
    assert predictor.model_node_for(recommender.hubs["CHOKE-SUEZ"], "sea", "destination") == "Suez Canal"


def test_shapley_values_are_exact_and_additive(predictor):
    key = predictor.make_key("Shanghai Port", "Rotterdam Port", "sea", 0.9)
    exp = predictor.explain(key, "p85")
    total = sum(c["hours"] for c in exp["contributions"])
    assert total == pytest.approx(exp["model_output_h"] - exp["base_value_h"], abs=0.05)
    # the model output reproduces the raw p85 prediction
    assert exp["model_output_h"] == pytest.approx(predictor.predict_band_many([key])[0]["raw_p85"], abs=0.05)
    top = exp["contributions"][0]
    assert top["feature"] == "News severity (NLP+CARF)" and top["hours"] > 0
