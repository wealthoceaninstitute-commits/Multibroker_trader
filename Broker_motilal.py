import os, json, logging
from typing import Dict, Any, List
from datetime import datetime
from collections import OrderedDict
import threading


try:
    import pyotp
except Exception:
    pyotp = None

from MOFSLOPENAPI import MOFSLOPENAPI  # requires your SDK

BASE_URL        = os.getenv("MO_BASE_URL", "https://openapi.motilaloswal.com")
SOURCE_ID       = os.getenv("MO_SOURCE_ID", "Desktop")
BROWSER_NAME    = os.getenv("MO_BROWSER", "chrome")
BROWSER_VERSION = os.getenv("MO_BROWSER_VER", "104")

STAT_KEYS = ["pending","traded","rejected","cancelled","others"]
_sessions: Dict[str, MOFSLOPENAPI] = {}

DATA_DIR    = os.path.abspath(os.environ.get("DATA_DIR", "./data"))
CLIENTS_DIR = os.path.join(DATA_DIR, "clients", "motilal")

def _read_clients() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    try:
        for fn in os.listdir(CLIENTS_DIR):
            if not fn.endswith('.json'):
                continue
            try:
                with open(os.path.join(CLIENTS_DIR, fn), 'r', encoding='utf-8') as f:
                    items.append(json.load(f))
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return items

def _pick(*vals):
    for v in vals:
        if v not in (None, '', [], {}):
            return v
    return None

def login(client: Dict[str, Any]) -> bool:
    userid   = (client.get("userid") or client.get("client_id") or '').strip()
    if not userid:
        return False
    if userid in _sessions:
        return True
    apikey   = _pick(client.get("apikey"), (client.get("creds") or {}).get("apikey"))
    password = _pick(client.get("password"), (client.get("creds") or {}).get("password"))
    pan      = _pick(client.get("pan"), (client.get("creds") or {}).get("pan"), (client.get("creds") or {}).get("PAN"))
    totpkey  = _pick(client.get("totpkey"), (client.get("creds") or {}).get("totpkey"),
                     (client.get("creds") or {}).get("mpin"), (client.get("creds") or {}).get("otp"))
    if not (userid and apikey and password and pan):
        logging.error("[MO] login(): missing credentials for %s", userid)
        return False
    try:
        otp = pyotp.TOTP(totpkey).now() if (pyotp and totpkey) else ""
        sdk = MOFSLOPENAPI(apikey, BASE_URL, None, SOURCE_ID, BROWSER_NAME, BROWSER_VERSION)
        resp = sdk.login(userid, password, pan, otp, userid)
        if resp and resp.get("status") == "SUCCESS":
            _sessions[userid] = sdk
            return True
        logging.error("[MO] login failed for %s: %s", userid, (resp or {}).get("message"))
    except Exception as e:
        logging.exception("[MO] login error for %s: %s", userid, e)
    return False

def _ensure_session(c: Dict[str, Any]) -> MOFSLOPENAPI | None:
    uid = (c.get('userid') or c.get('client_id') or '').strip()
    if not uid:
        return None
    sdk = _sessions.get(uid)
    if sdk:
        return sdk
    if login(c):
        return _sessions.get(uid)
    return None
def get_orders() -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch Motilal orders for all logged-in clients and bucketize:
    { pending:[], traded:[], rejected:[], cancelled:[], others:[] }
    """
    orders_data: Dict[str, List[Dict[str, Any]]] = {
        "pending":   [],
        "traded":    [],
        "rejected":  [],
        "cancelled": [],
        "others":    []
    }

    for c in _read_clients():
        name   = c.get("name") or c.get("display_name") or c.get("userid") or c.get("client_id") or ""
        userid = str(c.get("userid") or c.get("client_id") or "").strip()
        sdk    = _ensure_session(c)
        if not sdk or not userid:
            logging.error("[MO] get_orders: no session/userid for %s", name)
            continue

        try:
            today_date = datetime.now().strftime("%d-%b-%Y 09:00:00")
            resp = sdk.GetOrderBook({"clientcode": userid, "datetimestamp": today_date})

            if resp and resp.get("status") != "SUCCESS":
                logging.error("❌ Error fetching orders for %s: %s",
                              name, resp.get("message", "No message"))

            orders = resp.get("data", []) if isinstance(resp, dict) else []
            if not isinstance(orders, list):
                orders = []

            for order in orders:
                row = {
                    "name": name,
                    "symbol": order.get("symbol", ""),
                    "transaction_type": order.get("buyorsell", ""),
                    "quantity": order.get("orderqty", ""),
                    "price": order.get("price", ""),
                    "status": order.get("orderstatus", ""),
                    "order_id": order.get("uniqueorderid", "")
                }
                s = (row["status"] or "").lower()
                if "confirm" in s:
                    orders_data["pending"].append(row)
                elif "traded" in s:
                    orders_data["traded"].append(row)
                elif "rejected" in s or "error" in s:
                    orders_data["rejected"].append(row)
                elif "cancel" in s:
                    orders_data["cancelled"].append(row)
                else:
                    orders_data["others"].append(row)

        except Exception as e:
            print(f"❌ Error fetching orders for {name}: {e}")

    return orders_data

def cancel_orders(orders: List[Dict[str, Any]]) -> List[str]:
    """
    Cancel Motilal orders in parallel.
    Input:  [{ "name": "<client display name>", "order_id": "<id>" }, ...]
    Output: list of user-facing status messages.
    """
    if not isinstance(orders, list) or not orders:
        return ["❌ No orders received for cancellation."]

    messages: List[str] = []
    lock = threading.Lock()

    # map client display name -> client json
    by_name: Dict[str, Dict[str, Any]] = {}
    for c in _read_clients():
        nm = (c.get("name") or c.get("display_name") or "").strip()
        if nm:
            by_name[nm] = c

    def cancel_single(order: Dict[str, Any]) -> None:
        name     = (order or {}).get("name")
        order_id = (order or {}).get("order_id")
        if not name or not order_id:
            with lock:
                messages.append(f"❌ Missing data in order: {order}")
            return

        cj = by_name.get(name)
        if not cj:
            with lock:
                messages.append(f"❌ Session not found for: {name}")
            return

        userid = str(cj.get("userid") or cj.get("client_id") or "").strip()
        sdk    = _ensure_session(cj)
        if not sdk or not userid:
            with lock:
                messages.append(f"❌ Session not found for: {name}")
            return

        try:
            resp = sdk.CancelOrder(order_id, userid)
            msg  = (resp.get("message", "") or "").lower() if isinstance(resp, dict) else ""
            with lock:
                if "cancel order request sent" in msg:
                    messages.append(f"✅ Cancelled Order {order_id} for {name}")
                else:
                    messages.append(f"❌ Failed to cancel Order {order_id} for {name}: {resp.get('message','') if isinstance(resp,dict) else resp}")
        except Exception as e:
            with lock:
                messages.append(f"❌ Error cancelling {order_id} for {name}: {e}")

    threads: List[threading.Thread] = []
    for od in orders:
        t = threading.Thread(target=cancel_single, args=(od,))
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    return messages



def get_positions() -> Dict[str, List[Dict[str, Any]]]:
    """
    Fetch Motilal positions for all logged-in clients and bucketize:
    { open:[], closed:[] }
    API call pattern mirrors get_orders(): pass {"clientcode": userid}.
    """
    data: Dict[str, List[Dict[str, Any]]] = {"open": [], "closed": []}

    for c in _read_clients():
        name = c.get("name") or c.get("display_name") or c.get("userid") or c.get("client_id") or ""
        uid  = str(c.get("userid") or c.get("client_id") or "").strip()
        sdk  = _ensure_session(c)
        if not sdk or not uid:
            logging.error("[MO] get_positions: no session/userid for %s", name)
            continue

        # --- API call aligned with get_orders() ---
        try:
            resp = sdk.GetPosition({"clientcode": uid})
            if resp and resp.get("status") != "SUCCESS":
                logging.error("❌ Error fetching positions for %s: %s", name, resp.get("message", "No message"))
            rows = resp.get("data", []) if isinstance(resp, dict) else []
            if not isinstance(rows, list):
                rows = []
        except Exception as e:
            logging.error("[MO] get_positions error for %s: %s", name, e)
            rows = []
        # -----------------------------------------

        # --- same parsing / math you already use ---
        for pos in rows:
            buy_qty  = (pos.get("buyquantity", 0)  or 0)
            sell_qty = (pos.get("sellquantity", 0) or 0)
            qty      = buy_qty - sell_qty
            booked   = (pos.get("bookedprofitloss", 0) or 0)
            buy_amt  = (pos.get("buyamount", 0) or 0)
            sell_amt = (pos.get("sellamount", 0) or 0)
            ltp      = (pos.get("LTP", 0) or 0)

            buy_avg  = (buy_amt / buy_qty)  if buy_qty  > 0 else 0
            sell_avg = (sell_amt / sell_qty) if sell_qty > 0 else 0
            # MTM + booked P&L (unchanged)
            net_pnl  = ((ltp - buy_avg) * qty if qty > 0 else (sell_avg - ltp) * abs(qty)) + booked

            row = {
                "name": name,
                "symbol": pos.get("symbol", "") or "",
                "quantity": qty,
                "buy_avg": round(buy_avg, 2),
                "sell_avg": round(sell_avg, 2),
                "net_profit": round(net_pnl, 2),
            }
            if qty == 0:
                data["closed"].append(row)
            else:
                data["open"].append(row)
        # -------------------------------------------

    return data

# add near the top with the other imports
import sqlite3

# optional: put this next to DATA_DIR/CLIENTS_DIR constants
SQLITE_DB = os.path.abspath(
    os.environ.get("SQLITE_DB", os.path.join(DATA_DIR, "symbols.sqlite3"))
)

def close_positions(positions: List[Dict[str, Any]]) -> List[str]:
    """
    Close (square-off) positions for given [{name, symbol}] by placing
    opposite MARKET orders via MOFSLOPENAPI. Payload matches your route
    (clientcode/exchange/symboltoken/buyorsell/ordertype/producttype/...).
    """

    # -------- map client display name -> client json (reuse login/session flow)
    by_name: Dict[str, Dict[str, Any]] = {}
    for c in _read_clients():
        nm = (c.get("name") or c.get("display_name") or "").strip()
        if nm:
            by_name[nm] = c

    # -------- load min-qty map once (Security ID -> Min Qty); we’ll look up with token
    min_qty_map: Dict[str, int] = {}
    try:
        if os.path.exists(SQLITE_DB):
            conn = sqlite3.connect(SQLITE_DB)
            cur  = conn.cursor()
            cur.execute('SELECT [Security ID], [Min Qty] FROM symbols')
            for sid, q in cur.fetchall():
                if sid:
                    try:
                        min_qty_map[str(sid)] = int(q) if q else 1
                    except Exception:
                        min_qty_map[str(sid)] = 1
            conn.close()
    except Exception as e:
        logging.error("close_positions: min-qty DB read error: %s", e)

    out: List[str] = []

    for req in positions or []:
        name   = (req or {}).get("name") or ""
        symbol = (req or {}).get("symbol") or ""
        if not name or not symbol:
            out.append(f"❌ Missing name/symbol in request: {req}")
            continue

        cj  = by_name.get(name)
        uid = (cj.get("userid") or cj.get("client_id") or "").strip() if cj else ""
        sdk = _ensure_session(cj) if cj else None
        if not (cj and uid and sdk):
            out.append(f"❌ No session for: {name}")
            continue

        # ---- fetch fresh positions to get exchange, productname, symboltoken, and net qty
        try:
            resp = sdk.GetPosition()
            rows = resp.get("data", []) if (resp and resp.get("status") == "SUCCESS") else []
        except Exception as e:
            out.append(f"❌ GetPosition failed for {name}: {e}")
            continue

        pos_row = next((r for r in rows if (r.get("symbol") or "") == symbol), None)
        if not pos_row:
            out.append(f"❌ Position not found: {name} - {symbol}")
            continue

        buy_q = int(pos_row.get("buyquantity", 0) or 0)
        sell_q = int(pos_row.get("sellquantity", 0) or 0)
        net_q = buy_q - sell_q
        if net_q == 0:
            out.append(f"ℹ️ Already flat: {name} - {symbol}")
            continue

        side = "SELL" if net_q > 0 else "BUY"
        qty  = abs(net_q)

        # ---- lot sizing; your DB is keyed by Security ID, you look it up by token in the route
        token   = str(pos_row.get("symboltoken") or "")
        min_qty = max(1, int(min_qty_map.get(token, 1)))
        lots    = max(1, qty // min_qty) if min_qty > 0 else qty

        # Use product *name* just like your route (avoids “Invalid Product Type Parameter”)
        product = (pos_row.get("productname") or pos_row.get("producttype") or "CNC")

        order = {
            "clientcode": uid,
            "exchange": pos_row.get("exchange", "NSE"),
            "symboltoken": token,
            "buyorsell": side,
            "ordertype": "MARKET",
            "producttype": product,
            "orderduration": "DAY",
            "price": 0,
            "triggerprice": 0,
            "quantityinlot": int(lots),
            "disclosedquantity": 0,
            "amoorder": "N",
            "algoid": "",
            "goodtilldate": "",
            "tag": "SQUAREOFF",
        }

        # ---- print payload (like DHAN) so you can see exactly what’s sent
        try:
            print(f"[MO][CLOSE] name={name} uid={uid}")
            print("[MO][CLOSE] payload =>")
            print(json.dumps(order, indent=2))
        except Exception:
            pass

        # ---- place order
        try:
            r = sdk.PlaceOrder(order)
            ok_msg = (r or {}).get("message", "")
            ok = (isinstance(r, dict) and (
                    str(r.get("status", "")).upper() == "SUCCESS" or
                    "order placed" in str(ok_msg).lower()
                 ))
            out.append(f"{'✅' if ok else '❌'} {name} - close {symbol}: {ok_msg or r}")
        except Exception as e:
            out.append(f"❌ {name} - close {symbol}: {e}")

    return out





def _get_available_margin(sdk, clientcode: str) -> float:
    """
    Motilal: fetch 'Total Available Margin for Cash' via GetReportMarginSummary.
    Returns 0.0 on any error.
    """
    try:
        resp = sdk.GetReportMarginSummary(clientcode)
        if not (isinstance(resp, dict) and resp.get("status") == "SUCCESS"):
            return 0.0
        rows = resp.get("data", []) or []
        for item in rows:
            if (item.get("particulars") or "").strip().lower() == "total available margin for cash":
                try:
                    return float(item.get("amount", 0) or 0)
                except Exception:
                    return 0.0
    except Exception as e:
        logging.error("❌ GetReportMarginSummary error for %s: %s", clientcode, e)
    return 0.0



def get_holdings() -> Dict[str, Any]:
    """
    Motilal holdings using GetDPHolding + per-scrip GetLtp.
    Returns: {"holdings": [...], "summary": [...]}

    holdings rows:
      {name, symbol, quantity, buy_avg, ltp, pnl}

    summary rows:
      {name, capital, invested, pnl, current_value, available_margin, net_gain}
    """
    holdings_rows: List[Dict[str, Any]] = []
    summaries: List[Dict[str, Any]] = []

    for c in _read_clients():
        userid = str(c.get("userid") or c.get("client_id") or "").strip()
        name   = c.get("name") or c.get("display_name") or userid
        if not userid:
            continue

        # capital from client file (fallback 0.0)
        try:
            capital = float(c.get("capital", 0) or c.get("base_amount", 0) or 0.0)
        except Exception:
            capital = 0.0

        sdk = _ensure_session(c)
        if not sdk:
            logging.error("[MO] No session for %s (%s)", name, userid)
            continue

        # --- 1) HOLDINGS (DP holdings)
        rows: List[Dict[str, Any]] = []
        try:
            # Your working shape prefers plain userid; try that first.
            resp = sdk.GetDPHolding(userid)
            if not (isinstance(resp, dict) and resp.get("status") == "SUCCESS"):
                # fallbacks
                for arg in ({"clientcode": userid}, None):
                    fn = getattr(sdk, "GetDPHolding", None)
                    if callable(fn):
                        try:
                            resp = fn(arg) if arg is not None else fn()
                            if isinstance(resp, dict) and resp.get("status") == "SUCCESS":
                                break
                        except Exception:
                            pass
            if isinstance(resp, dict) and resp.get("status") == "SUCCESS":
                rows = resp.get("data", []) or []
                if not isinstance(rows, list):
                    rows = []
        except Exception as e:
            logging.error("[MO] GetDPHolding error for %s: %s", name, e)
            rows = []

        invested = 0.0
        total_pnl = 0.0

        for h in rows:
            symbol   = (h.get("scripname") or h.get("symbol") or "").strip()
            try:
                qty    = float(h.get("dpquantity", h.get("quantity", 0)) or 0)
                buyavg = float(h.get("buyavgprice", h.get("avgprice", 0)) or 0)
            except Exception:
                qty, buyavg = 0.0, 0.0

            # token for NSE; your working code uses nsesymboltoken
            scripcode = h.get("nsesymboltoken") or h.get("symboltoken") or h.get("token")
            if not scripcode or qty <= 0:
                continue

            # --- 1.a) LTP per scrip (paise -> divide by 100)
            ltp = 0.0
            try:
                ltp_req = {"clientcode": userid, "exchange": "NSE", "scripcode": int(scripcode)}
                ltp_resp = sdk.GetLtp(ltp_req)
                if isinstance(ltp_resp, dict) and ltp_resp.get("status") == "SUCCESS":
                    ltp_val = (ltp_resp.get("data") or {}).get("ltp", 0)
                    ltp = float(ltp_val or 0) / 100.0
            except Exception:
                ltp = 0.0

            pnl = round((ltp - buyavg) * qty, 2)
            invested  += qty * buyavg
            total_pnl += pnl

            holdings_rows.append({
                "name": name,
                "symbol": symbol,
                "quantity": qty,
                "buy_avg": round(buyavg, 2),
                "ltp": round(ltp, 2),
                "pnl": pnl
            })

        current_value = invested + total_pnl

        # --- 2) AVAILABLE MARGIN
        available_margin = 0.0
        try:
            available_margin = _get_available_margin(sdk, userid)
        except Exception as e:
            logging.error("[MO] get available margin error for %s: %s", name, e)

        net_gain = round((current_value + available_margin) - capital, 2)

        summaries.append({
            "name": name,
            "capital": round(capital, 2),
            "invested": round(invested, 2),
            "pnl": round(total_pnl, 2),
            "current_value": round(current_value, 2),
            "available_margin": round(available_margin, 2),
            "net_gain": net_gain
        })

    return {"holdings": holdings_rows, "summary": summaries}

def place_orders(orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    import json, threading
    from typing import Dict, Any, List

    if not isinstance(orders, list) or not orders:
        return {"status": "empty", "order_responses": {}}

    by_id: Dict[str, Dict[str, Any]] = {}
    for c in _read_clients():
        uid = str(c.get("userid") or c.get("client_id") or "").strip()
        if uid:
            by_id[uid] = c

    responses: Dict[str, Any] = {}
    lock = threading.Lock()
    threads: List[threading.Thread] = []

    def _worker(od: Dict[str, Any]):
        uid  = str(od.get("client_id") or "").strip()
        name = od.get("name") or uid
        cj   = by_id.get(uid)
        key  = f"{od.get('tag') or ''}:{uid}"

        if not cj:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Client JSON not found"}
                print(f"[MO] skip name={name} uid={uid} -> Client JSON not found")
            return

        sdk = _ensure_session(cj)
        if not sdk:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Session not found"}
                print(f"[MO] skip name={name} uid={uid} -> Session not found")
            return

        payload = {
            "clientcode": uid,
            "exchange": (od.get("exchange") or "NSE").upper(),
            "symboltoken": int(od.get("security_id") or 0),
            "buyorsell": od.get("action"),
            "ordertype": od.get("ordertype"),
            "producttype": od.get("producttype"),
            "orderduration": od.get("orderduration"),
            "price": float(od.get("price") or 0),
            "triggerprice": float(od.get("triggerprice") or 0),
            "quantityinlot": int(od.get("qty") or 0),
            "disclosedquantity": int(od.get("disclosedquantity") or 0),
            "amoorder": od.get("amoorder", "N"),
            "algoid": "",
            "goodtilldate": "",
            "tag": od.get("tag") or "",
        }

        with lock:
            print(f"[MO] placing name={name} uid={uid}")
            print("[MO] payload =>")
            try:
                print(json.dumps(payload, indent=2))
            except Exception:
                print(payload)

        try:
            resp = sdk.PlaceOrder(payload)
        except Exception as e:
            resp = {"status": "ERROR", "message": str(e)}

        with lock:
            print("[MO] response =>")
            try:
                print(json.dumps(resp, indent=2))
            except Exception:
                print(resp)
            responses[key] = resp

    for od in orders:
        t = threading.Thread(target=_worker, args=(od,))
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    return {"status": "completed", "order_responses": responses}













