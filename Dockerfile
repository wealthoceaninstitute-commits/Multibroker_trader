# Base Python environment
FROM python:3.12-slim

# Install system dependencies (needed for playwright + chromium)
RUN apt-get update && apt-get install -y \
    curl wget unzip gnupg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirement file and install deps
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . /app/

# Install playwright browser (required for Dhan automation)
RUN playwright install --with-deps chromium

ENV PORT=8000

# Start FastAPI
CMD ["uvicorn", "MultiBroker_Router:app", "--host", "0.0.0.0", "--port", "8000"]

