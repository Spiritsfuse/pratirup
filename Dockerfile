# Pratirup: self-contained image with the trained model, processed open data,
# benchmark results and the built web app. No network access or secrets needed.

FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements-serve.txt .
RUN pip install --no-cache-dir -r requirements-serve.txt
COPY pratirup/ pratirup/
COPY data/processed/ data/processed/
COPY models/ models/
COPY results/ results/
COPY --from=web /web/dist web/dist
# /app/var is world-writable (sticky) so hosts that run the image under another
# uid can still write the SQLite cache.
RUN useradd --uid 10001 --create-home pratirup && mkdir -p /app/var && chown -R pratirup /app && chmod 1777 /app/var
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT', '8000'))"
# Port defaults to 8000 and can be overridden with $PORT.
ENV MALLOC_ARENA_MAX=2 OMP_NUM_THREADS=2
CMD ["sh", "-c", "exec python -m pratirup.cli serve --host 0.0.0.0 --port ${PORT:-8000}"]
