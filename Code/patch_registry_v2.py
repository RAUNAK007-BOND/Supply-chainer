"""
Registry integrity patch (v2). Idempotent — safe to re-run from the project root.

1. Registers hubs that other hubs already route to but that were never defined. The graph
   builder silently drops edges to unknown IDs, so e.g. 34 air routes into Chennai vanished.
2. Gives the Cape of Good Hope chokepoint real Atlantic-side connections. Before, no hub linked
   *to* it and it only linked back into the Indian Ocean, so the classic Suez bypass the README
   describes was unreachable.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend", "engine"))
from multimodal_network import land_link_allowed  # noqa: E402

HUBS_PATH = "backend/data/canonical_hubs.json"
LOCATIONS_PATH = "backend/data/canonical_locations.json"

NEW_HUBS = [
    {"id": "AIR-CHENNAI", "display_name": "Chennai International Airport (MAA)", "aliases": ["MAA", "Chennai Airport"],
     "type": "airport", "modes": ["air", "road"], "lat": 12.9941, "lon": 80.1709, "country": "India",
     "parent_city": "Chennai", "importance": 8, "connections": [{"to": "HUB-CHENNAI", "mode": "road"},
                                                                {"to": "PORT-CHENNAI", "mode": "road"}]},
    {"id": "RAIL-BHOPAL", "display_name": "Bhopal Rail Freight Terminal", "aliases": ["Bhopal"],
     "type": "rail_terminal", "modes": ["rail", "road"], "lat": 23.2599, "lon": 77.4126, "country": "India",
     "parent_city": "Bhopal", "importance": 6, "connections": []},
    {"id": "RAIL-VARANASI", "display_name": "Varanasi Rail Freight Terminal", "aliases": ["Varanasi Rail"],
     "type": "rail_terminal", "modes": ["rail", "road"], "lat": 25.3176, "lon": 82.9739, "country": "India",
     "parent_city": "Varanasi", "importance": 6, "connections": [{"to": "AIR-VARANASI", "mode": "road"}]},
    {"id": "RAIL-SAMBALPUR", "display_name": "Sambalpur Rail Freight Terminal", "aliases": ["Sambalpur"],
     "type": "rail_terminal", "modes": ["rail", "road"], "lat": 21.4669, "lon": 83.9812, "country": "India",
     "parent_city": "Sambalpur", "importance": 5, "connections": []},
    {"id": "RAIL-VISAKHAPATNAM", "display_name": "Visakhapatnam Rail Freight Terminal", "aliases": ["Vizag Rail"],
     "type": "rail_terminal", "modes": ["rail", "road"], "lat": 17.6868, "lon": 83.2185, "country": "India",
     "parent_city": "Visakhapatnam", "importance": 7,
     "connections": [{"to": "PORT-VIZAG", "mode": "road"}, {"to": "PORT-VIZAG", "mode": "rail"}]},
]

CAPE_LINKS = ["PORT-CAPETOWN", "PORT-DURBAN", "PORT-ALGECIRAS", "PORT-SANTOS", "PORT-LAGOS"]

# ---------------------------------------------------------------------------------------------
# 3. Sea-lane basin topology.
#
# Many sea connections joined basins directly — e.g. Jebel Ali <-> Haifa, a straight line across
# the Arabian peninsula — so Asia/Gulf <-> Europe cargo never had to pass Suez, Bab el-Mandeb or
# Hormuz, and the SUEZ_BLOCK / RED_SEA_CONFLICT / HORMUZ_CLOSURE scenarios barely mattered.
# Every sea hub is assigned to a basin; a sea lane may only join two basins through the
# chokepoint that physically connects them.
# ---------------------------------------------------------------------------------------------
BRIDGES = {
    "CHOKE-SUEZ": {"ATLANTIC_MED", "RED_SEA"},
    "CHOKE-BABEL": {"RED_SEA", "INDO_PACIFIC"},
    "CHOKE-HORMUZ": {"GULF", "INDO_PACIFIC"},
    "CHOKE-CAPEGOOD": {"ATLANTIC_MED", "INDO_PACIFIC"},
    "CHOKE-PANAMA": {"ATLANTIC_MED", "INDO_PACIFIC"},
    "CHOKE-NSR": {"ATLANTIC_MED", "INDO_PACIFIC"},
}
EXPLICIT_SEA_LINKS = [("CHOKE-SUEZ", "CHOKE-BABEL")]  # the Red Sea transit itself

# Major liner services missing from the registry: LA/Long Beach (the busiest US container gateway)
# had no trans-Pacific lane at all, and New York's only sea link was Halifax.
MAJOR_LINER_LANES = [
    ("PORT-LOSANGELES", t) for t in ("PORT-SHANGHAI", "PORT-NINGBO", "PORT-SHENZHEN", "PORT-HONGKONG",
                                     "PORT-KAOHSIUNG", "PORT-BUSAN", "PORT-YOKOHAMA")
] + [
    ("PORT-LONGBEACH", t) for t in ("PORT-SHANGHAI", "PORT-NINGBO", "PORT-SHENZHEN", "PORT-BUSAN", "PORT-KAOHSIUNG")
] + [
    ("PORT-OAKLAND", "PORT-SHANGHAI"), ("PORT-OAKLAND", "PORT-YOKOHAMA"), ("PORT-SEATTLE", "PORT-SHANGHAI"),
    ("PORT-SEATTLE", "PORT-YOKOHAMA"), ("PORT-VANCOUVER", "PORT-SHANGHAI"), ("PORT-VANCOUVER", "PORT-BUSAN"),
    ("PORT-MANZANILLO", "PORT-SHANGHAI"),
    ("PORT-NEWYORK", "PORT-ROTTERDAM"), ("PORT-NEWYORK", "PORT-ANTWERP"), ("PORT-NEWYORK", "PORT-HAMBURG"),
    ("PORT-NEWYORK", "PORT-FELIXSTOWE"), ("PORT-NEWYORK", "PORT-ALGECIRAS"), ("PORT-SAVANNAH", "PORT-ROTTERDAM"),
    ("PORT-SAVANNAH", "PORT-ALGECIRAS"), ("PORT-HOUSTON", "PORT-ROTTERDAM"), ("PORT-HOUSTON", "PORT-ANTWERP"),
]


def basin(h):
    lat, lon = h["lat"], h["lon"]
    if lon < -30:  # Americas
        return "INDO_PACIFIC" if lon < -100 or (lat < 9.0 and lon < -69) else "ATLANTIC_MED"
    if 46.5 <= lon <= 55.5 and 36.5 <= lat <= 47.5:
        return "CASPIAN"               # landlocked: no sea route out
    if lon > 62:
        return "INDO_PACIFIC"
    if lat > 30.8:
        return "ATLANTIC_MED"          # Mediterranean, Black Sea, Atlantic Europe
    if lat < -20:
        return "ATLANTIC_MED" if lon < 25 else "INDO_PACIFIC"   # west / east of the Cape
    if lon < 32:
        return "ATLANTIC_MED"          # West Africa
    if 32 <= lon <= 43.5 and 12 <= lat <= 30.8:
        return "RED_SEA"
    if 47 <= lon < 56.3 and 23.5 <= lat <= 30.8:
        return "GULF"
    return "INDO_PACIFIC"


def _dist(a, b):
    import math
    dlat, dlon = math.radians(b["lat"] - a["lat"]), math.radians(b["lon"] - a["lon"])
    x = math.sin(dlat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def basins_of(h):
    return BRIDGES.get(h["id"], {basin(h)})


def enforce_sea_basins(hubs, ids):
    sea = [h for h in hubs if "sea" in h["modes"]]

    def link(a, b):
        if not any(c["to"] == b["id"] and c["mode"] == "sea" for c in a["connections"]):
            a["connections"].append({"to": b["id"], "mode": "sea"})

    pruned = 0
    for h in sea:
        keep = []
        for c in h["connections"]:
            if c["mode"] == "sea" and not (basins_of(h) & basins_of(ids[c["to"]])):
                pruned += 1
                continue
            keep.append(c)
        h["connections"] = keep

    # Each bridge reaches the 3 nearest ports on every side it joins.
    for bid, sides in BRIDGES.items():
        b = ids[bid]
        for side in sides:
            ports = sorted((p for p in sea if p["type"] != "choke_point" and basin(p) == side),
                           key=lambda p: _dist(b, p))[:3]
            for p in ports:
                link(b, p)
    for a, b in EXPLICIT_SEA_LINKS:
        link(ids[a], ids[b])
    for a, b in MAJOR_LINER_LANES:
        if a in ids and b in ids and basins_of(ids[a]) & basins_of(ids[b]):
            link(ids[a], ids[b])

    # Any sea hub left without a sea lane is re-attached to its 2 nearest same-basin neighbours.
    degree = {h["id"]: 0 for h in sea}
    for h in sea:
        for c in h["connections"]:
            if c["mode"] == "sea":
                degree[h["id"]] += 1
                degree[c["to"]] = degree.get(c["to"], 0) + 1
    reattached = 0
    for h in sea:
        if degree[h["id"]] == 0:
            near = sorted((p for p in sea if p is not h and basins_of(p) & basins_of(h)),
                          key=lambda p: _dist(h, p))[:2]
            for p in near:
                link(h, p)
            reattached += 1
    return pruned, reattached


def main():
    hubs = json.load(open(HUBS_PATH))
    ids = {h["id"]: h for h in hubs}

    added = 0
    for hub in NEW_HUBS:
        if hub["id"] not in ids:
            hubs.append(hub)
            ids[hub["id"]] = hub
            added += 1

    cape = ids["CHOKE-CAPEGOOD"]
    for target in CAPE_LINKS:
        if target in ids and not any(c["to"] == target for c in cape["connections"]):
            cape["connections"].append({"to": target, "mode": "sea"})

    # Drop connections whose target or mode doesn't exist (they were silently ignored anyway), and
    # land corridors between countries with no land link (rail across the Persian Gulf etc.).
    dropped = 0
    for h in hubs:
        keep = [c for c in h.get("connections", [])
                if c["to"] in ids and c["mode"] in h["modes"] and c["mode"] in ids[c["to"]]["modes"]
                and land_link_allowed(h, ids[c["to"]], c["mode"])]
        dropped += len(h.get("connections", [])) - len(keep)
        h["connections"] = keep

    pruned, reattached = enforce_sea_basins(hubs, ids)
    print(f"Sea basins: pruned {pruned} cross-basin lanes, re-attached {reattached} isolated sea hubs")

    with open(HUBS_PATH, "w") as f:
        json.dump(hubs, f, indent=2)

    locations = json.load(open(LOCATIONS_PATH))
    locations.setdefault("Chennai", {})["air"] = "AIR-CHENNAI"
    with open(LOCATIONS_PATH, "w") as f:
        json.dump(locations, f, indent=2)

    print(f"Added {added} hubs, total {len(hubs)}; dropped {dropped} invalid connections; "
          f"Cape links: {[c['to'] for c in cape['connections']]}")


if __name__ == "__main__":
    main()
