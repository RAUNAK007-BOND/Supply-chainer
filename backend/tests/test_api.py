"""HTTP API: persistence, live-scenario alerts, exports, webhooks and supplier intelligence."""
import hashlib
import hmac
import json

import pytest


def plan(client, **kw):
    body = {"source": "Shanghai", "destination": "Rotterdam", **kw}
    r = client.post("/api/recommend", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_status_reports_real_engine_state(client):
    s = client.get("/api/status").json()
    assert s["ml_trained"] and s["nlp_ready"] and s["quantiles"] == ["p50", "p85", "p95"]
    assert s["engine_status"] == "FULLY OPERATIONAL"


def test_network_has_coordinates_for_map(client):
    net = client.get("/api/network").json()
    assert len(net["nodes"]) >= 440
    assert all(isinstance(n["lat"], float) and isinstance(n["lon"], float) for n in net["nodes"])
    assert {"sea", "air", "rail", "road"} <= {e["mode"] for e in net["edges"]}


def test_hub_search_ranks_prefix_matches(client):
    res = client.get("/api/hubs/search", params={"q": "rotter"}).json()
    assert res and "Rotterdam" in res[0]["display_name"]


def test_runs_are_persisted_and_listed(client):
    out = plan(client)
    run_id = out["run_id"]
    runs = client.get("/api/runs").json()
    assert any(r["id"] == run_id for r in runs)
    full = client.get(f"/api/runs/{run_id}").json()
    assert full["response"]["recommendations"][0]["adjusted_eta"] == out["recommendations"][0]["adjusted_eta"]


@pytest.mark.parametrize("fmt,ctype", [("csv", "text/csv"), ("pdf", "application/pdf"),
                                       ("tms", "application/json")])
def test_exports(client, fmt, ctype):
    run_id = plan(client)["run_id"]
    r = client.get(f"/api/runs/{run_id}/export", params={"format": fmt, "index": 1})
    assert r.status_code == 200 and r.headers["content-type"].startswith(ctype)
    if fmt == "pdf":
        assert r.content[:4] == b"%PDF"
    if fmt == "csv":
        assert "buffer_p85_h" in r.text and "CHOKE-SUEZ" in r.text
    if fmt == "tms":
        doc = r.json()
        assert doc["schema"] == "supplychainer.shipment_plan.v1"
        assert doc["eta"]["p50"] <= doc["eta"]["p85"] <= doc["eta"]["p95"]
        assert doc["legs"][-1]["planned_arrival_p85"] == doc["eta"]["p85"]


def test_live_scenario_alerts_watched_route_with_replan(client):
    client.post("/api/scenarios/live", json={"scenario_id": None})
    out = plan(client)
    run_id = out["run_id"]
    sea_idx = next(i for i, r in enumerate(out["recommendations"]) if "BALANCED" in r["personas"])
    client.patch(f"/api/runs/{run_id}", json={"watched": True, "selected_index": sea_idx})
    unwatched = plan(client)["run_id"]

    res = client.post("/api/scenarios/live", json={"scenario_id": "SUEZ_BLOCK"}).json()
    mine = [a for a in res["alerts_raised"] if a["run_id"] == run_id]
    assert len(mine) == 1 and not any(a["run_id"] == unwatched for a in res["alerts_raised"])
    alert = mine[0]
    assert alert["severity"] == "critical" and "CHOKE-SUEZ" in alert["payload"]["affected_hubs"]
    replan = alert["payload"]["replan"]
    assert replan["rerouted"] is True and replan["delta_eta_vs_original"] > 0
    assert any(a["id"] == alert["id"] for a in client.get("/api/alerts").json())
    assert client.post(f"/api/alerts/{alert['id']}/ack").status_code == 200
    client.post("/api/scenarios/live", json={"scenario_id": None})


def test_watching_during_live_incident_alerts_immediately(client):
    client.post("/api/scenarios/live", json={"scenario_id": "SUEZ_BLOCK"})
    out = plan(client)
    sea_idx = next(i for i, r in enumerate(out["recommendations"]) if "BALANCED" in r["personas"])
    res = client.patch(f"/api/runs/{out['run_id']}", json={"watched": True, "selected_index": sea_idx}).json()
    assert res["alert"] and res["alert"]["scenario_id"] == "SUEZ_BLOCK"
    client.post("/api/scenarios/live", json={"scenario_id": None})


def test_webhook_signature(app_module):
    body = json.dumps({"event": "ping"}).encode()
    sig = app_module.dispatcher.sign("s3cret", body)
    assert sig == "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()


def test_webhook_crud_and_delivery_failure_is_recorded(client):
    hook = client.post("/api/webhooks", json={"url": "http://127.0.0.1:9/unreachable", "events": ["*"]}).json()
    assert len(hook["secret"]) == 32
    res = client.post("/api/webhooks/test").json()
    assert any(d["webhook_id"] == hook["id"] and d["status"].startswith("error") for d in res["deliveries"])
    assert client.delete(f"/api/webhooks/{hook['id']}").status_code == 200


def test_suppliers_scores_are_bounded_and_disruption_aware(client):
    raw = client.post("/api/suppliers", json={"category": "Raw Materials"}).json()
    assert all(0 <= s["audit_trace"]["scores"]["cost"] <= 1 for s in raw["suppliers"])

    normal = client.post("/api/suppliers", json={"category": "Electronics"}).json()
    suez = client.post("/api/suppliers", json={"category": "Electronics", "scenario": "SUEZ_BLOCK"}).json()
    shanghai = lambda d: next(s for s in d["suppliers"] if s["id"] == "SUP-GLOBAL-01")
    assert shanghai(suez)["effective_lead_time"] == pytest.approx(shanghai(normal)["effective_lead_time"] + 10, abs=0.1)
    assert shanghai(suez)["rank"] > shanghai(normal)["rank"]
    assert "ranking_shift" in suez["advice"] or shanghai(normal)["rank"] != 1


def test_supplier_what_if_does_not_change_live_scenario(client):
    client.post("/api/scenarios/live", json={"scenario_id": None})
    client.post("/api/suppliers", json={"category": "Electronics", "scenario": "HORMUZ_CLOSURE"})
    assert client.get("/api/scenarios/live").json()["scenario"] is None


def test_procurement_advice_thresholds(client):
    crit = client.post("/api/suppliers", json={"current_inventory": 500, "demand_forecast": 800}).json()["advice"]
    assert crit["status"] == "CRITICAL_SHORTAGE"
    ok = client.post("/api/suppliers", json={"current_inventory": 5000, "safety_stock": 1000,
                                             "demand_forecast": 800}).json()["advice"]
    assert ok["status"] == "HEALTHY"


def test_model_info_exposes_calibration(client):
    info = client.get("/api/model").json()
    assert info["holdout_coverage"]["p85"]["empirical_test_coverage"] == pytest.approx(0.85, abs=0.02)
