import React, { useState } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { Clock, Shield, Users, Zap, Eye, EyeOff, Loader2, QrCode, ScanLine, Settings2, Wifi, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import appLogo from '@/assets/app-logo-transparent.png';
import {
  erpRequest,
  getActiveErpBaseUrl,
  getCustomErpBaseUrl,
  setErpConnectionPreference,
  setCustomErpBaseUrl,
} from '@/lib/erpApi';
import { createErpConnectionQrValue, normalizeErpConnectionQrValue } from '@/lib/erpConnectionQr';

interface LoginPageProps {
  onLogin: (email: string, password: string) => void;
  isLoading?: boolean;
  error?: string;
  offlineMessage?: string;
}

const LoginPage: React.FC<LoginPageProps> = ({ onLogin, isLoading = false, error, offlineMessage }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);
  const [customErpUrl, setCustomErpUrlState] = useState(() => getCustomErpBaseUrl());
  const [connectionSettingsError, setConnectionSettingsError] = useState('');
  const [connectionTest, setConnectionTest] = useState<{ loading: boolean; ok?: boolean; message?: string }>({ loading: false });
  const [connectionQrUrl, setConnectionQrUrl] = useState('');
  const connectionInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onLogin(email, password);
  };

  const applySelectedConnection = () => {
    try {
      setCustomErpBaseUrl(customErpUrl);
      setErpConnectionPreference('custom');
      setConnectionSettingsError('');
    } catch (customError) {
      const message = customError instanceof Error ? customError.message : 'Invalid custom ERP URL.';
      setConnectionSettingsError(message);
      throw customError;
    }
  };

  const testConnection = async () => {
    if (connectionTest.loading) return;
    try {
      applySelectedConnection();
      setConnectionTest({ loading: true });
      const response = await erpRequest('/api/method/ping', {
        method: 'GET',
        retryOn403: false,
      });
      if (!response.ok) throw new Error(`ERP returned HTTP ${response.status}`);
      setConnectionTest({ loading: false, ok: true, message: `Connected to ${getActiveErpBaseUrl()}` });
    } catch (connectionError) {
      setConnectionTest({
        loading: false,
        ok: false,
        message: connectionError instanceof Error ? connectionError.message : 'Unable to reach the selected ERP.',
      });
    }
  };

  const closeConnectionSettings = () => {
    try {
      applySelectedConnection();
      setShowConnectionSettings(false);
    } catch {
      // Keep the dialog open so the URL can be corrected.
    }
  };

  const applyScannedConnection = useCallback((rawValue: string) => {
    try {
      const normalizedUrl = normalizeErpConnectionQrValue(rawValue);
      setCustomErpBaseUrl(normalizedUrl);
      setErpConnectionPreference('custom');
      setCustomErpUrlState(normalizedUrl);
      setConnectionQrUrl('');
      setConnectionSettingsError('');
      setConnectionTest({ loading: false, ok: true, message: `ERP URL loaded: ${normalizedUrl}` });
    } catch (scanError) {
      setConnectionSettingsError(scanError instanceof Error ? scanError.message : 'Invalid ERP connection QR.');
    }
  }, []);

  const generateConnectionQr = () => {
    try {
      const normalizedUrl = createErpConnectionQrValue(customErpUrl);
      setCustomErpBaseUrl(normalizedUrl);
      setErpConnectionPreference('custom');
      setCustomErpUrlState(normalizedUrl);
      setConnectionQrUrl(normalizedUrl);
      setConnectionSettingsError('');
    } catch (qrError) {
      setConnectionSettingsError(qrError instanceof Error ? qrError.message : 'Unable to generate the ERP connection QR.');
    }
  };

  const startConnectionQrScan = () => {
    setConnectionQrUrl('');
    setConnectionSettingsError('');
    connectionInputRef.current?.focus();
    window.QcmcScanner?.startScan?.();
  };

  useEffect(() => {
    if (!showConnectionSettings) return;
    const handleScannerData = (event: Event) => {
      const value = (event as CustomEvent<{ code?: string }>).detail?.code || '';
      if (value.trim()) applyScannedConnection(value);
    };
    window.addEventListener('qcmc-scanner-data', handleScannerData);
    window.setTimeout(() => connectionInputRef.current?.focus(), 0);
    return () => window.removeEventListener('qcmc-scanner-data', handleScannerData);
  }, [applyScannedConnection, showConnectionSettings]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .lp-root {
          font-family: 'Sora', sans-serif;
          min-height: 100vh;
          background: hsl(var(--background));
          display: flex;
          position: relative;
          overflow: hidden;
        }

        /* Ambient blobs */
        .lp-blob {
          position: fixed;
          border-radius: 50%;
          pointer-events: none;
          z-index: 0;
          filter: blur(80px);
        }
        .lp-blob-1 {
          width: 520px; height: 520px;
          top: -180px; left: -140px;
          background: radial-gradient(circle, hsl(var(--primary) / 0.18) 0%, transparent 70%);
        }
        .lp-blob-2 {
          width: 400px; height: 400px;
          bottom: -120px; right: -100px;
          background: radial-gradient(circle, hsl(var(--primary) / 0.12) 0%, transparent 70%);
        }
        .lp-blob-3 {
          width: 300px; height: 300px;
          top: 40%; left: 40%;
          background: radial-gradient(circle, hsl(var(--primary) / 0.06) 0%, transparent 70%);
        }

        /* ── Left panel ── */
        .lp-left {
          display: none;
          position: relative; z-index: 1;
          flex-direction: column;
          justify-content: center;
          padding: 56px 56px 56px 64px;
          width: 52%;
          border-right: 1px solid hsl(var(--border));
        }
        @media (min-width: 1024px) { .lp-left { display: flex; } }

        .lp-logo {
          display: flex; align-items: center; gap: 16px;
          margin-bottom: 52px;
        }
        .lp-logo-image {
          width: 88px;
          height: 88px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .lp-logo-name {
          font-size: 18px; font-weight: 700; color: hsl(var(--foreground));
          letter-spacing: -0.3px;
        }

        .lp-headline {
          font-size: 42px; font-weight: 800;
          color: hsl(var(--foreground));
          line-height: 1.15;
          letter-spacing: -1px;
          margin-bottom: 18px;
        }
        .lp-headline-grad {
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.7));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .lp-sub {
          font-size: 15px; color: hsl(var(--muted-foreground)); line-height: 1.7;
          max-width: 400px; margin-bottom: 44px;
        }

        .lp-features {
          display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
          max-width: 460px;
        }
        .lp-feature {
          background: hsl(var(--foreground) / 0.03);
          border: 1px solid hsl(var(--border));
          border-radius: 14px;
          padding: 18px 20px;
          transition: border-color 0.2s, background 0.2s;
        }
        .lp-feature:hover {
          background: hsl(var(--primary) / 0.05);
          border-color: hsl(var(--primary) / 0.2);
        }
        .lp-feature-icon {
          width: 34px; height: 34px; border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 12px;
        }
        .lp-feature-title { font-size: 13px; font-weight: 600; color: hsl(var(--foreground)); margin-bottom: 4px; }
        .lp-feature-desc  { font-size: 12px; color: hsl(var(--muted-foreground)); line-height: 1.5; }

        /* Divider line */
        .lp-divider {
          position: absolute; right: 0; top: 10%; bottom: 10%;
          width: 1px;
          background: linear-gradient(180deg, transparent, hsl(var(--primary) / 0.2), transparent);
        }

        /* ── Right panel ── */
        .lp-right {
          flex: 1;
          display: flex; align-items: center; justify-content: center;
          padding: 32px 24px;
          position: relative; z-index: 1;
        }

        .lp-form-wrap { width: 100%; max-width: 400px; }

        /* Mobile logo */
        .lp-mobile-logo {
          display: flex; align-items: center; justify-content: center; gap: 12px;
          margin-bottom: 32px;
        }
        @media (min-width: 1024px) { .lp-mobile-logo { display: none; } }
        .lp-mobile-logo .lp-logo-image {
          width: 72px;
          height: 72px;
        }

        /* Form card */
        .lp-card {
          background: hsl(var(--card));
          border: 1px solid hsl(var(--primary) / 0.15);
          border-radius: 20px;
          padding: 36px 32px;
          position: relative; overflow: hidden;
        }
        .lp-card::before {
          content: '';
          position: absolute; top: 0; left: 0; right: 0; height: 1px;
          background: linear-gradient(90deg, transparent, hsl(var(--primary) / 0.5), transparent);
        }

        .lp-card-title {
          font-size: 22px; font-weight: 700; color: hsl(var(--foreground));
          margin-bottom: 6px;
        }
        .lp-card-sub { font-size: 13px; color: hsl(var(--muted-foreground)); margin-bottom: 28px; }
        .lp-connection-toggle {
          width: 100%; min-height: 44px; margin: -12px 0 20px; padding: 8px 11px;
          border: 1px solid hsl(var(--border)); border-radius: 10px;
          background: hsl(var(--foreground) / 0.025); color: hsl(var(--foreground));
          display: flex; align-items: center; gap: 10px; text-align: left;
          font-family: 'Sora', sans-serif;
        }
        .lp-connection-toggle-copy { min-width: 0; flex: 1; }
        .lp-connection-toggle-label { display: block; font-size: 11px; color: hsl(var(--muted-foreground)); }
        .lp-connection-toggle-value { display: block; margin-top: 2px; font-size: 12px; font-weight: 700; }
        .lp-connection-backdrop {
          position: fixed; inset: 0; z-index: 100; padding: 18px;
          display: flex; align-items: center; justify-content: center;
          background: rgba(15, 23, 42, .52);
        }
        .lp-connection-dialog {
          width: min(100%, 390px); max-height: calc(100vh - 36px); overflow-y: auto;
          padding: 18px; border: 1px solid hsl(var(--border)); border-radius: 16px;
          background: hsl(var(--card)); box-shadow: 0 24px 70px rgba(15,23,42,.3);
        }
        .lp-connection-title { font-size: 18px; font-weight: 800; }
        .lp-connection-sub { margin-top: 5px; color: hsl(var(--muted-foreground)); font-size: 12px; line-height: 1.45; }
        .lp-custom-url { margin-top: 15px; }
        .lp-custom-url label { display: block; margin-bottom: 6px; color: hsl(var(--muted-foreground)); font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
        .lp-custom-url input { width: 100%; min-height: 44px; padding: 9px 11px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: 'JetBrains Mono', monospace; font-size: 12px; outline: none; }
        .lp-custom-url input:focus { border-color: hsl(var(--primary)); }
        .lp-connection-result { margin-top: 12px; padding: 9px 10px; border-radius: 9px; font-size: 11px; line-height: 1.4; }
        .lp-connection-result.is-ok { background: hsl(142 71% 45% / .1); color: hsl(142 64% 28%); }
        .lp-connection-result.is-error { background: hsl(var(--destructive) / .08); color: hsl(var(--destructive)); }
        .lp-connection-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 15px; }
        .lp-connection-action { min-height: 42px; border: 1px solid hsl(var(--border)); border-radius: 10px; background: hsl(var(--background)); color: hsl(var(--foreground)); font-family: 'Sora', sans-serif; font-size: 12px; font-weight: 700; }
        .lp-connection-action.is-primary { border-color: transparent; background: hsl(var(--primary)); color: white; }
        .lp-connection-qr-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; margin-top: 12px; }
        .lp-connection-action { display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 8px; }
        .lp-connection-qr-card { position: relative; margin-top: 14px; padding: 16px; border: 1px solid hsl(var(--border)); border-radius: 14px; background: white; text-align: center; }
        .lp-connection-qr-close { position: absolute; top: 7px; right: 7px; width: 30px; height: 30px; border: 0; border-radius: 8px; background: #f1f3f6; color: #14213d; display: grid; place-items: center; }
        .lp-connection-qr-image { display: block; width: min(100%, 220px); height: auto; margin: 0 auto; }
        .lp-connection-qr-label { margin-top: 10px; color: #14213d; font-size: 11px; font-weight: 800; }
        .lp-connection-qr-url { margin-top: 5px; color: #596579; font-family: 'JetBrains Mono', monospace; font-size: 10px; line-height: 1.4; overflow-wrap: anywhere; }
        .lp-connection-qr-help { margin-top: 7px; color: #6b7280; font-size: 10px; line-height: 1.4; }

        /* Error */
        .lp-error {
          background: hsl(var(--destructive) / 0.08);
          border: 1px solid hsl(var(--destructive) / 0.2);
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 13px; color: hsl(var(--destructive));
          margin-bottom: 20px;
        }
        .lp-info {
          background: hsl(var(--primary) / 0.08);
          border: 1px solid hsl(var(--primary) / 0.2);
          border-radius: 10px;
          padding: 11px 14px;
          font-size: 13px; color: hsl(var(--primary));
          margin-bottom: 20px;
        }

        /* Fields */
        .lp-field { margin-bottom: 18px; }
        .lp-label {
          display: block;
          font-size: 12px; font-weight: 600;
          text-transform: uppercase; letter-spacing: 0.06em;
          color: hsl(var(--muted-foreground)); margin-bottom: 8px;
        }
        .lp-input {
          width: 100%;
          padding: 11px 14px;
          background: hsl(var(--foreground) / 0.04);
          border: 1px solid hsl(var(--border));
          border-radius: 10px;
          color: hsl(var(--foreground)); font-size: 14px;
          outline: none; transition: border-color 0.2s, background 0.2s;
          font-family: 'Sora', sans-serif;
        }
        .lp-input::placeholder { color: hsl(var(--muted-foreground) / 0.8); }
        .lp-input:focus {
          border-color: hsl(var(--primary) / 0.5);
          background: hsl(var(--primary) / 0.05);
        }
        .lp-input-wrap { position: relative; }
        .lp-eye-btn {
          position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
          background: none; border: none; color: hsl(var(--muted-foreground)); cursor: pointer;
          transition: color 0.2s; padding: 4px;
          display: flex; align-items: center;
        }
        .lp-eye-btn:hover { color: hsl(var(--foreground)); }

        /* Submit */
        .lp-submit {
          width: 100%;
          margin-top: 8px;
          padding: 12px;
          background: linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.85));
          border: none; border-radius: 11px;
          color: white; font-size: 14px; font-weight: 600;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          transition: opacity 0.2s, transform 0.15s;
          font-family: 'Sora', sans-serif;
          box-shadow: 0 4px 16px hsl(var(--primary) / 0.3);
        }
        .lp-submit:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
        .lp-submit:active:not(:disabled) { transform: translateY(0); }
        .lp-submit:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes spin { to { transform: rotate(360deg); } }
        .lp-spin { animation: spin 0.8s linear infinite; }

        .lp-footer {
          text-align: center;
          font-size: 12px; color: hsl(var(--muted-foreground));
          margin-top: 20px;
        }

        /* Entrance animations */
        .lp-left  { animation: lpSlideR 0.6s cubic-bezier(0.16,1,0.3,1) both; }
        .lp-right { animation: lpSlideL 0.6s cubic-bezier(0.16,1,0.3,1) 0.1s both; }
        @keyframes lpSlideR { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes lpSlideL { from { opacity: 0; transform: translateX(20px);  } to { opacity: 1; transform: translateX(0); } }

        /* Readability baseline for warehouse operators. */
        .lp-card-sub, .lp-feature-desc, .lp-connection-toggle-label,
        .lp-connection-sub, .lp-connection-result, .lp-connection-qr-label,
        .lp-connection-qr-help, .lp-footer { font-size: 14px; line-height: 1.5; }
        .lp-connection-toggle-value, .lp-connection-action,
        .lp-custom-url input { font-size: 15px; }
        .lp-custom-url label, .lp-connection-qr-url { font-size: 12px; }
        .lp-submit, .lp-connection-action { min-height: 52px; font-size: 15px; }

      `}</style>

      <div className="lp-root">
        <div className="lp-blob lp-blob-1" />
        <div className="lp-blob lp-blob-2" />
        <div className="lp-blob lp-blob-3" />

        {/* ── Left panel ── */}
        <div className="lp-left">
          <div className="lp-divider" />

          <div className="lp-logo">
            <img src={appLogo} alt="QCMC Scanner logo" className="lp-logo-image" />
            <span className="lp-logo-name">QCMC Scanner</span>
          </div>

          <h1 className="lp-headline">
            Streamline Your<br />
            <span className="lp-headline-grad">Employee Check-ins</span>
          </h1>

          <p className="lp-sub">
            Fast, secure, and effortless time tracking with QR code scanning technology built for modern teams.
          </p>

          <div className="lp-features">
            {[
              { icon: <Zap size={16} color="#fbbf24" />, bg: 'rgba(251,191,36,0.1)',  title: 'Instant Scan', desc: 'Check in within seconds using QR codes' },
              { icon: <Shield size={16} color="#34d399" />, bg: 'rgba(52,211,153,0.1)', title: 'Secure', desc: 'Enterprise-grade security for your data' },
              { icon: <Users size={16} color="#818cf8" />,  bg: 'rgba(129,140,248,0.1)',title: 'Team View', desc: 'Real-time visibility of your team' },
              { icon: <Clock size={16} color="#a78bfa" />,  bg: 'rgba(167,139,250,0.1)',title: 'Time Tracking', desc: 'Accurate hours logging automatically' },
            ].map(({ icon, bg, title, desc }) => (
              <div className="lp-feature" key={title}>
                <div className="lp-feature-icon" style={{ background: bg }}>{icon}</div>
                <div className="lp-feature-title">{title}</div>
                <div className="lp-feature-desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="lp-right">
          <div className="lp-form-wrap">

            {/* Mobile logo */}
            <div className="lp-mobile-logo">
              <img src={appLogo} alt="QCMC Scanner logo" className="lp-logo-image" />
              <span className="lp-logo-name">QCMC Scanner</span>
            </div>

            <div className="lp-card">
              <div className="lp-card-title">Welcome back</div>
              <div className="lp-card-sub">Sign in to your account to continue</div>

              <button type="button" className="lp-connection-toggle" onClick={() => setShowConnectionSettings(true)} disabled={isLoading}>
                <Settings2 size={17} />
                  <span className="lp-connection-toggle-copy">
                  <span className="lp-connection-toggle-label">ERP connection</span>
                  <span className="lp-connection-toggle-value">Custom ERP URL</span>
                </span>
                <Wifi size={16} />
              </button>

              {offlineMessage && <div className="lp-info">{offlineMessage}</div>}
              {error && <div className="lp-error">{error}</div>}

              <form onSubmit={handleSubmit}>
                <div className="lp-field">
                  <label className="lp-label">Email Address</label>
                  <input
                    type="email"
                    className="lp-input"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoComplete="email"
                  />
                </div>

                <div className="lp-field">
                  <label className="lp-label">Password</label>
                  <div className="lp-input-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="lp-input"
                      style={{ paddingRight: 40 }}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="lp-eye-btn"
                      onClick={() => setShowPassword(p => !p)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="lp-submit" disabled={isLoading}>
                  {isLoading
                    ? <><Loader2 size={16} className="lp-spin" /> Signing in…</>
                    : 'Sign In'
                  }
                </button>
              </form>
            </div>

            <p className="lp-footer">© 2026 QCMC Scanner. All rights reserved.</p>
          </div>
        </div>
      </div>

      {showConnectionSettings && (
        <div className="lp-connection-backdrop" onClick={closeConnectionSettings}>
          <div className="lp-connection-dialog" role="dialog" aria-modal="true" aria-labelledby="erp-connection-title" onClick={event => event.stopPropagation()}>
            <div id="erp-connection-title" className="lp-connection-title">ERP Connection</div>
            <div className="lp-connection-sub">Type the ERP server this device should use.</div>
            <div className="lp-custom-url">
              <label htmlFor="custom-erp-url">ERP base URL</label>
              <input
                ref={connectionInputRef}
                id="custom-erp-url"
                type="url"
                value={customErpUrl}
                onChange={event => { setCustomErpUrlState(event.target.value); setConnectionQrUrl(''); setConnectionSettingsError(''); setConnectionTest({ loading: false }); }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    applyScannedConnection(event.currentTarget.value);
                  }
                }}
                placeholder="http://qcmc.qcstyro.com"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div className="lp-connection-qr-actions">
              <button type="button" className="lp-connection-action" onClick={generateConnectionQr}>
                <QrCode size={16} /> Generate QR
              </button>
              <button type="button" className="lp-connection-action" onClick={startConnectionQrScan}>
                <ScanLine size={16} /> Scan URL QR
              </button>
            </div>
            {connectionQrUrl && (
              <div className="lp-connection-qr-card">
                <button type="button" className="lp-connection-qr-close" aria-label="Close connection QR" onClick={() => setConnectionQrUrl('')}><X size={16} /></button>
                <QRCodeSVG className="lp-connection-qr-image" value={connectionQrUrl} size={220} level="M" marginSize={2} />
                <div className="lp-connection-qr-label">QCMC Scanner ERP Connection</div>
                <div className="lp-connection-qr-url">{connectionQrUrl}</div>
                <div className="lp-connection-qr-help">On another scanner, open ERP Connection and scan this QR.</div>
              </div>
            )}
            {connectionSettingsError && <div className="lp-connection-result is-error">{connectionSettingsError}</div>}
            {connectionTest.message && (
              <div className={`lp-connection-result ${connectionTest.ok ? 'is-ok' : 'is-error'}`}>{connectionTest.message}</div>
            )}
            <div className="lp-connection-actions">
              <button type="button" className="lp-connection-action" onClick={() => void testConnection()} disabled={connectionTest.loading}>
                {connectionTest.loading ? 'Testing…' : 'Test connection'}
              </button>
              <button type="button" className="lp-connection-action is-primary" onClick={closeConnectionSettings}>Done</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LoginPage;
