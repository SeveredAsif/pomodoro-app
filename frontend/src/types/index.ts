export type Period = "day" | "week" | "month" | "year";

export interface Preset {
  id: string;
  label: string;
  focus_minutes: number;
  break_minutes: number;
}

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: "bearer";
  user: User;
}

export interface SessionCreatePayload {
  topic: string;
  target_study_text: string;
  actual_study_text: string;
  completion_percentage: number;
  focus_minutes: number;
  break_minutes: number;
  started_at: string;
  finished_at: string;
}

export interface SessionRecord {
  id: number;
  user_id: number | null;
  topic: string;
  target_study_text: string;
  actual_study_text: string;
  completion_percentage: number;
  focus_minutes: number;
  break_minutes: number;
  started_at: string;
  finished_at: string;
  created_at: string;
}

export interface SessionListResponse {
  items: SessionRecord[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface SessionFilters {
  hour?: number;
  date?: string;
  week?: string;
  year?: number;
}

export interface StatsOverview {
  period: Period;
  total_focus_minutes: number;
  total_studied_hours: number;
  average_completion_percentage: number;
  sessions: number;
}

export interface TimelinePoint {
  label: string;
  focus_minutes: number;
  sessions: number;
  studied_hours: number;
  average_completion_percentage: number;
}

export interface TimelineResponse {
  period: Period;
  points: TimelinePoint[];
}

export interface CompletionSnapshot {
  day: number;
  week: number;
  month: number;
  year: number;
}
