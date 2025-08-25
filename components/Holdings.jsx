'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Table } from 'react-bootstrap';
import api from './api';

export default function Holdings() {
  const [rows, setRows] = useState([]);

  const fetchHoldings = async () => {
    const res = await api.get('/get_holdings');
    setRows(res.data?.holdings || []);
  };

  useEffect(()=>{ fetchHoldings().catch(()=>{}); },[]);

  return (
    <Card className="p-3">
      <div className="mb-3"><Button onClick={fetchHoldings}>Refresh Holdings</Button></div>
      <Table bordered hover size="sm">
        <thead><tr><th>Select</th><th>Name</th><th>Symbol</th><th>Quantity</th><th>Buy Avg</th><th>LTP</th><th>PnL</th></tr></thead>
        <tbody>
          {rows.length===0 ? <tr><td colSpan={7} className="text-center">No holdings available</td></tr> :
            rows.map((r, idx)=> (
              <tr key={idx}>
                <td><input type="checkbox"/></td>
                <td>{r.name}</td>
                <td>{r.symbol}</td>
                <td>{r.quantity}</td>
                <td>{r.buy_avg}</td>
                <td>{r.ltp}</td>
                <td style={{color:(parseFloat(r.pnl)||0)<0?'red':'green', fontWeight:'bold'}}>{(parseFloat(r.pnl)||0).toFixed(2)}</td>
              </tr>
            ))
          }
        </tbody>
      </Table>
    </Card>
  );
}
