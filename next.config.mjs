/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
    if (!API_BASE) return [];
    const paths = [
      'get_clients','add_client','delete_client',
      'get_groups','create_group','delete_group',
      'search_symbols',
      'place_order','get_orders','cancel_order','get_positions','close_position',
      'get_holdings','get_summary',
      'save_copytrading_setup','list_copytrading_setups','enable_copy_setup','disable_copy_setup','delete_copy_setup'
    ];
    return paths.map(p => ({ source: `/${p}`, destination: `${API_BASE}/${p}` }));
  },
};
export default nextConfig;
