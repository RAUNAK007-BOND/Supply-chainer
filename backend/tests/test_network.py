"""Graph and registry integrity: symmetric corridors, sea basins, land links, no dangling hubs."""
import json
import os
import sys

import networkx as nx
import pytest

from backend.engine.multimodal_network import NO_LAND_LINK, load_canonical_hubs

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "Code"))
from patch_registry_v2 import BRIDGES, basin  # noqa: E402


@pytest.fixture(scope="module")
def hubs():
    return {h["id"]: h for h in load_canonical_hubs()}


def test_no_dangling_connections(hubs):
    missing = {(h, c["to"]) for h, hub in hubs.items() for c in hub["connections"] if c["to"] not in hubs}
    assert not missing


def test_chennai_airport_is_registered_and_routable(recommender):
    assert "AIR-CHENNAI:air" in recommender.unified_graph
    assert recommender.unified_graph.degree("AIR-CHENNAI:air") > 10


def test_transit_corridors_are_bidirectional(recommender):
    G = recommender.unified_graph
    one_way = [(u, v) for u, v, d in G.edges(data=True) if d["type"] == "transit" and not G.has_edge(v, u)]
    assert not one_way


def test_cape_of_good_hope_is_reachable(recommender):
    G = recommender.unified_graph
    assert nx.has_path(G, "PORT-SHANGHAI:sea", "CHOKE-CAPEGOOD:sea")
    assert nx.has_path(G, "CHOKE-CAPEGOOD:sea", "PORT-ROTTERDAM:sea")


def test_sea_lanes_only_cross_basins_through_chokepoints(recommender):
    G = recommender.unified_graph
    bad = []
    for u, v, d in G.edges(data=True):
        if d["transport_mode"] != "sea":
            continue
        hu, hv = (recommender.hubs[G.nodes[n]["physical_id"]] for n in (u, v))
        bu, bv = BRIDGES.get(hu["id"], {basin(hu)}), BRIDGES.get(hv["id"], {basin(hv)})
        if not bu & bv:
            bad.append((hu["id"], hv["id"]))
    assert not bad, bad[:10]


def test_no_land_corridors_across_water(recommender):
    G = recommender.unified_graph
    bad = [(u, v) for u, v, d in G.edges(data=True) if d["transport_mode"] in ("road", "rail")
           and frozenset((G.nodes[u]["country"], G.nodes[v]["country"])) in NO_LAND_LINK]
    assert not bad, bad[:10]


def test_asia_europe_sea_needs_suez_or_cape(recommender):
    G = recommender.unified_graph.copy()
    sea_only = G.edge_subgraph([(u, v) for u, v, d in G.edges(data=True) if d["transport_mode"] == "sea"]).copy()
    sea_only.remove_nodes_from([n for n in list(sea_only) if n.split(":")[0] in
                                ("CHOKE-SUEZ", "CHOKE-CAPEGOOD", "CHOKE-PANAMA", "CHOKE-NSR")])
    assert not nx.has_path(sea_only, "PORT-SHANGHAI:sea", "PORT-ROTTERDAM:sea")
