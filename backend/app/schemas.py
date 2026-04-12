from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class Period(str, Enum):
    day = "day"
    week = "week"
    month = "month"
    year = "year"


class PomodoroPreset(BaseModel):
    id: str
    label: str
    focus_minutes: int
    break_minutes: int


class UserRegister(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class UserLogin(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class UserRead(BaseModel):
    id: int
    name: str
    email: str

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class PomodoroSessionCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=255)
    target_study_text: str = Field(min_length=1, max_length=800)
    actual_study_text: str = Field(min_length=1, max_length=1200)
    completion_percentage: float = Field(ge=0, le=100)
    focus_minutes: int = Field(ge=1, le=240)
    break_minutes: int = Field(ge=1, le=120)
    started_at: datetime | None = None
    finished_at: datetime | None = None


class PomodoroSessionRead(BaseModel):
    id: int
    user_id: int | None
    topic: str
    target_study_text: str
    actual_study_text: str
    completion_percentage: float
    focus_minutes: int
    break_minutes: int
    started_at: datetime
    finished_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class SessionListResponse(BaseModel):
    items: list[PomodoroSessionRead]
    total: int
    page: int
    page_size: int
    total_pages: int


class StatsOverview(BaseModel):
    period: Period
    total_focus_minutes: int
    total_studied_hours: float
    average_completion_percentage: float
    sessions: int


class TimelinePoint(BaseModel):
    label: str
    focus_minutes: int
    sessions: int
    studied_hours: float
    average_completion_percentage: float


class TimelineResponse(BaseModel):
    period: Period
    points: list[TimelinePoint]


class CompletionSnapshot(BaseModel):
    day: float
    week: float
    month: float
    year: float
