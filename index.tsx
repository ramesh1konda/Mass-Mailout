// AIT-TBC | index.tsx | Ramesh Konda | 2026-10-28 | React entry point; mounts <App /> into #root
// Change log:
//   2026-10-28 RK AIT-TBC Initial version

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
