"""Shared test setup. Every route test runs as one guest browser unless it opts out."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from auth import require_user  # noqa: E402
from main import app  # noqa: E402

TEST_USER = "guest|test-student"


@pytest.fixture(autouse=True)
def logged_in(request):
    if "real_auth" in request.keywords:
        app.dependency_overrides.pop(require_user, None)
    else:
        app.dependency_overrides[require_user] = lambda: TEST_USER
    yield
    app.dependency_overrides.pop(require_user, None)


def pytest_configure(config):
    config.addinivalue_line("markers", "real_auth: run the real guest ID check instead of the test user")
