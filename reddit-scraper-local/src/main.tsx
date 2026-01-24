import { createRoot } from 'react-dom/client';
import App from './client/App';

console.log('[Main] Starting Reddit Scraper Local...');

const container = document.getElementById('root');
if (!container) {
  console.error('[Main] No root element found');
  throw new Error('No root element found');
}

const root = createRoot(container);
root.render(<App />);
console.log('[Main] App rendered');
