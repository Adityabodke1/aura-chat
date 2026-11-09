import React, { useState } from 'react';
import { api } from '../api.js';
import { Avatar, EmptyArt, Spinner } from './Common.jsx';
import {
  CheckIcon,
  LockIcon,
  MenuIcon,
  MessageIcon,
  PhoneIcon,
  UserPlusIcon,
  XIcon,
} from './Icons.jsx';
import { dmChannelId } from '../utils.js';

const TABS = [
  { id: 'online', label: 'Online' },
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
];

export default function FriendsView({
  boot,
  me,
  onlineSet,
  tab,
  setTab,
  onOpenDm,
  onStartCall,
  onToast,
  onOpenSidebar,
}) {
  const [query, setQuery] = useState('');
  const [username, setUsername] = useState('');
  const [addState, setAddState] = useState({ type: 'idle', message: '' });
  const [responding, setResponding] = useState(null);

  const pendingCount = boot.incoming.length;
  const onlineFriends = boot.friends.filter((f) => onlineSet.has(f.id));
  const source = tab === 'online' ? onlineFriends : boot.friends;
  const friends = query.trim()
    ? source.filter((f) => f.username.toLowerCase().includes(query.trim().toLowerCase()))
    : source;

  async function addFriend(event) {
    event.preventDefault();
    if (!username.trim() || addState.type === 'loading') return;
    setAddState({ type: 'loading', message: '' });
    try {
      const result = await api.addFriend(username.trim());
      setAddState({
        type: 'success',
        message:
          result.status === 'accepted'
            ? `You're now friends with ${result.user?.username || username.trim()}!`
            : `Friend request sent to ${username.trim()}.`,
      });
      setUsername('');
    } catch (err) {
      setAddState({ type: 'error', message: err.message });
    }
  }

  async function respond(request, action) {
    setResponding(`${request.id}:${action}`);
    try {
      await api.respondFriend(request.id, action);
      // The server sends friend:accepted / friends:changed over the socket; App
      // shows the toast and refreshes the friend lists from there.
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setResponding(null);
    }
  }

  return (
    <main className="friends-view">
      <header className="friends-header">
        <button className="mobile-menu icon-btn" onClick={onOpenSidebar} aria-label="Open menu">
          <MenuIcon size={20} />
        </button>
        <h1>Friends</h1>
        <nav className="friends-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`friends-tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'pending' && pendingCount > 0 && (
                <span className="tab-badge">{pendingCount}</span>
              )}
            </button>
          ))}
          <button
            className={`friends-tab add-tab ${tab === 'add' ? 'active' : ''}`}
            onClick={() => setTab('add')}
          >
            Add Friend
          </button>
        </nav>
        <div className="friends-header-actions">
          <button
            className="header-icon-btn"
            onClick={() => setTab('add')}
            data-tooltip="Add a friend"
            aria-label="Add a friend"
          >
            <UserPlusIcon size={20} />
          </button>
        </div>
      </header>

      {tab !== 'add' && (
        <div className="friends-body">
          <div className="friends-toolbar">
            <span className="friends-section-label">
              {tab === 'online' ? `Online — ${onlineFriends.length}` : tab === 'all' ? `All Friends — ${boot.friends.length}` : 'Pending Requests'}
            </span>
            <div className="friends-search">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search friends"
                aria-label="Search friends"
              />
            </div>
          </div>

          {tab === 'pending' ? (
            <div className="pending-wrap">
              {boot.incoming.length > 0 && (
                <section>
                  <div className="member-group-label">Incoming — {boot.incoming.length}</div>
                  {boot.incoming.map((request) => (
                    <div className="friend-row pending-row" key={request.id}>
                      <Avatar user={request.user} size={40} status={onlineSet.has(request.user.id)} />
                      <div className="friend-meta">
                        <b>{request.user.username}</b>
                        <span>Incoming friend request</span>
                      </div>
                      <div className="pending-actions">
                        <button
                          className="pending-btn accept"
                          onClick={() => respond(request, 'accept')}
                          disabled={Boolean(responding)}
                          aria-label={`Accept ${request.user.username}`}
                        >
                          {responding === `${request.id}:accept` ? (
                            <Spinner size={16} />
                          ) : (
                            <CheckIcon size={18} />
                          )}
                        </button>
                        <button
                          className="pending-btn decline"
                          onClick={() => respond(request, 'decline')}
                          disabled={Boolean(responding)}
                          aria-label={`Decline ${request.user.username}`}
                        >
                          {responding === `${request.id}:decline` ? (
                            <Spinner size={16} />
                          ) : (
                            <XIcon size={18} />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              {boot.outgoing.length > 0 && (
                <section>
                  <div className="member-group-label">Outgoing — {boot.outgoing.length}</div>
                  {boot.outgoing.map((request) => (
                    <div className="friend-row pending-row" key={request.id}>
                      <Avatar user={request.user} size={40} status={onlineSet.has(request.user.id)} />
                      <div className="friend-meta">
                        <b>{request.user.username}</b>
                        <span>Outgoing friend request</span>
                      </div>
                      <span className="pending-pill">Pending</span>
                    </div>
                  ))}
                </section>
              )}

              {boot.incoming.length === 0 && boot.outgoing.length === 0 && (
                <div className="friends-empty">
                  <EmptyArt variant="pending" />
                  <h3>No pending requests</h3>
                  <p>Friend requests you send or receive will show up here.</p>
                </div>
              )}
            </div>
          ) : friends.length === 0 ? (
            <div className="friends-empty">
              <EmptyArt variant="friends" />
              <h3>
                {query
                  ? 'No friends match that search'
                  : tab === 'online'
                    ? 'No one is online right now'
                    : 'Your friend list is looking empty'}
              </h3>
              <p>
                {tab === 'online'
                  ? 'When your friends hop online, you’ll see them here.'
                  : 'Add a friend with their exact username to start chatting.'}
              </p>
              <button className="btn btn-primary" onClick={() => setTab('add')}>
                <UserPlusIcon size={16} /> Add a friend
              </button>
            </div>
          ) : (
            <div className="friend-list">
              {tab === 'all' && onlineFriends.length === 0 && (
                <div className="member-group-label">All — {friends.length}</div>
              )}
              {friends.map((friend) => {
                const online = onlineSet.has(friend.id);
                return (
                  <div
                    key={friend.id}
                    className={`friend-row ${online ? '' : 'is-offline'}`}
                    onClick={() => onOpenDm(friend)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onOpenDm(friend);
                    }}
                  >
                    <Avatar user={friend} size={40} status={online} />
                    <div className="friend-meta">
                      <b>
                        {friend.username}
                        {friend.id === me.id ? ' (you)' : ''}
                      </b>
                      <span>{online ? 'Online' : 'Offline'}</span>
                    </div>
                    <div className="friend-actions">
                      <button
                        className="friend-action"
                        title="Voice call"
                        disabled={!online}
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartCall?.(dmChannelId(me.id, friend.id), { video: false });
                        }}
                      >
                        <PhoneIcon size={18} />
                      </button>
                      <button
                        className="friend-action"
                        title="Message"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDm(friend);
                        }}
                      >
                        <MessageIcon size={18} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'add' && (
        <div className="friends-body add-friend-body">
          <div className="add-friend-card">
            <h2>Add Friend</h2>
            <p>You can add friends with their exact username. It’s case-insensitive.</p>

            <form className="add-friend-form" onSubmit={addFriend}>
              <input
                autoFocus
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (addState.type !== 'idle') setAddState({ type: 'idle', message: '' });
                }}
                placeholder="Enter a username"
                maxLength={20}
                spellCheck={false}
                aria-label="Username to add"
              />
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!username.trim() || addState.type === 'loading'}
              >
                {addState.type === 'loading' ? <Spinner size={16} /> : 'Send Friend Request'}
              </button>
            </form>

            {addState.message && (
              <div className={`add-friend-feedback ${addState.type}`}>
                {addState.type === 'error' ? <XIcon size={15} /> : <CheckIcon size={15} />}
                {addState.message}
              </div>
            )}

            <div className="add-friend-tip">
              <LockIcon size={16} />
              <div>
                <b>No email, no phone number.</b>
                <span>
                  Aura accounts are just a username and password. Usernames are unique and can be
                  3–20 characters.
                </span>
              </div>
            </div>

            {boot.outgoing.length > 0 && (
              <div className="add-friend-outgoing">
                <div className="member-group-label">Pending — {boot.outgoing.length}</div>
                {boot.outgoing.map((request) => (
                  <div className="pending-mini" key={request.id}>
                    <Avatar user={request.user} size={26} />
                    <span>{request.user.username}</span>
                    <span className="pending-pill">Pending</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
