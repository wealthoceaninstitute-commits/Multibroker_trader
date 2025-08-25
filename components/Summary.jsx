'use client';
import { useEffect, useState } from 'react';
import { Button, Card, Table } from 'react-bootstrap';
import api from './api';

export default function Summary() {
  const [rows, setRows] = useState([]);

  const fetchSummary = async () => {
    const res = await api.get('/get_summary');
    setRows(res.data?.summary || []);
  };

  useEffect(()=>{ fetchSummary().catch(()=>{}); },[]);

  return (
    <Card className="p-3">
      <div className="mb-3"><Button onClick={fetchSummary}>Refresh Summary</Button></div>
      <Table bordered hover size="sm">
        <thead><tr><th>Name</th><th>Capital</th><th>Invested</th><th>PnL</th><th>Current Value</th><th>Available Margin</th><th>Net Gain</th></tr></thead>
        <tbody>
          {rows.length===0 ? <tr><td colSpan={7} className="text-center">No summary data available</td></tr> :
            rows.map((r, idx)=> (
              <tr key={idx}>
                <td>{r.name}</td>
                <td>{Number(r.capital||0).toFixed(2)}</td>
                <td>{Number(r.invested||0).toFixed(2)}</td>
                <td>{Number(r.pnl||0).toFixed(2)}</td>
                <td>{Number(r.current_value||0).toFixed(2)}</td>
                <td>{Number(r.available_margin||0).toFixed(2)}</td>
                <td style={{color:(Number(r.net_gain)||0)<0?'red':'green', fontWeight:'bold'}}>{Number(r.net_gain||0).toFixed(2)}</td>
              </tr>
            ))
          }
        </tbody>
      </Table>
    </Card>
  );
}
