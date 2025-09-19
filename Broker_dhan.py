# Broker_dhan.py

import os, json, threading
from typing import Dict, Any, List, Optional
import requests

STAT_KEYS = ["pending", "traded", "rejected", "cancelled", "others"]

# use same DATA_DIR as router
BASE_DIR    = os.path.abspath(os.environ.get("DATA_DIR", "./data"))
CLIENTS_DIR = os.path.join(BASE_DIR, "clients", "dhan")


# ---------------------------
# helpers
# ---------------------------
def _read_clients() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    try:
        for fn in os.listdir(CLIENTS_DIR):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(CLIENTS_DIR, fn), "r", encoding="utf-8") as f:
                    items.append(json.load(f))
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return items

def _norm_order_type(s: str) -> str:
    """
    Normalize UI/Router variants to Dhan API enums.
    Dhan accepts: LIMIT, MARKET, STOP_LOSS, STOP_LOSS_MARKET
    """
    key = (s or "").strip().upper().replace("-", "_")
    m = {
        "LIMIT": "LIMIT",
        "LMT": "LIMIT",
        "MARKET": "MARKET",
        "MKT": "MARKET",

        "STOPLOSS": "STOP_LOSS",
        "STOP_LOSS": "STOP_LOSS",
        "STOP_LOSS_LIMIT": "STOP_LOSS",
        "SL": "STOP_LOSS",
        "SL_LIMIT": "STOP_LOSS",

        "SLM": "STOP_LOSS_MARKET",
        "SL_M": "STOP_LOSS_MARKET",
        "SL_MARKET": "STOP_LOSS_MARKET",
        "STOP_LOSS_MARKET": "STOP_LOSS_MARKET",
    }
    return m.get(key, key)

def _needs_price(ot: str) -> bool:
    ot = _norm_order_type(ot)
    # LIMIT and STOP_LOSS (aka SL-limit) need price
    return ot in ("LIMIT", "STOP_LOSS")

def _needs_trigger(ot: str) -> bool:
    ot = _norm_order_type(ot)
    # both SL-limit and SL-market need trigger
    return ot in ("STOP_LOSS", "STOP_LOSS_MARKET")


# ---------------------------
# session / info
# ---------------------------
# ---------------------------
# session / info  (upgraded)
# ---------------------------
from datetime import datetime, timedelta
try:
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")
except Exception:
    _IST = None  # fallback to naive datetimes

def _parse_token_validity(ts: str):
    """
    tokenValidity examples seen from Dhan:
      '19/09/2025 08:53'          (dd/MM/yyyy HH:mm)
      '19/09/2025 08:53:00'
      '19-09-2025 08:53'
    Returns a datetime (IST if tz available) or None.
    """
    if not ts:
        return None
    ts = str(ts).strip()
    fmts = ["%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S", "%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S"]
    for fmt in fmts:
        try:
            dt = datetime.strptime(ts, fmt)
            return dt.replace(tzinfo=_IST) if _IST else dt
        except Exception:
            continue
    return None

def login(client: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns a dict so the caller can persist/show warnings, but remains truthy.
    Shape:
      {
        "ok": bool,
        "token_validity_raw": "...",
        "token_validity_iso": "...",
        "token_days_left": int|None,
        "token_warning": bool,
        "message": "..."   # only when warning
      }
    """
    token = (client.get("apikey") or client.get("access_token") or "").strip()
    if not token:
        return {"ok": False, "message": "Missing access token"}

    name = client.get("name") or client.get("display_name") or ""
    uid  = str(client.get("userid") or client.get("client_id") or "").strip()

    try:
        r = requests.get(
            "https://api.dhan.co/v2/profile",
            headers={"access-token": token},
            timeout=15
        )
        ok = (r.status_code == 200)
        body = {}
        try:
            body = r.json() if r.content else {}
        except Exception:
            body = {}

        # Parse tokenValidity (if present)
        tv_raw = str(body.get("tokenValidity") or body.get("tokenvalidity") or "").strip()
        tv_dt  = _parse_token_validity(tv_raw)
        now    = datetime.now(_IST) if _IST else datetime.now()

        days_left = None
        warn = False
        msg = ""

        if tv_dt:
            seconds_left = (tv_dt - now).total_seconds()
            days_left = max(0, int(seconds_left // 86400))
            warn = seconds_left <= 2 * 86400  # <= 2 days
            if warn:
                msg = (f"⚠️ Dhan token for {name or uid} expires in "
                       f"{days_left} day(s) on {tv_raw}. Please regenerate a new token.")

                # Also log to console for immediate visibility
                try:
                    print(f"[DHAN] {msg}")
                except Exception:
                    pass

        return {
            "ok": ok,
            "token_validity_raw": tv_raw,
            "token_validity_iso": (tv_dt.isoformat() if tv_dt else ""),
            "token_days_left": days_left,
            "token_warning": warn,
            "message": msg
        }

    except Exception as e:
        return {"ok": False, "message": f"Dhan /v2/profile error: {e}"}



def get_orders() -> Dict[str, List[Dict[str, Any]]]:
    buckets: Dict[str, List[Dict[str, Any]]] = {k: [] for k in STAT_KEYS}
    for c in _read_clients():
        token = (c.get("apikey") or c.get("access_token") or "").strip()
        if not token:
            continue
        name = c.get("name") or c.get("display_name") or c.get("userid") or c.get("client_id") or ""
        try:
            resp = requests.get("https://api.dhan.co/v2/orders",
                                headers={"Content-Type": "application/json", "access-token": token},
                                timeout=10)
            orders = resp.json() if resp.status_code == 200 else []
            if not isinstance(orders, list):
                orders = []
        except Exception as e:
            print(f"[DHAN] get_orders error for {name}: {e}")
            orders = []
        for o in orders:
            row = {
                "name": name,
                "symbol": o.get("tradingSymbol", ""),
                "transaction_type": o.get("transactionType", ""),
                "quantity": o.get("quantity", ""),
                "price": o.get("price", ""),
                "status": o.get("orderStatus", ""),
                "order_id": o.get("orderId", ""),
            }
            s = str(row["status"]).lower()
            if "pend" in s:
                buckets["pending"].append(row)
            elif "trade" in s or s == "executed":
                buckets["traded"].append(row)
            elif "reject" in s or "error" in s:
                buckets["rejected"].append(row)
            elif "cancel" in s:
                buckets["cancelled"].append(row)
            else:
                buckets["others"].append(row)
    return buckets


# ---------------------------
# cancel single order (used by router fallback)
# ---------------------------
def cancel_order_dhan(client_json: Dict[str, Any], order_id: str) -> Dict[str, Any]:
    token = (client_json.get("apikey") or client_json.get("access_token") or "").strip()
    if not token:
        return {"status": "error", "message": "Missing access token", "raw": {}}

    try:
        r = requests.delete(
            f"https://api.dhan.co/v2/orders/{order_id}",
            headers={"Content-Type": "application/json", "access-token": token},
            timeout=15,
        )
        try:
            body = r.json() if r.content else {}
        except Exception:
            body = {}

        status_l     = str(body.get("status") or "").strip().lower()
        order_status = str(body.get("orderStatus") or body.get("order_status") or "").strip().upper()
        msg_l        = str(body.get("message") or body.get("errorMessage") or "").strip().lower()

        ok = (
            status_l == "success"
            or order_status.startswith("CANCEL")
            or ("cancel" in msg_l and any(w in msg_l for w in ("sent", "received", "already", "placed")))
            or (r.status_code in (200, 202, 204) and not body)
        )

        if ok:
            return {
                "status": "success",
                "orderId": body.get("orderId") or order_id,
                "orderStatus": order_status or "CANCELLED",
                "raw": body,
            }

        return {
            "status": "error",
            "message": body.get("message") or body.get("errorMessage") or body or r.status_code,
            "raw": body,
        }

    except Exception as e:
        return {"status": "error", "message": str(e), "raw": {}}


# ---------------------------
# positions / square-off
# ---------------------------
def get_positions() -> Dict[str, List[Dict[str, Any]]]:
    positions_data: Dict[str, List[Dict[str, Any]]] = {"open": [], "closed": []}

    for c in _read_clients():
        token = (c.get("apikey") or c.get("access_token") or "").strip()
        if not token:
            continue
        name = c.get("name") or c.get("display_name") or c.get("userid") or c.get("client_id") or ""
        try:
            resp = requests.get(
                "https://api.dhan.co/v2/positions",
                headers={"Content-Type": "application/json", "access-token": token},
                timeout=10
            )
            rows = resp.json() if resp.status_code == 200 else []
            if not isinstance(rows, list):
                rows = []
        except Exception as e:
            print(f"[DHAN] get_positions error for {name}: {e}")
            rows = []

        for pos in rows:
            net_qty   = pos.get("netQty", 0) or 0
            buy_avg   = pos.get("buyAvg", 0) or 0
            sell_avg  = pos.get("sellAvg", 0) or 0
            symbol    = pos.get("tradingSymbol", "") or ""
            realized  = pos.get("realizedProfit", 0) or 0
            unreal    = pos.get("unrealizedProfit", 0) or 0
            net_pnl   = (realized + unreal)

            row = {
                "name": name,
                "symbol": symbol,
                "quantity": net_qty,
                "buy_avg": round(buy_avg, 2),
                "sell_avg": round(sell_avg, 2),
                "net_profit": round(net_pnl, 2),
            }
            if net_qty == 0:
                positions_data["closed"].append(row)
            else:
                positions_data["open"].append(row)

    return positions_data


def close_positions(positions: List[Dict[str, Any]]) -> List[str]:
    by_name = {}
    for c in _read_clients():
        nm = (c.get("name") or c.get("display_name") or "").strip()
        if nm:
            by_name[nm] = c

    messages: List[str] = []

    for req in positions or []:
        name   = (req or {}).get("name") or ""
        symbol = (req or {}).get("symbol") or ""
        cj     = by_name.get(name)
        if not cj:
            messages.append(f"❌ Client not found for: {name}")
            continue

        token  = (cj.get("apikey") or cj.get("access_token") or "").strip()
        client = (cj.get("userid") or cj.get("client_id") or "").strip()
        if not token or not client:
            messages.append(f"❌ Missing token/client for: {name}")
            continue

        # fetch fresh positions
        try:
            p = requests.get(
                "https://api.dhan.co/v2/positions",
                headers={"Content-Type": "application/json", "access-token": token},
                timeout=10
            )
            prow = []
            if p.status_code == 200:
                arr = p.json() if p.content else []
                if isinstance(arr, list):
                    for x in arr:
                        if (x.get("tradingSymbol") or "") == symbol:
                            prow.append(x)
            if not prow:
                messages.append(f"❌ Position not found: {name} - {symbol}")
                continue
            pos = prow[0]
        except Exception as e:
            messages.append(f"❌ Fetch positions failed for {name}: {e}")
            continue

        net_qty = int(pos.get("netQty", 0) or 0)
        if net_qty == 0:
            messages.append(f"ℹ️ Already flat: {name} - {symbol}")
            continue

        side  = "SELL" if net_qty > 0 else "BUY"
        qty   = abs(net_qty)

        payload = {
            "dhanClientId": client,
            "correlationId": f"SQ{int(__import__('time').time())}{client[-4:]}",
            "transactionType": side,
            "exchangeSegment": pos.get("exchangeSegment"),
            "productType": pos.get("productType", "CNC"),
            "orderType": "MARKET",
            "validity": "DAY",
            "securityId": str(pos.get("securityId")),
            "quantity": int(qty),
            "disclosedQuantity": 0,
            "price": 0,
            "triggerPrice": 0,
            "afterMarketOrder": False,
            "amoTime": "OPEN",
            "boProfitValue": 0,
            "boStopLossValue": 0
        }

        try:
            r = requests.post(
                "https://api.dhan.co/v2/orders",
                headers={"Content-Type": "application/json", "access-token": token},
                json=payload,
                timeout=10
            )
            try:
                data = r.json() if r.content else {}
            except Exception:
                data = {}

            order_id     = str(data.get("orderId") or "").strip()
            order_status = str(data.get("orderStatus") or data.get("status") or "").strip().upper()
            err_msg      = str(data.get("message") or data.get("errorMessage") or "").strip()

            ok_http = r.status_code in (200, 202)
            ok_body = (bool(order_id) or order_status in {"SUCCESS", "TRANSIT", "PENDING", "SENT", "RECEIVED", "PLACED", "OPEN"})
            ok = ok_http and ok_body

            if ok:
                shown = {"orderId": order_id} if order_id else {}
                if order_status:
                    shown["orderStatus"] = order_status
                messages.append(f"✅ {name} - close {symbol}: {shown or 'OK'}")
            else:
                detail = err_msg or (data if data else f"HTTP {r.status_code}")
                messages.append(f"❌ {name} - close {symbol}: {detail}")

        except Exception as e:
            messages.append(f"❌ {name} - close {symbol}: {e}")

    return messages


# ---------------------------
# holdings + funds
# ---------------------------
def get_holdings() -> Dict[str, Any]:
    holdings_rows: List[Dict[str, Any]] = []
    summaries: List[Dict[str, Any]] = []

    for c in _read_clients():
        name       = c.get("name") or c.get("display_name") or c.get("userid") or c.get("client_id") or ""
        access_tok = (c.get("apikey") or c.get("access_token") or "").strip()

        try:
            capital = float(c.get("capital", 0) or c.get("base_amount", 0) or 0.0)
        except Exception:
            capital = 0.0

        if not access_tok:
            continue

        # 1) holdings
        try:
            resp = requests.get(
                "https://api.dhan.co/v2/holdings",
                headers={"Content-Type": "application/json", "access-token": access_tok},
                timeout=10
            )
            rows = resp.json() if resp.status_code == 200 else []
            if not isinstance(rows, list):
                rows = []
        except Exception as e:
            print(f"[DHAN] get_holdings error for {name}: {e}")
            rows = []

        invested = 0.0
        total_pnl = 0.0

        for h in rows:
            symbol = (h.get("tradingSymbol") or "").strip()
            try:
                qty    = float(h.get("availableQty", h.get("totalQty", 0)) or 0)
                buyavg = float(h.get("avgCostPrice", 0) or 0)
                ltp    = float(h.get("lastTradedPrice", h.get("LTP", h.get("ltp", h.get("lastprice", 0)))) or 0)
            except Exception:
                qty, buyavg, ltp = 0.0, 0.0, 0.0

            if qty <= 0:
                continue

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

        # 2) funds
        funds = {}
        try:
            f = requests.get(
                "https://api.dhan.co/v2/fundlimit",
                headers={"Content-Type": "application/json", "access-token": access_tok},
                timeout=10
            )
            if f.status_code == 200 and f.content:
                funds = f.json() or {}
        except Exception as e:
            print(f"[DHAN] fundlimit error for {name}: {e}")

        available_balance     = float(funds.get("availabelBalance", funds.get("availableBalance", 0)) or 0)
        withdrawable_balance  = float(funds.get("withdrawableBalance", 0) or 0)
        utilized_amount       = float(funds.get("utilizedAmount", 0) or 0)
        sod_limit             = float(funds.get("sodLimit", 0) or 0)
        collateral_amount     = float(funds.get("collateralAmount", 0) or 0)
        receivable_amount     = float(funds.get("receivableAmount", funds.get("receiveableAmount", 0)) or 0)
        blocked_payout_amount = float(funds.get("blockedPayoutAmount", 0) or 0)

        available_margin = available_balance
        net_gain = round((current_value + available_margin) - capital, 2)

        summaries.append({
            "name": name,
            "capital": round(capital, 2),
            "invested": round(invested, 2),
            "pnl": round(total_pnl, 2),
            "current_value": round(current_value, 2),
            "available_margin": round(available_margin, 2),

            "available_balance": round(available_balance, 2),
            "withdrawable_balance": round(withdrawable_balance, 2),
            "utilized_amount": round(utilized_amount, 2),
            "sod_limit": round(sod_limit, 2),
            "collateral_amount": round(collateral_amount, 2),
            "receivable_amount": round(receivable_amount, 2),
            "blocked_payout_amount": round(blocked_payout_amount, 2),

            "net_gain": net_gain
        })

    return {"holdings": holdings_rows, "summary": summaries}


# ---------------------------
# place orders (fixed)
# ---------------------------
def place_orders(orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Place a batch of orders on Dhan.
    Input  : list of normalized items from the router; each item should include:
             client_id, action, ordertype, producttype, orderduration, exchange,
             qty, price, triggerprice, disclosedquantity, amoorder, correlation_id,
             security_id (Dhan), symboltoken (ignored), tag, symbol (label)
    Output : {"status": "completed", "order_responses": { "<tag:client>": <dhan json> , ...}}
    """
    if not isinstance(orders, list) or not orders:
        return {"status": "empty", "order_responses": {}}

    # Build a quick lookup: dhan userid -> client json
    by_id: Dict[str, Dict[str, Any]] = {}
    for c in _read_clients():
        uid = str(c.get("userid") or c.get("client_id") or "").strip()
        if uid:
            by_id[uid] = c

    # Dhan mappings
    EXCHANGE_MAP = {
        "NSE": "NSE_EQ",
        "BSE": "BSE_EQ",
        "NSEFO": "NSE_FNO",
        "NSE_FO": "NSE_FNO",
        "NSECD": "NSE_CURRENCY",
        "MCX": "MCX_COMM",
        "BSEFO": "BSE_FNO",
        "BSECD": "BSE_CURRENCY",
        "NCDEX": "NCDEX",
    }
    PRODUCT_MAP = {
        "INTRADAY": "INTRADAY",
        "MIS": "INTRADAY",
        "DELIVERY": "CNC",
        "CNC": "CNC",
        "NORMAL": "MARGIN",
        "NRML": "MARGIN",
        "VALUEPLUS": "INTRADAY",
        "MTF": "MTF",
    }

    responses: Dict[str, Any] = {}
    lock = threading.Lock()
    threads: List[threading.Thread] = []

    def _worker(od: Dict[str, Any]) -> None:
        uid  = str(od.get("client_id") or "").strip()
        tag  = od.get("tag") or ""
        key  = f"{tag}:{uid}" if tag else uid
        name = od.get("name") or uid

        cj = by_id.get(uid)
        if not cj:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Client JSON not found"}
            return

        token = (cj.get("apikey") or cj.get("access_token") or "").strip()
        if not token:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Missing access token"}
            return

        # Gather/normalize fields
        exchange   = (od.get("exchange") or "NSE").upper()
        ordertype  = _norm_order_type(od.get("ordertype") or "")
        product_in = (od.get("producttype") or "").upper()
        validity   = (od.get("orderduration") or "DAY").upper()

        security_id = str(od.get("security_id") or "").strip()  # REQUIRED
        qty         = int(od.get("qty") or 0)
        try:
            price = float(od.get("price") or 0)
        except Exception:
            price = 0.0
        try:
            trig = float(od.get("triggerprice") or 0)
        except Exception:
            trig = 0.0
        disc_qty    = int(od.get("disclosedquantity") or 0)
        is_amo      = (od.get("amoorder") or "N") == "Y"
        corr_id     = od.get("correlation_id") or f"ROUTER{uid[-4:].zfill(4)}"

        # Validations to prevent DH-905
        if not security_id:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Missing securityId for Dhan"}
            return
        if _needs_price(ordertype) and price <= 0:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Order requires price > 0"}
            return
        if _needs_trigger(ordertype) and trig <= 0:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Order requires triggerPrice > 0"}
            return

        data: Dict[str, Any] = {
            "dhanClientId": uid,
            "correlationId": corr_id,
            "transactionType": (od.get("action") or "").upper(),
            "exchangeSegment": EXCHANGE_MAP.get(exchange, exchange),
            "productType": PRODUCT_MAP.get(product_in, product_in),
            "orderType": ordertype,                # already normalized
            "validity": validity,
            "securityId": security_id,
            "quantity": qty,
            "disclosedQuantity": disc_qty,         # always numeric
            "price": price if _needs_price(ordertype) else 0,
            "triggerPrice": trig if _needs_trigger(ordertype) else 0,
            "afterMarketOrder": is_amo,
            "amoTime": "OPEN",
            "boProfitValue": 0,
            "boStopLossValue": 0,
        }

        # --- DEBUG: print final payload & response ---
        try:
            safe_token = f"{token[:6]}...{token[-4:]}" if token else ""
            print(f"[DHAN] placing name={name} uid={uid} token={safe_token}")
            print("[DHAN] payload =>")
            print(json.dumps(data, indent=2))
        except Exception:
            pass

        try:
            r = requests.post(
                "https://api.dhan.co/v2/orders",
                headers={"Content-Type": "application/json", "access-token": token},
                json=data,
                timeout=15,
            )
            try:
                resp = r.json()
            except Exception:
                resp = {"_raw": getattr(r, "text", "")}
        except Exception as e:
            r = None
            resp = {"status": "ERROR", "message": str(e)}

        try:
            print(f"[DHAN] http_status={getattr(r, 'status_code', 'NA')}")
            print("[DHAN] response =>")
            print(json.dumps(resp, indent=2))
        except Exception:
            pass

        with lock:
            responses[key] = resp

    for item in orders:
        t = threading.Thread(target=_worker, args=(item,))
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    return {"status": "completed", "order_responses": responses}

from typing import Dict, Any, List
import requests
import json

def _build_dhan_modify_payload(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Build a clean Dhan modify payload:
    - ints/floats stay numeric (no quotes)
    - disclosedQuantity is always 0 (never "")
    - omit fields that are blank/zero so Dhan treats them as unchanged
    """
    def _has_value(x) -> bool:
        if x is None:
            return False
        if isinstance(x, str):
            s = x.strip()
            return s not in ("", "0", "0.0")
        try:
            return float(x) != 0
        except Exception:
            return True

    def _infer_type_local(price, trig) -> str:
        has_p = _has_value(price)
        has_t = _has_value(trig)
        if has_t and has_p:
            return "STOP_LOSS"            # SL-L
        if has_t and not has_p:
            return "STOP_LOSS_MARKET"     # SL-M
        if has_p and not has_t:
            return "LIMIT"
        return "MARKET"

    cj   = (row.get("_client_json") or {})
    price = row.get("price")
    trig  = row.get("triggerPrice") if "triggerPrice" in row else row.get("triggerprice")

    # Normalize orderType (fallback: infer from provided values)
    ot_in  = (row.get("orderType") or "").strip().upper().replace("-", "_")
    ot_map = {
        "LIMIT": "LIMIT",
        "MARKET": "MARKET",
        "STOPLOSS": "STOP_LOSS",
        "STOP_LOSS": "STOP_LOSS",
        "SL": "STOP_LOSS",
        "SL_LIMIT": "STOP_LOSS",
        "SL_MARKET": "STOP_LOSS_MARKET",
        "STOP_LOSS_MARKET": "STOP_LOSS_MARKET",
        "STOPLOSS_MARKET": "STOP_LOSS_MARKET",
        "NO_CHANGE": "",
        "": "",
    }
    order_type = ot_map.get(ot_in, ot_in) or _infer_type_local(price, trig)

    payload: Dict[str, Any] = {
        "dhanClientId": str(cj.get("userid") or cj.get("client_id") or ""),
        "orderId": str(row.get("order_id") or row.get("orderId") or ""),
        "orderType": order_type,
        "validity": str(row.get("validity") or "DAY").upper(),
        "disclosedQuantity": 0,  # numeric 0, never ""
    }

    q = row.get("quantity")
    if _has_value(q):
        try:
            payload["quantity"] = int(float(q))
        except Exception:
            pass

    if _has_value(price):
        try:
            payload["price"] = float(price)
        except Exception:
            pass

    if _has_value(trig):
        try:
            payload["triggerPrice"] = float(trig)
        except Exception:
            pass

    # Only include legName if non-empty
    leg = row.get("legName")
    if isinstance(leg, str) and leg.strip():
        payload["legName"] = leg.strip()

    return payload


def modify_orders(orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Batch modify Dhan orders.

    Each row should contain:
      name, order_id, orderType (or leave blank and provide price/trigger),
      price?, triggerPrice?, quantity?, validity?, disclosedQuantity? (ignored -> always 0),
      _client_json { userid, apikey|access_token }

    Returns: {"message": [ "...", ... ]}
    """
    messages: List[str] = []

    for row in (orders or []):
        try:
            name     = (row.get("name") or "").strip() or "<unknown>"
            order_id = str(row.get("order_id") or row.get("orderId") or "").strip()
            cj       = row.get("_client_json") or {}
            token    = (cj.get("apikey") or cj.get("access_token") or "").strip()
            dhan_id  = str(cj.get("userid") or cj.get("client_id") or "").strip()

            if not order_id or not token or not dhan_id:
                messages.append(f"❌ {name}: missing order_id/client/token")
                continue

            payload = _build_dhan_modify_payload(row)

            # Basic validations for explicit types
            ot = payload.get("orderType")
            if ot == "LIMIT" and "price" not in payload:
                messages.append(f"❌ {name} ({order_id}): LIMIT requires Price > 0")
                continue
            if ot == "STOP_LOSS" and not {"price", "triggerPrice"} <= payload.keys():
                messages.append(f"❌ {name} ({order_id}): STOP_LOSS requires Price & Trigger > 0")
                continue
            if ot == "STOP_LOSS_MARKET" and "triggerPrice" not in payload:
                messages.append(f"❌ {name} ({order_id}): SL-MARKET requires Trigger > 0")
                continue
            if payload.get("quantity", 1) <= 0:
                payload.pop("quantity", None)  # don't send zero/negative qty

            url = f"https://api.dhan.co/v2/orders/{order_id}"
            headers = {"Content-Type": "application/json", "access-token": token}

            # --- DEBUG OUT ---
            try:
                safe_token = f"{token[:6]}...{token[-4:]}"
                print("---- Dhan ModifyOrder (OUT) ----")
                print(json.dumps({
                    "url": url,
                    "headers": {"access-token": safe_token},
                    "payload": payload
                }, indent=2))
            except Exception:
                pass

            r = requests.put(url, headers=headers, json=payload, timeout=20)
            try:
                body = r.json() if r.content else {}
            except Exception:
                body = {"raw": getattr(r, "text", "")}

            # --- DEBUG RESP ---
            try:
                print("---- Dhan ModifyOrder (RESP) ----")
                print(json.dumps({"status_code": r.status_code, "response": body}, indent=2))
            except Exception:
                pass

            # Success heuristic: 2xx and no errorType
            ok = (200 <= r.status_code < 300) and not (isinstance(body, dict) and body.get("errorType"))
            if ok:
                messages.append(f"✅ {name} ({order_id}): Modified")
            else:
                err = ""
                if isinstance(body, dict):
                    err = body.get("errorMessage") or body.get("message") or body.get("status") or ""
                messages.append(f"❌ {name} ({order_id}): {err or ('HTTP ' + str(r.status_code))}")

        except Exception as e:
            messages.append(f"❌ {row.get('name','<unknown>')} ({row.get('order_id','?')}): {e}")

    return {"message": messages}




























