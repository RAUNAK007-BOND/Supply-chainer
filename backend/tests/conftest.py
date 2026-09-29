import os
import sys
import tempfile

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)
# Model artifacts are referenced relative to the project root.
os.chdir(ROOT)
os.environ.setdefault("SUPPLYCHAINER_DB", os.path.join(tempfile.mkdtemp(prefix="sc-test-"), "test.db"))


@pytest.fixture(scope="session")
def app_module():
    """The real FastAPI app with a throwaway database and a fully warmed engine."""
    import backend.main as main
    main.recommender.run_background_warmup()
    assert main.recommender.is_warmed_up, "engine failed to warm up"
    return main


@pytest.fixture(scope="session")
def recommender(app_module):
    return app_module.recommender


@pytest.fixture(scope="session")
def predictor(app_module):
    return app_module.predictor


@pytest.fixture(scope="session")
def client(app_module):
    from fastapi.testclient import TestClient
    with TestClient(app_module.app) as c:
        yield c


def pick(result, persona):
    return next(r for r in result["recommendations"] if persona in r["personas"])
