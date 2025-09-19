
// components/TradeForm.jsx — stable radios, canonical order types, validations
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button, Col, Form, Row, Alert, Card, Spinner,
} from 'react-bootstrap';
import AsyncSelect from 'react-select/async';
import api from './api';

const FORM_STORAGE_KEY = 'woi-trade-form-v1';

const onlyDigits = (v) => (v ?? '').replace(/[^\d]/g, '');
const toIntOr = (v, fallback = 1) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// canonical values (what backend expects)
const ORDER_TYPES = [
  { value: 'LIMIT', label: 'LIMIT' },
  { value: 'MARKET', label: 'MARKET' },
  { value: 'STOPLOSS', label: 'STOPLOSS' },     // Motilal prefers STOPLOSS
  { value: 'SL_MARKET', label: 'SL_MARKET' },   // Stoploss-Market
];

const PRODUCT_TYPES = [
  { value: 'VALUEPLUS', label: 'INTRADAY' },
  { value: 'DELIVERY', label: 'DELIVERY' },
  { value: 'NORMAL', label: 'NORMAL' },
  { value: 'SELLFROMDP', label: 'SELLFROMDP' },
  { value: 'BTST', label: 'BTST' },
  { value: 'MTF', label: 'MTF' },
];

const EXCHANGES = ['NSE', 'BSE', 'NSEFO', 'NSECD', 'NCDEX', 'MCX', 'BSEFO', 'BSECD'];

export default function TradeForm() {
  // core state
  const [action, setAction] = useState('BUY');                 // BUY | SELL
  const [productType, setProductType] = useState('VALUEPLUS'); // intraday default
  const [orderType, setOrderType] = useState('LIMIT');         // canonical value
  const [qtySelection, setQtySelection] = useState('manual');  // manual | auto

  const [groupAcc, setGroupAcc] = useState(false);
  const [diffQty, setDiffQty] = useState(false);
  const [multiplier, setMultiplier] = useState(false);

  const [qty, setQty] = useState('1');
  const [exchange, setExchange] = useState('NSE');
  const [symbol, setSymbol] = useState(null); // { value, label }
  const [price, setPrice] = useState(0);
  const [trigPrice, setTrigPrice] = useState(0);
  const [disclosedQty, setDisclosedQty] = useState(0);

  const [timeForce, setTimeForce] = useState('DAY'); // DAY | IOC
  const [amo, setAmo] = useState(false);

  const [clients, setClients] = useState([]);
  const [selectedClients, setSelectedClients] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);

  const [perClientQty, setPerClientQty] = useState({});
  const [perGroupQty, setPerGroupQty] = useState({});

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // ---------- load from localStorage ----------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);

      setAction((s.action ?? 'BUY').toUpperCase());
      setProductType(s.productType ?? 'VALUEPLUS');
      setOrderType(s.orderType ?? 'LIMIT');
      setQtySelection(s.qtySelection ?? 'manual');

      setGroupAcc(!!s.groupAcc);
      setDiffQty(!!s.diffQty);
      setMultiplier(!!s.multiplier);

      setQty(String(s.qty ?? '1'));
      setExchange((s.exchange ?? 'NSE').toUpperCase());
      setSymbol(s.symbol ?? null);
      setPrice(Number(s.price ?? 0));
      setTrigPrice(Number(s.trigPrice ?? 0));
      setDisclosedQty(Number(s.disclosedQty ?? 0));

      setTimeForce(s.timeForce ?? 'DAY');
      setAmo(!!s.amo);

      setSelectedClients(s.selectedClients ?? []);
      setSelectedGroups(s.selectedGroups ?? []);
      setPerClientQty(s.perClientQty ?? {});
      setPerGroupQty(s.perGroupQty ?? {});
    } catch {/* ignore */}
  }, []);

  // ---------- persist to localStorage ----------
  useEffect(() => {
    const snapshot = {
      action, productType, orderType, qtySelection,
      groupAcc, diffQty, multiplier,
      qty, exchange, symbol, price, trigPrice, disclosedQty,
      timeForce, amo,
      selectedClients, selectedGroups,
      perClientQty, perGroupQty,
    };
    try { localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(snapshot)); } catch {}
  }, [
    action, productType, orderType, qtySelection,
    groupAcc, diffQty, multiplier,
    qty, exchange, symbol, price, trigPrice, disclosedQty,
    timeForce, amo,
    selectedClients, selectedGroups,
    perClientQty, perGroupQty,
  ]);

  // ---------- initial data ----------
  useEffect(() => {
    api.get('/get_clients').then(res => setClients(res.data?.clients || [])).catch(() => {});
    api.get('/groups').then(res => {
      const normalized = (res.data?.groups || []).map(g => ({
        group_name: g.name || g.group_name || g.id,
        no_of_clients: (g.members || g.clients || []).length,
        multiplier: Number(g.multiplier ?? 1),
        client_names: (g.members || g.clients || []).map(m => m.name || m),
      }));
      setGroups(normalized);
    }).catch(() => {});
  }, []);

  // ---------- symbol search ----------
  const loadSymbolOptions = async (inputValue) => {
    if (!inputValue) return [];
    const res = await api.get('/search_symbols', { params: { q: inputValue, exchange } });
    const results = res.data?.results || [];
    return results.map(r => ({
      value: r.id ?? r.token ?? r.symbol ?? r.text, // stable machine value
      label: r.text ?? r.label ?? String(r.id),
    }));
  };

  // ---------- derived ----------
  const isStopOrder = orderType === 'STOPLOSS' || orderType === 'SL_MARKET';

  const canUseSingleQty = useMemo(() => {
    if (groupAcc) return !diffQty;
    if (!groupAcc) return !(diffQty && selectedClients.length > 0);
    return true;
  }, [groupAcc, diffQty, selectedClients.length]);

  // ---------- validations ----------
  const validateBeforeSubmit = () => {
    if (!groupAcc && selectedClients.length === 0) {
      return 'Please select at least one client.';
    }
    if (groupAcc && selectedGroups.length === 0) {
      return 'Please select at least one group.';
    }
    if (!symbol?.value) {
      return 'Please select a symbol from the dropdown.';
    }
    if (orderType === 'MARKET' && Number(price) !== 0) {
      setPrice(0); // normalize silently
    }
    if (isStopOrder && Number(trigPrice) <= 0) {
      return 'Trigger price is required for STOPLOSS / SL_MARKET orders.';
    }
    if (toIntOr(qty, 0) <= 0 && canUseSingleQty) {
      return 'Quantity must be a positive number.';
    }
    return null;
  };

  // ---------- submit ----------
  const submit = async (e) => {
    e.preventDefault();

    const errMsg = validateBeforeSubmit();
    if (errMsg) {
      setToast({ variant: 'warning', text: errMsg });
      return;
    }

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
        action,                                              // BUY/SELL
        ordertype: orderType,                                // LIMIT/MARKET/STOPLOSS/SL_MARKET
        producttype: productType,                            // canonical
        orderduration: timeForce,                            // DAY/IOC
        exchange,                                            // e.g., NSE/NSEFO
        symbol: symbol?.value || '',                         // machine value
        price: Number(price) || 0,
        triggerprice: Number(trigPrice) || 0,
        disclosedquantity: Number(disclosedQty) || 0,
        amoorder: amo ? 'Y' : 'N',
        qtySelection,
        quantityinlot: safeSingleQty,
        perClientQty: safePerClientQty,
        perGroupQty: safePerGroupQty,
        diffQty,
        multiplier,
      };

      const resp = await api.post('/place_order', payload);
      setToast({ variant: 'success', text: 'Order placed. Response: ' + JSON.stringify(resp.data) });
    } catch (err) {
      const r = err?.response;
      const msg = r?.data?.message
        || (typeof r?.data === 'string' ? r.data : null)
        || err.message
        || 'Request failed';
      setToast({ variant: 'danger', text: 'Error: ' + msg });
    } finally {
      setBusy(false);
    }
  };

  const resetAll = () => {
    try { localStorage.removeItem(FORM_STORAGE_KEY); } catch {}
    setAction('BUY');
    setProductType('VALUEPLUS');
    setOrderType('LIMIT');
    setQtySelection('manual');
    setGroupAcc(false);
    setDiffQty(false);
    setMultiplier(false);
    setQty('1');
    setExchange('NSE');
    setSymbol(null);
    setPrice(0);
    setTrigPrice(0);
    setDisclosedQty(0);
    setTimeForce('DAY');
    setAmo(false);
    setSelectedClients([]);
    setSelectedGroups([]);
    setPerClientQty({});
    setPerGroupQty({});
  };

  return (
    <Card className="shadow-sm cardPad blueTone">
      <Form onSubmit={submit}>
        {/* Action */}
        <div className="formSection">
          <Row className="g-2 align-items-center">
            <Col xs="auto" className="d-flex align-items-center flex-wrap gap-3">
              <Form.Label className="mb-0 fw-semibold">Action</Form.Label>
              {['BUY','SELL'].map(v => (
                <Form.Check
                  key={v}
                  inline
                  type="radio"
                  name="action"
                  id={`action_${v}`}
                  label={v}
                  checked={action === v}
                  onChange={() => setAction(v)}
                />
              ))}
            </Col>
          </Row>
        </div>

        {/* Product */}
        <div className="formSection">
          <Row className="g-2 align-items-center">
            <Col xs="auto" className="d-flex align-items-center flex-wrap gap-3">
              <Form.Label className="mb-0 fw-semibold">Product</Form.Label>
              {PRODUCT_TYPES.map(pt => (
                <Form.Check
                  key={pt.value}
                  inline
                  type="radio"
                  name="productType"
                  id={`product_${pt.value}`}
                  label={pt.label}
                  checked={productType === pt.value}
                  onChange={() => setProductType(pt.value)}
                />
              ))}
            </Col>
          </Row>
        </div>

        {/* Order Type */}
        <div className="formSection">
          <Row className="g-2 align-items-center">
            <Col xs="auto" className="d-flex align-items-center flex-wrap gap-3">
              <Form.Label className="mb-0 fw-semibold">Order Type</Form.Label>
              {ORDER_TYPES.map(ot => (
                <Form.Check
                  key={ot.value}
                  inline
                  type="radio"
                  name="orderType"
                  id={`ordertype_${ot.value}`}
                  label={ot.label}
                  checked={orderType === ot.value}
                  onChange={() => setOrderType(ot.value)}
                />
              ))}
            </Col>
          </Row>
        </div>

        {/* Clients / Groups */}
        <div className="formSection">
          <Row>
            <Col xs={12}>
              {!groupAcc ? (
                <>
                  <Form.Label className="label-tight">Select Clients</Form.Label>
                  <Form.Select
                    multiple
                    size={8}
                    value={selectedClients}
                    onChange={e=>setSelectedClients(Array.from(e.target.selectedOptions).map(o=>o.value))}
                  >
                    {(clients || []).map(c => (
                      <option key={c.client_id} value={c.client_id}>
                        {c.name} : {c.client_id}
                      </option>
                    ))}
                  </Form.Select>
                </>
              ) : (
                <>
                  <Form.Label className="label-tight">Select Groups</Form.Label>
                  <div className="border rounded p-2">
                    {groups.length===0 ? (
                      <div className="text-muted">No groups found.</div>
                    ) : (
                      groups.map(g => (
                        <Form.Check
                          key={g.group_name}
                          type="checkbox"
                          id={`group_${g.group_name}`}
                          name="groupsPick"
                          label={`${g.group_name} (${g.no_of_clients} clients, x${g.multiplier})`}
                          checked={selectedGroups.includes(g.group_name)}
                          onChange={e=>{
                            const chk = e.target.checked;
                            setSelectedGroups(prev => chk ? [...prev, g.group_name] : prev.filter(x=>x!==g.group_name));
                          }}
                        />
                      ))
                    )}
                  </div>
                </>
              )}
            </Col>
          </Row>
        </div>

        {/* Details */}
        <div className="formSection">
          {/* Qty / Entity */}
          <Row className="g-2 mb-2 align-items-end">
            <Col md={5}>
              <Form.Label className="label-tight">Qty</Form.Label>
              <Form.Control
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={qtySelection==='auto'}
                value={qty}
                onChange={e=>setQty(onlyDigits(e.target.value))}
                onBlur={()=>setQty(String(Math.max(1, parseInt(qty || '1', 10) || 1)))}
              />
            </Col>

            <Col md={7}>
              <div className="d-flex align-items-center flex-wrap gap-3 mb-1">
                <Form.Label className="mb-0 fw-semibold">Entity</Form.Label>
                <Form.Check
                  inline
                  type="checkbox"
                  id="entity_groupAcc"
                  name="entity_groupAcc"
                  label="Group Acc"
                  checked={groupAcc}
                  onChange={e=>setGroupAcc(e.target.checked)}
                />
                <Form.Check
                  inline
                  type="checkbox"
                  id="entity_diffQty"
                  name="entity_diffQty"
                  label="Diff. Qty."
                  checked={diffQty}
                  onChange={e=>setDiffQty(e.target.checked)}
                />
                <Form.Check
                  inline
                  type="checkbox"
                  id="entity_multiplier"
                  name="entity_multiplier"
                  label="Multiplier"
                  checked={multiplier}
                  onChange={e=>setMultiplier(e.target.checked)}
                />
              </div>

              <div className="d-flex align-items-center flex-wrap gap-3">
                <Form.Label className="mb-0 fw-semibold">Qty Mode</Form.Label>
                <Form.Check
                  inline
                  type="radio"
                  name="qtySel"
                  id="qtySel_manual"
                  label="Manual"
                  checked={qtySelection==='manual'}
                  onChange={()=>setQtySelection('manual')}
                />
                <Form.Check
                  inline
                  type="radio"
                  name="qtySel"
                  id="qtySel_auto"
                  label="Auto Calculate"
                  checked={qtySelection==='auto'}
                  onChange={()=>setQtySelection('auto')}
                />
              </div>
            </Col>
          </Row>

          {/* Exchange / Symbol */}
          <Row className="g-2 mb-2 align-items-end">
            <Col md={5}>
              <Form.Label className="label-tight">Exchange</Form.Label>
              <Form.Select value={exchange} onChange={e=>setExchange(e.target.value.toUpperCase())}>
                {EXCHANGES.map(x => <option key={x} value={x}>{x}</option>)}
              </Form.Select>
            </Col>

            <Col md={7}>
              <Form.Label className="label-tight">Symbol</Form.Label>
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

          {/* Price / Trigger / Disclosed */}
          <Row className="g-2 align-items-end">
            <Col md={5}>
              <Form.Label className="label-tight">Price</Form.Label>
              <Form.Control
                type="number"
                step="0.01"
                value={orderType === 'MARKET' ? 0 : price}
                disabled={orderType === 'MARKET'}
                onChange={e=>setPrice(e.target.value)}
              />
            </Col>

            <Col md={7}>
              <Row className="g-2">
                <Col md={6}>
                  <Form.Label className="label-tight">Trig. Price</Form.Label>
                  <Form.Control
                    type="number"
                    step="0.01"
                    value={trigPrice}
                    onChange={e=>setTrigPrice(e.target.value)}
                    disabled={!isStopOrder}
                  />
                </Col>
                <Col md={6}>
                  <Form.Label className="label-tight">Disclosed Qty</Form.Label>
                  <Form.Control
                    type="number"
                    value={disclosedQty}
                    onChange={e=>setDisclosedQty(e.target.value)}
                  />
                </Col>
              </Row>
            </Col>
          </Row>
        </div>

        {/* Duration */}
        <div className="formSection">
          <Row className="g-2 align-items-center">
            <Col md="auto" className="d-flex align-items-center flex-wrap gap-3">
              <Form.Label className="mb-0">Order Duration</Form.Label>
              {['DAY','IOC'].map(tf => (
                <Form.Check
                  key={tf}
                  inline
                  type="radio"
                  name="timeForce"
                  id={`timeForce_${tf}`}
                  label={tf}
                  checked={timeForce===tf}
                  onChange={()=>setTimeForce(tf)}
                />
              ))}
              <Form.Check
                inline
                type="checkbox"
                id="amo_order"
                name="amo_order"
                label="AMO Order"
                checked={amo}
                onChange={e=>setAmo(e.target.checked)}
              />
            </Col>
          </Row>
        </div>

        {/* Buttons */}
        <Row className="mt-2">
          <Col className="text-start">
            <div className="btn-nudge">
              <Button type="submit" variant={action === 'BUY' ? 'success' : 'danger'} disabled={busy}>
                {busy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                {action}
              </Button>{' '}
              <Button type="button" variant="secondary" onClick={resetAll}>
                Reset
              </Button>
            </div>
          </Col>
        </Row>

        {toast && (
          <Alert variant={toast.variant} onClose={()=>setToast(null)} dismissible className="mt-3">
            {toast.text}
          </Alert>
        )}
      </Form>

      <style jsx>{`
        .cardPad { padding: 1rem 2.5rem 2.75rem; }
        @media (min-width: 992px) { .cardPad { padding: 1.25rem 2.75rem 3.25rem; } }
        .blueTone {
          background: linear-gradient(180deg, #f9fbff 0%, #f3f7ff 100%);
          border: 1px solid #d5e6ff;
          box-shadow: 0 0 0 6px rgba(49, 132, 253, 0.12);
          border-radius: 8px;
        }
        .formSection { padding-block: 6px; margin: 0 16px 8px; border-bottom: 1px dashed #d7e3ff; }
        .formSection:last-of-type { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
        .label-tight { margin-bottom: 4px; }
        :global(input[type="radio"]), :global(input[type="checkbox"]) { accent-color: #0d6efd; }
        .btn-nudge { margin-left: 3rem; padding-bottom: 0.25rem; }
      `}</style>
    </Card>
  );
}
