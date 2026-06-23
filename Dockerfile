FROM python:3.11-slim

WORKDIR /app

# Install dependencies first for caching
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Render dynamically assigns a PORT environment variable.
# We default to 10000 if it's not set.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-10000}"]
