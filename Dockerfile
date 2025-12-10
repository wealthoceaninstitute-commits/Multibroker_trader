FROM python:3.12-slim

# Install system dependencies for Chromium + Playwright
RUN apt-get update && apt-get install -y \
    wget git curl unzip xvfb \
    chromium libnss3 libatk1.0-0 libatk-bridge2.0-0 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxrandr2 libasound2 \
    libgdk-pixbuf-2.0-0 libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browser
RUN python -m playwright install chromium

# Copy the source code
COPY . .

# Expose Railway dynamic port
ENV PORT=8000

CMD ["uvicorn", "MultiBroker_Router:app", "--host", "0.0.0.0", "--port", "8000"]
