'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Card, Button, Modal, Form, Table, Badge, ButtonGroup } from 'react-bootstrap';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:5001';

// ----- helpers (frontend-only fallbacks) -----
const LS_KEY_GROUPS = 'mb_groups_v2_groupMultiplier';
const readLS = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export default function Clients() {
  // ===== Clients state =====
  const [clients, setClients] = useState([]);
  const [selectedClients, setSelectedClients] = useState(new Set());
  const [subtab, setSubtab] = useState('clients');

  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [broker, setBroker] = useState('dhan');
  const [addForm, setAddForm] = useState({
    name: '', userid: '', password: '', pan: '',
    apikey: '', totpkey: '', access_token: '', capital: '',
  });
  const [editingKey, setEditingKey] = useState({ broker: null, userid: null });

  // Tracks clients currently logging in (for instant UI feedback)
  const [loggingNow, setLoggingNow] = useState(new Set());
  const pollingAbortRef = useRef(false);

  // ===== Groups =====
  const [groups, setGroups] = useState([]); // [{id, name, multiplier, members:[{broker,userid}]}]
  const [selectedGroups, setSelectedGroups] = useState(new Set());

  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editGroupMode, setEditGroupMode] = useState(false);
  const [groupForm, setGroupForm] = useState({
    id: null,
    name: '',
    multiplier: '1',
    members: {}, // clientKey -> true
  });

  // ===== Copy Trading (table UI like Group) =====
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [copyForm, setCopyForm] = useState({
    name: '',
    master: '',                // userid
    rows: {},                  // clientKey -> {selected: bool, mult: '1'}
  });

  // ===== Loaders =====
  async function loadClients() {
    try {
      const r = await fetch(`${API_BASE}/clients`, { cache: 'no-store' });
      const j = await r.json();
      setClients(Array.isArray(j) ? j : (j.clients || []));
    } catch {
      setClients([]);
    }
  }
  async function loadGroups() {
    try {
      const r = await fetch(`${API_BASE}/groups`, { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        const arr = Array.isArray(j) ? j : (j.groups || []);
        setGroups(arr);
        writeLS(LS_KEY_GROUPS, arr);
        return;
      }
      throw new Error('groups api not ready');
    } catch {
      setGroups(readLS(LS_KEY_GROUPS, []));
    }
  }
  useEffect(() => { loadClients(); loadGroups(); }, []);

  // ===== Keys & selections =====
  const keyOf = (c) => `${(c.broker || '').toLowerCase()}::${c.userid || c.client_id || ''}`;
  const allClientKeys = useMemo(() => clients.map(keyOf), [clients]);

  const toggleAllClients = (checked) => setSelectedClients(checked ? new Set(allClientKeys) : new Set());
  const toggleOneClient = (k, checked) =>
    setSelectedClients(prev => { const s = new Set(prev); checked ? s.add(k) : s.delete(k); return s; });

  const groupKey = (g) => g.id || g.name;
  const allGroupKeys = useMemo(() => groups.map(groupKey), [groups]);
  const toggleAllGroups = (checked) => setSelectedGroups(checked ? new Set(allGroupKeys) : new Set());
  const toggleOneGroup = (k, checked) =>
    setSelectedGroups(prev => { const s = new Set(prev); checked ? s.add(k) : s.delete(k); return s; });

  // ===== UI bits =====
  const statusBadge = (c) => {
    const k = keyOf(c);
    if (loggingNow.has(k)) return <Badge bg="warning">logging_in…</Badge>;
    const s = c.session_active === true ? 'logged_in'
      : c.session_active === false ? 'logged_out'
      : (c.status || 'pending');
    const variant = s === 'logged_in' ? 'success'
      : s === 'logged_out' ? 'secondary'
      : s === 'failed' ? 'danger' : 'warning';
    return <Badge bg={variant}>{s}</Badge>;
  };

  // ===== Client CRUD =====
  const openAdd = () => {
    setEditMode(false);
    setBroker('dhan');
    setAddForm({ name:'', userid:'', password:'', pan:'', apikey:'', totpkey:'', access_token:'', capital:'' });
    setEditingKey({ broker:null, userid:null });
    setShowModal(true);
  };

  const openEdit = () => {
    if (selectedClients.size !== 1) return;
    const k = Array.from(selectedClients)[0];
    const row = clients.find(c => keyOf(c) === k);
    if (!row) return;

    setEditMode(true);
    const b = (row.broker || '').toLowerCase();
    setBroker(b);
    setAddForm({
      name: row.name || row.display_name || '',
      userid: row.userid || row.client_id || '',
      password: row.password || '',
      pan: row.pan || '',
      apikey: row.apikey || row.access_token || '',
      access_token: row.apikey || row.access_token || '',
      totpkey: row.totpkey || '',
      capital: row.capital?.toString?.() || '',
    });
    setEditingKey({ broker: b, userid: row.userid || row.client_id || '' });
    setShowModal(true);
  };

  const onDelete = async () => {
    if (!selectedClients.size) return;
    if (!confirm(`Delete ${selectedClients.size} selected client(s)?`)) return;

    const items = Array.from(selectedClients).map(k => {
      const row = clients.find(c => keyOf(c) === k);
      return { broker: (row?.broker || '').toLowerCase(), userid: row?.userid || row?.client_id || '' };
    }).filter(Boolean);

    try {
      await fetch(`${API_BASE}/delete_client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      await loadClients();
    } catch {}
    setSelectedClients(new Set());
  };

  // Poll /clients until given userid is logged in
  async function pollUntilLoggedIn(broker, userid, { intervalMs = 1000, maxTries = 15 } = {}) {
    const targetKey = `${broker}::${userid}`;
    setLoggingNow(prev => new Set(prev).add(targetKey));
    pollingAbortRef.current = false;

    let tries = 0;
    while (!pollingAbortRef.current && tries < maxTries) {
      try {
        const r = await fetch(`${API_BASE}/clients`, { cache: 'no-store' });
        const j = await r.json();
        const list = Array.isArray(j) ? j : (j.clients || []);
        const hit = list.find(c =>
          (c.broker || '').toLowerCase() === broker &&
          (c.userid || c.client_id || '') === userid
        );
        if (hit) {
          setClients(list);
          if (hit.session_active === true) break;
        }
      } catch {}
      tries += 1;
      await new Promise(res => setTimeout(res, intervalMs));
    }

    setLoggingNow(prev => { const n = new Set(prev); n.delete(targetKey); return n; });
  }

  const onSubmit = async (e) => {
    e.preventDefault();

    if (broker === 'dhan' && !(addForm.access_token || addForm.apikey)) {
      alert('Access Token is required for Dhan.');
      return;
    }

    const capitalNum = addForm.capital === '' ? undefined : Number(addForm.capital) || 0;

    const creds =
      broker === 'dhan'
        ? { access_token: addForm.access_token || addForm.apikey }
        : { password: addForm.password || undefined, pan: addForm.pan || undefined, apikey: addForm.apikey || undefined, totpkey: addForm.totpkey || undefined };

    const bodyBase = {
      broker,
      name: addForm.name || undefined,
      userid: addForm.userid,
      capital: capitalNum,
      creds,
    };

    if (broker === 'dhan') {
      bodyBase.apikey = addForm.access_token || addForm.apikey;
      bodyBase.access_token = addForm.access_token || addForm.apikey;
    } else {
      bodyBase.password = addForm.password || undefined;
      bodyBase.pan = addForm.pan || undefined;
      bodyBase.apikey = addForm.apikey || undefined;
      bodyBase.totpkey = addForm.totpkey || undefined;
    }

    if (editMode && editingKey.userid) {
      bodyBase._original = { broker: editingKey.broker, userid: editingKey.userid };
      bodyBase.original_broker = editingKey.broker;
      bodyBase.original_userid = editingKey.userid;
    }

    const endpoint = editMode ? 'edit_client' : 'add_client';

    try {
      const r = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyBase),
      });

      setShowModal(false);
      setSelectedClients(new Set());
      await loadClients();

      const b = (editMode ? editingKey.broker : broker) || broker;
      const id = (editMode ? editingKey.userid : addForm.userid);
      if (b && id) pollUntilLoggedIn(b, id, { intervalMs: 1000, maxTries: 15 });

      if (!r.ok) {
        try { console.warn(`/${endpoint} failed`, await r.text()); } catch {}
      }
    } catch {
      setShowModal(false);
    }
  };

  // ===== Group helpers =====
  const membersArrayFromForm = () => {
    const arr = [];
    for (const k of Object.keys(groupForm.members || {})) {
      if (!groupForm.members[k]) continue;
      const [b, id] = k.split('::');
      if (!b || !id) continue;
      arr.push({ broker: b, userid: id });
    }
    return arr;
  };

  const prefillGroupForm = (g) => {
    const map = {};
    (g.members || []).forEach(m => {
      const k = `${(m.broker||'').toLowerCase()}::${m.userid||m.client_id||''}`;
      map[k] = true;
    });
    setGroupForm({
      id: g.id ?? null,
      name: g.name || '',
      multiplier: (g.multiplier?.toString?.() || '1'),
      members: map
    });
  };

  // ===== Group CRUD =====
  const openCreateGroup = () => {
    setEditGroupMode(false);
    setGroupForm({ id: null, name: '', multiplier: '1', members: {} });
    setShowGroupModal(true);
  };

  const openEditGroup = () => {
    if (selectedGroups.size !== 1) return;
    const k = Array.from(selectedGroups)[0];
    const g = groups.find(x => groupKey(x) === k);
    if (!g) return;
    setEditGroupMode(true);
    prefillGroupForm(g);
    setShowGroupModal(true);
  };

  async function saveGroupsLocally(next) {
    setGroups(next);
    writeLS(LS_KEY_GROUPS, next);
  }

  const onDeleteGroup = async () => {
    if (!selectedGroups.size) return;
    if (!confirm(`Delete ${selectedGroups.size} selected group(s)?`)) return;
    const ids = Array.from(selectedGroups);
    let deletedOK = false;
    try {
      const r = await fetch(`${API_BASE}/delete_group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, names: ids })
      });
      if (r.ok) deletedOK = true;
    } catch {}
    if (!deletedOK) {
      const next = groups.filter(g => !ids.includes(groupKey(g)));
      await saveGroupsLocally(next);
    } else {
      await loadGroups();
    }
    setSelectedGroups(new Set());
  };

  const onSubmitGroup = async (e) => {
    e.preventDefault();

    const members = membersArrayFromForm();
    const multiplierNum = groupForm.multiplier === '' ? 1 : Number(groupForm.multiplier);
    if (!groupForm.name?.trim() || members.length === 0 || !isFinite(multiplierNum) || multiplierNum <= 0) {
      alert('Please enter a group name, select at least one client, and set a positive multiplier.');
      return;
    }

    const payload = {
      id: groupForm.id || undefined,
      name: groupForm.name.trim(),
      multiplier: multiplierNum,
      members
    };

    const endpoint = editGroupMode ? 'edit_group' : 'add_group';
    let ok = false;
    try {
      const r = await fetch(`${API_BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      ok = r.ok;
    } catch {}

    if (!ok) {
      if (editGroupMode) {
        const k = payload.id ?? groupForm.name;
        const next = groups.map(g => (groupKey(g) === k ? {
          id: g.id ?? k, name: payload.name, multiplier: payload.multiplier, members: payload.members
        } : g));
        await saveGroupsLocally(next);
      } else {
        const tempId = `g_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
        const newG = { id: tempId, name: payload.name, multiplier: payload.multiplier, members: payload.members };
        await saveGroupsLocally([newG, ...groups]);
      }
    } else {
      await loadGroups();
    }

    setShowGroupModal(false);
    setEditGroupMode(false);
  };

  // ===== Copy Trading helpers (TABLE UI like Group) =====
  const openCopyModal = () => {
    const rows = {};
    clients.forEach(c => { rows[keyOf(c)] = { selected: false, mult: '1' }; });
    setCopyForm({ name: '', master: '', rows });
    setShowCopyModal(true);
  };

  const onSubmitCopy = async (e) => {
    e.preventDefault();

    const name = (copyForm.name || '').trim();
    const master = (copyForm.master || '').trim();
    if (!name || !master) {
      alert('Please enter a setup name and select a Master account.');
      return;
    }

    // Build children + multipliers from selected rows (excluding master)
    const children = [];
    const multipliers = {};
    for (const [k, v] of Object.entries(copyForm.rows || {})) {
      if (!v?.selected) continue;
      const [, id] = k.split('::');
      if (!id || id === master) continue;
      children.push(id);
      const m = parseFloat(v.mult);
      multipliers[id] = !isFinite(m) || m <= 0 ? 1 : m;
    }
    if (children.length === 0) {
      alert('Please choose at least one Child account.');
      return;
    }

    const body = {
      name, setup_name: name,
      master, master_account: master,
      children, child_accounts: children,
      multipliers,
      enabled: false,
    };

    try {
      const r = await fetch(`${API_BASE}/save_copytrading_setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        alert(`Error saving setup: ${r.status} ${t}`);
        return;
      }
      setShowCopyModal(false);
    } catch {
      alert('Network error while saving setup.');
    }
  };

  // ===== Render =====
  return (
    <Card className="p-3">
      {/* Toolbar */}
      <div className="d-flex align-items-center mb-3" style={{ gap: 10 }}>
        {subtab === 'clients' ? (
          <>
            <Button variant="success" onClick={openAdd}>Add Client</Button>
            <Button variant="secondary" disabled={selectedClients.size !== 1} onClick={openEdit}>Edit</Button>
            <Button variant="danger" disabled={!selectedClients.size} onClick={onDelete}>Delete</Button>
          </>
        ) : (
          <>
            <Button variant="success" onClick={openCreateGroup}>Create Group</Button>
            <Button variant="secondary" disabled={selectedGroups.size !== 1} onClick={openEditGroup}>Edit</Button>
            <Button variant="danger" disabled={!selectedGroups.size} onClick={onDeleteGroup}>Delete</Button>
          </>
        )}
        <div className="ms-auto d-flex" style={{ gap: 8 }}>
          <Button variant="outline-secondary" onClick={() => { loadClients(); loadGroups(); }}>
            Refresh
          </Button>
          {/* Open Copy Trading modal (table UI) */}
          <Button variant="outline-info" onClick={openCopyModal}>
            Copy Setup
          </Button>
        </div>
      </div>

      {/* Subtabs */}
      <div className="mb-3">
        <ButtonGroup>
          <Button
            variant={subtab === 'clients' ? 'primary' : 'outline-primary'}
            onClick={() => setSubtab('clients')}
          >
            Clients
          </Button>
          <Button
            variant={subtab === 'group' ? 'primary' : 'outline-primary'}
            onClick={() => setSubtab('group')}
          >
            Group
          </Button>
        </ButtonGroup>
      </div>

      {/* Clients Table */}
      {subtab === 'clients' ? (
        <Table bordered hover responsive size="sm">
          <thead>
            <tr>
              <th style={{ width: 70 }}>
                <Form.Check
                  type="checkbox"
                  checked={selectedClients.size === clients.length && clients.length > 0}
                  onChange={(e) => toggleAllClients(e.target.checked)}
                />
              </th>
              <th>Client Name</th>
              <th>Capital</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr><td colSpan={4} className="text-muted">No clients yet.</td></tr>
            ) : clients.map((c) => {
              const k = keyOf(c);
              const display = c.name || c.display_name || c.userid || c.client_id || '-';
              const capital = c.capital ?? '-';
              return (
                <tr key={k}>
                  <td>
                    <Form.Check
                      type="checkbox"
                      checked={selectedClients.has(k)}
                      onChange={(e) => toggleOneClient(k, e.target.checked)}
                    />
                  </td>
                  <td>{display}</td>
                  <td>{capital}</td>
                  <td>{statusBadge(c)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        // Groups Table
        <Table bordered hover responsive size="sm">
          <thead>
            <tr>
              <th style={{ width: 70 }}>
                <Form.Check
                  type="checkbox"
                  checked={selectedGroups.size === groups.length && groups.length > 0}
                  onChange={(e) => toggleAllGroups(e.target.checked)}
                />
              </th>
              <th>Group Name</th>
              <th>Multiplier</th>
              <th>Members</th>
              <th>Preview</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr><td colSpan={5} className="text-muted">No groups yet.</td></tr>
            ) : groups.map((g) => {
              const k = groupKey(g);
              const mems = g.members || [];
              const preview = mems.slice(0, 3).map(m => `${m.userid}`).join(', ')
                + (mems.length > 3 ? ` +${mems.length - 3}` : '');
              return (
                <tr key={k}>
                  <td>
                    <Form.Check
                      type="checkbox"
                      checked={selectedGroups.has(k)}
                      onChange={(e) => toggleOneGroup(k, e.target.checked)}
                    />
                  </td>
                  <td>{g.name || '-'}</td>
                  <td>{g.multiplier ?? '-'}</td>
                  <td>{mems.length}</td>
                  <td className="text-muted">{mems.length ? (preview || '-') : '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* Client Modal */}
      <Modal show={showModal} onHide={() => { setShowModal(false); pollingAbortRef.current = true; }}>
        <Form onSubmit={onSubmit}>
          <Modal.Header closeButton><Modal.Title>{editMode ? 'Edit Client' : 'Add Client'}</Modal.Title></Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Broker</Form.Label>
              <Form.Select
                value={broker}
                disabled={editMode}
                onChange={(e) => {
                  setBroker(e.target.value);
                  setAddForm(prev => ({ ...prev, password:'', pan:'', apikey:'', totpkey:'', access_token:'' }));
                }}
              >
                <option value="dhan">Dhan</option>
                <option value="motilal">Motilal Oswal</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-2">
              <Form.Label>Name</Form.Label>
              <Form.Control value={addForm.name} onChange={(e) => setAddForm(p => ({ ...p, name: e.target.value }))} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Client ID *</Form.Label>
              <Form.Control value={addForm.userid} disabled={editMode} required onChange={(e) => setAddForm(p => ({ ...p, userid: e.target.value.trim() }))} />
            </Form.Group>

            {broker === 'dhan' ? (
              <>
                <Form.Group className="mb-2">
                  <Form.Label>Access Token *</Form.Label>
                  <Form.Control
                    type="password"
                    required
                    value={addForm.access_token}
                    onChange={(e) => setAddForm(p => ({ ...p, access_token: e.target.value, apikey: e.target.value }))}
                    placeholder="paste your Dhan access token"
                  />
                  <Form.Text muted>Required for Dhan login (saved as API Key).</Form.Text>
                </Form.Group>
              </>
            ) : (
              <>
                <Form.Group className="mb-2">
                  <Form.Label>Password *</Form.Label>
                  <Form.Control type="password" required value={addForm.password} onChange={(e) => setAddForm(p => ({ ...p, password: e.target.value }))} />
                </Form.Group>
                <Form.Group className="mb-2">
                  <Form.Label>PAN *</Form.Label>
                  <Form.Control required value={addForm.pan} onChange={(e) => setAddForm(p => ({ ...p, pan: e.target.value }))} />
                </Form.Group>
                <Form.Group className="mb-2">
                  <Form.Label>API Key *</Form.Label>
                  <Form.Control type="password" required value={addForm.apikey} onChange={(e) => setAddForm(p => ({ ...p, apikey: e.target.value }))} />
                </Form.Group>
                <Form.Group className="mb-2">
                  <Form.Label>TOTP Key (optional)</Form.Label>
                  <Form.Control type="password" value={addForm.totpkey} onChange={(e) => setAddForm(p => ({ ...p, totpkey: e.target.value }))} />
                </Form.Group>
              </>
            )}

            <Form.Group className="mb-2">
              <Form.Label>Capital</Form.Label>
              <Form.Control type="number" step="0.01" min="0" value={addForm.capital} onChange={(e) => setAddForm(p => ({ ...p, capital: e.target.value }))} placeholder="e.g. 100000" />
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => { setShowModal(false); pollingAbortRef.current = true; }}>Cancel</Button>
            <Button type="submit" variant="primary">{editMode ? 'Save Changes & Login' : 'Save & Login'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Group Modal */}
      <Modal show={showGroupModal} onHide={() => setShowGroupModal(false)} size="lg">
        <Form onSubmit={onSubmitGroup}>
          <Modal.Header closeButton>
            <Modal.Title>{editGroupMode ? 'Edit Group' : 'Create Group'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Group Name *</Form.Label>
              <Form.Control
                value={groupForm.name}
                required
                onChange={(e) => setGroupForm(p => ({ ...p, name: e.target.value }))}
              />
            </Form.Group>

            <Form.Group className="mb-3" style={{ maxWidth: 260 }}>
              <Form.Label>Multiplier *</Form.Label>
              <Form.Control
                type="number"
                min="0.01"
                step="0.01"
                required
                value={groupForm.multiplier}
                onChange={(e) => setGroupForm(p => ({ ...p, multiplier: e.target.value }))}
              />
              <Form.Text muted>Applied to quantities for the whole group.</Form.Text>
            </Form.Group>

            <div className="mb-2 fw-semibold">Select Clients</div>
            <Table bordered hover responsive size="sm">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>Add</th>
                  <th>Client</th>
                  <th>Broker</th>
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr><td colSpan={3} className="text-muted">No clients to add.</td></tr>
                ) : clients.map((c) => {
                  const k = keyOf(c);
                  const checked = !!(groupForm.members || {})[k];
                  return (
                    <tr key={k}>
                      <td>
                        <Form.Check
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setGroupForm(p => {
                              const m = { ...(p.members || {}) };
                              if (v) m[k] = true; else delete m[k];
                              return { ...p, members: m };
                            });
                          }}
                        />
                      </td>
                      <td>{c.name || c.display_name || c.userid || c.client_id || '-'}</td>
                      <td className="text-capitalize">{(c.broker || '').toLowerCase()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Tip: Quantities will be scaled by this group Multiplier.
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowGroupModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">{editGroupMode ? 'Save Group' : 'Create Group'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Copy Trading Modal — TABLE like Group with per-client Multiplier */}
      <Modal show={showCopyModal} onHide={() => setShowCopyModal(false)} size="lg">
        <Form onSubmit={onSubmitCopy}>
          <Modal.Header closeButton>
            <Modal.Title>Create Copy Trading Setup</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3" style={{ maxWidth: 420 }}>
              <Form.Label>Setup Name *</Form.Label>
              <Form.Control
                value={copyForm.name}
                required
                onChange={(e) => setCopyForm(p => ({ ...p, name: e.target.value }))}
              />
            </Form.Group>

            <Form.Group className="mb-3" style={{ maxWidth: 420 }}>
              <Form.Label>Select Master Account *</Form.Label>
              <Form.Select
                value={copyForm.master}
                required
                onChange={(e) => {
                  const master = e.target.value;
                  setCopyForm(p => {
                    // ensure master is not selected as child
                    const rows = { ...(p.rows || {}) };
                    Object.keys(rows).forEach(k => {
                      const id = k.split('::')[1];
                      if (id === master) rows[k].selected = false;
                    });
                    return { ...p, master, rows };
                  });
                }}
              >
                <option value="">-- Select Master --</option>
                {clients.map(c => {
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
                ) : clients.map((c) => {
                  const k   = keyOf(c);
                  const id  = c.userid || c.client_id || '';
                  const isMaster = copyForm.master && id === copyForm.master;
                  const row = copyForm.rows[k] || { selected: false, mult: '1' };
                  const label = `${c.name || c.display_name || id} : ${id}`;

                  return (
                    <tr key={`copy-${k}`}>
                      <td>
                        <Form.Check
                          type="checkbox"
                          disabled={isMaster}
                          checked={!isMaster && !!row.selected}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setCopyForm(p => {
                              const rows = { ...(p.rows || {}) };
                              rows[k] = { ...(rows[k] || { mult: '1' }), selected: v };
                              return { ...p, rows };
                            });
                          }}
                        />
                      </td>
                      <td>{label}</td>
                      <td className="text-capitalize">{(c.broker || '').toLowerCase()}</td>
                      <td>
                        <Form.Control
                          type="number"
                          min="0.01"
                          step="0.01"
                          disabled={isMaster || !row.selected}
                          value={row.mult ?? '1'}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCopyForm(p => {
                              const rows = { ...(p.rows || {}) };
                              rows[k] = { ...(rows[k] || { selected: false }), mult: val };
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
              Tip: Master cannot be a child. Each child can have its own Multiplier.
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowCopyModal(false)}>Cancel</Button>
            <Button type="submit" variant="success">Save Setup</Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </Card>
  );
}
