FROM python:3.12-slim

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Chrome + dependencies already handled by Railway build
RUN apt-get update

# Copy your backend code
COPY . .

EXPOSE 8000

CMD ["uvicorn", "CT_FastAPI:app", "--host", "0.0.0.0", "--port", "8000"]
