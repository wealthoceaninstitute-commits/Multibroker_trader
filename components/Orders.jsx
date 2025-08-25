'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Table, Tabs, Tab, Badge } from 'react-bootstrap';
import api from './api';

const AUTO_REFRESH_MS = 3000; // adjust if you want (e.g., 5000)

export default function Orders() {
  const [orders, setOrders] = useState({ pending: [], traded: [], rejected: [], cancelled: [], others: [] });
  const [selectedIds, setSelectedIds] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  const busyRef = useRef(false);      // pause polling while canceling
  const snapRef = useRef('');         // last snapshot for change detection
  const timerRef = useRef(null);
  const abortRef = useRef(null);      // cancel in-flight refresh

  const fetchAll = async () => {
    if (busyRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    // cancel previous in-flight request
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
      // ignore cancellations; log real errors
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
        <Button variant="danger" onClick={cancelSelected}>Cancel Order</Button>
        <Badge bg="secondary" className="ms-auto">
          Auto-refresh: 3s {lastUpdated ? `· Updated ${lastUpdated.toLocaleTimeString()}` : ''}
        </Badge>
      </div>
      <Tabs defaultActiveKey="pending" className="mb-3">
        <Tab eventKey="pending" title="Pending">{renderTable(orders.pending, 'pending_table')}</Tab>
        <Tab eventKey="traded" title="Traded">{renderTable(orders.traded, 'traded_table')}</Tab>
        <Tab eventKey="rejected" title="Rejected">{renderTable(orders.rejected, 'rejected_table')}</Tab>
        <Tab eventKey="cancelled" title="Cancelled">{renderTable(orders.cancelled, 'cancelled_table')}</Tab>
        <Tab eventKey="others" title="Others">{renderTable(orders.others, 'others_table')}</Tab>
      </Tabs>
    </Card>
  );
}
