import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/popup.css';
import { Popup } from './Popup';

const root = document.getElementById('root');
if (!root) throw new Error('Popup root element not found');

createRoot(root).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
