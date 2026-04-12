from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()


class Base(DeclarativeBase):
    pass


def _build_engine() -> object:
    connect_args = {}
    if settings.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
    return create_engine(settings.database_url, future=True, connect_args=connect_args)


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ensure_schema_compatibility() -> None:
    inspector = inspect(engine)
    if "pomodoro_sessions" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("pomodoro_sessions")}
    statements: list[str] = []

    if "target_study_text" not in existing_columns:
        statements.append(
            "ALTER TABLE pomodoro_sessions ADD COLUMN target_study_text VARCHAR(800) NOT NULL DEFAULT ''"
        )

    if "actual_study_text" not in existing_columns:
        statements.append(
            "ALTER TABLE pomodoro_sessions ADD COLUMN actual_study_text VARCHAR(1200) NOT NULL DEFAULT ''"
        )

    if "completion_percentage" not in existing_columns:
        statements.append(
            "ALTER TABLE pomodoro_sessions ADD COLUMN completion_percentage FLOAT NOT NULL DEFAULT 0"
        )

    if "user_id" not in existing_columns:
        statements.append("ALTER TABLE pomodoro_sessions ADD COLUMN user_id INTEGER")

    if not statements:
        with engine.begin() as connection:
            _backfill_legacy_session_data(connection)
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        _backfill_legacy_session_data(connection)


def _backfill_legacy_session_data(connection: Connection) -> None:
    connection.execute(
        text(
            """
            UPDATE pomodoro_sessions
            SET completion_percentage = efficiency
            WHERE completion_percentage = 0
              AND efficiency > 0
              AND (target_study_text = '' OR target_study_text IS NULL)
              AND (actual_study_text = '' OR actual_study_text IS NULL)
            """
        )
    )

    connection.execute(
        text(
            """
            UPDATE pomodoro_sessions
            SET target_study_text = topic
            WHERE target_study_text = '' OR target_study_text IS NULL
            """
        )
    )

    connection.execute(
        text(
            """
            UPDATE pomodoro_sessions
            SET actual_study_text = 'Legacy record imported before manual log notes were enabled.'
            WHERE actual_study_text = '' OR actual_study_text IS NULL
            """
        )
    )
