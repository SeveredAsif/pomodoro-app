import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ApiError,
  clearAuthToken,
  clearStoredUser,
  createSession,
  getAuthToken,
  getCompletion,
  getOverview,
  getPresets,
  getSessions,
  getTimeline,
  getStoredUser,
  login,
  register,
  setAuthToken,
  setStoredUser,
} from "./services/api";
import {
  AuthResponse,
  CompletionSnapshot,
  Period,
  Preset,
  SessionFilters,
  SessionRecord,
  StatsOverview,
  TimelineResponse,
  User,
} from "./types";
import { asISO, formatDateTimeBD, formatSeconds, parseBackendTimestamp } from "./utils/time";

type TimerMode = "focus" | "break";

const PERIODS: Period[] = ["day", "week", "month", "year"];
const LOGS_PAGE_SIZE = 20;

function getCurrentBdDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function formatBdDateTimeInputValue(value: Date): string {
  const bdTime = new Date(value.getTime() + 6 * 60 * 60 * 1000);
  const year = bdTime.getUTCFullYear();
  const month = String(bdTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(bdTime.getUTCDate()).padStart(2, "0");
  const hour = String(bdTime.getUTCHours()).padStart(2, "0");
  const minute = String(bdTime.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseBdDateTimeInputValue(value: string): Date | null {
  if (!value) {
    return null;
  }

  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return null;
  }

  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  if ([year, month, day, hour, minute].some((item) => Number.isNaN(item))) {
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - 6, minute, 0, 0));
}

function shiftIsoDate(value: string, offsetDays: number): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }

  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + offsetDays);
  return next.toISOString().slice(0, 10);
}

function shiftBdMonth(value: string, offsetMonths: number): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }

  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCMonth(next.getUTCMonth() + offsetMonths);
  return next.toISOString().slice(0, 10);
}

function shiftBdYear(value: string, offsetYears: number): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return value;
  }

  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCFullYear(next.getUTCFullYear() + offsetYears);
  return next.toISOString().slice(0, 10);
}

function parseApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(error.message) as { detail?: string };
    if (parsed.detail) {
      return parsed.detail;
    }
  } catch {
    // ignore parse failures and fall back below
  }

  return error.message || fallback;
}

function App() {
  const [authToken, setAuthTokenState] = useState<string | null>(() => getAuthToken());
  const [authUser, setAuthUser] = useState<User | null>(() => getStoredUser());
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("Pomodoro Learner");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthBusy, setIsAuthBusy] = useState(false);

  const [presets, setPresets] = useState<Preset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState<string>("custom");

  const [topic, setTopic] = useState("Algorithms Sprint");
  const [targetStudyText, setTargetStudyText] = useState(
    "Finish two dynamic programming problems and summarize key patterns.",
  );
  const [actualStudyText, setActualStudyText] = useState("");
  const [completionPercentage, setCompletionPercentage] = useState(80);
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [manualTopic, setManualTopic] = useState("");
  const [manualTargetStudyText, setManualTargetStudyText] = useState("");
  const [manualActualStudyText, setManualActualStudyText] = useState("");
  const [manualCompletionPercentage, setManualCompletionPercentage] = useState(100);
  const [manualFocusMinutes, setManualFocusMinutes] = useState(30);
  const [manualBreakMinutes, setManualBreakMinutes] = useState(5);
  const [manualStudiedMinutes, setManualStudiedMinutes] = useState("");
  const [manualStartedAt, setManualStartedAt] = useState(() => formatBdDateTimeInputValue(new Date()));
  const [manualFinishedAt, setManualFinishedAt] = useState(() => formatBdDateTimeInputValue(new Date()));
  const [manualEntryError, setManualEntryError] = useState("");
  const [isManualSaving, setIsManualSaving] = useState(false);

  const [mode, setMode] = useState<TimerMode>("focus");
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [overtimeSeconds, setOvertimeSeconds] = useState(0);
  const [activeFocusSeconds, setActiveFocusSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [awaitingLog, setAwaitingLog] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<Date | null>(null);
  const [statusMessage, setStatusMessage] = useState("Focus on one task and make it count.");

  const [period, setPeriod] = useState<Period>("week");
  const [dayReferenceDate, setDayReferenceDate] = useState<string>(() => getCurrentBdDate());
  const [weekReferenceDate, setWeekReferenceDate] = useState<string>(() => getCurrentBdDate());
  const [monthReferenceDate, setMonthReferenceDate] = useState<string>(() => getCurrentBdDate());
  const [yearReferenceDate, setYearReferenceDate] = useState<string>(() => getCurrentBdDate());
  const [overview, setOverview] = useState<StatsOverview | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [completion, setCompletion] = useState<CompletionSnapshot | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [sessionsPage, setSessionsPage] = useState(1);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [sessionsTotalPages, setSessionsTotalPages] = useState(1);
  const [hourFilter, setHourFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [weekFilter, setWeekFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const focusTickRef = useRef<number | null>(null);
  const secondsLeftRef = useRef(secondsLeft);
  const awaitingLogRef = useRef(awaitingLog);

  const totalPhaseSeconds = useMemo(() => {
    return Math.max(1, (mode === "focus" ? focusMinutes : breakMinutes) * 60);
  }, [mode, focusMinutes, breakMinutes]);

  const remainingPercent = useMemo(() => {
    return Math.min(100, Math.max(0, Math.round((secondsLeft / totalPhaseSeconds) * 100)));
  }, [secondsLeft, totalPhaseSeconds]);

  const timerRingStyle = useMemo(
    () =>
      ({
        "--remaining": `${remainingPercent}%`,
        "--ring-color": mode === "focus" ? "#e25d38" : "#0f7f7a",
      }) as React.CSSProperties,
    [remainingPercent, mode],
  );

  const activeSessionFilters = useMemo<SessionFilters>(() => {
    const filters: SessionFilters = {};

    if (hourFilter !== "") {
      filters.hour = Number.parseInt(hourFilter, 10);
    }

    if (dateFilter) {
      filters.date = dateFilter;
    }

    if (weekFilter) {
      filters.week = weekFilter;
    }

    if (yearFilter) {
      filters.year = Number.parseInt(yearFilter, 10);
    }

    return filters;
  }, [hourFilter, dateFilter, weekFilter, yearFilter]);

  const currentBdDate = useMemo(() => getCurrentBdDate(), []);
  const statsReferenceDate = useMemo(() => {
    if (period === "day") {
      return dayReferenceDate;
    }

    if (period === "week") {
      return weekReferenceDate;
    }

    if (period === "month") {
      return monthReferenceDate;
    }

    if (period === "year") {
      return yearReferenceDate;
    }

    return undefined;
  }, [period, dayReferenceDate, weekReferenceDate, monthReferenceDate, yearReferenceDate]);

  useEffect(() => {
    secondsLeftRef.current = secondsLeft;
  }, [secondsLeft]);

  useEffect(() => {
    awaitingLogRef.current = awaitingLog;
  }, [awaitingLog]);

  function getStudiedMinutes(item: SessionRecord): number {
    if (item.studied_minutes > 0) {
      return Math.round(item.studied_minutes);
    }

    const start = parseBackendTimestamp(item.started_at).getTime();
    const end = parseBackendTimestamp(item.finished_at).getTime();
    return Math.max(0, Math.round((end - start) / 60000));
  }

  function handleLogout(message?: string): void {
    clearAuthToken();
    clearStoredUser();
    setAuthTokenState(null);
    setAuthUser(null);
    setPresets([]);
    setOverview(null);
    setTimeline(null);
    setCompletion(null);
    setSessions([]);
    setSessionsPage(1);
    setSessionsTotal(0);
    setSessionsTotalPages(1);
    setHourFilter("");
    setDateFilter("");
    setWeekFilter("");
    setYearFilter("");
    setAwaitingLog(false);
    setIsRunning(false);
    setOvertimeSeconds(0);
    setActiveFocusSeconds(0);
    setSessionStartedAt(null);
    setDayReferenceDate(getCurrentBdDate());
    setWeekReferenceDate(getCurrentBdDate());
    setMonthReferenceDate(getCurrentBdDate());
    setYearReferenceDate(getCurrentBdDate());
    setStatusMessage(message ?? "Logged out.");
  }

  function handleAuthIssue(message: string): void {
    setStatusMessage(message);
  }

  function completeAuthentication(payload: AuthResponse): void {
    setAuthToken(payload.access_token)
    setStoredUser(payload.user)
    setAuthTokenState(payload.access_token)
    setAuthUser(payload.user)
    setAuthError("")
    setAuthPassword("")
    setStatusMessage(`Welcome ${payload.user.name}. Ready for your next focus sprint.`)
  }

  async function onSubmitAuth(event: FormEvent): Promise<void> {
    event.preventDefault()

    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Email and password are required.")
      return
    }

    if (authMode === "register" && !authName.trim()) {
      setAuthError("Name is required for registration.")
      return
    }

    setIsAuthBusy(true)

    try {
      const response =
        authMode === "register"
          ? await register({
              name: authName.trim(),
              email: authEmail.trim(),
              password: authPassword,
            })
          : await login({
              email: authEmail.trim(),
              password: authPassword,
            })

      completeAuthentication(response)
    } catch (error) {
      setAuthError(parseApiError(error, "Authentication failed. Please try again."))
    } finally {
      setIsAuthBusy(false)
    }
  }

  useEffect(() => {
    if (!authToken) {
      return;
    }

    getPresets()
      .then((items) => {
        setPresets(items);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          handleAuthIssue("Your session could not be verified. Please sign in again if needed.");
          return;
        }
        setStatusMessage("Could not load presets, but custom mode is available.");
      });
  }, [authToken]);

  useEffect(() => {
    if (mode === "focus" && !isRunning && !awaitingLog && sessionStartedAt === null) {
      setSecondsLeft(focusMinutes * 60);
      setOvertimeSeconds(0);
      setActiveFocusSeconds(0);
    }
  }, [focusMinutes, mode, isRunning, awaitingLog, sessionStartedAt]);

  useEffect(() => {
    if (!isRunning && mode === "break") {
      setSecondsLeft(breakMinutes * 60);
    }
  }, [breakMinutes, mode, isRunning]);

  useEffect(() => {
    if (!isRunning || mode !== "focus") {
      focusTickRef.current = null;
      return;
    }

    focusTickRef.current = Date.now();

    const advanceFocusTimer = (): void => {
      const now = Date.now();
      const previousTick = focusTickRef.current ?? now;
      const elapsedSeconds = Math.floor((now - previousTick) / 1000);

      if (elapsedSeconds <= 0) {
        return;
      }

      focusTickRef.current = previousTick + elapsedSeconds * 1000;
      setActiveFocusSeconds((prev) => prev + elapsedSeconds);

      const remainingBeforeTick = secondsLeftRef.current;

      if (awaitingLogRef.current || remainingBeforeTick <= 0) {
        setOvertimeSeconds((prev) => prev + elapsedSeconds);
        return;
      }

      if (elapsedSeconds < remainingBeforeTick) {
        const nextRemaining = remainingBeforeTick - elapsedSeconds;
        secondsLeftRef.current = nextRemaining;
        setSecondsLeft(nextRemaining);
        return;
      }

      const overflowSeconds = elapsedSeconds - remainingBeforeTick;
      secondsLeftRef.current = 0;
      awaitingLogRef.current = true;
      setSecondsLeft(0);
      setAwaitingLog(true);
      setStatusMessage("Focus target reached. Timer is tracking overtime until you stop and log.");

      if (overflowSeconds > 0) {
        setOvertimeSeconds((prev) => prev + overflowSeconds);
      }
    };

    const timer = window.setInterval(advanceFocusTimer, 250);
    const onVisibilityChange = (): void => {
      advanceFocusTimer();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isRunning, mode]);

  useEffect(() => {
    if (!isRunning || mode !== "break" || secondsLeft <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => Math.max(prev - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [isRunning, mode, secondsLeft]);

  useEffect(() => {
    if (!isRunning || mode !== "break" || secondsLeft > 0) {
      return;
    }

    setIsRunning(false);
    setMode("focus");
    setSecondsLeft(focusMinutes * 60);
    setOvertimeSeconds(0);
    setActiveFocusSeconds(0);
    setStatusMessage("Break complete. Ready for the next focus sprint.");
  }, [secondsLeft, isRunning, mode, focusMinutes]);

  useEffect(() => {
    if (!authToken) {
      setOverview(null);
      setTimeline(null);
      setCompletion(null);
      setIsLoadingStats(false);
      return;
    }

    setIsLoadingStats(true);

    Promise.all([getOverview(period, statsReferenceDate), getTimeline(period, statsReferenceDate), getCompletion()])
      .then(([overviewData, timelineData, completionData]) => {
        setOverview(overviewData);
        setTimeline(timelineData);
        setCompletion(completionData);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          handleAuthIssue("Your session could not be verified. Please sign in again if needed.");
          return;
        }
        setStatusMessage("Unable to fetch some stats. Check API connectivity.");
      })
      .finally(() => {
        setIsLoadingStats(false);
      });
  }, [period, authToken, statsReferenceDate]);

  useEffect(() => {
    setSessionsPage(1);
  }, [hourFilter, dateFilter, weekFilter, yearFilter]);

  useEffect(() => {
    if (!authToken) {
      setSessions([]);
      setSessionsTotal(0);
      setSessionsTotalPages(1);
      setIsLoadingSessions(false);
      return;
    }

    setIsLoadingSessions(true);

    getSessions(sessionsPage, LOGS_PAGE_SIZE, activeSessionFilters)
      .then((response) => {
        setSessions(response.items);
        setSessionsTotal(response.total);
        setSessionsTotalPages(response.total_pages);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          handleAuthIssue("Your session could not be verified. Please sign in again if needed.");
          return;
        }
        setStatusMessage("Unable to fetch session logs. Check API connectivity.");
      })
      .finally(() => {
        setIsLoadingSessions(false);
      });
  }, [authToken, sessionsPage, activeSessionFilters]);

  function applyPreset(item: Preset): void {
    setSelectedPreset(item.id);
    setFocusMinutes(item.focus_minutes);
    setBreakMinutes(item.break_minutes);
    setMode("focus");
    setIsRunning(false);
    setAwaitingLog(false);
    setOvertimeSeconds(0);
    setActiveFocusSeconds(0);
    setSecondsLeft(item.focus_minutes * 60);
    setStatusMessage(`Preset loaded: ${item.label}`);
  }

  function startTimer(): void {
    if (mode === "focus" && !sessionStartedAt) {
      setSessionStartedAt(new Date());
      setActiveFocusSeconds(0);
    }

    setIsRunning(true);
    setStatusMessage(mode === "focus" ? "Focus mode running." : "Break mode running.");
  }

  function pauseTimer(): void {
    setIsRunning(false);
    if (mode === "focus" && awaitingLog) {
      setStatusMessage("Overtime stopped. Log your study and start break.");
      return;
    }

    setStatusMessage("Timer stopped.");
  }

  function resetTimer(): void {
    setIsRunning(false);
    setAwaitingLog(false);
    setOvertimeSeconds(0);
    setActiveFocusSeconds(0);
    setSecondsLeft((mode === "focus" ? focusMinutes : breakMinutes) * 60);
    if (mode === "focus") {
      setSessionStartedAt(null);
    }
    setStatusMessage("Timer reset.");
  }

  function skipMode(): void {
    setIsRunning(false);

    if (mode === "focus") {
      setAwaitingLog(true);
      setSecondsLeft(0);
      setStatusMessage("Focus stopped. Log your study to begin break.");
      return;
    }

    setMode("focus");
    setSecondsLeft(focusMinutes * 60);
    setOvertimeSeconds(0);
    setActiveFocusSeconds(0);
    setSessionStartedAt(null);
    setStatusMessage("Break skipped. Back to focus mode.");
  }

  async function refreshStats(): Promise<void> {
    const [overviewData, timelineData, completionData] = await Promise.all([
      getOverview(period, statsReferenceDate),
      getTimeline(period, statsReferenceDate),
      getCompletion(),
    ]);

    setOverview(overviewData);
    setTimeline(timelineData);
    setCompletion(completionData);
  }

  async function refreshSessions(page: number): Promise<void> {
    const response = await getSessions(page, LOGS_PAGE_SIZE, activeSessionFilters);
    setSessions(response.items);
    setSessionsTotal(response.total);
    setSessionsTotalPages(response.total_pages);
  }

  async function onSubmitCompletedStudy(event: FormEvent): Promise<void> {
    event.preventDefault();

    if (!topic.trim()) {
      setStatusMessage("Please enter a session title before saving.");
      return;
    }

    if (!targetStudyText.trim()) {
      setStatusMessage("Please add your target study text before saving.");
      return;
    }

    if (!actualStudyText.trim()) {
      setStatusMessage("Please describe what you actually studied.");
      return;
    }

    setIsSaving(true);

    const start = sessionStartedAt ?? new Date();
    const finish = new Date();
    const plannedSeconds = focusMinutes * 60;
    const studiedSeconds = Math.max(activeFocusSeconds, 1);
    const studiedMinutes = Math.round((studiedSeconds / 60) * 100) / 100;
    const overtimeLoggedSeconds = Math.max(studiedSeconds - plannedSeconds, 0);
    const overtimeLoggedMinutes = overtimeLoggedSeconds / 60;

    try {
      await createSession({
        topic: topic.trim(),
        target_study_text: targetStudyText.trim(),
        actual_study_text: actualStudyText.trim(),
        completion_percentage: completionPercentage,
        focus_minutes: focusMinutes,
        break_minutes: breakMinutes,
        studied_minutes: studiedMinutes,
        started_at: asISO(start),
        finished_at: asISO(finish),
      });

      setStatusMessage(
        `Session saved (${(studiedSeconds / 60).toFixed(1)}m studied, +${overtimeLoggedMinutes.toFixed(1)}m overtime).`,
      );

      setIsRunning(false);
      setAwaitingLog(false);
      setSessionStartedAt(null);
      setOvertimeSeconds(0);
      setActiveFocusSeconds(0);
      setMode("break");
      setSecondsLeft(breakMinutes * 60);
      setActualStudyText("");

      setSessionsPage(1);
      await Promise.all([refreshStats(), refreshSessions(1)]);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthIssue("Your session could not be verified. Please sign in again if needed.");
        return;
      }
      setStatusMessage("Could not save session. Check backend status.");
    } finally {
      setIsSaving(false);
    }
  }

  function onCustomFocusChange(value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 240) {
      return;
    }

    setSelectedPreset("custom");
    setFocusMinutes(parsed);
  }

  function onCustomBreakChange(value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 120) {
      return;
    }

    setSelectedPreset("custom");
    setBreakMinutes(parsed);
  }

  async function onSubmitManualEntry(event: FormEvent): Promise<void> {
    event.preventDefault();
    setManualEntryError("");

    if (!manualTopic.trim()) {
      setManualEntryError("Session title is required.");
      return;
    }

    if (!manualTargetStudyText.trim()) {
      setManualEntryError("Target study text is required.");
      return;
    }

    if (!manualActualStudyText.trim()) {
      setManualEntryError("Actual study text is required.");
      return;
    }

    const finishedAt = parseBdDateTimeInputValue(manualFinishedAt);
    const startedAt = parseBdDateTimeInputValue(manualStartedAt);
    const parsedStudiedMinutes = manualStudiedMinutes.trim() === "" ? null : Number.parseFloat(manualStudiedMinutes);

    if (!finishedAt) {
      setManualEntryError("Finished time is required.");
      return;
    }

    let resolvedStartedAt = startedAt;
    let resolvedStudiedMinutes = parsedStudiedMinutes;

    if (!resolvedStartedAt && resolvedStudiedMinutes === null) {
      setManualEntryError("Provide a start time or studied minutes.");
      return;
    }

    if (resolvedStartedAt && finishedAt <= resolvedStartedAt) {
      setManualEntryError("End time must be after start time.");
      return;
    }

    if (!resolvedStartedAt && resolvedStudiedMinutes !== null) {
      if (Number.isNaN(resolvedStudiedMinutes) || resolvedStudiedMinutes <= 0) {
        setManualEntryError("Studied minutes must be greater than zero.");
        return;
      }

      resolvedStartedAt = new Date(finishedAt.getTime() - resolvedStudiedMinutes * 60 * 1000);
    }

    if (!resolvedStartedAt) {
      setManualEntryError("Start time could not be determined.");
      return;
    }

    const computedStudiedMinutes = Math.max(
      1,
      Math.round(((finishedAt.getTime() - resolvedStartedAt.getTime()) / 60000) * 100) / 100,
    );

    if (resolvedStudiedMinutes === null) {
      resolvedStudiedMinutes = computedStudiedMinutes;
    }

    if (resolvedStudiedMinutes <= 0) {
      setManualEntryError("Studied minutes must be greater than zero.");
      return;
    }

    setIsManualSaving(true);

    try {
      await createSession({
        topic: manualTopic.trim(),
        target_study_text: manualTargetStudyText.trim(),
        actual_study_text: manualActualStudyText.trim(),
        completion_percentage: manualCompletionPercentage,
        focus_minutes: manualFocusMinutes,
        break_minutes: manualBreakMinutes,
        studied_minutes: computedStudiedMinutes,
        started_at: asISO(resolvedStartedAt),
        finished_at: asISO(finishedAt),
      });

      setManualTopic("");
      setManualTargetStudyText("");
      setManualActualStudyText("");
      setManualCompletionPercentage(100);
      setManualFocusMinutes(30);
      setManualBreakMinutes(5);
      setManualStudiedMinutes("");
      setManualStartedAt(formatBdDateTimeInputValue(new Date()));
      setManualFinishedAt(formatBdDateTimeInputValue(new Date()));

      setSessionsPage(1);
      await Promise.all([refreshStats(), refreshSessions(1)]);
      setStatusMessage("Manual session saved.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        handleAuthIssue("Your session could not be verified. Please sign in again if needed.");
        return;
      }

      setManualEntryError(parseApiError(error, "Could not save the manual session."));
    } finally {
      setIsManualSaving(false);
    }
  }

  if (!authToken) {
    return (
      <div className="auth-shell">
        <div className="glow glow-a" />
        <div className="glow glow-b" />
        <section className="auth-card">
          <p className="hero-kicker">Personalized Access</p>
          <h1>Pomodoro</h1>
          <p className="auth-copy">
            Sign in to keep your study sessions private. Every timer log and statistic is stored per user.
          </p>

          <div className="auth-tabs">
            <button
              className={`tab ${authMode === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
            >
              Login
            </button>
            <button
              className={`tab ${authMode === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
            >
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={onSubmitAuth}>
            {authMode === "register" && (
              <label>
                Name
                <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="Your display name" />
              </label>
            )}

            <label>
              Email
              <input
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </label>

            {authError && <p className="auth-error">{authError}</p>}

            <button className="btn primary" disabled={isAuthBusy}>
              {isAuthBusy ? "Please wait..." : authMode === "register" ? "Create Account" : "Login"}
            </button>
          </form>
        </section>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="glow glow-a" />
      <div className="glow glow-b" />

      <div className="user-bar">
        <p>
          Signed in as <strong>{authUser?.name ?? "Learner"}</strong>
        </p>
        <button className="btn" onClick={() => handleLogout("Logged out successfully.")}>Logout</button>
      </div>

      <header className="hero">
        <p className="hero-kicker">Precision Study Tracking</p>
        <h1>Pomodoro</h1>
        <p className="hero-copy">
          Define what you plan to study, log what really happened, and track your own self-rated completion
          over time.
        </p>
      </header>

      <main className="layout-grid">
        <section className="panel timer-panel">
          <div className="timer-header">
            <span className={`mode-pill ${mode === "focus" ? "focus" : "break"}`}>
              {mode === "focus" ? "Focus" : "Break"} Mode
            </span>
            <p className="status-message">{statusMessage}</p>
          </div>

          <div className="timer-face" style={timerRingStyle}>
            <div className="timer-core">
              <span className="timer-time">{formatSeconds(secondsLeft)}</span>
              <span className="timer-sub">
                {awaitingLog && mode === "focus"
                  ? `Overtime +${formatSeconds(overtimeSeconds)}`
                  : `${remainingPercent}% time left`}
              </span>
            </div>
          </div>

          <div className="timer-controls">
            <button className="btn primary" onClick={startTimer} disabled={isRunning}>
              Start
            </button>
            <button className="btn" onClick={pauseTimer} disabled={!isRunning}>
              {awaitingLog && mode === "focus" ? "Stop" : "Pause"}
            </button>
            <button className="btn" onClick={resetTimer}>
              Reset
            </button>
            <button className="btn" onClick={skipMode}>
              Skip
            </button>
          </div>

          <div className="form-grid">
            <label>
              Session title
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g., React Hooks" />
            </label>
            <label className="wide-field">
              Target for this session
              <textarea
                value={targetStudyText}
                onChange={(e) => setTargetStudyText(e.target.value)}
                rows={3}
                placeholder="What exactly do you want to study in this session?"
              />
            </label>
            <label>
              Custom focus length (minutes)
              <input
                type="number"
                min={1}
                max={240}
                value={focusMinutes}
                onChange={(e) => onCustomFocusChange(e.target.value)}
              />
            </label>
            <label>
              Custom break length (minutes)
              <input
                type="number"
                min={1}
                max={120}
                value={breakMinutes}
                onChange={(e) => onCustomBreakChange(e.target.value)}
              />
            </label>
          </div>

          <div className="preset-row">
            <span>Quick Presets</span>
            <div className="preset-list">
              {presets.map((item) => (
                <button
                  key={item.id}
                  className={`chip ${selectedPreset === item.id ? "active" : ""}`}
                  onClick={() => applyPreset(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <form className="manual-entry-form" onSubmit={onSubmitManualEntry}>
            <div className="manual-entry-header">
              <div>
                <h2>Manual Log Entry</h2>
                <p>Add a study row directly to the database without running the timer.</p>
              </div>
            </div>

            <div className="form-grid manual-grid">
              <label>
                Session title
                <input value={manualTopic} onChange={(e) => setManualTopic(e.target.value)} placeholder="e.g., Datacomm" />
              </label>
              <label>
                Completion percentage
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={manualCompletionPercentage}
                  onChange={(e) => setManualCompletionPercentage(Math.min(100, Math.max(0, Number.parseFloat(e.target.value) || 0)))}
                />
              </label>
              <label className="wide-field">
                Target study text
                <textarea
                  value={manualTargetStudyText}
                  onChange={(e) => setManualTargetStudyText(e.target.value)}
                  rows={2}
                  placeholder="What you planned to study"
                />
              </label>
              <label className="wide-field">
                Actual study text
                <textarea
                  value={manualActualStudyText}
                  onChange={(e) => setManualActualStudyText(e.target.value)}
                  rows={3}
                  placeholder="What you actually completed"
                />
              </label>
              <label>
                Planned focus minutes
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={manualFocusMinutes}
                  onChange={(e) => setManualFocusMinutes(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                />
              </label>
              <label>
                Break minutes
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={manualBreakMinutes}
                  onChange={(e) => setManualBreakMinutes(Math.max(1, Number.parseInt(e.target.value, 10) || 1))}
                />
              </label>
              <label>
                Start time (BD)
                <input
                  type="datetime-local"
                  value={manualStartedAt}
                  onChange={(e) => setManualStartedAt(e.target.value)}
                />
              </label>
              <label>
                End time (BD)
                <input
                  type="datetime-local"
                  value={manualFinishedAt}
                  onChange={(e) => setManualFinishedAt(e.target.value)}
                />
              </label>
              <label className="wide-field">
                Studied minutes override
                <input
                  type="number"
                  min={1}
                  step="0.1"
                  value={manualStudiedMinutes}
                  onChange={(e) => setManualStudiedMinutes(e.target.value)}
                  placeholder="Optional if you forgot start time"
                />
              </label>
            </div>

            {manualEntryError && <p className="auth-error">{manualEntryError}</p>}

            <div className="manual-actions">
              <button className="btn primary" type="submit" disabled={isManualSaving}>
                {isManualSaving ? "Saving..." : "Save Manual Entry"}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setManualTopic("");
                  setManualTargetStudyText("");
                  setManualActualStudyText("");
                  setManualCompletionPercentage(100);
                  setManualFocusMinutes(30);
                  setManualBreakMinutes(5);
                  setManualStudiedMinutes("");
                  setManualStartedAt(formatBdDateTimeInputValue(new Date()));
                  setManualFinishedAt(formatBdDateTimeInputValue(new Date()));
                  setManualEntryError("");
                }}
              >
                Reset Manual Form
              </button>
            </div>
          </form>

          {awaitingLog && (
            <form className="completion-form" onSubmit={onSubmitCompletedStudy}>
              <h2>Log What You Actually Studied</h2>
              <label>
                Actual study log
                <textarea
                  value={actualStudyText}
                  onChange={(e) => setActualStudyText(e.target.value)}
                  rows={4}
                  placeholder="Write what you finished, where you got blocked, and what remains."
                />
              </label>
              <label>
                Self-rated completion percentage
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={completionPercentage}
                  onChange={(e) =>
                    setCompletionPercentage(
                      Math.min(100, Math.max(0, Number.parseFloat(e.target.value) || 0)),
                    )
                  }
                />
              </label>
              <button className="btn primary" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Session"}
              </button>
            </form>
          )}
        </section>

        <section className="panel stats-panel">
          <div className="stats-head">
            <h2>Statistics</h2>
            <div className="period-tabs">
              {PERIODS.map((item) => (
                <button
                  key={item}
                  className={`tab ${period === item ? "active" : ""}`}
                  onClick={() => setPeriod(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          {isLoadingStats ? (
            <p>Loading statistics...</p>
          ) : (
            <>
              <div className="kpi-grid">
                <article>
                  <h3>Studied Hours</h3>
                  <p>{overview?.total_studied_hours ?? 0}</p>
                </article>
                <article>
                  <h3>Self-Rated Completion</h3>
                  <p>{overview?.average_completion_percentage ?? 0}%</p>
                </article>
                <article>
                  <h3>Sessions</h3>
                  <p>{overview?.sessions ?? 0}</p>
                </article>
              </div>

              <div className="chart-grid">
                <article className="chart-card">
                  <h3>Study Hours Timeline</h3>
                  {period === "day" && (
                    <>
                      <div className="day-timeline-toolbar">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setDayReferenceDate((prev) => shiftIsoDate(prev, -1))}
                        >
                          Previous Day
                        </button>
                        <label>
                          Day (BD)
                          <input
                            type="date"
                            value={dayReferenceDate}
                            max={currentBdDate}
                            onChange={(e) => setDayReferenceDate(e.target.value)}
                          />
                        </label>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setDayReferenceDate(currentBdDate)}
                          disabled={dayReferenceDate === currentBdDate}
                        >
                          Today
                        </button>
                      </div>
                      <p className="timeline-note">Hourly view for {dayReferenceDate} (BD)</p>
                    </>
                  )}
                  {period === "week" && (
                    <>
                      <div className="day-timeline-toolbar">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setWeekReferenceDate((prev) => shiftIsoDate(prev, -7))}
                        >
                          Previous Week
                        </button>
                        <label>
                          Week anchor (BD)
                          <input
                            type="date"
                            value={weekReferenceDate}
                            max={currentBdDate}
                            onChange={(e) => setWeekReferenceDate(e.target.value)}
                          />
                        </label>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setWeekReferenceDate(currentBdDate)}
                          disabled={weekReferenceDate === currentBdDate}
                        >
                          This Week
                        </button>
                      </div>
                      <p className="timeline-note">Weekly view anchored at {weekReferenceDate} (BD)</p>
                    </>
                  )}
                  {period === "month" && (
                    <>
                      <div className="day-timeline-toolbar">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setMonthReferenceDate((prev) => shiftBdMonth(prev, -1))}
                        >
                          Previous Month
                        </button>
                        <label>
                          Month anchor (BD)
                          <input
                            type="date"
                            value={monthReferenceDate}
                            max={currentBdDate}
                            onChange={(e) => setMonthReferenceDate(e.target.value)}
                          />
                        </label>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setMonthReferenceDate(currentBdDate)}
                          disabled={monthReferenceDate === currentBdDate}
                        >
                          This Month
                        </button>
                      </div>
                      <p className="timeline-note">Monthly view anchored at {monthReferenceDate} (BD)</p>
                    </>
                  )}
                  {period === "year" && (
                    <>
                      <div className="day-timeline-toolbar">
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setYearReferenceDate((prev) => shiftBdYear(prev, -1))}
                        >
                          Previous Year
                        </button>
                        <label>
                          Year anchor (BD)
                          <input
                            type="date"
                            value={yearReferenceDate}
                            max={currentBdDate}
                            onChange={(e) => setYearReferenceDate(e.target.value)}
                          />
                        </label>
                        <button
                          className="btn"
                          type="button"
                          onClick={() => setYearReferenceDate(currentBdDate)}
                          disabled={yearReferenceDate === currentBdDate}
                        >
                          This Year
                        </button>
                      </div>
                      <p className="timeline-note">Yearly view anchored at {yearReferenceDate} (BD)</p>
                    </>
                  )}
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={timeline?.points ?? []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="studied_hours" fill="#0f7f7a" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </article>

                <article className="chart-card">
                  <h3>Completion Trend (%)</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={timeline?.points ?? []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis domain={[0, "auto"]} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="average_completion_percentage"
                        stroke="#f15c3b"
                        strokeWidth={3}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </article>
              </div>

              <div className="completion-grid">
                <article>
                  <span>Day</span>
                  <strong>{completion?.day ?? 0}%</strong>
                </article>
                <article>
                  <span>Week</span>
                  <strong>{completion?.week ?? 0}%</strong>
                </article>
                <article>
                  <span>Month</span>
                  <strong>{completion?.month ?? 0}%</strong>
                </article>
                <article>
                  <span>Year</span>
                  <strong>{completion?.year ?? 0}%</strong>
                </article>
              </div>

              <div className="recent-table">
                <h3>Session Logs</h3>
                <div className="logs-toolbar">
                  <label>
                    Hour (BD)
                    <select value={hourFilter} onChange={(e) => setHourFilter(e.target.value)}>
                      <option value="">All</option>
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={String(hour)}>
                          {hour.toString().padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Date
                    <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
                  </label>
                  <label>
                    Week
                    <input type="week" value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} />
                  </label>
                  <label>
                    Year
                    <input
                      type="number"
                      min={1970}
                      max={9999}
                      value={yearFilter}
                      onChange={(e) => setYearFilter(e.target.value)}
                      placeholder="e.g., 2026"
                    />
                  </label>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setHourFilter("");
                      setDateFilter("");
                      setWeekFilter("");
                      setYearFilter("");
                    }}
                  >
                    Clear Filters
                  </button>
                </div>

                <p className="logs-summary">Showing {sessions.length} of {sessionsTotal} logs</p>

                {isLoadingSessions ? (
                  <p className="empty-logs">Loading logs...</p>
                ) : (
                  <div className="log-grid">
                    {sessions.map((item) => (
                      <article key={item.id} className="log-card">
                        <div className="log-head">
                          <h4>{item.topic}</h4>
                          <span className="log-score">{item.completion_percentage}%</span>
                        </div>
                        <div className="log-times">
                          <p className="log-time">Start: {formatDateTimeBD(item.started_at)}</p>
                          <p className="log-time">End: {formatDateTimeBD(item.finished_at)}</p>
                          <p className="log-time tz-note">BD Standard Time (UTC+6)</p>
                        </div>
                        <div className="log-meta">
                          <span>{item.focus_minutes}m planned</span>
                          <span>{getStudiedMinutes(item)}m studied</span>
                          <span>{item.break_minutes}m break</span>
                        </div>
                        <div className="log-block">
                          <span>Target</span>
                          <p>{item.target_study_text}</p>
                        </div>
                        <div className="log-block">
                          <span>Actually Studied</span>
                          <p>{item.actual_study_text}</p>
                        </div>
                      </article>
                    ))}
                    {sessions.length === 0 && <p className="empty-logs">No sessions matched these filters.</p>}
                  </div>
                )}

                <div className="pagination-row">
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setSessionsPage((prev) => Math.max(1, prev - 1))}
                    disabled={sessionsPage <= 1}
                  >
                    Previous
                  </button>
                  <p>
                    Page {sessionsPage} of {sessionsTotalPages}
                  </p>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setSessionsPage((prev) => Math.min(sessionsTotalPages, prev + 1))}
                    disabled={sessionsPage >= sessionsTotalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
