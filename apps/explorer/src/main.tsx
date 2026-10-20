import { createRoot } from 'react-dom/client';
import { packageName } from './index.js';

createRoot(document.getElementById('root') as HTMLElement).render(
  <p>{packageName}: placeholder</p>,
);
