import {
  AuthResponse,
  CompletionSnapshot,
  LoginPayload,
  Period,
  Preset,
  RegisterPayload,
  SessionCreatePayload,
  SessionFilters,
  SessionListResponse,
  SessionRecord,
  StatsOverview,
  TimelineResponse,
  User,
} from "../types";

const runtimeHostname = typeof window === "undefined" ? "localhost" : window.location.hostname;
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? `http://${runtimeHostname}:8000/api`;
const TOKEN_STORAGE_KEY = "pomodoro_auth_token";
const USER_STORAGE_KEY = "pomodoro_auth_user";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function setAuthToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function clearAuthToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

export function setStoredUser(user: User): void {
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function getStoredUser(): User | null {
  const raw = localStorage.getItem(USER_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function clearStoredUser(): void {
  localStorage.removeItem(USER_STORAGE_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    headers,
    ...init,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new ApiError(response.status, message || `API request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function register(payload: RegisterPayload): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function login(payload: LoginPayload): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getPresets(): Promise<Preset[]> {
  return request<Preset[]>("/presets");
}

export function createSession(payload: SessionCreatePayload): Promise<SessionRecord> {
  return request<SessionRecord>("/sessions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getOverview(period: Period): Promise<StatsOverview> {
  return request<StatsOverview>(`/stats/overview?period=${period}`);
}

export function getTimeline(period: Period): Promise<TimelineResponse> {
  return request<TimelineResponse>(`/stats/timeline?period=${period}`);
}

export function getCompletion(): Promise<CompletionSnapshot> {
  return request<CompletionSnapshot>("/stats/completion");
}

export function getSessions(
  page = 1,
  pageSize = 20,
  filters?: SessionFilters,
): Promise<SessionListResponse> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("page_size", String(pageSize));

  if (filters?.hour !== undefined) {
    params.set("hour", String(filters.hour));
  }

  if (filters?.date) {
    params.set("date", filters.date);
  }

  if (filters?.week) {
    params.set("week", filters.week);
  }

  if (filters?.year !== undefined) {
    params.set("year", String(filters.year));
  }

  return request<SessionListResponse>(`/sessions?${params.toString()}`);
}
