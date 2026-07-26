'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/auth-store';
import { createClient } from '@/lib/graphql-client';
import { useEventStore } from '@/lib/event-store';
import {
  USERS_QUERY,
  CREATE_USER_MUTATION,
  ASSIGN_EVENT_ROLE_MUTATION,
  REMOVE_EVENT_ROLE_MUTATION,
  DELETE_USER_MUTATION,
  RESET_USER_PASSWORD_MUTATION,
} from '@/lib/queries';

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
};

/** Global roles, from the Role enum in schema.gql. */
const GLOBAL_ROLES = [
  'ADMIN',
  'COORDINATOR',
  'PANEL_CHAIR',
  'AUDITOR',
  'JUDGE',
  'TEAM_REP',
] as const;

/** Per-event roles, from the EventRole enum. Narrower than the global list. */
const EVENT_ROLES = ['ADMIN', 'COORDINATOR', 'PANEL_CHAIR', 'AUDITOR'] as const;

const ROLES_THAT_MANAGE_USERS = ['SUPER_ADMIN', 'ADMIN'];

/** Strips the `[GraphQL] ` prefix urql puts on server errors. */
function cleanError(message: string) {
  return message.split('] ').pop() ?? message;
}

const ROLE_TONE: Record<string, string> = {
  SUPER_ADMIN: 'bg-[#7c3aed]/15 text-[#a78bfa] ring-[#7c3aed]/25',
  ADMIN: 'bg-sky-500/10 text-sky-300 ring-sky-400/20',
  COORDINATOR: 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20',
  PANEL_CHAIR: 'bg-amber-500/10 text-amber-300 ring-amber-400/20',
  AUDITOR: 'bg-white/[0.05] text-[#8694a8] ring-white/10',
};

function roleTone(role: string) {
  return ROLE_TONE[role] ?? 'bg-white/[0.05] text-[#8694a8] ring-white/10';
}

export default function UsersPage() {
  const token = useAuthStore((s) => s.token);
  const currentUser = useAuthStore((s) => s.user);
  const eventId = useEventStore((s) => s.eventId);
  const event = useEventStore((s) => s.event);

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    phone: '',
    globalRole: 'COORDINATOR',
  });

  /** Per-row selection for the event role dropdowns. */
  const [roleChoice, setRoleChoice] = useState<Record<string, string>>({});

  const canManage = ROLES_THAT_MANAGE_USERS.includes(currentUser?.role ?? '');

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await createClient(token).query(USERS_QUERY, {}).toPromise();
      if (res.error) {
        setError(cleanError(res.error.message));
        return;
      }
      setUsers(res.data?.users ?? []);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load users');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (canManage) load();
    else setLoading(false);
  }, [canManage, load]);

  /** Runs a mutation, surfaces errors, and refreshes on success. */
  const run = async (
    key: string,
    query: string,
    variables: Record<string, any>,
    successMessage: string,
    refresh = true,
  ) => {
    if (!token) return;
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await createClient(token).mutation(query, variables).toPromise();
      if (res.error) {
        setError(cleanError(res.error.message));
        return;
      }
      setNotice(successMessage);
      if (refresh) await load();
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const createUser = async () => {
    if (!form.email || !form.name || !form.password) {
      setError('Email, name, and password are all required.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    await run(
      'create',
      CREATE_USER_MUTATION,
      {
        input: {
          email: form.email.trim(),
          name: form.name.trim(),
          password: form.password,
          phone: form.phone.trim() || undefined,
          globalRole: form.globalRole,
        },
      },
      `Created ${form.email.trim()}.`,
    );
    setForm({ email: '', name: '', password: '', phone: '', globalRole: 'COORDINATOR' });
    setShowCreate(false);
  };

  const assignRole = (user: User) => {
    if (!eventId) return;
    const role = roleChoice[user.id] ?? EVENT_ROLES[1];
    return run(
      `assign-${user.id}`,
      ASSIGN_EVENT_ROLE_MUTATION,
      { input: { userId: user.id, eventId, role } },
      `${user.name || user.email} is now ${role} on ${event?.name ?? 'this event'}.`,
      false,
    );
  };

  const removeRole = (user: User) => {
    if (!eventId) return;
    return run(
      `remove-${user.id}`,
      REMOVE_EVENT_ROLE_MUTATION,
      { userId: user.id, eventId },
      `Removed ${user.name || user.email} from ${event?.name ?? 'this event'}.`,
      false,
    );
  };

  const resetPassword = (user: User) => {
    const newPassword = window.prompt(`New password for ${user.email}:`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    return run(
      `reset-${user.id}`,
      RESET_USER_PASSWORD_MUTATION,
      { userId: user.id, newPassword },
      `Password reset for ${user.email}.`,
      false,
    );
  };

  const deleteUser = (user: User) => {
    if (!window.confirm(`Delete ${user.email}? This cannot be undone.`)) return;
    return run(`delete-${user.id}`, DELETE_USER_MUTATION, { userId: user.id }, `Deleted ${user.email}.`);
  };

  if (!canManage) {
    return (
      <div className="rounded-xl border border-dark-600 bg-dark-800/50 p-8">
        <h1 className="text-lg font-semibold text-white">Users &amp; roles</h1>
        <p className="mt-2 text-sm text-slate-400">
          Managing users requires an admin account. Ask an administrator if you need access.
        </p>
      </div>
    );
  }

  const inputClass =
    'w-full rounded-lg border border-dark-500 bg-dark-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 outline-none focus:border-[#7c3aed]/50';

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Users &amp; roles</h1>
          <p className="mt-1 text-sm text-slate-400">
            {event?.name
              ? `Event roles apply to ${event.name}.`
              : 'Select an event in the sidebar to assign event roles.'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-lg shadow-accent/20 hover:bg-accent/90"
        >
          {showCreate ? 'Cancel' : 'Add user'}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {showCreate && (
        <div className="mb-6 rounded-xl border border-dark-600 bg-dark-800/80 p-6">
          <h3 className="mb-4 text-sm font-semibold text-white">New user</h3>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Full name</label>
              <input
                className={`mt-1 ${inputClass}`}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Priya Menon"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Email</label>
              <input
                type="email"
                className={`mt-1 ${inputClass}`}
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="priya@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Temporary password
              </label>
              <input
                type="text"
                className={`mt-1 ${inputClass}`}
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Share this with the person and ask them to change it.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">
                Phone (optional)
              </label>
              <input
                className={`mt-1 ${inputClass}`}
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+6591234567"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Global role</label>
              <select
                className={`mt-1 ${inputClass}`}
                value={form.globalRole}
                onChange={(e) => setForm((f) => ({ ...f, globalRole: e.target.value }))}
              >
                {GLOBAL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex gap-3 border-t border-dark-600 pt-4">
            <button
              onClick={createUser}
              disabled={busy === 'create'}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:bg-accent/90 disabled:opacity-50"
            >
              {busy === 'create' ? 'Creating…' : 'Create user'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="rounded-lg border border-dark-500 bg-dark-700 px-4 py-2 text-sm text-white hover:bg-dark-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-dark-600 bg-dark-800/50">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-dark-600 text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-5 py-3 font-medium">Person</th>
              <th className="px-5 py-3 font-medium">Global role</th>
              <th className="px-5 py-3 font-medium">Event role</th>
              <th className="px-5 py-3 text-right font-medium">Account</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelf = user.id === currentUser?.id;
              return (
                <tr key={user.id} className="border-b border-dark-600/50 last:border-0">
                  <td className="px-5 py-4">
                    <p className="text-sm font-medium text-white">
                      {user.name || <span className="text-slate-500">No name set</span>}
                      {isSelf && <span className="ml-2 text-[11px] text-slate-500">you</span>}
                    </p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ${roleTone(
                        user.role,
                      )}`}
                    >
                      {user.role}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2">
                      <select
                        disabled={!eventId}
                        value={roleChoice[user.id] ?? EVENT_ROLES[1]}
                        onChange={(e) =>
                          setRoleChoice((prev) => ({ ...prev, [user.id]: e.target.value }))
                        }
                        className="rounded-lg border border-dark-500 bg-dark-900/60 px-2 py-1.5 text-xs text-white outline-none disabled:opacity-40"
                      >
                        {EVENT_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => assignRole(user)}
                        disabled={!eventId || busy === `assign-${user.id}`}
                        className="rounded-lg bg-accent/90 px-2.5 py-1.5 text-xs text-white hover:bg-accent disabled:opacity-40"
                      >
                        {busy === `assign-${user.id}` ? 'Saving…' : 'Assign'}
                      </button>
                      <button
                        onClick={() => removeRole(user)}
                        disabled={!eventId || busy === `remove-${user.id}`}
                        className="rounded-lg border border-dark-500 bg-dark-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-dark-600 disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => resetPassword(user)}
                        disabled={busy === `reset-${user.id}`}
                        className="rounded-lg border border-dark-500 bg-dark-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-dark-600 disabled:opacity-40"
                      >
                        Reset password
                      </button>
                      <button
                        onClick={() => deleteUser(user)}
                        disabled={isSelf || busy === `delete-${user.id}`}
                        title={isSelf ? 'You cannot delete your own account' : undefined}
                        className="rounded-lg border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-30"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {loading && <p className="px-5 py-8 text-center text-sm text-slate-500">Loading users…</p>}
        {!loading && users.length === 0 && !error && (
          <p className="px-5 py-8 text-center text-sm text-slate-500">
            No users yet. Add one to get started.
          </p>
        )}
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Global roles control what someone can do across the platform. Event roles apply only to the
        selected event.
      </p>
    </div>
  );
}
