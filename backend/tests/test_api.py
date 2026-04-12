from datetime import UTC, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_session
from app.main import app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

Base.metadata.create_all(bind=engine)


def override_get_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_session] = override_get_session
client = TestClient(app)


def test_healthcheck():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_presets_available():
    response = client.get("/api/presets")
    assert response.status_code == 200
    assert any(item["id"] == "classic" for item in response.json())


def _register_and_get_token(name: str) -> str:
    email = f"{name.lower()}-{uuid4().hex[:8]}@example.com"
    payload = {
        "name": name,
        "email": email,
        "password": "StrongPass123",
    }
    response = client.post("/api/auth/register", json=payload)
    assert response.status_code == 200
    return response.json()["access_token"]


def test_register_and_login():
    email = f"login-{uuid4().hex[:8]}@example.com"
    register_payload = {
        "name": "Login User",
        "email": email,
        "password": "StrongPass123",
    }

    register_response = client.post("/api/auth/register", json=register_payload)
    assert register_response.status_code == 200

    login_payload = {
        "email": email,
        "password": "StrongPass123",
    }
    login_response = client.post("/api/auth/login", json=login_payload)
    assert login_response.status_code == 200
    assert login_response.json()["token_type"] == "bearer"


def test_protected_endpoints_require_login():
    payload = {
        "topic": "Unauthorized Attempt",
        "target_study_text": "Try to submit without auth",
        "actual_study_text": "Should fail",
        "completion_percentage": 10,
        "focus_minutes": 25,
        "break_minutes": 5,
        "started_at": datetime.now(UTC).isoformat(),
        "finished_at": datetime.now(UTC).isoformat(),
    }
    response = client.post("/api/sessions", json=payload)
    assert response.status_code == 401


def test_create_session_and_stats_are_user_scoped():
    user_one_token = _register_and_get_token("Alice")
    user_two_token = _register_and_get_token("Bob")

    auth_headers_one = {"Authorization": f"Bearer {user_one_token}"}
    auth_headers_two = {"Authorization": f"Bearer {user_two_token}"}

    start_time = datetime.now(UTC) - timedelta(minutes=2)
    end_time = datetime.now(UTC)

    payload = {
        "topic": "Linear Algebra",
        "target_study_text": "Solve two eigenvalue decomposition exercises and write summary notes.",
        "actual_study_text": "Solved one full exercise and outlined the second; wrote concise summary notes.",
        "completion_percentage": 70,
        "focus_minutes": 25,
        "break_minutes": 5,
        "started_at": start_time.isoformat(),
        "finished_at": end_time.isoformat(),
    }

    create_response = client.post("/api/sessions", json=payload, headers=auth_headers_one)
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["completion_percentage"] == 70
    assert created["user_id"] is not None

    overview = client.get("/api/stats/overview", params={"period": "day"}, headers=auth_headers_one)
    assert overview.status_code == 200
    overview_data = overview.json()
    assert overview_data["total_focus_minutes"] >= 2
    assert overview_data["average_completion_percentage"] >= 70.0

    sessions_one = client.get("/api/sessions", headers=auth_headers_one)
    assert sessions_one.status_code == 200
    sessions_one_data = sessions_one.json()
    assert sessions_one_data["total"] >= 1
    assert any(item["topic"] == "Linear Algebra" for item in sessions_one_data["items"])

    other_overview = client.get(
        "/api/stats/overview",
        params={"period": "day"},
        headers=auth_headers_two,
    )
    assert other_overview.status_code == 200
    assert other_overview.json()["sessions"] == 0

    sessions_two = client.get("/api/sessions", headers=auth_headers_two)
    assert sessions_two.status_code == 200
    assert sessions_two.json()["total"] == 0

    completion = client.get("/api/stats/completion", headers=auth_headers_one)
    assert completion.status_code == 200
    completion_data = completion.json()
    assert "day" in completion_data
    assert "week" in completion_data


def test_daily_timeline_splits_session_across_bd_hours():
    token = _register_and_get_token("HourSplit")
    headers = {"Authorization": f"Bearer {token}"}

    bd_tz = timezone(timedelta(hours=6))
    now_bd = datetime.now(UTC).astimezone(bd_tz)
    start_bd = datetime(now_bd.year, now_bd.month, now_bd.day, 12, 38, 0)
    end_bd = datetime(now_bd.year, now_bd.month, now_bd.day, 13, 5, 0)

    start_utc = start_bd.replace(tzinfo=bd_tz).astimezone(UTC)
    end_utc = end_bd.replace(tzinfo=bd_tz).astimezone(UTC)

    payload = {
        "topic": "Hour Split",
        "target_study_text": "Test BD hour split",
        "actual_study_text": "Crossed one hour boundary",
        "completion_percentage": 80,
        "focus_minutes": 25,
        "break_minutes": 5,
        "started_at": start_utc.isoformat(),
        "finished_at": end_utc.isoformat(),
    }
    create_response = client.post("/api/sessions", json=payload, headers=headers)
    assert create_response.status_code == 200

    timeline = client.get("/api/stats/timeline", params={"period": "day"}, headers=headers)
    assert timeline.status_code == 200

    points = timeline.json()["points"]
    point_12 = next((item for item in points if item["label"] == "12:00"), None)
    point_13 = next((item for item in points if item["label"] == "13:00"), None)

    assert point_12 is not None
    assert point_13 is not None
    assert point_12["focus_minutes"] >= 20
    assert point_13["focus_minutes"] >= 5


def test_sessions_support_pagination_and_time_filters():
    token = _register_and_get_token("FilterPagination")
    headers = {"Authorization": f"Bearer {token}"}

    bd_tz = timezone(timedelta(hours=6))
    now_bd = datetime.now(UTC).astimezone(bd_tz)
    base_day = datetime(now_bd.year, now_bd.month, now_bd.day)

    ranges_bd = [
        (base_day.replace(hour=10, minute=10), base_day.replace(hour=10, minute=40), "Morning"),
        (base_day.replace(hour=12, minute=15), base_day.replace(hour=12, minute=35), "Noon A"),
        (base_day.replace(hour=12, minute=50), base_day.replace(hour=13, minute=10), "Noon B"),
    ]

    for start_bd, end_bd, topic in ranges_bd:
        start_utc = start_bd.replace(tzinfo=bd_tz).astimezone(UTC)
        end_utc = end_bd.replace(tzinfo=bd_tz).astimezone(UTC)
        payload = {
            "topic": topic,
            "target_study_text": "Filter coverage",
            "actual_study_text": "Saved for filter/pagination verification",
            "completion_percentage": 80,
            "focus_minutes": 25,
            "break_minutes": 5,
            "started_at": start_utc.isoformat(),
            "finished_at": end_utc.isoformat(),
        }
        create_response = client.post("/api/sessions", json=payload, headers=headers)
        assert create_response.status_code == 200

    page_one = client.get("/api/sessions", params={"page": 1, "page_size": 2}, headers=headers)
    assert page_one.status_code == 200
    page_one_data = page_one.json()
    assert page_one_data["total"] == 3
    assert page_one_data["total_pages"] == 2
    assert page_one_data["page"] == 1
    assert len(page_one_data["items"]) == 2
    assert page_one_data["items"][0]["topic"] == "Noon B"

    page_two = client.get("/api/sessions", params={"page": 2, "page_size": 2}, headers=headers)
    assert page_two.status_code == 200
    page_two_data = page_two.json()
    assert page_two_data["page"] == 2
    assert len(page_two_data["items"]) == 1
    assert page_two_data["items"][0]["topic"] == "Morning"

    iso = base_day.isocalendar()
    week_value = f"{iso.year}-W{iso.week:02d}"
    date_value = base_day.strftime("%Y-%m-%d")

    filtered = client.get(
        "/api/sessions",
        params={
            "page": 1,
            "page_size": 20,
            "hour": 12,
            "date": date_value,
            "week": week_value,
            "year": base_day.year,
        },
        headers=headers,
    )
    assert filtered.status_code == 200
    filtered_data = filtered.json()
    assert filtered_data["total"] == 2
    assert len(filtered_data["items"]) == 2
    assert all(item["topic"] in {"Noon A", "Noon B"} for item in filtered_data["items"])
