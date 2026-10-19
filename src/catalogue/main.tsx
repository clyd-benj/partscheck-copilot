import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@/styles/catalogue.css';
import { Catalogue } from './Catalogue';

const root = document.getElementById('root');
if (!root) throw new Error('Catalogue root element not found');

createRoot(root).render(
  <StrictMode>
    <Catalogue />
  </StrictMode>,
);
