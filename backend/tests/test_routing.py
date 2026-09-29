"""End-to-end routing behaviour under real scenarios — checks the numbers, not just 'no crash'."""
import pytest

from .conftest import pick


def sea_route(recommender, src="Shanghai", dst="Rotterdam", **kw):
    return pick(recommender.recommend(src, dst, **kw), "BALANCED")


def test_suez_block_reroutes_via_cape(recommender):
    normal = sea_route(recommender)
    blocked = sea_route(recommender, scenario="SUEZ_BLOCK")
    assert "CHOKE-SUEZ" in normal["hubs"]
    assert "CHOKE-SUEZ" not in blocked["hubs"] and "CHOKE-CAPEGOOD" in blocked["hubs"]
    impact = blocked["scenario_impact"]
    assert impact["rerouted"] is True
    assert impact["delta_eta"] > 72, "a Cape detour must cost days, not hours"
    assert blocked["adjusted_eta"] == pytest.approx(normal["adjusted_eta"] + impact["delta_eta"], abs=0.2)


def test_suez_block_through_canal_carries_the_outage(recommender):
    # Force the canal: avoid the Cape, so the only sea option pays the 240h salvage window.
    res = recommender.recommend("Shanghai", "Rotterdam", scenario="SUEZ_BLOCK", transport_preference="sea",
                                overrides={"avoid_chokepoints": ["CHOKE-CAPEGOOD"]})
    route = pick(res, "BALANCED")
    suez_legs = [l for l in route["legs"] if l["to"] == "CHOKE-SUEZ"]
    assert suez_legs and suez_legs[0]["event_delay"] == 240 and suez_legs[0]["threat"] == 1.0
    assert route["audit_trace"]["eta"]["scenario"] == 240
    assert route["threat_level"] == 1.0


def test_scenario_delay_is_counted_once_per_hub(recommender):
    # road -> transfer -> sea inside the struck port used to pay the 120h strike twice.
    res = recommender.recommend("HUB-LOSANGELES", "Shanghai", scenario="LA_PORT_STRIKE",
                                transport_preference="sea", overrides={"avoid_chokepoints": ["PORT-OAKLAND"]})
    for route in res["recommendations"]:
        la_hits = [l for l in route["legs"] if l["to"] in ("PORT-LOSANGELES", "PORT-LONGBEACH")]
        assert sum(l["event_delay"] for l in route["legs"]) <= 120 * len({l["to"] for l in la_hits})
        assert route["audit_trace"]["eta"]["scenario"] == sum(l["event_delay"] for l in route["legs"])


def test_ml_model_drives_routing(recommender):
    route = sea_route(recommender)
    assert route["audit_trace"]["eta"]["ml_buffer_p85"] > 0
    assert route["eta_band"]["p50"] <= route["eta_band"]["p85"] <= route["eta_band"]["p95"]
    assert route["adjusted_eta"] == route["eta_band"]["p85"]
    assert route["drivers"]["contributions"], "critical-leg Shapley drivers missing"


def test_audit_trace_reconciles_with_totals(recommender):
    res = recommender.recommend("Shanghai", "Rotterdam", scenario="SUEZ_BLOCK")
    for r in res["recommendations"]:
        eta = r["audit_trace"]["eta"]
        assert sum(eta.values()) == pytest.approx(r["adjusted_eta"], abs=0.5)
        assert sum(r["audit_trace"]["cost"].values()) == pytest.approx(r["total_cost"], abs=1.0)
        assert sum(l["cost"] for l in r["legs"]) == pytest.approx(r["total_cost"], abs=1.0)


def test_explanations_only_quote_real_numbers(recommender):
    res = recommender.recommend("Shanghai", "Rotterdam")
    for r in res["recommendations"]:
        assert f"plan for {r['adjusted_eta'] / 24:.1f} days" in r["explanation"]
        assert f"about {r['eta_band']['p50'] / 24:.1f} days" in r["explanation"]
        assert "396%" not in r["explanation"] and "reduces total landed cost by" not in r["explanation"]


def test_perishable_cargo_never_goes_by_sea(recommender):
    res = recommender.recommend("Shanghai", "Rotterdam", cargo_type="perishable_urgent")
    assert all(l["mode"] != "SEA" for r in res["recommendations"] for l in r["legs"])


def test_hazardous_cargo_never_flies(recommender):
    res = recommender.recommend("Shanghai", "Rotterdam", cargo_type="hazardous_waste")
    assert all(l["mode"] != "AIR" for r in res["recommendations"] for l in r["legs"])


def test_oversize_cargo_avoids_long_haul_trucking(recommender):
    res = recommender.recommend("Mumbai", "Delhi", cargo_type="oversize_heavy")
    assert all(not (l["mode"] == "ROAD" and l["distance_km"] > 300) for r in res["recommendations"] for l in r["legs"])


def test_strict_mode_preference(recommender):
    res = recommender.recommend("Shanghai", "Rotterdam", transport_preference="rail", routing_policy="STRICT")
    for r in res.get("recommendations", []):
        assert {l["mode"] for l in r["legs"]} <= {"RAIL", "ROAD", "TRANSFER"}


def test_preferred_policy_is_applied(recommender):
    strict_any = recommender.recommend("Shanghai", "Rotterdam")
    preferred = recommender.recommend("Shanghai", "Rotterdam", transport_preference="sea", routing_policy="PREFERRED")
    fast_any, fast_pref = pick(strict_any, "FASTEST"), pick(preferred, "FASTEST")
    assert fast_any["primary_mode"] == "AIR"
    sea_km = lambda r: r["mode_mix"].get("SEA", 0)
    assert sea_km(fast_pref) >= sea_km(fast_any)


def test_urgent_priority_trades_cost_for_time(recommender):
    normal = pick(recommender.recommend("Mumbai", "Rotterdam"), "BALANCED")
    urgent = pick(recommender.recommend("Mumbai", "Rotterdam", priority="urgent"), "BALANCED")
    assert urgent["adjusted_eta"] <= normal["adjusted_eta"]


def test_seasonal_arctic_lane_is_opt_in(recommender):
    default = recommender.recommend("Shanghai", "Rotterdam", transport_preference="sea")
    assert all("CHOKE-NSR" not in r["hubs"] for r in default["recommendations"])
    opt_in = recommender.recommend("Shanghai", "Rotterdam", transport_preference="sea",
                                   overrides={"allow_seasonal_lanes": True})
    nsr = [r for r in opt_in["recommendations"] if "CHOKE-NSR" in r["hubs"]]
    for r in nsr:
        assert "CHOKE-NSR" in r["advisories"] and r["audit_trace"]["eta"]["advisory"] > 0


def test_what_if_does_not_leak_into_live_state(recommender, app_module):
    app_module.scenario_mgr.activate_scenario(None)
    recommender.recommend("Shanghai", "Rotterdam", scenario="SUEZ_BLOCK")
    assert app_module.scenario_mgr.active_scenario_id is None


def test_origin_disruption_is_attributed_to_origin(recommender):
    res = recommender.recommend("PORT-CHENNAI", "Singapore", scenario="CHENNAI_FLOOD")
    for r in res["recommendations"]:
        assert "PORT-CHENNAI" in r["exposed_disruptions"]
        assert set(r["exposed_disruptions"]) <= {"PORT-CHENNAI", "HUB-CHENNAI"}


def test_unknown_location_returns_error(recommender):
    assert "error" in recommender.recommend("Atlantis", "Rotterdam")
