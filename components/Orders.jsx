
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Table, Tabs, Tab, Badge, Modal, Form, Spinner, InputGroup } from 'react-bootstrap';
import api from './api';

/* == tiny inline icons (no extra deps) == */
const SearchIcon = (props) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);
const XCircle = (props) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const AUTO_REFRESH_MS = 3000;

/* display -> canonical order type */
const DISPLAY_TO_CANON = {
  NO_CHANGE: 'NO_CHANGE',
  LIMIT: 'LIMIT',
  MARKET: 'MARKET',
  STOPLOSS: 'STOPLOSS',
  'SL MARKET': 'STOPLOSS_MARKET',
};

/* ---------- Broker-agnostic symbol parsing ---------- */
const MONTH_MAP = {
  JAN:'JAN', FEB:'FEB', MAR:'MAR', APR:'APR', MAY:'MAY', JUN:'JUN',
  JUL:'JUL', AUG:'AUG', SEP:'SEP', SEPT:'SEP', OCT:'OCT', NOV:'NOV', DEC:'DEC'
};
const sanitize = (s) => String(s || '')
  .toUpperCase()
  .replace(/[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
  .replace(/[–—−]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();
const isMonthHead = (t) => /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)/.test(t);
const isYear = (t) => /^\d{4}$/.test(t);
const isDay = (t) => /^\d{1,2}$/.test(t);
const isTailFlag = (t) => /^(FUT|OPT|CE|PE)$/.test(t);

function parseSymbol(raw) {
  const u = sanitize(raw);
  const tokens = u.split(/[\s\-_/]+/).filter(Boolean);

  const undParts = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (isTailFlag(t) || isYear(t) || isMonthHead(t)) {
      if (undParts.length && isDay(undParts[undParts.length - 1])) undParts.pop();
      break;
    }
    undParts.push(t);
  }
  const und = undParts.join('').replace(/[^A-Z0-9]/g, '');

  let mon=null, year=null, m;
  m = u.match(/\b(\d{1,2})[-\s]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*[-\s]*((?:19|20)\d{2})\b/);
  if (m) { mon = MONTH_MAP[m[2]]; year = m[3]; }
  if (!mon) {
    m = u.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[A-Z]*[-\s]*((?:19|20)\d{2})\b/);
    if (m) { mon = MONTH_MAP[m[1]]; year = m[2]; }
  }

  const kind = /\b(CE|PE)\b/.test(u) ? 'OPT' : 'FUT';
  return { und, mon, year, kind };
}
function canonicalKey(raw, { includeKind = false } = {}) {
  const { und, mon, year, kind } = parseSymbol(raw);
  const base = (und && mon && year) ? `${und}-${mon}${year}` : sanitize(raw).replace(/[^A-Z0-9]/g, '');
  return includeKind ? `${base}-${kind}` : base;
}
/* ---------------------------------------------------- */

export default function Orders() {
  const [orders, setOrders] = useState({ pending: [], traded: [], rejected: [], cancelled: [], others: [] });
  const [selectedIds, setSelectedIds] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  // search state
  const [query, setQuery] = useState('');
  const qTokens = useMemo(() => query.trim().split(/\s+/).filter(Boolean), [query]);

  // modify modal
  const [showModify, setShowModify] = useState(false);
  const [modifyTarget, setModifyTarget] = useState(null); // {symbol, key, orders:[...]}
  const [modQty, setModQty] = useState('');
  const [modPrice, setModPrice] = useState('');
  const [modTrig, setModTrig] = useState('');
  const [modType, setModType] = useState('NO_CHANGE');
  const [modLTP, setModLTP] = useState('—');
  const [modSaving, setModSaving] = useState(false);

  const busyRef = useRef(false);
  const snapRef = useRef('');
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  // dedicated modal container (prevents portal issues)
  const modalContainerRef = useRef(null);
  useEffect(() => {
    if (typeof document !== 'undefined') {
      const el = document.createElement('div');
      el.id = 'orders-modal-root';
      document.body.appendChild(el);
      modalContainerRef.current = el;
      return () => { try { document.body.removeChild(el); } catch {} };
    }
  }, []);

  /* ===== fetch ===== */
  const fetchAll = async () => {
    if (busyRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await api.get('/get_orders', { signal: controller.signal });
      const next = {
        pending: res.data?.pending || [],
        traded: res.data?.traded || [],
        rejected: res.data?.rejected || [],
        cancelled: res.data?.cancelled || [],
        others: res.data?.others || [],
      };
      const snap = JSON.stringify(next);
      if (snap !== snapRef.current) {
        snapRef.current = snap;
        setOrders(next);
        setLastUpdated(new Date());
      }
    } catch (e) {
      if (e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
        console.warn('orders refresh failed', e?.message || e);
      }
    } finally {
      abortRef.current = null;
    }
  };

  useEffect(() => {
    fetchAll().catch(() => {});
    timerRef.current = setInterval(() => { fetchAll().catch(() => {}); }, AUTO_REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  /* ========= helpers ========= */
  const rowKey = (row) =>
    String(row.order_id ?? `${row.name ?? ''}|${row.symbol ?? ''}|${row.status ?? ''}`);

  const toggle = (rowId) =>
    setSelectedIds((prev) => ({ ...prev, [rowId]: !prev[rowId] }));

  // always read from full pending list (not filtered / not DOM)
  const getSelectedPending = () => {
    const picked = [];
    orders.pending.forEach((row) => {
      const id = rowKey(row);
      if (selectedIds[id]) {
        picked.push({
          name: row.name ?? '',
          symbol: row.symbol ?? '',
          price: row.price ?? '',
          order_id: row.order_id ?? '',
          status: row.status ?? '',
          // capture broker/client if present in your payload
          broker: row.broker ?? row.broker_name ?? row.vendor ?? row.gateway ?? null,
          client_id: row.client_id ?? row.clientId ?? row.client ?? null,
        });
      }
    });
    return picked;
  };

  /* ----- Cancel ----- */
  const cancelSelected = async () => {
    const selectedOrders = getSelectedPending().map((o) => ({
      name: o.name, symbol: o.symbol, order_id: o.order_id,
      ...(o.client_id ? { client_id: o.client_id } : {}),
      ...(o.broker ? { broker: o.broker } : {}),
    }));
    if (selectedOrders.length === 0) return alert('No orders selected.');

    try {
      busyRef.current = true;
      const res = await api.post('/cancel_order', { orders: selectedOrders });
      alert(Array.isArray(res.data?.message) ? res.data.message.join('\n') : 'Cancel request sent');
      setSelectedIds({});
      await fetchAll();
    } catch (e) {
      alert('Cancel failed: ' + (e.response?.data || e.message));
    } finally {
      busyRef.current = false;
    }
  };

  /* ----- Modify ----- */
  const requires = (displayType) => {
    const canon = DISPLAY_TO_CANON[displayType] || displayType;
    return { price: ['LIMIT', 'STOPLOSS'].includes(canon), trig: ['STOPLOSS', 'STOPLOSS_MARKET'].includes(canon), canon };
  };

  const tryFetchLTP = async (symbol) => {
    try {
      const r = await api.get('/ltp', { params: { symbol } });
      const v = Number(r?.data?.ltp);
      if (!Number.isNaN(v)) setModLTP(v.toFixed(2));
    } catch { /* ignore 404 etc. */ }
  };

  const openModify = () => {
    const chosen = getSelectedPending();
    if (chosen.length === 0) { alert('Select at least one order in Pending to modify.'); return; }

    const key0 = canonicalKey(chosen[0].symbol, { includeKind: false });
    const allSame = chosen.every((c) => canonicalKey(c.symbol, { includeKind: false }) === key0);

    if (!allSame) {
      const diag = chosen.map((c) => `${c.symbol} → ${canonicalKey(c.symbol, { includeKind:false })}`).join('\n');
      alert('Please select orders with the SAME Symbol to batch modify.\n\n' + diag);
      return;
    }

    const single = chosen.length === 1;
    setModifyTarget({ symbol: chosen[0].symbol, key: key0, orders: chosen });
    setModPrice(single ? (Number.isFinite(parseFloat(chosen[0].price)) ? String(parseFloat(chosen[0].price)) : '') : '');
    setModTrig('');
    setModQty('');
    setModType('NO_CHANGE');
    setModLTP('—');
    setShowModify(true);
    if (chosen[0].symbol) tryFetchLTP(chosen[0].symbol);
  };

  const submitModify = async () => {
    if (!modifyTarget) return;
    const need = requires(modType);

    let qtyNum, priceNum, trigNum;
    if (modQty !== '') {
      qtyNum = parseInt(modQty, 10);
      if (Number.isNaN(qtyNum) || qtyNum <= 0) return alert('Quantity must be a positive integer.');
    }
    if (modPrice !== '') {
      priceNum = parseFloat(modPrice);
      if (Number.isNaN(priceNum) || priceNum <= 0) return alert('Price must be a positive number.');
    }
    if (modTrig !== '') {
      trigNum = parseFloat(modTrig);
      if (Number.isNaN(trigNum) || trigNum <= 0) return alert('Trigger price must be a positive number.');
    }
    if (modType !== 'NO_CHANGE') {
      if (need.price && !(modPrice !== '' && priceNum > 0)) return alert('Selected Order Type requires Price.');
      if (need.trig && !(modTrig !== '' && trigNum > 0)) return alert('Selected Order Type requires Trigger Price.');
    }
    if (modType === 'NO_CHANGE' && modQty === '' && modPrice === '' && modTrig === '') {
      return alert('Nothing to update. Change Qty / Price / Trigger Price / Order Type.');
    }

    setModSaving(true);
    busyRef.current = true;

    try {
      // one POST per order, explicitly tagged with broker & client_id when available
      const requests = modifyTarget.orders.map((o) => {
        const payload = {
          name: o.name,
          symbol: o.symbol,
          order_id: o.order_id,
          ...(o.client_id ? { client_id: o.client_id } : {}),
          ...(o.broker ? { broker: o.broker } : {}),
        };
        if (modType !== 'NO_CHANGE') payload.ordertype = need.canon;
        if (modQty !== '') payload.quantity = qtyNum;
        if (modPrice !== '') payload.price = priceNum;
        if (modTrig !== '') payload.triggerprice = trigNum;

        return api.post('/modify_order', { order: payload });
      });

      const results = await Promise.allSettled(requests);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const fail = results.length - ok;

      let msg = `Modified ${ok} of ${results.length} order(s)`;
      const failMsgs = results
        .map((r) => (r.status === 'rejected' ? (r.reason?.response?.data || r.reason?.message) : null))
        .filter(Boolean)
        .slice(0, 5);
      if (fail > 0 && failMsgs.length) msg += `\nFailed: ${fail}\n- ${failMsgs.join('\n- ')}`;
      alert(msg);

      setShowModify(false);
      setSelectedIds({});
      await fetchAll();
    } catch (e) {
      alert('Modify failed: ' + (e.response?.data || e.message));
    } finally {
      setModSaving(false);
      busyRef.current = false;
    }
  };

  /* ------- search + highlight ------- */
  const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const highlightSymbol = (sym) => {
    const text = sym ?? 'N/A';
    if (!text || qTokens.length === 0) return text;
    try {
      const re = new RegExp(`(${qTokens.map(escapeReg).join('|')})`, 'gi');
      const parts = String(text).split(re);
      return parts.map((p, i) =>
        re.test(p) ? <mark key={i} className="hl">{p}</mark> : <span key={i}>{p}</span>
      );
    } catch {
      return text;
    }
  };

  const filterBySymbol = (rows) => {
    if (qTokens.length === 0) return rows;
    return rows.filter((r) => {
      const sym = String(r.symbol || '').toUpperCase();
      return qTokens.every((t) => sym.includes(t.toUpperCase()));
    });
  };

  const filtered = useMemo(() => ({
    pending: filterBySymbol(orders.pending),
    traded: filterBySymbol(orders.traded),
    rejected: filterBySymbol(orders.rejected),
    cancelled: filterBySymbol(orders.cancelled),
    others: filterBySymbol(orders.others),
  }), [orders, qTokens]);

  /* --------------------------------------------------- */

  const renderModifyModal = () => {
    if (!modifyTarget) return null;
    const need = requires(modType);
    const isBatch = modifyTarget.orders?.length > 1;

    return (
      <Modal
        container={modalContainerRef.current || undefined}
        show={showModify}
        onHide={() => setShowModify(false)}
        backdrop="static"
        centered
        contentClassName="blueTone modalCardPad"
      >
        <Modal.Header closeButton>
          <Modal.Title>{isBatch ? 'Modify Orders (Batch)' : 'Modify Order'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="small mb-2">
            <div><strong>Symbol:</strong> {modifyTarget.symbol}</div>
            <div>
              {isBatch
                ? <span><strong>Selected:</strong> {modifyTarget.orders.length} pending orders</span>
                : <span><strong>Order ID:</strong> {modifyTarget.orders[0]?.order_id}</span>}
            </div>
          </div>

          {/* LTP display */}
          <div className="mb-2">
            <div className="text-uppercase text-muted" style={{ fontSize: '0.75rem' }}>LTP</div>
            <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{modLTP}</div>
          </div>

          <Form onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitModify(); } }}>
            <Form.Group className="mb-2">
              <Form.Label className="label-tight">Quantity</Form.Label>
              <Form.Control
                type="number" min="1" step="1"
                value={modQty} onChange={(e) => setModQty(e.target.value)}
                placeholder={isBatch ? 'Leave blank to keep same (ALL)' : 'Leave blank to keep same'}
              />
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label className="label-tight">
                Price {modType !== 'NO_CHANGE' && need.price ? <span className="text-danger">*</span> : null}
              </Form.Label>
              <Form.Control
                type="number" min="0" step="0.05"
                value={modPrice} onChange={(e) => setModPrice(e.target.value)}
                placeholder={need.price ? 'Required for selected type' : (isBatch ? 'Leave blank to keep same (ALL)' : 'Leave blank to keep same')}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label className="label-tight">
                Trig. Price {modType !== 'NO_CHANGE' && need.trig ? <span className="text-danger">*</span> : null}
              </Form.Label>
              <Form.Control
                type="number" min="0" step="0.05"
                value={modTrig} onChange={(e) => setModTrig(e.target.value)}
                placeholder={need.trig ? 'Required for selected type' : (isBatch ? 'Leave blank to keep same (ALL)' : 'Leave blank to keep same')}
              />
            </Form.Group>

            <Form.Group className="mb-1">
              <Form.Label className="mb-1 fw-semibold">Order Type</Form.Label>
              <div className="d-flex align-items-center flex-wrap gap-3">
                {['NO_CHANGE', 'LIMIT', 'MARKET', 'STOPLOSS', 'SL MARKET'].map((ot) => (
                  <Form.Check
                    key={ot} inline type="radio" name="modifyOrderType"
                    label={ot.replace('SL MARKET', 'SL_MARKET')}
                    checked={modType === ot} onChange={() => setModType(ot)}
                  />
                ))}
              </div>
              <div className="form-text">
                LIMIT → needs <strong>Price</strong>. SL-L → needs <strong>Price</strong> &amp; <strong>Trig</strong>. SL-M → needs <strong>Trig</strong>.
                {isBatch && <> Changes will apply to <strong>all selected orders</strong>.</>}
              </div>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer className="footerNudge">
          <Button variant="secondary" onClick={() => setShowModify(false)} disabled={modSaving}>Cancel</Button>
          <Button variant="warning" onClick={submitModify} disabled={modSaving}>
            {modSaving ? <Spinner size="sm" animation="border" className="me-2" /> : null}
            Modify
          </Button>
        </Modal.Footer>

        <style jsx global>{`
          .modalCardPad { padding: 0.5rem 1.25rem 0.75rem; }
          @media (min-width: 992px) { .modalCardPad { padding: 0.75rem 1.5rem 1rem; } }
          .blueTone { background: linear-gradient(180deg, #f9fbff 0%, #f3f7ff 100%) !important;
            border: 1px solid #d5e6ff !important; box-shadow: 0 0 0 6px rgba(49,132,253,.12) !important; border-radius: 10px !important; }
          .label-tight { margin-bottom: 4px; }
          .footerNudge { padding-right: 1.25rem; }
          input[type="radio"], input[type="checkbox"] { accent-color: #0d6efd; }
        `}</style>
      </Modal>
    );
  };

  const renderTable = (rows, id) => (
    <Table bordered hover size="sm" id={id}>
      <thead>
        <tr>
          <th>Select</th><th>Name</th><th>Symbol</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th>Order ID</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={8} className="text-center">No data</td></tr>
        ) : rows.map((row) => {
          const idKey = rowKey(row);
          return (
            <tr key={idKey} data-rowid={idKey}>
              <td><input type="checkbox" checked={!!selectedIds[idKey]} onChange={() => toggle(idKey)} /></td>
              <td>{row.name ?? 'N/A'}</td>
              <td>{highlightSymbol(row.symbol)}</td>
              <td>{row.transaction_type ?? 'N/A'}</td>
              <td>{row.quantity ?? 'N/A'}</td>
              <td>{row.price ?? 'N/A'}</td>
              <td>{row.status ?? 'N/A'}</td>
              <td>{row.order_id ?? 'N/A'}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );

  return (
    <Card className="p-3 softCard">
      {/* Toolbar */}
      <div className="mb-3 d-flex gap-2 align-items-center flex-wrap">
        <Button onClick={() => fetchAll()}>Refresh Orders</Button>
        <Button variant="warning" onClick={openModify}>Modify Order</Button>
        <Button variant="danger" onClick={cancelSelected}>Cancel Order</Button>

        {/* quick sanity: selection count */}
        <Badge bg="info" className="ms-1">{Object.values(selectedIds).filter(Boolean).length} selected</Badge>

        {/* Search by Symbol */}
        <div className="ms-auto">
          <InputGroup className="searchGroup">
            <InputGroup.Text title="Search by Symbol"><SearchIcon /></InputGroup.Text>
            <Form.Control
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setQuery(''); }}
              placeholder="Search symbol (e.g., RELIANCE)"
              aria-label="Search by symbol"
            />
            {query ? (
              <Button variant="outline-secondary" onClick={() => setQuery('')} title="Clear"><XCircle /></Button>
            ) : null}
          </InputGroup>
        </div>

        <Badge bg="secondary" className="ms-2">
          Auto-refresh: {Math.round(AUTO_REFRESH_MS / 1000)}s {lastUpdated ? `· Updated ${lastUpdated.toLocaleTimeString()}` : ''}
        </Badge>
      </div>

      <Tabs defaultActiveKey="pending" className="mb-3">
        <Tab eventKey="pending" title="Pending">{renderTable(filtered.pending, 'pending_table')}</Tab>
        <Tab eventKey="traded" title="Traded">{renderTable(filtered.traded, 'traded_table')}</Tab>
        <Tab eventKey="rejected" title="Rejected">{renderTable(filtered.rejected, 'rejected_table')}</Tab>
        <Tab eventKey="cancelled" title="Cancelled">{renderTable(filtered.cancelled, 'cancelled_table')}</Tab>
        <Tab eventKey="others" title="Others">{renderTable(filtered.others, 'others_table')}</Tab>
      </Tabs>

      {/* styles */}
      <style jsx global>{`
        .softCard { border: 1px solid #e6efff; box-shadow: 0 2px 12px rgba(13,110,253,.06); border-radius: 12px; }
        .searchGroup { min-width: 280px; max-width: 360px; }
        .searchGroup .input-group-text { background: #eaf3ff; border-color: #cfe2ff; }
        .searchGroup .form-control { border-color: #cfe2ff; }
        .searchGroup .btn { border-color: #cfe2ff; }
        mark.hl { background: #fff3cd; padding: 0 2px; border-radius: 2px; }
      `}</style>

      {renderModifyModal()}
    </Card>
  );
}
