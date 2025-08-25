import os, json
from typing import Dict, Any, List
import requests
import threading

STAT_KEYS = ["pending", "traded", "rejected", "cancelled", "others"]

# use same DATA_DIR as router
BASE_DIR = os.path.abspath(os.environ.get("DATA_DIR", "./data"))
CLIENTS_DIR = os.path.join(BASE_DIR, "clients", "dhan")

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

def login(client: Dict[str, Any]) -> bool:
    token = (client.get("apikey") or client.get("access_token") or "").strip()
    if not token:
        return False
    try:
        r = requests.get("https://api.dhan.co/v2/profile",
                         headers={"access-token": token}, timeout=15)
        print("[DHAN] /v2/profile ->", r.status_code)
        return r.status_code == 200
    except Exception as e:
        print("[DHAN] login error:", e)
        return False

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

# Broker_dhan.py
import requests
from typing import Any, Dict

def cancel_order_dhan(client_json: Dict[str, Any], order_id: str) -> Dict[str, Any]:
    """
    Normalize Dhan cancel response so the router can keep using:
        resp.get("status").lower() == "success"
    Returns:
      {"status":"success", "orderId":..., "orderStatus":..., "raw": {...}}
      or
      {"status":"error", "message":..., "raw": {...}}
    """
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

        # --- Normalize success ---
        status_l     = str(body.get("status") or "").strip().lower()
        order_status = str(body.get("orderStatus") or body.get("order_status") or "").strip().upper()
        msg_l        = str(body.get("message") or body.get("errorMessage") or "").strip().lower()

        ok = (
            status_l == "success"                         # explicit success
            or order_status.startswith("CANCEL")          # "CANCELLED", "CANCEL REQUEST SENT/RECEIVED", etc.
            or ("cancel" in msg_l and any(w in msg_l for w in ("sent", "received", "already", "placed")))
            or (r.status_code in (200, 202, 204) and not body)  # some variants return 2xx with empty body
        )

        if ok:
            return {
                "status": "success",
                "orderId": body.get("orderId") or order_id,
                "orderStatus": order_status or "CANCELLED",
                "raw": body,
            }

        # Not OK -> bubble up broker message
        return {
            "status": "error",
            "message": body.get("message") or body.get("errorMessage") or body or r.status_code,
            "raw": body,
        }

    except Exception as e:
        return {"status": "error", "message": str(e), "raw": {}}




def get_positions() -> Dict[str, List[Dict[str, Any]]]:
    """Return Dhan positions normalized into {open:[...], closed:[...]}"""
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
    """
    Close (square-off) positions for given [{name, symbol}] by placing
    opposite MARKET orders using live position info.
    """
    # map: name -> client json
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

        token   = (cj.get("apikey") or cj.get("access_token") or "").strip()
        client  = (cj.get("userid") or cj.get("client_id") or "").strip()
        if not token or not client:
            messages.append(f"❌ Missing token/client for: {name}")
            continue

        # fetch fresh positions to get netQty + securityId/etc
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
            "price": "",
            "triggerPrice": "",
            "afterMarketOrder": False,
            "amoTime": "OPEN",
            "boProfitValue": "",
            "boStopLossValue": ""
        }

        try:
            r = requests.post(
                "https://api.dhan.co/v2/orders",
                headers={"Content-Type": "application/json", "access-token": token},
                json=payload, timeout=10
            )
            data = r.json() if r.content else {}
            ok = str(data.get("status","")).lower() == "success"
            messages.append(f"{'✅' if ok else '❌'} {name} - close {symbol}: {data or r.status_code}")
        except Exception as e:
            messages.append(f"❌ {name} - close {symbol}: {e}")

    return messages

def get_holdings() -> Dict[str, Any]:
    """
    Dhan holdings using LTP present in /v2/holdings and cash from /v2/fundlimit.
    Returns: {"holdings": [...], "summary": [...]}

    holdings rows:
      {name, symbol, quantity, buy_avg, ltp, pnl}

    summary rows (per client):
      {
        name, capital, invested, pnl, current_value,
        available_margin, net_gain,
        available_balance, withdrawable_balance,
        utilized_amount, sod_limit, collateral_amount,
        receivable_amount, blocked_payout_amount
      }
    """
    holdings_rows: List[Dict[str, Any]] = []
    summaries: List[Dict[str, Any]] = []

    for c in _read_clients():
        name       = c.get("name") or c.get("display_name") or c.get("userid") or c.get("client_id") or ""
        access_tok = (c.get("apikey") or c.get("access_token") or "").strip()

        # capital from client file (fallback 0.0)
        try:
            capital = float(c.get("capital", 0) or c.get("base_amount", 0) or 0.0)
        except Exception:
            capital = 0.0

        if not access_tok:
            continue

        # --- 1) HOLDINGS (ltp is already included) ---
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
                # LTP key variants seen in raw payload
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

        # --- 2) FUNDS (/v2/fundlimit) ---
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

        # Dhan responses sometimes have a typo "availabelBalance"; handle both.
        available_balance     = float(funds.get("availabelBalance", funds.get("availableBalance", 0)) or 0)
        withdrawable_balance  = float(funds.get("withdrawableBalance", 0) or 0)
        utilized_amount       = float(funds.get("utilizedAmount", 0) or 0)
        sod_limit             = float(funds.get("sodLimit", 0) or 0)
        collateral_amount     = float(funds.get("collateralAmount", 0) or 0)
        receivable_amount     = float(funds.get("receivableAmount", funds.get("receiveableAmount", 0)) or 0)
        blocked_payout_amount = float(funds.get("blockedPayoutAmount", 0) or 0)

        # For backward compatibility with your UI field name
        available_margin = available_balance

        net_gain = round((current_value + available_margin) - capital, 2)

        summaries.append({
            "name": name,
            "capital": round(capital, 2),
            "invested": round(invested, 2),
            "pnl": round(total_pnl, 2),
            "current_value": round(current_value, 2),

            # existing field used by your UI
            "available_margin": round(available_margin, 2),

            # additional fund fields for completeness
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

def place_orders(orders: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Place a batch of orders on Dhan.
    Input  : list of normalized items from the router; each item should include:
             client_id, action, ordertype, producttype, orderduration, exchange,
             qty, price, triggerprice, disclosedquantity, amoorder, correlation_id,
             security_id (Dhan), symboltoken (optional, ignored), tag, symbol (label)
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
        "VALUEPLUS": "INTRADAY",  # <-- important for your UI
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
        ordertype  = (od.get("ordertype") or "").upper()
        product_in = (od.get("producttype") or "").upper()
        validity   = (od.get("orderduration") or "DAY").upper()

        security_id = str(od.get("security_id") or "").strip()  # MUST be present for Dhan
        qty         = int(od.get("qty") or 0)
        price       = float(od.get("price") or 0)
        trig        = float(od.get("triggerprice") or 0)
        disc_qty    = int(od.get("disclosedquantity") or 0)
        is_amo      = (od.get("amoorder") or "N") == "Y"
        corr_id     = od.get("correlation_id") or f"ROUTER{uid[-4:].zfill(4)}"

        # Basic validations to avoid DH-905
        if not security_id:
            with lock:
                responses[key] = {"status": "ERROR", "message": "Missing securityId for Dhan"}
            return
        if ordertype == "LIMIT" and price <= 0:
            with lock:
                responses[key] = {"status": "ERROR", "message": "LIMIT order requires price > 0"}
            return
        if ("SL" in ordertype) and trig <= 0:
            with lock:
                responses[key] = {"status": "ERROR", "message": "SL/SL-M order requires triggerPrice > 0"}
            return

        data = {
            "dhanClientId": uid,
            "correlationId": corr_id,
            "transactionType": (od.get("action") or "").upper(),
            "exchangeSegment": EXCHANGE_MAP.get(exchange, exchange),
            "productType": PRODUCT_MAP.get(product_in, product_in),
            "orderType": ordertype,
            "validity": validity,
            "securityId": security_id,
            "quantity": qty,
            "disclosedQuantity": disc_qty if disc_qty else "",
            "price": price if ordertype == "LIMIT" else "",
            "triggerPrice": trig if ("SL" in ordertype) else "",
            "afterMarketOrder": is_amo,
            "amoTime": "OPEN",
            "boProfitValue": "",
            "boStopLossValue": "",
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
