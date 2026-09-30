# Supplychainer v2: Codebase Walkthrough

This is our team's guide to how the system works, so every member can explain the design, the
bug fixes and the trade-offs without looking anything up. Read it with the code open.

---

## 1. One request, end to end

`POST /api/recommend` in `backend/main.py`, for example Shanghai → Rotterdam with the `SUEZ_BLOCK`
scenario active:

1. **Resolve endpoints.** `NodeResolver` (`backend/engine/node_resolver.py`) maps "Shanghai" to a
   canonical hub and an entry node in the graph.
2. **Graph.** `create_multimodal_network()` (`backend/engine/multimodal_network.py`) builds a
   NetworkX `DiGraph` once at startup:
   - Each hub is split into one node per mode (`CNSHA:sea`, `CNSHA:road`, …). This is node splitting.
   - **Transfer edges** connect a hub's own mode nodes and carry the cost of switching modes.
   - **Transit edges** are the sea lanes, air routes, rail lines and roads between hubs.
3. **Persona graph.** `RouteRecommender._persona_graph()` copies the graph and removes:
   - hubs the scenario tells us to avoid, plus seasonal hubs
   - modes banned for this cargo type (e.g. oversize cargo can't fly; road is kept for short
     first- and last-mile legs)
   - under the `STRICT` policy, any mode other than the preferred one
4. **Solve.** `_solve()` runs `nx.dijkstra_path` with a custom weight function. It solves three
   times, once per persona:
   - `FASTEST`: weight = travel time + p85 delay
   - `SAFEST`: weight = (time + p95 delay) × (1 + threat × multiplier)
   - `BALANCED`: a weighted mix of p85 time, cost and threat, tilted by the `priority` multiplier
   - `PREFERRED` policy: other modes are penalised softly rather than removed
5. **Per-leg physics.** `_leg()` gets called for every edge Dijkstra looks at:
   - It applies scenario disruptions or standing advisories at the destination hub.
   - It asks the ML model for a **p50/p85/p95 delay band**.
   - An announced outage acts as a **floor** on the band, not an addition to it, because both
     describe the same wait at the same hub.
6. **Compose and explain.** `_compose()` turns the chosen path into:
   - the legs
   - the ETA band, cost and threat
   - an `audit_trace`
   - Shapley feature contributions
   - an explanation built from real computed numbers
7. **Persist.** `Storage.save_run()` (`backend/engine/storage.py`) writes the request and
   response to SQLite so history, comparison, alerts and exports all work.

---

## 2. The four-stage risk pipeline (`backend/engine/threat_intelligence.py`)

| Stage | Class / function | What it does |
|---|---|---|
| 1. Fetch | `DynamicNewsIngestor` (`news_ingestion.py`) | Pulls Google News RSS for hubs on the path. Falls back to offline text for each mode. |
| 2. NLP | `ContrastiveNLPEngine.get_semantic_score` | Embeds news chunks with `all-MiniLM-L6-v2`. Score = max over chunks of (best disaster-anchor similarity − best safe-anchor similarity). Scores at or below `noise_floor` become 0. The rest are multiplied by `calibration_multiplier` (3.5) and capped at 1. |
| 3. CARF | `CARFFilter.assess` | Keeps news that is relevant to *this* mode (see below). |
| 4. ML | `ThreatIntelligencePredictor.predict_band_many` | Three Gradient Boosting quantile regressors (α = 0.50 / 0.85 / 0.95) predict delay hours. The output is clamped to per-mode calibration floors and caps. |

**CARF rules**, applied the same way to all four modes:
- The news mentions this mode's keywords → relevance 1.0.
- It's an area-wide event (flood, war, cyberattack…) → 1.0.
- It only mentions *other* modes → 0.0, filtered out. A seaport strike doesn't affect a rail leg.
- It mentions no mode at all → 0.5, attenuated.

**Threat typing.** `classify_threat()` sorts news into cyber, geopolitical, labor, weather,
infrastructure or congestion using a keyword taxonomy.

**Why max-pool over chunks?** One alarming headline shouldn't be averaged away by ten calm ones.

---

## 3. The ML model

- **Features (6):**
  - Leg_Type
  - Origin_Node
  - Destination_Node
  - Transport_Mode
  - Condition_Flag
  - NLP_Severity_Score

  Categorical features are label-encoded with `Execution/label_encoders.pkl`.
- **Why quantile loss?** For planning, the average delay isn't what matters. You need a buffer
  you'll exceed only 15% of the time. With pinball loss at α = 0.85, the model learns the 85th
  percentile directly.
- **p50/p95 companions.** `Code/train_quantile_band.py` trains them with the *same*
  hyper-parameters, the same encoders and the same seeded data.
  - As a guard, the script first retrains p85 and checks that it reproduces the shipped model
    exactly. If it doesn't, it refuses to write any files.
  - Test-set coverage (`Execution/quantile_band_report.json`): p50 = 0.506, p85 = 0.851, p95 = 0.948.
    Each is close to its target, so the models are well calibrated.
- **Quantile crossing.** Models trained separately can predict p50 > p85. `_calibrate()` enforces
  p50 ≤ p85 ≤ p95.
- **Caching.** Predictions are memoised by feature key and batched through `predict_band_many`.
  Bands for the unchanged graph are precomputed at warm-up, which keeps Dijkstra fast.
- **Explainability.** `explain()` computes **exact** interventional Shapley values. With only 6
  features there are just 2⁶ = 64 coalitions, so we can enumerate them all instead of sampling
  with KernelSHAP.
  - The background sample is `Execution/shap_background.json`.
  - The contributions add up exactly to (prediction − baseline), in hours.

---

## 4. The silent bugs we fixed, and why they mattered

The same list is in the commit `06463c1`. Be ready to explain any of these:

- **NLP anchors not loading on CPU.** The anchors were saved on a GPU, so `torch.load` without
  `map_location="cpu"` failed. The failure was swallowed, so every threat score was 0 and the
  whole NLP stage did nothing.
- **Noise floor inverted.** `if margin >= noise_floor: return 0` threw away real threats and kept
  noise. The fix is `<=`.
- **Calibration multiplier 10× too small.** 0.35 → 3.5. With 0.35, even strong threats scored low.
- **CARF inverted.** The old sea/air rule *zeroed* news that matched the mode, which is the
  opposite of what it should do. Rail and road weren't checked at all.
- **One-way corridors.** About 700 registry connections were only added in one direction, so
  routes depended on direction and the Cape of Good Hope was unreachable. That meant a Suez
  blockage couldn't reroute. Transit edges now go both ways.
- **Impossible links.** Road and rail between countries with no land connection (e.g. across the
  Persian Gulf or the Strait of Gibraltar) are now blocked by `NO_LAND_LINK`. Registry sea lanes
  that skipped the Suez, Bab el-Mandeb and Hormuz choke points were fixed by
  `Code/patch_registry_v2.py`.
- **Double-counted scenario delay.** A road → transfer → sea path through a struck port paid the
  strike delay twice. Now it's paid once, on entering the hub.
- **Ignored inputs.** Cargo type, priority and the PREFERRED policy were accepted by the API but
  never used.
- **Invented explanation numbers.** Text like "396% cheaper" was hardcoded. It's now computed
  from the actual route alternatives.
- **Wrong ML fallback.** Unknown hubs were fed to the model as "Atlanta Air Hub". Now we map them
  to a same-mode model node.
- **Supplier scoring.** The cost score could go negative. The fixes are in `supplier_scorer.py`.
- **What-if mutating global state.** A what-if request used to change the active scenario for
  everyone.

**How we tested for this kind of bug:** run `SUEZ_BLOCK` and check that the route avoids Suez,
that the threat on the Suez leg is 1.0, and that the ETA goes up. Look at the numbers, not just
whether the request errored.

---

## 5. What we built on top

- **Confidence band.** p50/p85/p95 is shown for each route (section 3).
- **SQLite history.** `storage.py` stores runs, alerts, webhooks and state, so history survives a
  restart. It uses `/api/runs`.
- **Live alerts.** `POST /api/scenarios/live` calls `AlertEngine.on_scenario_activated`:
  1. It re-evaluates every *watched* run.
  2. If a route is affected, it raises an alert and computes a re-plan.
  3. It pushes the result over the `/ws` WebSocket.
- **Webhooks.** `WebhookDispatcher` in `integrations.py` sends HMAC-signed POSTs. The receiver
  checks the signature with the shared secret.
- **Exports.**
  - CSV
  - PDF
  - `supplychainer.shipment_plan.v1` JSON, a format a TMS could import
- **Frontend.** `frontend/src/`:
  - `views/Planner.jsx`: the main routing screen
  - `components/MapView.jsx`: the Leaflet map, driven by `/api/network`
  - `views/HistoryView.jsx`, `views/AlertsView.jsx`, `views/IntegrationsView.jsx` and
    `views/SuppliersView.jsx`
- **Tests.** There are 80 pytest tests in `backend/tests/`, covering the API, the network
  (bidirectional edges, no impossible links), routing (Suez reroute, cargo bans, priority), the
  quantile model (monotone band, coverage) and CARF. Run them with `python -m pytest`.

---

## 6. Trade-offs judges may ask about

- **Dijkstra with a dynamic weight, instead of an OR solver.** It's fast and exact for a single
  objective. We get multiple objectives by solving once per persona instead of computing a Pareto
  front.
- **Outage as a floor, not an addition.** This avoids counting the same wait twice. The downside
  is that it can underestimate when a disruption and ordinary congestion really do stack.
- **Keyword CARF and threat typing.** These are transparent and easy to audit, but they're
  brittle when news uses unusual wording. A trained classifier would be the next step.
- **Synthetic, seeded training data.** The results are reproducible, but the model is only as
  realistic as `real_dataset_builder.py`.
- **SQLite.** It needs no setup and survives restarts. It isn't multi-tenant and has no
  authentication.
- **Legacy files.** `Execution/api.py` and the US-only prototype modules in `backend/engine/`
  aren't used by the live app (see the README).

---

## 7. Quick self-check before judging

Each of us should be able to answer these without notes:
1. Why do we predict p85 and not the mean?
2. What would happen if CARF were removed?
3. Why was the Cape of Good Hope unreachable before v2?
4. How are Shapley values computed exactly here, and what do they add up to?
5. What happens, step by step, when someone activates a live scenario?
6. How was AI used in this project, and what did we decide or check ourselves?
