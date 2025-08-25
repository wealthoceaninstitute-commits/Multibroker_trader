// CopyTrading.jsx — Create + Edit + Delete + Enable/Disable
'use client';

import { useEffect, useState } from 'react';
import { Card, Button, Table, Modal, Form, Badge } from 'react-bootstrap';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:5001';

export default function CopyTrading() {
  const [clients, setClients] = useState([]);
  const [setups, setSetups] = useState([]);
  const [selectedId, setSelectedId] = useState('');

  // modal state
  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState(null); // null=create, string=edit
  const [form, setForm] = useState({
    name: '',
    master: '',              // userid
    rows: {},                // key -> { selected: bool, mult: '1' }
  });

  // ---- load data ----
  const loadClients = async () => {
    try {
      const r = await fetch(`${API_BASE}/clients`, { cache: 'no-store' });
      const j = await r.json();
      setClients(Array.isArray(j) ? j : (j.clients || []));
    } catch {}
  };
  const loadSetups = async () => {
    try {
      const r = await fetch(`${API_BASE}/list_copytrading_setups`, { cache: 'no-store' });
      const j = await r.json();
      setSetups(j.setups || []);
    } catch {}
  };
  useEffect(() => { loadClients(); loadSetups(); }, []);

  const keyOf = (c) => `${(c.broker || '').toLowerCase()}::${c.userid || c.client_id || ''}`;

  // ---- toolbar actions ----
  const openCreate = () => {
    const rows = {};
    clients.forEach(c => { rows[keyOf(c)] = { selected: false, mult: '1' }; });
    setForm({ name: '', master: '', rows });
    setEditingId(null);
    setShow(true);
  };

  const openEdit = () => {
    if (!selectedId) return;
    const s = setups.find(x => (x.id || x.name) === selectedId);
    if (!s) return;

    // seed rows for all clients
    const rows = {};
    clients.forEach(c => { rows[keyOf(c)] = { selected: false, mult: '1' }; });

    // preselect children + multipliers
    const children = s.children || [];
    const mm = s.multipliers || {};
    clients.forEach(c => {
      const uid = c.userid || c.client_id || '';
      if (children.includes(uid)) {
        const k = keyOf(c);
        rows[k] = { selected: true, mult: String(mm[uid] ?? 1) };
      }
    });

    setForm({
      name: s.name || s.id || '',
      master: s.master || '',
      rows
    });
    setEditingId(s.id || s.name);
    setShow(true);
  };

  const onDelete = async () => {
    if (!selectedId) return;
    if (!confirm('Delete this setup?')) return;
    try {
      let r = await fetch(`${API_BASE}/delete_copy_setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [selectedId] })
      });
      if (r.status === 404) {
        // compatibility fallback
        r = await fetch(`${API_BASE}/delete_copytrading_setup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [selectedId] })
        });
      }
    } catch {}
    await loadSetups();
    setSelectedId('');
  };

  const enableCopy = async (value) => {
    if (!selectedId) return;
    try {
      const ep = value ? 'enable_copy' : 'disable_copy';
      await fetch(`${API_BASE}/${ep}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [selectedId] })
      });
    } catch {}
    await loadSetups();
  };

  // ---- submit create/edit ----
  const onSubmitSetup = async (e) => {
    e.preventDefault();
    const name = (form.name || '').trim();
    const master = (form.master || '').trim();
    if (!name || !master) { alert('Enter Setup Name and select a Master.'); return; }

    const children = [];
    const multipliers = {};
    Object.entries(form.rows || {}).forEach(([k, v]) => {
      if (!v?.selected) return;
      const id = k.split('::')[1];
      if (!id || id === master) return;
      children.push(id);
      const m = parseFloat(v.mult);
      multipliers[id] = !isFinite(m) || m <= 0 ? 1 : m;
    });
    if (!children.length) { alert('Pick at least one child account.'); return; }

    const body = {
      // dual keys for backend compatibility
      id: editingId || undefined,
      name, setup_name: name,
      master, master_account: master,
      children, child_accounts: children,
      multipliers,
      enabled: editingId ? undefined : false
    };

    try {
      const r = await fetch(`${API_BASE}/save_copytrading_setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!r.ok) {
        const t = await r.text().catch(()=>'');
        alert(`Error saving setup: ${r.status} ${t}`);
        return;
      }
      setShow(false);
      setEditingId(null);
      await loadSetups();
    } catch {
      alert('Network error while saving setup.');
    }
  };

  const statusBadge = (s) => (
    <Badge bg={s ? 'success' : 'secondary'}>{s ? 'Enabled' : 'Disabled'}</Badge>
  );

  // ---- render ----
  return (
    <Card className="p-3">
      <h5 className="mb-3">Copy Trading Management</h5>

      <div className="d-flex align-items-center mb-3" style={{ gap: 10 }}>
        <Button variant="success" onClick={openCreate}>Create Setup</Button>
        <Button variant="secondary" disabled={!selectedId} onClick={openEdit}>Edit Setup</Button>
        <Button variant="danger" disabled={!selectedId} onClick={onDelete}>Delete Setup</Button>
        <Button variant="primary"  disabled={!selectedId} onClick={() => enableCopy(true)}>Enable Copy</Button>
        <Button variant="warning"  disabled={!selectedId} onClick={() => enableCopy(false)}>Disable Copy</Button>
      </div>

      <Table bordered hover responsive size="sm">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Select</th>
            <th>Setup Name</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {setups.length === 0 ? (
            <tr><td colSpan={3} className="text-muted">No setups yet.</td></tr>
          ) : setups.map(s => (
            <tr key={s.id || s.name}>
              <td>
                <Form.Check
                  type="radio"
                  name="setupPick"
                  checked={selectedId === (s.id || s.name)}
                  onChange={() => setSelectedId(s.id || s.name)}
                />
              </td>
              <td>{s.name || s.id}</td>
              <td>{statusBadge(!!s.enabled)}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      {/* CREATE / EDIT modal (table like Group: Add | Client | Broker | Multiplier) */}
      <Modal show={show} onHide={() => { setShow(false); setEditingId(null); }} size="lg">
        <Form onSubmit={onSubmitSetup}>
          <Modal.Header closeButton>
            <Modal.Title>{editingId ? 'Edit Copy Trading Setup' : 'Create Copy Trading Setup'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3" style={{ maxWidth: 420 }}>
              <Form.Label>Setup Name *</Form.Label>
              <Form.Control
                value={form.name}
                required
                onChange={(e)=>setForm(p=>({...p, name: e.target.value}))}
              />
            </Form.Group>

            <Form.Group className="mb-3" style={{ maxWidth: 420 }}>
              <Form.Label>Select Master Account *</Form.Label>
              <Form.Select
                value={form.master}
                required
                onChange={(e)=>{
                  const master = e.target.value;
                  setForm(p=>{
                    const rows = { ...(p.rows || {}) };
                    Object.keys(rows).forEach(k=>{
                      const id = k.split('::')[1];
                      if (id === master) rows[k].selected = false;
                    });
                    return { ...p, master, rows };
                  });
                }}
              >
                <option value="">-- Select Master --</option>
                {clients.map(c=>{
                  const id = c.userid || c.client_id || '';
                  const label = `${c.name || c.display_name || id} : ${id}`;
                  return <option key={`m-${id}`} value={id}>{label}</option>;
                })}
              </Form.Select>
            </Form.Group>

            <div className="mb-2 fw-semibold">Select Child Accounts & Multipliers</div>
            <Table bordered hover responsive size="sm">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Add</th>
                  <th>Client</th>
                  <th>Broker</th>
                  <th style={{ width: 180 }}>Multiplier</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr><td colSpan={4} className="text-muted">No clients.</td></tr>
                ) : clients.map(c=>{
                  const k = keyOf(c);
                  const id = c.userid || c.client_id || '';
                  const isMaster = form.master && id === form.master;
                  const row = form.rows[k] || { selected:false, mult:'1' };
                  const label = `${c.name || c.display_name || id} : ${id}`;
                  return (
                    <tr key={`row-${k}`}>
                      <td>
                        <Form.Check
                          type="checkbox"
                          disabled={isMaster}
                          checked={!isMaster && !!row.selected}
                          onChange={(e)=>{
                            const v = e.target.checked;
                            setForm(p=>{
                              const rows = { ...(p.rows || {}) };
                              rows[k] = { ...(rows[k] || { mult:'1' }), selected: v };
                              return { ...p, rows };
                            });
                          }}
                        />
                      </td>
                      <td>{label}</td>
                      <td className="text-capitalize">{(c.broker||'').toLowerCase()}</td>
                      <td>
                        <Form.Control
                          type="number"
                          min="0.01" step="0.01"
                          disabled={isMaster || !row.selected}
                          value={row.mult ?? '1'}
                          onChange={(e)=>{
                            const val = e.target.value;
                            setForm(p=>{
                              const rows = { ...(p.rows || {}) };
                              rows[k] = { ...(rows[k] || { selected:false }), mult: val };
                              return { ...p, rows };
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Master cannot be a child. Each child has its own multiplier.
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={()=>{ setShow(false); setEditingId(null); }}>Cancel</Button>
            <Button type="submit" variant="success">{editingId ? 'Save Changes' : 'Save Setup'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Card>
  );
}
