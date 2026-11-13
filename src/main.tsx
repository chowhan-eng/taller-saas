import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { captureLoginToken } from '@/lib/base44';
import Home from '@/pages/Home';
import Onboarding from '@/pages/Onboarding';
import Gracias from '@/pages/Gracias';
import Privacidad from '@/pages/Privacidad';
import { ForgotPassword, Login, Register, ResetPassword } from '@/pages/Auth';

captureLoginToken();

const path = window.location.pathname.replace(/\/+$/, '').replace(/\/index\.html$/, '') || '/';
// The hosting falls back to this bundle for /dashboard; the real panel is its own page.
if (path === '/dashboard') location.replace(`/dashboard/index.html${location.search}${location.hash}`);

const Page =
  path === '/onboarding/gracias' ? Gracias :
  path === '/onboarding' ? Onboarding :
  path === '/privacidad' ? Privacidad :
  path === '/login' ? Login :
  path === '/register' ? Register :
  path === '/forgot-password' ? ForgotPassword :
  path === '/reset-password' ? ResetPassword :
  path === '/' ? Home : path === '/dashboard' ? Loading : NotFound;

function Loading() { return <main className="wrap" style={{ padding: '48px 16px' }}><p>Abriendo tu panel…</p></main>; }

function NotFound() {
  return (
    <main className="wrap" style={{ padding: '48px 16px' }}>
      <h1>Página no encontrada</h1>
      <p><a href="/">Volver al inicio</a></p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><Page /></StrictMode>);
