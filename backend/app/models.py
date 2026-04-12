from datetime import UTC, datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(UTC).replace(tzinfo=None),
        nullable=False,
    )


class PomodoroSession(Base):
    __tablename__ = "pomodoro_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    target_study_text: Mapped[str] = mapped_column(String(800), nullable=False)
    actual_study_text: Mapped[str] = mapped_column(String(1200), nullable=False)
    completion_percentage: Mapped[float] = mapped_column(Float, nullable=False)
    focus_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    break_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    # Legacy columns retained for schema compatibility with existing deployments.
    target_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    efficiency: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=False),
        default=lambda: datetime.now(UTC).replace(tzinfo=None),
        nullable=False,
    )

    @property
    def studied_minutes(self) -> float:
        if self.completed_minutes > 0:
            return float(self.completed_minutes)

        duration = (self.finished_at - self.started_at).total_seconds() / 60
        return max(duration, 0.0)
