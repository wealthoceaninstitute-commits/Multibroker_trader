'use client';
import { useState } from 'react';
import { Container, Tabs, Tab } from 'react-bootstrap';
import dynamic from 'next/dynamic';

// Code-split tabs (faster initial load)
const TradeForm   = dynamic(() => import('../components/TradeForm'),   { ssr: false });
const Orders      = dynamic(() => import('../components/Orders'),      { ssr: false });
const Positions   = dynamic(() => import('../components/Positions'),   { ssr: false });
const Holdings    = dynamic(() => import('../components/Holdings'),    { ssr: false });
const Summary     = dynamic(() => import('../components/Summary'),     { ssr: false });
const Clients     = dynamic(() => import('../components/Clients'),     { ssr: false });
const CopyTrading = dynamic(() => import('../components/CopyTrading'), { ssr: false });

export default function Page() {
  const [key, setKey] = useState('trade');

  return (
    <Container className="mt-4">
      <Tabs
        activeKey={key}
        onSelect={(k)=>setKey(k || 'trade')}
        id="mainTabs"
        className="mb-3"
        mountOnEnter
        unmountOnExit
      >
        <Tab eventKey="trade" title="Trade"><TradeForm/></Tab>
        <Tab eventKey="orders" title="Orders"><Orders/></Tab>
        <Tab eventKey="positions" title="Positions"><Positions/></Tab>
        <Tab eventKey="holdings" title="Holdings"><Holdings/></Tab>
        <Tab eventKey="summary" title="Summary"><Summary/></Tab>
        <Tab eventKey="clients" title="Clients"><Clients/></Tab>
        <Tab eventKey="copytrading" title="Copy Trading"><CopyTrading/></Tab>
      </Tabs>
    </Container>
  );
}
