import math
from datetime import UTC, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_session
from app.models import PomodoroSession, User
from app.schemas import (
    AuthResponse,
    CompletionSnapshot,
    Period,
    PomodoroPreset,
    PomodoroSessionCreate,
    PomodoroSessionRead,
    SessionListResponse,
    StatsOverview,
    TimelineResponse,
    UserLogin,
    UserRead,
    UserRegister,
)
from app.security import create_access_token, decode_access_token, hash_password, verify_password
from app.services.stats import build_completion_snapshot, build_overview, build_timeline

router = APIRouter(prefix="/api")
auth_scheme = HTTPBearer(auto_error=False)
BD_TIMEZONE = timezone(timedelta(hours=6), name="UTC+06")

PRESETS: list[PomodoroPreset] = [
    PomodoroPreset(id="classic", label="Classic 25/5", focus_minutes=25, break_minutes=5),
    PomodoroPreset(id="deep", label="Deep Work 50/10", focus_minutes=50, break_minutes=10),
    PomodoroPreset(id="sprint", label="Sprint 15/3", focus_minutes=15, break_minutes=3),
    PomodoroPreset(id="balanced", label="Balanced 30/5", focus_minutes=30, break_minutes=5),
]


def _to_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _to_bd_local(value: datetime) -> datetime:
    utc_naive = _to_utc_naive(value)
    return utc_naive.replace(tzinfo=UTC).astimezone(BD_TIMEZONE).replace(tzinfo=None)


def _overlap_exists(
    start_a: datetime,
    end_a: datetime,
    start_b: datetime,
    end_b: datetime,
) -> bool:
    return min(end_a, end_b) > max(start_a, start_b)


def _matches_hour_filter(start_bd: datetime, end_bd: datetime, hour: int) -> bool:
    cursor = start_bd.replace(minute=0, second=0, microsecond=0)
    if cursor > start_bd:
        cursor -= timedelta(hours=1)

    while cursor < end_bd:
        hour_end = cursor + timedelta(hours=1)
        if cursor.hour == hour and _overlap_exists(start_bd, end_bd, cursor, hour_end):
            return True
        cursor = hour_end

    return False


def _matches_session_filters(
    session: PomodoroSession,
    hour: int | None,
    date_value: str | None,
    week_value: str | None,
    year_value: int | None,
) -> bool:
    start_bd = _to_bd_local(session.started_at)
    end_bd = _to_bd_local(session.finished_at)

    if end_bd <= start_bd:
        end_bd = start_bd + timedelta(seconds=1)

    if date_value:
        try:
            day = datetime.strptime(date_value, "%Y-%m-%d")
        except ValueError:
            return False

        day_end = day + timedelta(days=1)
        if not _overlap_exists(start_bd, end_bd, day, day_end):
            return False

    if week_value:
        try:
            week_start = datetime.strptime(f"{week_value}-1", "%G-W%V-%u")
        except ValueError:
            return False

        week_end = week_start + timedelta(days=7)
        if not _overlap_exists(start_bd, end_bd, week_start, week_end):
            return False

    if year_value:
        year_start = datetime(year_value, 1, 1)
        year_end = datetime(year_value + 1, 1, 1)
        if not _overlap_exists(start_bd, end_bd, year_start, year_end):
            return False

    if hour is not None and not _matches_hour_filter(start_bd, end_bd, hour):
        return False

    return True


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(auth_scheme),
    db: Session = Depends(get_session),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    payload = decode_access_token(credentials.credentials)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    sub = payload.get("sub")
    if not isinstance(sub, str) or not sub.isdigit():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(sub)).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User no longer exists")

    return user


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "name": "Pomodoro"}


@router.get("/presets", response_model=list[PomodoroPreset])
def list_presets() -> list[PomodoroPreset]:
    return PRESETS


@router.post("/auth/register", response_model=AuthResponse)
def register_user(payload: UserRegister, db: Session = Depends(get_session)) -> AuthResponse:
    email = _normalize_email(payload.email)
    if "@" not in email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format")

    existing = db.query(User).filter(User.email == email).first()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")

    user = User(
        name=payload.name.strip(),
        email=email,
        password_hash=hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=UserRead.model_validate(user))


@router.post("/auth/login", response_model=AuthResponse)
def login_user(payload: UserLogin, db: Session = Depends(get_session)) -> AuthResponse:
    email = _normalize_email(payload.email)
    user = db.query(User).filter(User.email == email).first()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    token = create_access_token(user.id, user.email)
    return AuthResponse(access_token=token, user=UserRead.model_validate(user))


@router.post("/sessions", response_model=PomodoroSessionRead)
def create_session(
    payload: PomodoroSessionCreate,
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> PomodoroSession:
    started_at = _to_utc_naive(payload.started_at) if payload.started_at else datetime.now(UTC).replace(tzinfo=None)
    finished_at = _to_utc_naive(payload.finished_at) if payload.finished_at else datetime.now(UTC).replace(tzinfo=None)

    item = PomodoroSession(
        user_id=current_user.id,
        topic=payload.topic,
        target_study_text=payload.target_study_text,
        actual_study_text=payload.actual_study_text,
        completion_percentage=payload.completion_percentage,
        focus_minutes=payload.focus_minutes,
        break_minutes=payload.break_minutes,
        target_minutes=0,
        completed_minutes=0,
        efficiency=payload.completion_percentage,
        started_at=started_at,
        finished_at=finished_at,
    )

    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.get("/sessions", response_model=SessionListResponse)
def list_sessions(
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    hour: int | None = Query(default=None, ge=0, le=23),
    date_value: str | None = Query(default=None, alias="date"),
    week_value: str | None = Query(default=None, alias="week"),
    year_value: int | None = Query(default=None, alias="year", ge=1970, le=9999),
) -> SessionListResponse:
    rows = (
        db.query(PomodoroSession)
        .filter(PomodoroSession.user_id == current_user.id)
        .order_by(PomodoroSession.finished_at.desc())
        .all()
    )

    filtered = [
        row
        for row in rows
        if _matches_session_filters(row, hour, date_value, week_value, year_value)
    ]

    total = len(filtered)
    total_pages = max(1, math.ceil(total / page_size))
    start = (page - 1) * page_size
    end = start + page_size

    return SessionListResponse(
        items=filtered[start:end],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/stats/overview", response_model=StatsOverview)
def stats_overview(
    period: Period = Query(default=Period.week),
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> StatsOverview:
    return build_overview(db, current_user.id, period)


@router.get("/stats/timeline", response_model=TimelineResponse)
def stats_timeline(
    period: Period = Query(default=Period.week),
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> TimelineResponse:
    return build_timeline(db, current_user.id, period)


@router.get("/stats/completion", response_model=CompletionSnapshot)
def stats_completion(
    db: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
) -> CompletionSnapshot:
    snapshot = build_completion_snapshot(db, current_user.id)
    return CompletionSnapshot(**snapshot)
