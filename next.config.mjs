/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const API = process.env.NEXT_PUBLIC_API_BASE; // must include https://
    return API ? [
      { source: '/get_positions',            destination: `${API}/get_positions` },
      { source: '/get_orders',               destination: `${API}/get_orders` },
      { source: '/get_holdings',             destination: `${API}/get_holdings` },
      { source: '/get_summary',              destination: `${API}/get_summary` },
      { source: '/list_copytrading_setups',  destination: `${API}/list_copytrading_setups` },
      { source: '/enable_copy_setup',        destination: `${API}/enable_copy_setup` },
      { source: '/disable_copy_setup',       destination: `${API}/disable_copy_setup` },
      { source: '/delete_copy_setup',        destination: `${API}/delete_copy_setup` },
    ] : [];
  },
};
export default nextConfig;
