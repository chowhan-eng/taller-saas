// Entry of /admin (platform owner only). Reuses the dashboard's Tailwind build.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../dash/tailwind.css';
import { captureLoginToken } from '@/lib/base44';
import Admin from './Admin';

captureLoginToken();
createRoot(document.getElementById('root')!).render(<StrictMode><Admin /></StrictMode>);
