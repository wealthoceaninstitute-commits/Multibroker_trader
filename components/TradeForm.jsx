// TradeForm.jsx — persistence with localStorage (Fix #2)
// Keeps all selections even if the tab unmounts or you refresh.
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Button, Col, Form, Row, Alert, Card, Spinner,
} from 'react-bootstrap';
import AsyncSelect from 'react-select/async';
import api from './api';

// ----------------------------------------------
// Persistence key
// ----------------------------------------------
const FORM_STORAGE_KEY = 'woi-trade-form-v1';

// helpers
const onlyDigits = (v) => (v ?? '').replace(/[^\d]/g, '');
const toIntOr = (v, fallback = 1) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export default function TradeForm() {
  // core state
  const [action, setAction] = useState('buy');
  const [productType, setProductType] = useState('VALUEPLUS'); // VALUEPLUS => INTRADAY
  const [orderType, setOrderType] = useState('LIMIT');         // LIMIT | MARKET | STOPLOSS | SL MARKET
  const [qtySelection, setQtySelection] = useState('manual');  // manual | auto
  const [groupAcc, setGroupAcc] = useState(false);
  const [diffQty, setDiffQty] = useState(false);
  const [multiplier, setMultiplier] = useState(false);

  const [qty, setQty] = useState('1');
  const [exchange, setExchange] = useState('nse');
  const [symbol, setSymbol] = useState(null);
  const [price, setPrice] = useState(0);
  const [trigPrice, setTrigPrice] = useState(0);
  const [disclosedQty, setDisclosedQty] = useState(0);

  // Order Duration: only DAY/IOC radios; "AMO Order" checkbox
  const [timeForce, setTimeForce] = useState('DAY'); // 'DAY' | 'IOC'
  const [amo, setAmo] = useState(false);

  const [clients, setClients] = useState([]);
  const [selectedClients, setSelectedClients] = useState([]);

  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState([]);

  const [perClientQty, setPerClientQty] = useState({});
  const [perGroupQty, setPerGroupQty] = useState({});

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  // ----------------------------------------------
  // Rehydrate from localStorage on first mount
  // ----------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(FORM_STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);

      setAction(s.action ?? 'buy');
      setProductType(s.productType ?? 'VALUEPLUS');
      setOrderType(s.orderType ?? 'LIMIT');
      setQtySelection(s.qtySelection ?? 'manual');
      setGroupAcc(!!s.groupAcc);
      setDiffQty(!!s.diffQty);
      setMultiplier(!!s.multiplier);

      setQty(String(s.qty ?? '1'));
      setExchange(s.exchange ?? 'nse');
      if (s.symbol && (s.symbol.value || s.symbol.label)) setSymbol(s.symbol);
      setPrice(s.price ?? 0);
      setTrigPrice(s.trigPrice ?? 0);
      setDisclosedQty(s.disclosedQty ?? 0);

      setTimeForce(s.timeForce ?? 'DAY');
      setAmo(!!s.amo);

      setSelectedClients(s.selectedClients ?? []);
      setSelectedGroups(s.selectedGroups ?? []);

      setPerClientQty(s.perClientQty ?? {});
      setPerGroupQty(s.perGroupQty ?? {});
    } catch {
      // ignore malformed storage
    }
  }, []);

  // ----------------------------------------------
  // Save snapshot to localStorage whenever state changes
  // ----------------------------------------------
  useEffect(() => {
    const snapshot = {
      action, productType, orderType, qtySelection,
      groupAcc, diffQty, multiplier,
      qty, exchange, symbol, price, trigPrice, disclosedQty,
      timeForce, amo,
      selectedClients, selectedGroups,
      perClientQty, perGroupQty,
    };
    try {
      localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // storage may be unavailable (private mode, quota, etc.)
    }
  }, [
    action, productType, orderType, qtySelection,
    groupAcc, diffQty, multiplier,
    qty, exchange, symbol, price, trigPrice, disclosedQty,
    timeForce, amo,
    selectedClients, selectedGroups,
    perClientQty, perGroupQty,
  ]);

  // initial data fetch (clients, groups)
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

  const loadSymbolOptions = async (inputValue) => {
    if (!inputValue || inputValue.length < 1) return [];
    const res = await api.get('/search_symbols', { params: { q: inputValue, exchange } });
    const results = res.data?.results || [];
    return results.map(r => ({
      value: r.id ?? r.value ?? r.symbol ?? r.text,
      label: r.text ?? r.label ?? String(r.id),
    }));
  };

  // derived
  const isStopOrder = orderType === 'STOPLOSS' || orderType === 'SL MARKET';
  const canUseSingleQty = useMemo(() => {
    if (groupAcc) return !diffQty;
    if (!groupAcc) return !(diffQty && selectedClients.length > 0);
    return true;
  }, [groupAcc, diffQty, selectedClients.length]);

  const handleQtyBlur = () => setQty(String(toIntOr(qty, 1)));

  const submit = async (e) => {
    e.preventDefault();

    if (groupAcc) {
      if (selectedGroups.length === 0) {
        setToast({ variant: 'warning', text: 'Please select at least one group.' });
        return;
      }
    } else if (selectedClients.length === 0) {
      setToast({ variant: 'warning', text: 'Please select at least one client.' });
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
        action: action?.toUpperCase(),
        ordertype: orderType?.toUpperCase(),
        producttype: productType?.toUpperCase(),
        orderduration: timeForce?.toUpperCase(),
        exchange: exchange?.toUpperCase(),
        symbol: symbol?.value || '',
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
      setToast({ variant: 'danger', text: 'Error: ' + (err.response?.data?.message || err.message) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="shadow-sm cardPad blueTone">
      <Form onSubmit={submit}>
        {/* Section: Action */}
        <div className="formSection">
          <Row className="g-2 align-items-center">
            <Col xs="auto" className="d-flex align-items-center flex-wrap gap-3">
              <Form.Label className="mb-0 fw-semibold">Action</Form.Label>
              <Form.Check inline type="radio" name="action" id="buy"  label="BUY"
                checked={action==='buy'}  onChange={()=>setAction('buy')} />
              <Form.Check inline type="radio" name="action" id="sell" label="SELL"
                checked={action==='sell'} onChange={()=>setAction(
