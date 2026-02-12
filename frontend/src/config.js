// src/config.js
// If we are in production (Docker), use the browser's current hostname but port 8000.
// If we are in dev (your laptop), use 127.0.0.1:8000.

const getApiUrl = () => {
  if (import.meta.env.DEV) {
    return "http://127.0.0.1:8000";
  }
  // This assumes your Backend is running on Port 8000 on the same server as the Frontend
  return `${window.location.protocol}//${window.location.hostname}:8000`;
};

export const API_URL = getApiUrl();