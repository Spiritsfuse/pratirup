# Deploying Pratirup

Pratirup is one container: FastAPI serves the API and the built React app. It needs no database server, no secrets and no network access. The SQLite cache is rebuilt from the committed data and models at start, in about 5 s.

## 1. Local, hardened (recommended for judging and demos)

```bash
docker compose up --build        # http://127.0.0.1:8000
```

`docker-compose.yml` runs the image:

- with a read-only root filesystem;
- with all Linux capabilities dropped and `no-new-privileges`;
- with memory and PID limits;
- as a non-root user;
- bound to localhost only.

A plain `docker run --rm -p 8000:8000 pratirup` also works.

## 2. Free public demo: Render (no card needed)

The free web service gives 512 MB RAM and 0.1 CPU and sleeps after 15 minutes idle. The first request after sleep takes about a minute. The app uses about 250 MB.

1. Create a free account at render.com and sign in with GitHub.
2. Click **New → Blueprint** and choose this repository. `render.yaml` configures everything.
3. Wait for the first build (about 5–8 min). Open the `https://pratirup-….onrender.com` URL.
4. Before a judging session, open the URL once so the service is awake.

## 3. Hugging Face Spaces (Docker)

Docker Spaces now need a PRO plan (about US$9/month); only static Spaces are free.

1. Create a Docker Space.
2. Add this front-matter to the Space's README:

   ```yaml
   ---
   title: Pratirup
   sdk: docker
   app_port: 8000
   license: apache-2.0
   ---
   ```

3. Push this repository's contents to the Space with a write-scoped access token.

The image already handles the Space's non-default user ID, because `/app/var` is world-writable.

## 4. Google Cloud Run (needs a billing account)

```bash
gcloud run deploy pratirup --source . --region asia-south1 --memory 1Gi \
  --no-cpu-throttling --min-instances 0 --allow-unauthenticated \
  --set-env-vars PRATIRUP_VAR_DIR=/tmp/pratirup
```

Live streaming uses a background thread, so keep CPU allocated (`--no-cpu-throttling`).

## Not suitable

- **Vercel / Netlify:** serverless functions cannot keep the live-streaming twin in memory, and the Python bundle is large. They could host only the static frontend.
- **Koyeb / Fly.io / Railway:** no usable free tier for new accounts (October 2026).
