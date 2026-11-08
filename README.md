# Learning Grounds

A voice tutor that works through homework with you on a shared whiteboard. Upload a homework PDF, and the tutor reads each page, then talks it through with you by voice or text. It draws on the board while it talks: it circles a problem, underlines the key facts, writes a hint in math, draws a number line, or writes a question for you to answer in a box. Ask it to check your work, and it reads your handwriting.

**Live:** https://learningrounds.com. Log in with Google or an email address.

Built at SharkByte 2026 by Lorenzo and Aquiles.

## How it's built

| Part | Built with |
|---|---|
| Web app (`web/`) | Next.js 16 and React 19, tldraw for the board, ElevenLabs Agents for the tutor's voice and board tools, KaTeX for math |
| API (`api/`) | FastAPI, Gemini to read homework pages and check work, Auth0 for login and API access |
| Canvas LMS | An LTI 1.1 app: open Learning Grounds from a course menu, and turn work in from the board |
| Hosting (`deploy/`) | Docker on a Hostinger VPS behind nginx. Every push to `main` deploys itself. |

The browser never holds the ElevenLabs key or the agent ID. A logged-in student's browser asks our API for a one-time session credential.

## Run it locally

1. Copy the example settings, then fill in the keys (ask Lorenzo):
   ```bash
   cp api/.env.example api/.env
   cp web/.env.example web/.env.local
   ```
2. Start the API:
   ```bash
   cd api && uv run uvicorn main:app --reload --port 8000
   ```
3. In a second terminal, start the web app, then open http://localhost:3000:
   ```bash
   cd web && npm install && npm run dev
   ```

Tests: `cd api && uv run pytest`, and `cd web && node --test lib/*.test.ts`.

## What's where

- `web/`: the Next.js app. The board, the tutor's pen and its tools are in `web/lib/lg-*.ts`.
- `api/`: the FastAPI app, with tests in `api/tests/`. `api/scripts/` sets up the ElevenLabs agent and writes the server's settings files.
- `deploy/`: Docker Compose, our nginx sites, and the timer that deploys `main`.
- `docs/`:
  - [CONTRACT.md](docs/CONTRACT.md): how the UI and the back end connect.
  - [learning-grounds-vision.md](docs/learning-grounds-vision.md): the product vision and scope.
  - [DEPLOY.md](docs/DEPLOY.md): the server.

## Deploying

Push to `main`, and the server deploys it within about 2 minutes. If a build fails, the current version keeps running. Keep `main` working, and do unfinished work on a branch. [docs/DEPLOY.md](docs/DEPLOY.md) has the details.
