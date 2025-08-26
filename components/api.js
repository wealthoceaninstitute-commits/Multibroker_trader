// components/api.js
import axios from 'axios';
import API_BASE from '../src/lib/apiBase.js';

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});
export default api;
