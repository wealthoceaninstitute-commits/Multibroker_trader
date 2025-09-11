'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Table, Tabs, Tab, Badge, Modal, Form } from 'react-bootstrap';
import api from './api';

const AUTO_REFRESH_MS = 3000; // adjust if you want (e.g., 5000)

export default function Orders() {
  const [orders, setOrders] = useState({ pending: [], traded: [], rejected: [], cancelled: [], others: [] });
  const [selectedIds, setSelectedIds] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  // modify modal state (no Price field)
  const [showModify, setShowModify] = useState(false);
  const [modifyTarget, setModifyTarget] = useState(null); // {name, symbol, order_id}
  const [modQty, setModQty] = useState('');
  const [modTrig, setModTrig] = useState('');
  const [modType, setModType] = useState('NO_CHANGE'); // LIMIT / MARKET / STOP_LOSS / STOP_LOSS_MARKET / NO_CHANGE
  const [modLTP, setModLTP] = useState('—');           // read-only display
  const [modSaving, setModSaving] = useState(false);

  const busyRef = useRef(false);      // pause polling while canceling/modifying
  const snapRef = useRef('');         // last snapshot for change detection
  const timerRef = useRef(null);
  const abortRef = useRef(null);      // cancel in-flight refresh

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
    fetchAll().catch(()=>{});
    timerRef.current = setInterval(() => { fetchAll().catch(()=>{}); }, AUTO_REFRESH_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const toggle = (rowId) => setSelectedIds(prev => ({...prev, [rowId]: !prev[rowId]}));

  // -------- Cancel --------
  const cancelSelected = async () => {
    const rows = document.querySelectorAll('#pending_table tbody tr');
    const selectedOrders = [];
    rows.forEach(tr => {
      const rowId = tr.getAttribute('data-rowid');
      if (selectedIds[rowId]) {
        const tds = tr.querySelectorAll('td');
        selectedOrders.push({
          name: tds[1]?.textContent.trim(),
          symbol: tds[2]?.textContent.trim(),
          order_id: tds[7]?.textContent.trim(),
        });
      }
    });
    if (selectedOrders.length === 0) return alert('No orders selected.');

    try {
      busyRef.current = true; // pause polling
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

  // -------- Modify (single pending order) --------
  // optional LTP fetcher (safe no-op if API not present)
  const tryFetchLTP = async (symbol) => {
    try {
      // if you add an endpoint later, match it here; otherwise we keep '—'
      const r = await api.get('/ltp', { params: { symbol } });
      const v = Number(r?.data?.ltp);
      if (!Number.isNaN(v)) setModLTP(v.toFixed(2));
    } catch { /* ignore */ }
  };

  const openModify = () => {
    const rows = document.querySelectorAll('#pending_table tbody tr');
    const chosen = [];
    rows.forEach(tr => {
      const rowId = tr.getAttribute('data-rowid');
      if (selectedIds[rowId]) {
        const tds = tr.querySelectorAll('td');
        chosen.push({
          name: tds[1]?.textContent.trim(),
          symbol: tds[2]?.textContent.trim(),
          order_id: tds[7]?.textContent.trim(),
        });
      }
    });

    if (chosen.length === 0) return alert('Select one pending order to modify.');
    if (chosen.length > 1) return alert('Please select only one order to modify.');

    const row = chosen[0];
    setModifyTarget({ name: row.name, symbol: row.symbol, order_id: row.order_id });
    setModQty('');
    setModTrig('');
    setModType('NO_CHANGE');
    setModLTP('—');
    setShowModify(true);
    // non-blocking best-effort LTP
    if (row.symbol) tryFetchLTP(row.symbol);
  };

  const submitModify = async () => {
    if (!modifyTarget) return;

    // Build payload with only provided fields (no price)
    const payload = { ...modifyTarget };
    if (modQty !== '') {
      const q = parseInt(modQty, 10);
      if (Number.isNaN(q) || q <= 0) return alert('Quantity must be a positive integer.');
      payload.quantity = q;
    }
    if (modTrig !== '') {
      const t = parseFloat(modTrig);
      if (Number.isNaN(t) || t <= 0) return alert('Trigger price must be a positive number.');
      payload.triggerprice = t;
    }
    if (modType && modType !== 'NO_CHANGE') {
      payload.ordertype = modType; // LIMIT / MARKET / STOP_LOSS / STOP_LOSS_MARKET
    }

    if (!('quantity' in payload) && !('triggerprice' in payload) && !('ordertype' in payload)) {
      return alert('Nothing to update. Change Qty / Trigger Price / Order Type.');
    }

    try {
      busyRef.current = true;
      setModSaving(true);
      const res = await api.post('/modify_order', { order: payload });
      const msg = res.data?.message || 'Modify request sent';
      alert(Array.isArray(msg) ? msg.join('\n') : msg);
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

  const renderModifyModal = () => (
    <Modal show={showModify} onHide={() => setShowModify(false)} backdrop="static" centered>
      <Modal.Header closeButton>
        <Modal.Title>Modify Order</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {modifyTarget && (
          <>
            <div className="mb-3 small">
              <div><strong>Symbol:</strong> {modifyTarget.symbol}</div>
              <div><strong>Order ID:</strong> {modifyTarget.order_id}</div>
            </div>

            {/* LTP (display only) */}
            <div className="mb-2">
              <div className="text-uppercase text-muted" style={{fontSize:'0.75rem'}}>LTP</div>
              <div style={{fontWeight:700, fontSize:'1.1rem'}}>{modLTP}</div>
            </div>

            <Form
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitModify();
                }
              }}
            >
              {/* Quantity */}
              <Form.Group className="mb-3">
                <Form.Label>Quantity</Form.Label>
                <Form.Control
                  type="number"
                  min="1"
                  step="1"
                  value={modQty}
                  onChange={(e) => setModQty(e.target.value)}
                  placeholder="Leave blank to keep same"
                />
              </Form.Group>

              {/* Trigger Price */}
              <Form.Group className="mb-3">
                <Form.Label>Trig. Price</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  step="0.05"
                  value={modTrig}
                  onChange={(e) => setModTrig(e.target.value)}
                  placeholder="Leave blank to keep same"
                />
              </Form.Group>

              {/* Order Type */}
              <Form.Group className="mb-1">
                <Form.Label>Order Type</Form.Label>
                <Form.Select value={modType} onChange={(e)=>setModType(e.target.value)}>
                  <option value="NO_CHANGE">NO_CHANGE</option>
                  <option value="LIMIT">LIMIT</option>
                  <option value="MARKET">MARKET</option>
                  <option value="STOP_LOSS">STOP_LOSS (SL-L)</option>
                  <option value="STOP_LOSS_MARKET">STOP_LOSS_MARKET (SL-M)</option>
                </Form.Select>
                <div className="form-text">
                  Keep default values & change only what you need. Press <kbd>Enter</kbd> to submit.
                </div>
              </Form.Group>
            </Form>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={() => setShowModify(false)} disabled={modSaving}>Cancel</Button>
        <Button variant="warning" onClick={submitModify} disabled={modSaving}>
          {modSaving ? 'Updating…' : 'Modify'}
        </Button>
      </Modal.Footer>
    </Modal>
  );

  const renderTable = (rows, id) => (
    <Table bordered hover size="sm" id={id}>
      <thead>
        <tr><th>Select</th><th>Name</th><th>Symbol</th><th>Type</th><th>Qty</th><th>Price</th><th>Status</th><th>Order ID</th></tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={8} className="text-center">No data</td></tr>
        ) : rows.map((row, idx) => {
          const rowId = `${row.name}-${row.symbol}-${row.order_id || row.status || idx}`;
          return (
            <tr key={rowId} data-rowid={rowId}>
              <td><input type="checkbox" checked={!!selectedIds[rowId]} onChange={()=>toggle(rowId)} /></td>
              <td>{row.name ?? 'N/A'}</td>
              <td>{row.symbol ?? 'N/A'}</td>
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
    <Card className="p-3">
      <div className="mb-3 d-flex gap-2 align-items-center">
        <Button onClick={()=>fetchAll()}>Refresh Orders</Button>
        <Button variant="warning" onClick={openModify}>Modify Order</Button>
        <Button variant="danger" onClick={cancelSelected}>Cancel Order</Button>
        <Badge bg="secondary" className="ms-auto">
          Auto-refresh: {Math.round(AUTO_REFRESH_MS/1000)}s {lastUpdated ? `· Updated ${lastUpdated.toLocaleTimeString()}` : ''}
        </Badge>
      </div>

      <Tabs defaultActiveKey="pending" className="mb-3">
        <Tab eventKey="pending" title="Pending">{renderTable(orders.pending, 'pending_table')}</Tab>
        <Tab eventKey="traded" title="Traded">{renderTable(orders.traded, 'traded_table')}</Tab>
        <Tab eventKey="rejected" title="Rejected">{renderTable(orders.rejected, 'rejected_table')}</Tab>
        <Tab eventKey="cancelled" title="Cancelled">{renderTable(orders.cancelled, 'cancelled_table')}</Tab>
        <Tab eventKey="others" title="Others">{renderTable(orders.others, 'others_table')}</Tab>
      </Tabs>

      {renderModifyModal()}
    </Card>
  );
}
