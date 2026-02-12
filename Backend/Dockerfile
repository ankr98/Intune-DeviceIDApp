# 1. Use an official Python runtime as a parent image
# We use 'slim' to keep the image size small
FROM python:3.10-slim

# 2. Set the working directory in the container
WORKDIR /app

# --- NEW: Install cabextract for HP/Dell sync ---
RUN apt-get update && apt-get install -y cabextract && rm -rf /var/lib/apt/lists/*
# ------------------------------------------------

# 3. Copy the requirements file into the container
COPY requirements.txt .

# 4. Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy the rest of the backend code into the container
COPY . .

# 6. Expose port 8000 (The port FastAPI runs on)
EXPOSE 8000

# 7. Define the command to run your app using Uvicorn
# --host 0.0.0.0 is CRITICAL for Docker containers to be accessible
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]