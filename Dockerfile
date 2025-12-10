# Use official Python runtime
FROM python:3.12-slim

# Install system deps + Chromium dependencies for Playwright
RUN apt-get update && apt-get install -y \
    git curl unzip wget gnupg ca-certificates \
    libxkbcommon0 libgtk-3-0 libnss3 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright required browser
RUN python -m playwright install chromium

# Copy source code
COPY . .

# Railway exposes PORT dynamically, ensure compatibility
ENV PORT=8000

# Start FastAPI using uvicorn
CMD ["uvicorn", "MultiBroker_Router:app", "--host", "0.0.0.0", "--port", "8000"]
