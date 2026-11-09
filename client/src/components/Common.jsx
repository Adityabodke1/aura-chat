import React, { useEffect } from 'react';
import { initials } from '../utils.js';
import { XIcon, AuraLogo } from './Icons.jsx';

export function Avatar({ user, size = 32, status, className = '', ring = false }) {
  const name = user?.username || '?';
  return (
    <div
      className={`avatar ${ring ? 'avatar-ring' : ''} ${className}`}
      style={{
        width: size,
        height: size,
        background: user?.avatarColor || '#5865F2',
        fontSize: Math.max(10, Math.round(size * 0.37)),
      }}
      title={name}
    >
      <span>{initials(name)}</span>
      {status !== undefined && (
        <span
          className={`status-dot ${status ? 'online' : 'offline'}`}
          style={{ width: Math.max(8, size * 0.3), height: Math.max(8, size * 0.3) }}
        />
      )}
    </div>
  );
}

export function BrandMark({ size = 30 }) {
  return (
    <span className="brand-mark" style={{ width: size + 10, height: size + 10 }}>
      <AuraLogo size={size} />
    </span>
  );
}

export function Modal({ title, subtitle, onClose, children, maxWidth = 440, className = '' }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className={`modal ${className}`} style={{ maxWidth }} role="dialog" aria-modal="true">
        <button className="modal-close" onClick={onClose} aria-label="Close" data-tooltip="Close">
          <XIcon size={18} />
        </button>
        {title && (
          <div className="modal-head">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Spinner({ size = 20, className = '' }) {
  return <span className={`spinner ${className}`} style={{ width: size, height: size }} />;
}

export function EmptyArt({ variant = 'friends' }) {
  if (variant === 'chat') {
    return (
      <svg viewBox="0 0 120 90" className="empty-art" aria-hidden="true">
        <rect x="18" y="22" width="84" height="50" rx="12" fill="#2b2d31" />
        <path d="M32 72 26 86l18-8" fill="#2b2d31" />
        <circle cx="46" cy="47" r="4" fill="#5865F2" />
        <circle cx="60" cy="47" r="4" fill="#5865F2" opacity="0.7" />
        <circle cx="74" cy="47" r="4" fill="#5865F2" opacity="0.4" />
      </svg>
    );
  }
  if (variant === 'pending') {
    return (
      <svg viewBox="0 0 120 90" className="empty-art" aria-hidden="true">
        <circle cx="60" cy="34" r="18" fill="#5865F2" opacity="0.25" />
        <circle cx="60" cy="34" r="9" fill="#5865F2" />
        <path d="M30 76c0-14 13-24 30-24s30 10 30 24" stroke="#5865F2" strokeWidth="6" fill="none" strokeLinecap="round" opacity="0.4" />
        <path d="M84 18h16M92 10v16" stroke="#57F287" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 120 90" className="empty-art" aria-hidden="true">
      <circle cx="42" cy="38" r="15" fill="#5865F2" opacity="0.8" />
      <circle cx="78" cy="38" r="15" fill="#EB459E" opacity="0.65" />
      <path d="M22 76c0-12 9-20 20-20s20 8 20 20" fill="#5865F2" opacity="0.25" />
      <path d="M58 76c0-12 9-20 20-20s20 8 20 20" fill="#EB459E" opacity="0.2" />
    </svg>
  );
}
