import { createRoot } from 'react-dom/client';
import { App } from './App';
import { globalStyles } from './design-system/global-styles';

// Inject global styles
const styleTag = document.createElement('style');
styleTag.textContent = globalStyles;
document.head.appendChild(styleTag);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(<App />);
