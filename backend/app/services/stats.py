from collections import defaultdict
from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import PomodoroSession
from app.schemas import Period, StatsOverview, TimelinePoint, TimelineResponse

BD_TIMEZONE = timezone(timedelta(hours=6), name="UTC+06")


def _ensure_utc_naive(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _to_bd_local(value: datetime) -> datetime:
    utc_naive = _ensure_utc_naive(value)
    return utc_naive.replace(tzinfo=UTC).astimezone(BD_TIMEZONE).replace(tzinfo=None)


def _bd_local_to_utc_naive(value: datetime) -> datetime:
    return value.replace(tzinfo=BD_TIMEZONE).astimezone(UTC).replace(tzinfo=None)


def _effective_end(start: datetime, end: datetime) -> datetime:
    if end <= start:
        return start + timedelta(seconds=1)
    return end


def _overlap_minutes(
    start_a: datetime,
    end_a: datetime,
    start_b: datetime,
    end_b: datetime,
) -> float:
    overlap_start = max(start_a, start_b)
    overlap_end = min(end_a, end_b)
    if overlap_end <= overlap_start:
        return 0.0
    return (overlap_end - overlap_start).total_seconds() / 60


def _period_bounds(period: Period, now: datetime) -> tuple[datetime, datetime]:
    if period == Period.day:
        start = datetime(now.year, now.month, now.day)
        end = start + timedelta(days=1)
        return start, end

    if period == Period.week:
        start = datetime(now.year, now.month, now.day) - timedelta(days=now.weekday())
        end = start + timedelta(days=7)
        return start, end

    if period == Period.month:
        start = datetime(now.year, now.month, 1)
        if now.month == 12:
            end = datetime(now.year + 1, 1, 1)
        else:
            end = datetime(now.year, now.month + 1, 1)
        return start, end

    start = datetime(now.year, 1, 1)
    end = datetime(now.year + 1, 1, 1)
    return start, end


def _safe_average_completion(total_percentage: float, sessions: int) -> float:
    if sessions <= 0:
        return 0.0
    return round(total_percentage / sessions, 2)


def build_overview(db: Session, user_id: int, period: Period, now: datetime | None = None) -> StatsOverview:
    now_utc = _ensure_utc_naive(now or datetime.now(UTC))
    now_bd = _to_bd_local(now_utc)
    start_bd, end_bd = _period_bounds(period, now_bd)
    start_utc = _bd_local_to_utc_naive(start_bd)
    end_utc = _bd_local_to_utc_naive(end_bd)

    rows = (
        db.query(PomodoroSession)
        .filter(
            PomodoroSession.user_id == user_id,
            PomodoroSession.finished_at > start_utc,
            PomodoroSession.started_at < end_utc,
        )
        .all()
    )

    total_focus_minutes = 0.0
    total_completion = 0.0
    sessions = 0

    for row in rows:
        session_start_bd = _to_bd_local(row.started_at)
        session_end_bd = _to_bd_local(_effective_end(row.started_at, row.finished_at))
        period_overlap = _overlap_minutes(session_start_bd, session_end_bd, start_bd, end_bd)

        if period_overlap <= 0:
            continue

        total_focus_minutes += period_overlap
        total_completion += row.completion_percentage
        sessions += 1

    return StatsOverview(
        period=period,
        total_focus_minutes=round(total_focus_minutes),
        total_studied_hours=round(total_focus_minutes / 60, 2),
        average_completion_percentage=_safe_average_completion(total_completion, sessions),
        sessions=sessions,
    )


def _timeline_buckets(period: Period, now: datetime) -> list[tuple[str, datetime, datetime]]:
    buckets: list[tuple[str, datetime, datetime]] = []

    if period == Period.day:
        day_start = datetime(now.year, now.month, now.day)
        for hour in range(24):
            start = day_start + timedelta(hours=hour)
            end = start + timedelta(hours=1)
            buckets.append((f"{hour:02d}:00", start, end))
        return buckets

    if period == Period.week:
        week_start = datetime(now.year, now.month, now.day) - timedelta(days=now.weekday())
        for offset in range(7):
            start = week_start + timedelta(days=offset)
            end = start + timedelta(days=1)
            buckets.append((start.strftime("%a %d"), start, end))
        return buckets

    if period == Period.month:
        month_end = datetime(now.year, now.month, now.day) + timedelta(days=1)
        month_start = month_end - timedelta(days=30)
        cursor = month_start
        while cursor < month_end:
            end = cursor + timedelta(days=1)
            buckets.append((cursor.strftime("%m/%d"), cursor, end))
            cursor = end
        return buckets

    month = now.month
    year = now.year
    for i in range(11, -1, -1):
        m = month - i
        y = year
        while m <= 0:
            m += 12
            y -= 1

        start = datetime(y, m, 1)
        if m == 12:
            end = datetime(y + 1, 1, 1)
        else:
            end = datetime(y, m + 1, 1)
        buckets.append((start.strftime("%b"), start, end))

    return buckets


def build_timeline(db: Session, user_id: int, period: Period, now: datetime | None = None) -> TimelineResponse:
    now_utc = _ensure_utc_naive(now or datetime.now(UTC))
    now_bd = _to_bd_local(now_utc)
    buckets = _timeline_buckets(period, now_bd)

    global_start = _bd_local_to_utc_naive(buckets[0][1])
    global_end = _bd_local_to_utc_naive(buckets[-1][2])

    rows = (
        db.query(PomodoroSession)
        .filter(
            PomodoroSession.user_id == user_id,
            PomodoroSession.finished_at > global_start,
            PomodoroSession.started_at < global_end,
        )
        .all()
    )

    acc: dict[str, dict[str, float]] = defaultdict(
        lambda: {"focus_minutes": 0.0, "completion_total": 0.0, "sessions": 0.0}
    )

    for row in rows:
        row_start_bd = _to_bd_local(row.started_at)
        row_end_bd = _to_bd_local(_effective_end(row.started_at, row.finished_at))

        for label, start, end in buckets:
            overlap = _overlap_minutes(row_start_bd, row_end_bd, start, end)
            if overlap > 0:
                acc[label]["focus_minutes"] += overlap
                acc[label]["completion_total"] += row.completion_percentage
                acc[label]["sessions"] += 1

    points = []
    for label, _, _ in buckets:
        focus_minutes = int(round(acc[label]["focus_minutes"]))
        sessions = int(acc[label]["sessions"])
        completion_total = acc[label]["completion_total"]
        points.append(
            TimelinePoint(
                label=label,
                focus_minutes=focus_minutes,
                sessions=sessions,
                studied_hours=round(focus_minutes / 60, 2),
                average_completion_percentage=_safe_average_completion(completion_total, sessions),
            )
        )

    return TimelineResponse(period=period, points=points)


def build_completion_snapshot(db: Session, user_id: int, now: datetime | None = None) -> dict[str, float]:
    now_utc = _ensure_utc_naive(now or datetime.now(UTC))
    return {
        "day": build_overview(db, user_id, Period.day, now_utc).average_completion_percentage,
        "week": build_overview(db, user_id, Period.week, now_utc).average_completion_percentage,
        "month": build_overview(db, user_id, Period.month, now_utc).average_completion_percentage,
        "year": build_overview(db, user_id, Period.year, now_utc).average_completion_percentage,
    }
