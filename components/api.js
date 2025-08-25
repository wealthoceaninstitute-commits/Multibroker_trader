// api.js
import axios from 'axios';

const env = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
const baseURL = env || 'http://127.0.0.1:5001';   // hard fallback to FastAPI
console.log('[API] baseURL =', baseURL);

const api = axios.create({
  baseURL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
});

export default api;
