FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1

# Install Only Required Dependencies
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libasound2 xvfb \
    curl wget unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium only
RUN pip install playwright && playwright install chromium

COPY . .

ENV PORT=8000

CMD ["bash", "-c", "uvicorn MultiBroker_Router:app --host 0.0.0.0 --port=${PORT}"]
