import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { Avatar, Modal, Spinner } from './Common.jsx';
import {
  CheckIcon,
  CopyIcon,
  CrownIcon,
  LogOutIcon,
  RefreshIcon,
  ShieldIcon,
  XIcon,
} from './Icons.jsx';
import { formatBytes, initials, roomAccent } from '../utils.js';
import { THEMES } from '../theme.js';

/* ---------------------------------------------------------------- */
/*  Create room                                                     */
/* ---------------------------------------------------------------- */

export function CreateRoomModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (loading) return;
    if (name.trim().length < 2) {
      setError('Give your room a name (at least 2 characters).');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { room } = await api.createRoom(name.trim());
      onCreated(room);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title="Create a room"
      subtitle="Your room gets its own 6-digit invite code. Only people with the code can join."
      onClose={onClose}
      maxWidth={460}
    >
      <form onSubmit={submit} className="modal-form">
        <div className="create-room-preview">
          <span className="create-room-icon" style={{ background: roomAccent(name || 'Room') }}>
            {initials(name || 'Room')}
          </span>
          <div>
            <b>{name.trim() || 'Your new room'}</b>
            <span>Invite-only · text, voice &amp; video</span>
          </div>
        </div>

        <label className="field">
          <span className="field-label">
            Room name <b>*</b>
          </span>
          <div className="field-input-wrap">
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError('');
              }}
              placeholder="Late night crew"
              maxLength={30}
            />
          </div>
        </label>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={loading || name.trim().length < 2}>
            {loading ? <Spinner size={16} /> : 'Create Room'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- */
/*  Join room                                                       */
/* ---------------------------------------------------------------- */

export function JoinRoomModal({ onClose, onJoined, onToast }) {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(event) {
    event?.preventDefault();
    if (otp.length !== 6 || loading) return;
    setLoading(true);
    setError('');
    try {
      const { room } = await api.joinRoom(otp);
      onToast?.(`Welcome to ${room.name}.`, 'info');
      onJoined(room);
    } catch (err) {
      setError(err.message);
      setOtp('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      title="Join a room"
      subtitle="Enter the 6-digit code someone shared with you."
      onClose={onClose}
      maxWidth={460}
      className="join-room-modal"
    >
      <form onSubmit={submit} className="modal-form">
        <OtpInput value={otp} onChange={setOtp} disabled={loading} error={Boolean(error)} />
        {error && <div className="form-error shake">{error}</div>}
        <button className="btn btn-primary btn-full" type="submit" disabled={otp.length !== 6 || loading}>
          {loading ? <Spinner size={16} /> : 'Join Room'}
        </button>
        <p className="modal-hint">Codes are six numbers. Ask the room owner if you don’t have one.</p>
      </form>
    </Modal>
  );
}

function OtpInput({ value, onChange, disabled, error }) {
  const refs = useRef([]);
  const [digits, setDigits] = useState(Array(6).fill(''));

  useEffect(() => {
    if (!value) setDigits(Array(6).fill(''));
  }, [value]);

  function update(next, focusIndex) {
    setDigits(next);
    onChange(next.join(''));
    if (typeof focusIndex === 'number') {
      refs.current[Math.max(0, Math.min(5, focusIndex))]?.focus();
    }
  }

  function handleChange(index, raw) {
    const chars = raw.replace(/\D/g, '');
    if (!chars) {
      const next = [...digits];
      next[index] = '';
      update(next, index);
      return;
    }
    const next = [...digits];
    let cursor = index;
    for (const ch of chars.slice(0, 6 - index)) {
      next[cursor] = ch;
      cursor += 1;
    }
    update(next, Math.min(cursor, 5));
  }

  function handleKeyDown(index, event) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault();
      const next = [...digits];
      next[index - 1] = '';
      update(next, index - 1);
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event) {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = Array(6).fill('');
    for (let i = 0; i < pasted.length; i += 1) next[i] = pasted[i];
    update(next, Math.min(pasted.length, 5));
  }

  return (
    <div className={`otp-input ${error ? 'has-error' : ''}`} onPaste={handlePaste}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={1}
          disabled={disabled}
          aria-label={`Room code digit ${index + 1}`}
        />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/*  Room info                                                       */
/* ---------------------------------------------------------------- */

export function RoomInfoModal({ room, me, onClose, onRegenerated, onLeft, onToast }) {
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const isOwner = room.ownerId === me.id;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(room.otp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
      onToast?.('Room code copied — send it to a friend.', 'info');
    } catch {
      onToast?.('Could not copy the code.', 'error');
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      await api.regenerateOtp(room.id);
      onRegenerated?.();
      onToast?.('New room code generated.', 'info');
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setRegenerating(false);
    }
  }

  async function leave() {
    if (!confirmLeave) {
      setConfirmLeave(true);
      return;
    }
    setLeaving(true);
    try {
      await api.leaveRoom(room.id);
      onLeft?.();
    } catch (err) {
      onToast?.(err.message, 'error');
      setLeaving(false);
    }
  }

  return (
    <Modal
      title={room.name}
      subtitle={`${room.members.length} member${room.members.length === 1 ? '' : 's'} · created by ${
        room.members.find((m) => m.id === room.ownerId)?.username || 'unknown'
      }`}
      onClose={onClose}
      maxWidth={500}
    >
      <div className="room-info-code">
        <span className="room-info-label">
          <ShieldIcon size={14} /> Room code · invite only
        </span>
        <div className="room-info-digits">
          <span>{room.otp.slice(0, 3)}</span>
          <span className="code-gap">—</span>
          <span>{room.otp.slice(3)}</span>
        </div>
        <div className="room-info-code-actions">
          <button className="btn btn-primary" onClick={copyCode}>
            {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
            {copied ? 'Copied!' : 'Copy code'}
          </button>
          {isOwner && (
            <button className="btn btn-secondary" onClick={regenerate} disabled={regenerating}>
              {regenerating ? <Spinner size={16} /> : <RefreshIcon size={16} />}
              New code
            </button>
          )}
        </div>
        <p>Anyone with this code can join the room. Changing it locks out the old code.</p>
      </div>

      <div className="room-info-members">
        <div className="member-group-label">Members — {room.members.length}</div>
        <div className="room-info-member-list">
          {room.members.map((member) => (
            <div className="room-info-member" key={member.id}>
              <Avatar user={member} size={26} />
              <span>{member.username}</span>
              {member.id === room.ownerId && (
                <span className="owner-tag">
                  <CrownIcon size={11} /> Owner
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="modal-actions spread">
        <button
          className={`btn ${confirmLeave ? 'btn-danger' : 'btn-secondary'}`}
          onClick={leave}
          disabled={leaving}
        >
          {leaving ? <Spinner size={16} /> : confirmLeave ? 'Click again to leave' : 'Leave room'}
        </button>
        <button className="btn btn-secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- */
/*  Settings                                                        */
/* ---------------------------------------------------------------- */

export function SettingsModal({
  user,
  soundOn,
  theme,
  onThemeChange,
  onSoundChange,
  onLogout,
  onClose,
  onToast,
}) {
  const [copied, setCopied] = useState(false);

  async function copyUsername() {
    try {
      await navigator.clipboard.writeText(user.username);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onToast?.('Username copied.', 'info');
    } catch {
      /* ignore */
    }
  }

  return (
    <Modal title="User Settings" onClose={onClose} maxWidth={480} className="settings-modal">
      <div className="settings-profile">
        <Avatar user={user} size={64} status />
        <div className="settings-profile-info">
          <h3>{user.username}</h3>
          <button className="settings-copy" onClick={copyUsername}>
            {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
            {copied ? 'Copied' : 'Copy username'}
          </button>
          <span className="settings-joined">
            Member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Preferences</div>
        <div className="settings-row">
          <div>
            <b>Color aura</b>
            <span>Recolor the glow, accents and gradients</span>
          </div>
          <div className="theme-swatches" role="radiogroup" aria-label="Color theme">
            {THEMES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`theme-swatch ${theme === entry.id ? 'active' : ''}`}
                onClick={() => onThemeChange?.(entry.id)}
                role="radio"
                aria-checked={theme === entry.id}
                aria-label={`${entry.name} theme`}
                title={`${entry.name} · ${entry.note}`}
                style={{ '--swatch-a': entry.accent, '--swatch-b': entry.accent2 }}
              >
                <span />
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <div>
            <b>Sound effects</b>
            <span>Message pops, call tones and join sounds</span>
          </div>
          <button
            className={`switch ${soundOn ? 'on' : ''}`}
            onClick={() => onSoundChange(!soundOn)}
            role="switch"
            aria-checked={soundOn}
            aria-label="Toggle sound effects"
          >
            <span />
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Account</div>
        <div className="settings-row">
          <div>
            <b>Log out</b>
            <span>You can log back in with your username and password</span>
          </div>
          <button className="btn btn-danger-outline" onClick={onLogout}>
            <LogOutIcon size={15} /> Log Out
          </button>
        </div>
      </div>

      <div className="settings-foot">Aura Chat · v1.1 · voice &amp; video powered by WebRTC</div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- */
/*  Image lightbox                                                  */
/* ---------------------------------------------------------------- */

export function ImageLightbox({ attachment, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [onClose]);

  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <img src={attachment.url} alt={attachment.name} />
      <div className="lightbox-meta">
        <span>{attachment.name}</span>
        <span>{formatBytes(attachment.size)}</span>
      </div>
      <button className="lightbox-close" onClick={onClose} aria-label="Close image">
        <XIcon size={20} />
      </button>
    </div>
  );
}
