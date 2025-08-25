# Next.js + FastAPI Trading UI

This is a React/Next.js port of your existing jQuery/Bootstrap trading UI. It calls your FastAPI endpoints directly.

## Quick start

1. Ensure your FastAPI server is running locally on `http://localhost:8000` (or update the base URL below).
2. Copy `.env.local.example` to `.env.local` and set:
   ```
   NEXT_PUBLIC_API_BASE=http://localhost:8000
   ```
3. Install and run:
   ```bash
   npm install
   npm run dev
   ```

## Notes

- Endpoints used match your current frontend:
  - `/get_clients`, `/add_client`, `/delete_client`
  - `/get_groups`, `/create_group`, `/delete_group`
  - `/search_symbols`
  - `/place_order`, `/get_orders`, `/cancel_order`
  - `/get_positions`, `/close_position`
  - `/get_holdings`, `/get_summary`
  - `/save_copytrading_setup`, `/list_copytrading_setups`, `/enable_copy_setup`, `/disable_copy_setup`, `/delete_copy_setup`
- You can also set rewrites in `next.config.mjs` by configuring `NEXT_PUBLIC_API_BASE`. The app will transparently proxy those paths.

## Mapping to old files

- Ported Trade tab, Clients/Groups, Orders/Positions/Holdings/Summary, and Copy Trading logic from the original HTML/JS.
- Select2 has been replaced with `react-select/Async` for symbol search.
- jQuery modals and DOM manipulations have been converted to React Bootstrap and hooks.
