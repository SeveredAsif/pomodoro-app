# Pomodoro

Pomodoro is a full-stack study timer web app built with FastAPI + React. It supports custom/fixed timer cycles, manual target vs actual study logs, user registration/login, and visual analytics for day/week/month/year self-rated completion.

## Features

- Focus timer with start, pause, reset, and mode skipping.
- User registration and login with JWT bearer authentication.
- Per-user data isolation (sessions and statistics are scoped to the authenticated user).
- Custom focus and break lengths.
- Fixed preset choices (25/5, 50/10, 15/3, 30/5).
- Study title and target study text before each session.
- Post-session log for what you actually studied and manually entered completion percentage.
- Persistent records in PostgreSQL.
- Statistics dashboard with charts for studied hours and completion trends.
- Completion snapshot by day, week, month, and year based on self-rated percentages.
- Docker Compose workflow for local full-stack startup.
- Frontend prepared for Netlify/Vercel static deployment.

## Stack

- Backend: FastAPI, SQLAlchemy, PostgreSQL
- Frontend: React, Vite, TypeScript, Recharts
- DevOps: Docker Compose, Nginx

## Run Locally (Docker Compose)

1. From project root:
   - `docker compose up --build`
2. Open:
   - Frontend: http://localhost:5173
   - Backend docs: http://localhost:8000/docs

## Run Without Docker

### Backend

1. `cd backend`
2. `python -m venv .venv`
3. `.venv\\Scripts\\activate`
4. `pip install -r requirements.txt`
5. Copy `.env.example` to `.env` and set values.
6. `uvicorn app.main:app --reload --port 8000`

### Frontend

1. `cd frontend`
2. `npm install`
3. Copy `.env.example` to `.env` and set `VITE_API_BASE_URL`.
4. `npm run dev`

## Tests

### Backend tests

- `cd backend`
- `pytest`

### Frontend tests

- `cd frontend`
- `npm test`

## Deploying (Frontend + Backend + DB)

### Recommended split deployment

- Frontend: Netlify or Vercel (static Vite build)
- Backend: Render, Railway, Fly.io, or Vercel Python runtime
- Database: managed PostgreSQL (Neon, Supabase, Railway, Render)

### Why split deployments

Netlify and Vercel are excellent for frontend hosting, while database-backed FastAPI APIs are usually simpler and more reliable on container/app platforms. This app is already prepared for split hosting through `VITE_API_BASE_URL` and backend CORS settings.

### Frontend deploy steps

1. Deploy `frontend` directory on Netlify/Vercel.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Add env var: `VITE_API_BASE_URL=https://YOUR_BACKEND_URL/api`

### Backend deploy steps

1. Deploy `backend` as a Python service or container.
2. Set env var `DATABASE_URL` to managed PostgreSQL URL.
3. Set env var `CORS_ORIGINS` to include deployed frontend URL.

## API Highlights

- `GET /api/presets` fixed pomodoro options.
- `POST /api/auth/register` create a new user account.
- `POST /api/auth/login` login and receive a bearer token.
- `POST /api/sessions` save a pomodoro record.
- `GET /api/sessions` list recent records.
- `GET /api/stats/overview?period=week` aggregate totals.
- `GET /api/stats/timeline?period=week` chart data.
- `GET /api/stats/completion` day/week/month/year completion snapshot.

All session and statistics endpoints require `Authorization: Bearer <token>` and return only the current user's data.
