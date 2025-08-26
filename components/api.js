// components/api.js
import axios from 'axios';
import API_BASE from '../src/lib/apiBase';  // path is correct for your repo layout

const api = axios.create({
  baseURL: API_BASE,            // no localhost fallback in prod
  headers: { 'Content-Type': 'application/json' },
  withCredentials: false,
});

export default api;
