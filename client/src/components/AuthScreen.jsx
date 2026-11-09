import React, { useState } from 'react';
import { api } from '../api.js';
import { Spinner, BrandMark } from './Common.jsx';
import { EyeIcon, EyeOffIcon, SparklesIcon, LockIcon, VideoIcon, MessageIcon, ShieldIcon } from './Icons.jsx';

export default function AuthScreen({ onAuth, notice }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [loading, setLoading] = useState(false);

  const fail = (message) => {
    setError(message);
    setShake((n) => n + 1);
  };

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setConfirm('');
  };

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setError('');

    const clean = username.trim();
    if (!/^[a-zA-Z0-9_.]{3,20}$/.test(clean)) {
      return fail('Username must be 3–20 characters (letters, numbers, dots or underscores).');
    }
    if (password.length < 6) return fail('Password must be at least 6 characters.');
    if (mode === 'register' && password !== confirm) return fail('Passwords do not match.');

    setLoading(true);
    try {
      const data =
        mode === 'login' ? await api.login(clean, password) : await api.register(clean, password);
      onAuth(data.token, data);
    } catch (err) {
      fail(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-bg" aria-hidden="true">
        <span className="orb orb-a" />
        <span className="orb orb-b" />
        <span className="orb orb-c" />
        <span className="auth-grid" />
      </div>

      <div className="auth-brand-top">
        <BrandMark size={28} />
        <span>Aura</span>
      </div>

      <div className="auth-card" key={shake}>
        <aside className="auth-art">
          <div className="auth-art-inner">
            <span className="auth-eyebrow">
              <SparklesIcon size={15} /> A calmer place to hang out
            </span>
            <h1>
              Your people.
              <br />
              Your rooms.
              <br />
              <em>Your aura.</em>
            </h1>
            <p>
              Drop into private spaces with a six-digit code. Share moments, talk all night, and see
              each other while you do it.
            </p>

            <ul className="auth-features">
              <li>
                <span className="auth-feature-icon">
                  <MessageIcon size={16} />
                </span>
                Real-time chat with photos &amp; videos
              </li>
              <li>
                <span className="auth-feature-icon">
                  <LockIcon size={16} />
                </span>
                OTP-locked rooms — invite only
              </li>
              <li>
                <span className="auth-feature-icon">
                  <VideoIcon size={16} />
                </span>
                Voice &amp; video calls built in
              </li>
            </ul>

            <div className="auth-art-glow" aria-hidden="true" />
          </div>
        </aside>

        <section className="auth-form-wrap">
          <div className="auth-form-head">
            <h2>{mode === 'login' ? 'Welcome back!' : 'Create your account'}</h2>
            <p>
              {mode === 'login'
                ? 'We’re so excited to see you again.'
                : 'Pick a username and a password. No email, ever.'}
            </p>
          </div>

          {notice && !error && <div className="auth-notice">{notice}</div>}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <label className="field">
              <span className="field-label">
                Username <b>*</b>
              </span>
              <div className="field-input-wrap">
                <input
                  autoFocus
                  autoComplete="username"
                  aria-label="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username"
                  maxLength={20}
                  spellCheck={false}
                />
              </div>
              {mode === 'register' && (
                <span className="field-hint">3–20 chars · letters, numbers, dots, underscores</span>
              )}
            </label>

            <label className="field">
              <span className="field-label">
                Password <b>*</b>
              </span>
              <div className="field-input-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  aria-label="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  maxLength={128}
                />
                <button
                  type="button"
                  className="field-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
                </button>
              </div>
            </label>

            {mode === 'register' && (
              <label className="field">
                <span className="field-label">
                  Confirm password <b>*</b>
                </span>
                <div className="field-input-wrap">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    aria-label="Confirm password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="••••••••"
                    maxLength={128}
                  />
                </div>
              </label>
            )}

            <button className="btn btn-primary auth-submit" disabled={loading} type="submit">
              {loading ? <Spinner size={18} /> : mode === 'login' ? 'Log In' : 'Create Account'}
            </button>

            <p className="auth-switch">
              {mode === 'login' ? 'New around here?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Create an account' : 'Log in'}
              </button>
            </p>
          </form>

          <div className="auth-foot">
            <ShieldIcon size={13} />
            Passwords are salted &amp; hashed. Rooms stay invite-only.
          </div>
        </section>
      </div>

      <p className="auth-legal">
        Aura is a self-hosted chat app. No tracking, no email, no nonsense.
      </p>
    </div>
  );
}
