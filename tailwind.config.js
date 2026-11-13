/** Tailwind is used ONLY by the /dashboard entry (src/dash). The landing keeps its own plain CSS. */
export default {
  content: ['./dashboard/index.html', './admin/index.html', './src/dash/**/*.{ts,tsx}', './src/admin/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Reparo (HelloClient) tokens — values from the production index.css
        hc: { page: 'var(--hc-page)', card: 'var(--hc-card)', panel: 'var(--hc-panel)', line: 'var(--hc-line)', strong: 'var(--hc-line-strong)', hover: 'var(--hc-hover)', ink: 'var(--hc-ink)', muted: 'var(--hc-muted)', accent: 'var(--hc-accent)', soft: 'var(--hc-accent-soft)' },
        // WhatsApp Inbox Pro
        wa: { green: '#25d366', deep: '#054a3a', dark: '#0b141a', panel: '#111b21', raised: '#202c33', out: '#005c4b', line: '#2a3942', text: '#e9edef', muted: '#8696a0', blue: '#53bdeb' },
        // TPV Doscar / Informática Torrent
        tpv: { slate: 'hsl(191 14% 24%)', yellow: '#FAD200', win: '#F0F0F0', edge: '#A0A0A0', blue: '#1b5aa8' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
