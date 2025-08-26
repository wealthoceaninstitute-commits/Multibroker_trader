// src/lib/apiBase.js
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
export default API_BASE;
