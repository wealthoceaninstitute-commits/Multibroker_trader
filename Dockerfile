FROM python:3.12-slim

RUN apt-get update && apt-get install -y \
    wget unzip xvfb chromium libnss3 libgdk-pixbuf2.0-0 libgtk-3-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 libasound2 

RUN pip install --no-cache-dir -r requirements.txt

ENV CHROME_BIN=/usr/bin/chromium
ENV DISPLAY=:99

WORKDIR /app
COPY . .

CMD ["python", "CT_FastAPI.py"]
