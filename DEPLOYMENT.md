# Deploying PRIMEXA FNO Dashboard (primexalearning.in)

This app is a **monorepo**: React (Vite) frontend + Express API + WebSockets. Live market data uses **Dhan** credentials — **never** enable `MOCK_MODE` in production.

## Production checklist (code)

- `NODE_ENV=production`
- `MOCK_MODE=false`
- `DHAN_ACCESS_TOKEN` + `DHAN_CLIENT_ID` (and `DHAN_API_KEY` if you use it) — required for real ticks and REST
- Strong `JWT_SECRET` (not the example string)
- `CORS_ORIGINS=https://primexalearning.in,https://www.primexalearning.in` (plus your API URL if different)
- Optional: `REDIS_HOST` for distributed cache (app works without Redis)
- Market routes enforce JWT when `NODE_ENV=production` or `REQUIRE_MARKET_AUTH=true`
- WebSocket **mock stream is disabled in production** — missing Dhan credentials will **fail startup**

## Free / low-cost hosting

| Platform | Notes |
|----------|--------|
| **[Render](https://render.com)** | Free web service **sleeps** after idle; cold starts. Use `render.yaml` blueprint. |
| **Cloudflare Pages** | Free static hosting for the **frontend** (`apps/web` build). Set `VITE_API_BASE_URL` to your API URL. |
| **Oracle Cloud Free Tier** | Always-free VM; you install Docker and run the image yourself — best for **always-on** WebSockets. |

There is no reliable “100% free forever” tier for **always-on Node + WebSocket + production traffic**; plan for a small paid VPS if you outgrow free tiers.

## Option A — Render (Docker)

1. Push this repo to GitHub: `https://github.com/arpan-banerjee/fno_dashboard.git`
2. Sign up at [render.com](https://render.com) → **New** → **Blueprint** → connect repo → apply `render.yaml` (or create a **Web Service** with Dockerfile).
3. In the Render dashboard, set **secrets** (Environment):
   - `DHAN_ACCESS_TOKEN`, `DHAN_CLIENT_ID`, `DHAN_API_KEY` (as applicable)
   - `JWT_SECRET` (long random string)
   - `CORS_ORIGINS` = your site origins
   - `MOCK_MODE=false`
4. **Docker build arg**: set `VITE_API_BASE_URL` to your **public API URL** (e.g. `https://primexa-fno-api.onrender.com`) so the SPA calls the correct API.
5. Custom domain: Render → your service → **Custom Domains** → add `api.primexalearning.in` (DNS `CNAME` to Render’s host).
6. **Frontend**: either  
   - build `apps/web` with the same `VITE_API_BASE_URL` and deploy `dist` to **Cloudflare Pages** / Netlify / Render Static Site, or  
   - serve `apps/web/dist` from Nginx on the same VM as the API (advanced).

## Option B — Cloudflare Pages (frontend only)

1. Project → Build command:  
   `npm ci && npm run build -w @option-dashboard/shared && npm run build -w @option-dashboard/web`
2. Root directory: repository root (or configure `apps/web` if using a subdirectory project).
3. Environment variable: `VITE_API_BASE_URL=https://api.primexalearning.in` (your API).
4. Custom domain: `primexalearning.in` in Cloudflare DNS.

## Option C — Docker on a VPS

```bash
docker build -t fno-dashboard \
  --build-arg VITE_API_BASE_URL=https://api.primexalearning.in .
docker run -d -p 4000:4000 --env-file .env.production fno-dashboard
```

Put Nginx in front with TLS (Let’s Encrypt), proxy `/` to static files and `/` API routes to `localhost:4000` if you use a single host.

## DNS for primexalearning.in

At your domain registrar (or Cloudflare):

- `A` or `CNAME` for `@` and `www` → frontend (Pages/Netlify).
- `CNAME` for `api` → Render (or your API host).

## After deploy

- Open `https://<api>/health` — should return `{"status":"ok",...}`.
- Log in via the app; all `/market/*` calls must send `Authorization: Bearer <token>` when running in production.

## Repository

Source: `https://github.com/arpan-banerjee/fno_dashboard.git`
