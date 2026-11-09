import React from 'react';
import { CheckIcon, XIcon } from './Icons.jsx';

export function Toasts({ toasts, dismiss }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind || 'info'}`}>
          <span className="toast-icon">
            {toast.kind === 'error' ? <XIcon size={15} /> : <CheckIcon size={15} />}
          </span>
          <span className="toast-text">{toast.message}</span>
          <button className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <XIcon size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
