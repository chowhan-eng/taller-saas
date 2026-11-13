// Entry of /dashboard. Own Vite entry + Tailwind, so the landing's plain CSS is untouched.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tailwind.css';
import './print.css';
import { captureLoginToken } from '@/lib/base44';
import Shell from './Shell';

captureLoginToken();
createRoot(document.getElementById('root')!).render(<StrictMode><Shell /></StrictMode>);
