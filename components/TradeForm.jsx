'use client';
import { useEffect, useMemo, useState } from 'react';
import { Button, Col, Form, Row, Alert, Card, Spinner } from 'react-bootstrap';
import AsyncSelect from 'react-select/async';
import api from './api';

/** helpers */
const onlyDigits = (v) => (v ?? '').replace(/[^\d]/g, '');
const toIntOr = (v, fallback = 1) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export default function TradeForm() {
  // --- State mirrors the original HTML form ---
  const [action, setAction] = useState('buy');
  const [productType, setProductType] = useState('VALUEPLUS');
  const [qtySelection, setQtySelection] = useState('manual');
  const [groupAcc, setGroupAcc] = useState(false);
  const [diffQty, setDiffQty] = useState(false);
  const [multiplier, setMultiplier] = useState(false);

  // IMPORTANT: qty as *string* so users can backspace to empty safely
  const [qty, setQty] = useState('1');

  const [orderType, setOrderType] = useState('LIMIT');
  const [timeForce, setTimeForce] = useState('DAY');
  const [amo, setAmo] = useState(false);

  const [exchange, setExchange] = useState('nse');
  const [symbol, setSymbol] = useState(null); // react-select option
  const [price, setPrice] = useState(0);
  const [trigPrice, setTrigPrice] = useState(0);
  const [disclosedQty, setDisclosedQty] = useState(0);

  const [clients, setClients] = useState([]);          // [{client_id, name, ...}]
  const [selectedClients, setSelectedClients] = useState([]); // array of ids

  // Per-client & per-group qty kept as strings (same reason as qty)
  const [perClientQty, setPerClientQty] = useState({}); // {clientId: 'qty'}
  const [groups, setGroups] = useState([]);             // [{group_name, no_of_clients, multiplier, client_names}]
  const [selectedGroups, setSelectedGroups] = useState([]);   // array of group_name
  const [perGroupQty, setPerGroupQty] = useState({});   // {groupName: 'qty'}

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(()=>{
    // load clients & groups once
   // TradeForm.jsx  -- inside useEffect that loads clients & groups
api.get('/get_clients').then(res => {
  setClients(res.data?.clients || []);
}).catch(()=>{});

api.get('/groups').then(res => {
  const normalized = (res.data?.groups || []).map(g => ({
    group_name: g.name || g.group_name || g.id,
    no_of_clients: (g.members || g.clients || []).length,
    multiplier: Number(g.multiplier ?? 1),
    client_names: (g.members || g.clients || []).map(m => m.name || m),
  }));
  setGroups(normalized);
}).catch(()=>{});

  },[]);

  // --- Symbol Async loader ---
  const loadSymbolOptions = async (inputValue) => {
    if (!inputValue || inputValue.length < 1) return [];
    const res = await api.get('/search_symbols', {
      params: { q: inputValue, exchange }
    });
    const results = res.data?.results || [];
    return results.map(r => ({
      value: r.id ?? r.value ?? r.symbol ?? r.text,
      label: r.text ?? r.label ?? String(r.id)
    }));
  };

  const handleClientQtyChange = (clientId, value) => {
    setPerClientQty(prev => ({ ...prev, [clientId]: onlyDigits(value) }));
  };
  const handleClientQtyBlur = (clientId) => {
    setPerClientQty(prev => ({ ...prev, [clientId]: String(toIntOr(prev[clientId], 1)) }));
  };

  const handleGroupQtyChange = (groupName, value) => {
    setPerGroupQty(prev => ({ ...prev, [groupName]: onlyDigits(value) }));
  };
  const handleGroupQtyBlur = (groupName) => {
    setPerGroupQty(prev => ({ ...prev, [groupName]: String(toIntOr(prev[groupName], 1)) }));
  };

  const canUseSingleQty = useMemo(()=>{
    if (groupAcc) {
      if (diffQty) return false;
      return true; // single qty for group modes (including multiplier mode)
    }
    if (!groupAcc) {
      if (diffQty && selectedClients.length>0) return false;
      return true;
    }
    return true;
  }, [groupAcc, diffQty, selectedClients.length]);

  const actionBtnVariant = action==='buy' ? 'success' : 'danger';

  const submit = async (e) => {
    e.preventDefault();

    // validations
    if (groupAcc) {
      if (selectedGroups.length === 0) {
        setToast({variant:'warning', text:'Please select at least one group.'});
        return;
      }
    } else if (selectedClients.length === 0) {
      setToast({variant:'warning', text:'Please select at least one client.'});
      return;
    }

    // Build safe quantities (never 0)
    const safeSingleQty = canUseSingleQty ? toIntOr(qty, 1) : 0;
    const safePerClientQty = (!groupAcc && diffQty)
      ? Object.fromEntries(selectedClients.map(cid => [cid, toIntOr(perClientQty[cid], 1)]))
      : {};
    const safePerGroupQty = (groupAcc && diffQty)
      ? Object.fromEntries(selectedGroups.map(gn => [gn, toIntOr(perGroupQty[gn], 1)]))
      : {};

    setBusy(true);
    try {
      const payload = {
        groupacc: groupAcc,
        groups: selectedGroups,
        clients: selectedClients,
        action: action?.toUpperCase(),
        ordertype: orderType?.toUpperCase(),
        producttype: productType?.toUpperCase(),
        orderduration: timeForce?.toUpperCase(),
        exchange: exchange?.toUpperCase(),
        symbol: symbol?.value || '',
        price: Number(price)||0,
        triggerprice: Number(trigPrice)||0,
        disclosedquantity: Number(disclosedQty)||0,
        amoorder: amo ? 'Y' : 'N',
        qtySelection,
        quantityinlot: safeSingleQty,
        perClientQty: safePerClientQty,
        perGroupQty: safePerGroupQty,
        diffQty,
        multiplier
      };

      const resp = await api.post('/place_order', payload);
      setToast({variant:'success', text: 'Order placed. Response: ' + JSON.stringify(resp.data)});
    } catch (err) {
      setToast({variant:'danger', text: 'Error: ' + (err.response?.data?.message || err.message)});
    } finally {
      setBusy(false);
    }
  };

  // If user leaves the single-qty field blank, snap it back to 1
  const handleQtyBlur = () => setQty(String(toIntOr(qty, 1)));

  return (
    <Card className="p-3">
      <Form onSubmit={submit}>
        <Row className="mb-3">
          <Col xs={12}>
            <Form.Label className="mb-2">Action</Form.Label><br/>
            <Form.Check inline type="radio" id="buy" name="action" label="BUY" checked={action==='buy'} onChange={()=>setAction('buy')}/>
            <Form.Check inline type="radio" id="sell" name="action" label="SELL" checked={action==='sell'} onChange={()=>setAction('sell')}/>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col xs={12}>
            <Form.Label className="mb-2">Product Type</Form.Label><br/>
            {['VALUEPLUS','DELIVERY','NORMAL','SELLFROMDP','BTST','MTF'].map(pt=>(
              <Form.Check key={pt} inline type="radio" name="productType" label={pt==='VALUEPLUS'?'INTRADAY':pt} checked={productType===pt} onChange={()=>setProductType(pt)} />
            ))}
          </Col>
        </Row>

        <Row className="mb-3">
          <Col xs={12}>
            <Form.Label className="mb-2">Entity Selection</Form.Label>
            <div className="mb-2">
              <Form.Check inline type="checkbox" id="groupAcc" label="Group Acc" checked={groupAcc} onChange={e=>setGroupAcc(e.target.checked)} />
              <Form.Check inline type="checkbox" id="diffQty" label="Diff. Qty." checked={diffQty} onChange={e=>setDiffQty(e.target.checked)} />
              <Form.Check inline type="checkbox" id="multiplier" label="Multiplier" checked={multiplier} onChange={e=>setMultiplier(e.target.checked)} />
            </div>

            {!groupAcc ? (
              <Form.Group>
                <Form.Label>Select Clients</Form.Label>
                <Form.Select
                  multiple
                  size={5}
                  value={selectedClients}
                  onChange={e=>setSelectedClients(Array.from(e.target.selectedOptions).map(o=>o.value))}
                >
                  {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.name} : {c.client_id}</option>)}
                </Form.Select>
              </Form.Group>
            ) : (
              <div className="border rounded p-2">
                {groups.length===0 ? <div className="text-muted">No groups found.</div> :
                  groups.map((g)=> (
                    <Form.Check
                      key={g.group_name}
                      type="checkbox"
                      id={`group_${g.group_name}`}
                      label={`${g.group_name} (${g.no_of_clients} clients, x${g.multiplier})`}
                      checked={selectedGroups.includes(g.group_name)}
                      onChange={e=>{
                        const checked = e.target.checked;
                        setSelectedGroups(prev => checked ? [...prev, g.group_name] : prev.filter(x=>x!==g.group_name));
                      }}
                    />
                  ))
                }
              </div>
            )}
          </Col>
        </Row>

        <Row className="mb-3">
          <Col xs="auto" className="align-self-end">
            <Form.Label className="mb-2">Quantity Selection</Form.Label><br/>
            <Form.Check inline type="radio" name="qtySelection" id="manualQty" label="Manual" checked={qtySelection==='manual'} onChange={()=>setQtySelection('manual')}/>
            <Form.Check inline type="radio" name="qtySelection" id="autoQty" label="Auto Calculate" checked={qtySelection==='auto'} onChange={()=>setQtySelection('auto')} />
          </Col>
        </Row>

        {/* Per-group qty inputs if needed */}
        {groupAcc && diffQty && selectedGroups.length>0 && (
          <div className="mb-3">
            {selectedGroups.map(gn => (
              <Row key={gn} className="align-items-center mb-2">
                <Col xs={6}><b>{gn}</b></Col>
                <Col xs={6}>
                  <Form.Control
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={perGroupQty[gn] ?? '1'}
                    onChange={e=>handleGroupQtyChange(gn, e.target.value)}
                    onBlur={()=>handleGroupQtyBlur(gn)}
                  />
                </Col>
              </Row>
            ))}
          </div>
        )}

        {/* Single qty row */}
        {canUseSingleQty && (
          <Row className="mb-3">
            <Col xs={12} md={4}>
              <Form.Label>Qty</Form.Label>
              <Form.Control
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={qtySelection==='auto'}
                value={qty}
                onChange={e=>setQty(onlyDigits(e.target.value))}
                onBlur={handleQtyBlur}
              />
            </Col>
          </Row>
        )}

        {/* Per-client qty inputs */}
        {!groupAcc && diffQty && selectedClients.length>0 && (
          <div className="mb-3">
            {selectedClients.map(cid => {
              const label = clients.find(c=>c.client_id===cid)?.name + ' : ' + cid;
              const v = perClientQty[cid] ?? '1';
              return (
                <Row key={cid} className="align-items-center mb-2">
                  <Col xs={6}><b>{label}</b></Col>
                  <Col xs={6}>
                    <Form.Control
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={v}
                      onChange={e=>handleClientQtyChange(cid, e.target.value)}
                      onBlur={()=>handleClientQtyBlur(cid)}
                    />
                  </Col>
                </Row>
              );
            })}
          </div>
        )}

        <Row className="mb-3">
          <Col md={6}>
            <Form.Label>Exchange</Form.Label>
            <Form.Select value={exchange} onChange={e=>setExchange(e.target.value)}>
              {['nse','bse','nsefo','nsecd','ncdex','mcx','bsefo','bsecd'].map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}
            </Form.Select>
          </Col>
          <Col md={6}>
            <Form.Label>Symbol</Form.Label>
            <AsyncSelect
              cacheOptions
              defaultOptions={false}
              loadOptions={loadSymbolOptions}
              value={symbol}
              onChange={setSymbol}
              placeholder="Type to search symbol..."
            />
          </Col>
        </Row>

        <Row className="mb-3">
          <Col md={4}>
            <Form.Label>Price</Form.Label>
            <Form.Control type="number" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}/>
          </Col>
          <Col md={4}>
            <Form.Label>Trig. Price</Form.Label>
            <Form.Control type="number" step="0.01" value={trigPrice} onChange={e=>setTrigPrice(e.target.value)}/>
          </Col>
          <Col md={4}>
            <Form.Label>Disclosed Qty</Form.Label>
            <Form.Control type="number" value={disclosedQty} onChange={e=>setDisclosedQty(e.target.value)}/>
          </Col>
        </Row>

        <Row className="mb-3">
          <Col xs={12}>
            <Form.Label className="mb-2">Order Type</Form.Label><br/>
            {['LIMIT','MARKET','STOPLOSS','SL MARKET'].map(ot => (
              <Form.Check key={ot} inline type="radio" name="orderType" label={ot} checked={orderType===ot} onChange={()=>setOrderType(ot)} />
            ))}
          </Col>
        </Row>

        <Row className="mb-3">
          <Col xs={12}>
            <Form.Label className="mb-2">Order Duration</Form.Label><br/>
            {['DAY','IOC','AMO'].map(tf => (
              <Form.Check key={tf} inline type="radio" name="timeForce" label={tf} checked={timeForce===tf} onChange={()=>setTimeForce(tf)} />
            ))}
            <Form.Check inline type="checkbox" id="amo" label="AMO Order" checked={amo} onChange={e=>setAmo(e.target.checked)} />
          </Col>
        </Row>

        {toast && <Alert variant={toast.variant} onClose={()=>setToast(null)} dismissible>{toast.text}</Alert>}

        <Row className="mb-2">
          <Col>
            <Button type="submit" variant={actionBtnVariant} disabled={busy}>
              {busy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
              {action.toUpperCase()}
            </Button>{' '}
            <Button type="reset" variant="secondary" onClick={()=>window.location.reload()}>Reset</Button>
          </Col>
        </Row>
      </Form>
    </Card>
  );
}
