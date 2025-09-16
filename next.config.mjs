// next.config.js  (CommonJS)
// Or convert to .mjs with "export default config" style if you prefer.

/** @type {import('next').NextConfig} */
const apiBase = process.env.API_BASE; // e.g. "https://multibrokertrader-production-xxxx.up.railway.app"

function ok(url) { return typeof url === 'string' && /^https?:\/\//i.test(url); }
function to(path) { return `${apiBase}${path}`; }

const config = {
  reactStrictMode: true,
  async rewrites() {
    // If API_BASE is missing or bad, skip rewrites so the build doesn't fail.
    if (!ok(apiBase)) {
      console.warn(
        'Skipping Next.js rewrites: API_BASE is not set or missing http/https. ' +
        'Set API_BASE to your backend URL (e.g., https://...up.railway.app).'
      );
      return [];
    }
    return [
      { source: '/get_positions',            destination: to('/get_positions') },
      { source: '/get_orders',               destination: to('/get_orders') },
      { source: '/get_holdings',             destination: to('/get_holdings') },
      { source: '/get_summary',              destination: to('/get_summary') },
      { source: '/list_copytrading_setups',  destination: to('/list_copytrading_setups') },
      { source: '/enable_copy_setup',        destination: to('/enable_copy_setup') },
      { source: '/disable_copy_setup',       destination: to('/disable_copy_setup') },
      { source: '/delete_copy_setup',        destination: to('/delete_copy_setup') },
    ];
  },
};

module.exports = config;
