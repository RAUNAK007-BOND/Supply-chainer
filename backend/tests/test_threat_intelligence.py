"""NLP severity, CARF relevance filtering and threat typing (regressions for the planted bugs)."""
import pytest

from backend.engine.threat_intelligence import CARFFilter, ContrastiveNLPEngine, classify_threat


@pytest.fixture(scope="module")
def nlp(recommender):
    assert recommender.nlp.ready, "NLP anchors must load on CPU (torch.load map_location)"
    return recommender.nlp


# ------------------------------------------------------------------ NLP
def test_nlp_scores_real_disruptions_high(nlp):
    assert nlp.get_semantic_score("Vessel grounding blocks Suez Canal, ships stuck for days") >= 0.9
    assert nlp.get_semantic_score("Missile attack on cargo ship in Red Sea forces carriers to reroute") >= 0.7
    assert nlp.get_semantic_score("Massive port worker strike shuts down all container terminals") >= 0.5


def test_nlp_scores_calm_news_zero(nlp):
    # The inverted noise-floor check used to let only near-zero/negative margins through.
    assert nlp.get_semantic_score("Routine delivery on time, clear weather, business as usual.") == 0.0
    assert nlp.get_semantic_score("Port of Rotterdam reports record quarterly volumes and smooth operations") == 0.0


def test_nlp_one_alarming_headline_is_not_diluted(nlp):
    mixed = ("Stock markets rise as tech earnings beat expectations | "
             "Vessel grounding blocks Suez Canal, ships stuck for days | Local sports team wins title")
    assert nlp.get_semantic_score(mixed) >= 0.9


def test_offline_baselines_are_neutral(nlp, recommender):
    for mode, text in recommender.news_ingestor.fallback_news.items():
        assert nlp.get_semantic_score(text) == 0.0, f"{mode} fallback text reads as a threat"


def test_nlp_not_ready_returns_zero():
    engine = ContrastiveNLPEngine(lazy_load=True)
    assert engine.get_semantic_score("Suez Canal blocked") == 0.0


# ------------------------------------------------------------------ CARF
@pytest.mark.parametrize("mode,text,expected", [
    # mode-matched news keeps its full score (this was inverted for sea and air)
    ("sea", "Vessel grounding blocks Suez Canal", 1.0),
    ("air", "Airport closed after flight cancellations", 1.0),
    ("rail", "Freight train derailment blocks main line tracks", 1.0),
    ("road", "Trucker strike blockades highway border crossing", 1.0),
    # news about a different mode is filtered out, for every mode
    ("sea", "Airport closed after flight cancellations", 0.0),
    ("air", "Port workers strike, vessels queue at berth", 0.0),
    ("rail", "Highway bridge collapse halts truck traffic", 0.0),
    ("road", "Freight train derailment blocks main line tracks", 0.0),
    # area-wide events hit every mode
    ("rail", "Severe flooding and earthquake across the region", 1.0),
    ("air", "War escalation declared in the region", 1.0),
])
def test_carf_symmetric_relevance(mode, text, expected):
    verdict = CARFFilter().assess(0.8, text, mode)
    assert verdict["relevance"] == expected, verdict


def test_carf_attenuates_mode_unspecified_news():
    verdict = CARFFilter().assess(0.8, "Regional logistics disruption expected this week", "sea")
    assert verdict["relevance"] == CARFFilter.UNSPECIFIED_ATTENUATION


def test_carf_word_boundaries():
    # "airport" must not count as the sea keyword "port" (substring) and punctuation is ignored.
    assert CARFFilter().assess(0.8, "Airport, closed.", "sea")["relevance"] == 0.0
    assert CARFFilter().assess(0.8, "Port, closed.", "sea")["relevance"] == 1.0


def test_carf_zero_score_stays_zero():
    assert CARFFilter().apply_filter(0.0, "Suez Canal blocked", "sea") == 0.0


# ------------------------------------------------------------------ taxonomy
@pytest.mark.parametrize("text,category", [
    ("Missile attack on cargo ship in Red Sea", "geopolitical"),
    ("Port workers strike, picket lines at terminals", "labor"),
    ("Cyclone and flooding close coastal roads", "weather"),
    ("Vessel ran aground, canal blocked for salvage", "infrastructure"),
    ("Ransomware attack disables terminal systems", "cyber"),
    ("Berthing congestion and backlog at transshipment hub", "congestion"),
])
def test_threat_taxonomy(text, category):
    assert classify_threat(text)["category"] == category
