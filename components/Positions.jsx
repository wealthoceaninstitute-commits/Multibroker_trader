'use client';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, Table, Tabs, Tab, Badge } from 'react-bootstrap';
import api from './api';

const AUTO_REFRESH_MS = 3000;

export default function Positions() {
  const [openRows, setOpenRows] = useState([]);
  const [closedRows, setClosedRows] = useState([]);
  const [selected, setSelected] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);

  const busyRef = useRef(false);
  const snapRef = useRef('');
  const timerRef = useRef(null);
  const abortRef = useRef(null);

  const fetchAll = async () => {
    if (busyRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await api.get('/get_positions', { signal: controller.signal });
      const nextOpen = res.data?.open || [];
      const nextClosed = res.data?.closed || [];
      const snap = JSON.stringify({ nextOpen, nextClosed });
      if (snap !== snapRef.current) {
        snapRef.current = snap;
        setOpenRows(nextOpen);
        setClosedRows(nextClosed);
        setLastUpdated(new Date());
      }
    } catch (e) {
      if (e.name !== 'CanceledError' && e.code !== 'ERR_CANCELED') {
        console.warn('positions refresh failed', e?.message || e);
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

  const toggle = (rowId) => setSelected(prev => ({...prev, [rowId]: !prev[rowId]}));

  const closeSelected = async () => {
    const rows = document.querySelectorAll('#open_positions_table tbody tr');
    const toClose = [];
    rows.forEach(tr => {
      const rowId = tr.getAttribute('data-rowid');
      if (selected[rowId]) {
        const tds = tr.querySelectorAll('td');
        const qty = parseInt(tds[3]?.textContent.trim(), 10);
        toClose.push({
          name: tds[1]?.textContent.trim(),
          symbol: tds[2]?.textContent.trim(),
          quantity: Math.abs(qty || 0),
          transaction_type: (qty || 0) > 0 ? 'SELL' : 'BUY'
        });
      }
    });
    if (toClose.length === 0) return alert('No positions selected.');
    try {
      busyRef.current = true; // pause polling
      const res = await api.post('/close_position', { positions: toClose });
      alert(Array.isArray(res.data?.message) ? res.data.message.join('\n') : 'Close request sent');
      setSelected({});
      await fetchAll();
    } catch (e) {
      alert('Close failed: ' + (e.response?.data || e.message));
    } finally {
      busyRef.current = false;
    }
  };

  const renderTable = (rows, id) => (
    <Table bordered hover size="sm" id={id}>
      <thead>
        <tr><th>Select</th><th>Name</th><th>Symbol</th><th>Quantity</th><th>Buy Avg</th><th>Sell Avg</th><th>Net Profit</th></tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={7} className="text-center">No data</td></tr>
        ) : rows.map((row, idx) => {
          const rowId = `${row.name}-${row.symbol}-${row.net_profit ?? idx}`;
          return (
            <tr key={rowId} data-rowid={rowId}>
              <td><input type="checkbox" checked={!!selected[rowId]} onChange={()=>toggle(rowId)} /></td>
              <td>{row.name ?? 'N/A'}</td>
              <td>{row.symbol ?? 'N/A'}</td>
              <td>{row.quantity ?? 'N/A'}</td>
              <td>{row.buy_avg ?? 'N/A'}</td>
              <td>{row.sell_avg ?? 'N/A'}</td>
              <td style={{ color: (parseFloat(row.net_profit)||0) < 0 ? 'red' : 'green', fontWeight:'bold' }}>
                {row.net_profit ?? 'N/A'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );

  return (
    <Card className="p-3">
      <div className="mb-3 d-flex gap-2 align-items-center">
        <Button onClick={()=>fetchAll()}>Refresh Positions</Button>
        <Button variant="danger" onClick={closeSelected}>Close Position</Button>
        <Badge bg="secondary" className="ms-auto">
          Auto-refresh: 3s {lastUpdated ? `· Updated ${lastUpdated.toLocaleTimeString()}` : ''}
        </Badge>
      </div>
      <Tabs defaultActiveKey="open" className="mb-3">
        <Tab eventKey="open" title="Open">{renderTable(openRows, 'open_positions_table')}</Tab>
        <Tab eventKey="closed" title="Closed">{renderTable(closedRows, 'closed_positions_table')}</Tab>
      </Tabs>
    </Card>
  );
}
