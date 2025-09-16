// next.config.mjs

/** @type {import('next').NextConfig} */
const apiBase = process.env.API_BASE ?? ''; // must be like: https://<your-backend>.up.railway.app
const isHttp = /^https?:\/\//i.test(apiBase);
const to = (p) => `${apiBase}${p}`;

const config = {
  reactStrictMode: true,
  async rewrites() {
    if (!isHttp) {
      console.warn(
        'Skipping Next.js rewrites: API_BASE missing or not starting with http/https.'
      );
      return [];
    }
    return [
      { source: '/get_positions',           destination: to('/get_positions') },
      { source: '/get_orders',              destination: to('/get_orders') },
      { source: '/get_holdings',            destination: to('/get_holdings') },
      { source: '/get_summary',             destination: to('/get_summary') },
      { source: '/list_copytrading_setups', destination: to('/list_copytrading_setups') },
      { source: '/enable_copy_setup',       destination: to('/enable_copy_setup') },
      { source: '/disable_copy_setup',      destination: to('/disable_copy_setup') },
      { source: '/delete_copy_setup',       destination: to('/delete_copy_setup') },
      { source: '/search_symbols', destination: to('/search_symbols') },
    ];
  },
};

export default config;
