"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

// =============================================================================
// SUPER COMPLEX NEXT.JS + TAILWIND CRUD DASHBOARD (Single-file, client page)
// - Fixes: 'process is not defined' by avoiding direct process.env usage in browser
// - Features: SWR-like cache, URL-synced filters, keyboard shortcuts, modals,
//   toasts, optimistic updates + undo, CSV export/import, selection, bulk delete,
//   pagination, sorting, search, detail drawer, offline cache (localStorage),
//   WebSocket live updates (best-effort), self-tests for helpers.
// =============================================================================

// ===== Types =====
export type User = {
  id: number;
  name: string;
  email: string;
};

// ===== ENV / API base (browser-safe) =====
// Priority: window.__API_BASE__ (runtime) -> NEXT_PUBLIC_API_BASE (if defined) -> localhost
declare global { interface Window { __API_BASE__?: string } }
const API_BASE: string =
  (typeof window !== "undefined" && (window.__API_BASE__ || "")) ||
  // guard access to process for sandboxes that don't define it
  (typeof process !== "undefined" && (process as any)?.env?.NEXT_PUBLIC_API_BASE) ||
  "http://localhost:5000";
const API_URL = `${API_BASE}/api/users`;

// ===== Utils =====
const emailRegex = /^(?:[a-zA-Z0-9_'^&+%\-]+(?:\.[a-zA-Z0-9_'^&+%\-]+)*|"(?:[^"]|\\")+")@(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(" ");

// Simple SWR-ish cache
const cache = new Map<string, any>();

// Self-tests (since we cannot add separate test files here)
function runSelfTests() {
  try {
    console.group("[SelfTest]");
    // email
    console.assert(emailRegex.test("a@b.com"), "email: valid");
    console.assert(!emailRegex.test("bad@"), "email: invalid");
    // csv
    const csv = toCSV([{ id: 1, name: "A,B", email: "x@y.com" }]);
    const parsed = parseCSV(csv);
    console.assert(parsed[0].name === "A,B", "csv roundtrip");
    // sort compare
    const a = [{ id: 2, name: "b", email: "b@x" }, { id: 1, name: "a", email: "a@x" }];
    const s = [...a].sort((x, y) => collator.compare(x.name, y.name));
    console.assert(s[0].name === "a", "sort asc");
    console.groupEnd();
  } catch (e) {
    console.warn("SelfTest error", e);
  }
}

// CSV helpers
function toCSV(rows: User[]): string {
  const esc = (v: any) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return ["id,name,email", ...rows.map(r => [r.id, esc(r.name), esc(r.email)].join(","))].join("\n");
}
function parseCSV(csv: string): User[] {
  const lines = csv.trim().split(/\r?\n/);
  const out: User[] = [];
  const header = lines.shift()?.split(",").map(h => h.trim().toLowerCase()) ?? [];
  const idx = {
    id: header.indexOf("id"),
    name: header.indexOf("name"),
    email: header.indexOf("email"),
  };
  for (const line of lines) {
    // naive CSV split handling quotes
    const cells: string[] = [];
    let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
      else { cur += ch; }
    }
    cells.push(cur);
    const get = (i: number) => (i >= 0 ? cells[i]?.replace(/^"|"$/g, "").replaceAll('""', '"') : undefined);
    const id = Number(get(idx.id) || 0);
    const name = get(idx.name) || "";
    const email = get(idx.email) || "";
    out.push({ id, name, email });
  }
  return out;
}

// Toasts
function useToasts() {
  const [items, setItems] = useState<{ id: number; type: "success"|"error"|"info"; msg: string; actionLabel?: string; action?: () => void }[]>([]);
  const idRef = useRef(1);
  const push = (t: Omit<(typeof items)[number], "id">) => {
    const id = idRef.current++;
    const item = { id, ...t } as (typeof items)[number];
    setItems(v => [...v, item]);
    setTimeout(() => setItems(v => v.filter(x => x.id !== id)), 4000);
  };
  return { items, push };
}

// Confirm Modal
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}
        className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-gray-200">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-gray-100" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Confirm({ open, onCancel, onConfirm, title, desc }: { open: boolean; onCancel: () => void; onConfirm: () => void; title: string; desc?: string }) {
  return (
    <AnimatePresence>{open && (
      <Modal open={open} onClose={onCancel} title={title}>
        {desc && <p className="text-sm text-gray-600 mb-4">{desc}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700">Delete</button>
        </div>
      </Modal>
    )}</AnimatePresence>
  );
}

// Form schema
const UserSchema = z.object({
  name: z.string().min(2, "Name too short"),
  email: z.string().email("Invalid email"),
});

type FormValues = z.infer<typeof UserSchema>;

// ============================= Main Page =====================================
export default function Home() {
  // Run inline self-tests once
  useEffect(() => { runSelfTests(); }, []);

  // Data state
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // UI/UX state
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<keyof User>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [showDetail, setShowDetail] = useState<User | null>(null);

  const [selected, setSelected] = useState<number[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { items: toasts, push } = useToasts();

  // Form
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormValues>({ resolver: zodResolver(UserSchema) });

  // Fetch users (with cache + offline localStorage fallback)
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const key = API_URL;
      if (cache.has(key)) setUsers(cache.get(key));
      const res = await fetch(API_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: User[] = await res.json();
      cache.set(key, data);
      setUsers(data);
      if (typeof window !== "undefined") localStorage.setItem("users_cache", JSON.stringify(data));
    } catch (e: any) {
      const ls = typeof window !== "undefined" ? localStorage.getItem("users_cache") : null;
      if (ls) {
        const data = JSON.parse(ls) as User[];
        setUsers(data);
        push({ type: "info", msg: "Loaded offline cache" });
      } else {
        setError(e?.message || "Failed to load");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // WebSocket live updates (best-effort, ignored if server doesn't support)
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(API_BASE.replace(/^http/, "ws") + "/ws");
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "users:update") {
            setUsers(msg.payload);
          }
        } catch { /* ignore */ }
      };
    } catch { /* ignore */ }
    return () => { try { ws?.close(); } catch {} };
  }, []);

  // URL sync (query, sort, page)
  useEffect(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (sortBy) p.set("sb", String(sortBy));
    if (sortDir) p.set("sd", sortDir);
    if (page !== 1) p.set("p", String(page));
    if (pageSize !== 8) p.set("ps", String(pageSize));
    const qs = p.toString();
    if (typeof window !== "undefined") {
      const url = qs ? `?${qs}` : location.pathname;
      window.history.replaceState({}, "", url);
    }
  }, [query, sortBy, sortDir, page, pageSize]);

  // Keyboard shortcuts
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key.toLowerCase() === "n") { e.preventDefault(); openCreate(); }
      if (e.key === "Delete" && selected.length) { e.preventDefault(); setConfirmOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected.length]);

  // Derived data: filter + sort + paginate
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = users;
    if (q) list = list.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    list = [...list].sort((a, b) => {
      const A = a[sortBy]; const B = b[sortBy];
      const cmp = typeof A === "string" && typeof B === "string" ? collator.compare(A, B) : Number(A) - Number(B);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [users, query, sortBy, sortDir]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, pages);
  const start = (pageSafe - 1) * pageSize;
  const end = start + pageSize;
  const pageRows = filtered.slice(start, end);
  const allVisibleSelected = pageRows.length > 0 && pageRows.every(r => selected.includes(r.id));

  // CRUD helpers
  function openCreate() {
    setEditing(null);
    reset({ name: "", email: "" });
    setShowForm(true);
  }
  function openEdit(u: User) {
    setEditing(u);
    reset({ name: u.name, email: u.email });
    setShowForm(true);
  }

  const createUser = async (values: FormValues) => {
    const res = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    if (!res.ok) throw new Error("Create failed");
    const created: User = await res.json();
    setUsers(v => [created, ...v]);
    push({ type: "success", msg: "User created" });
  };

  const updateUser = async (id: number, values: FormValues) => {
    const prev = users;
    setUsers(v => v.map(u => u.id === id ? { ...u, ...values } : u)); // optimistic
    try {
      const res = await fetch(`${API_URL}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      if (!res.ok) throw new Error("Update failed");
      const data = await res.json().catch(() => null);
      if (data?.id) setUsers(v => v.map(u => u.id === id ? data : u));
      push({ type: "success", msg: "Changes saved" });
    } catch (e: any) {
      setUsers(prev); // rollback
      push({ type: "error", msg: e?.message || "Update failed" });
    }
  };

  const removeUser = async (id: number) => {
    const prev = users;
    const removed = users.find(u => u.id === id);
    setUsers(v => v.filter(u => u.id !== id)); // optimistic
    push({ type: "info", msg: "User deleted", actionLabel: "Undo", action: () => { if (removed) setUsers(v => [removed, ...v]); } });
    try {
      const res = await fetch(`${API_URL}/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    } catch (e: any) {
      setUsers(prev);
      push({ type: "error", msg: e?.message || "Delete failed" });
    }
  };

  const removeSelected = async () => {
    const ids = selected.slice();
    setConfirmOpen(false);
    const prev = users;
    setUsers(v => v.filter(u => !ids.includes(u.id)));
    setSelected([]);
    try {
      await Promise.all(ids.map(id => fetch(`${API_URL}/${id}`, { method: "DELETE" })));
      push({ type: "success", msg: `Deleted ${ids.length} user(s)` });
    } catch (e) {
      setUsers(prev);
      push({ type: "error", msg: "Bulk delete failed" });
    }
  };

  // Form submit
  const onSubmit = async (values: FormValues) => {
    setShowForm(false);
    if (editing) await updateUser(editing.id, values); else await createUser(values);
  };

  // CSV import
  const fileRef = useRef<HTMLInputElement | null>(null);
  const onImportCSV = async (f: File) => {
    const text = await f.text();
    const rows = parseCSV(text).filter(r => r.name && r.email);
    // Create sequentially (could batch on server)
    for (const r of rows) {
      await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: r.name, email: r.email }) });
    }
    await fetchUsers();
    push({ type: "success", msg: `Imported ${rows.length} users` });
  };

  // Render
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 p-6">
      <div className="mx-auto w-full max-w-7xl">
        {/* Header & Stats */}
        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <div className="md:col-span-2 flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-5 shadow">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800">🧑‍💼 Users Admin Dashboard</h1>
            <button onClick={fetchUsers} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-60" disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow">
            <div className="text-xs uppercase text-gray-500">Total</div>
            <div className="text-2xl font-bold text-gray-800">{users.length}</div>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow">
            <div className="text-xs uppercase text-gray-500">Selected</div>
            <div className="text-2xl font-bold text-gray-800">{selected.length}</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 items-center gap-2">
            <div className="relative w-full md:max-w-sm">
              <input
                ref={searchRef}
                type="search"
                placeholder="Search by name or email… (Ctrl/Cmd+K)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-xl border border-gray-300 bg-white py-2.5 pl-10 pr-3 text-sm text-gray-800 outline-none ring-blue-300 placeholder:text-gray-400 focus:border-blue-400 focus:ring"
              />
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-3.5-3.5"/></svg>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { const blob = new Blob([toCSV(filtered)], { type: "text/csv" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `users_${Date.now()}.csv`; a.click(); URL.revokeObjectURL(url); }}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Export CSV</button>
            <button onClick={() => fileRef.current?.click()} className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Import CSV</button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportCSV(f); e.currentTarget.value = ""; }} />
            <button onClick={openCreate} className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-green-700">New User</button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="sticky top-0 bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="px-4 py-3 w-10">
                    <input aria-label="Select page" type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={allVisibleSelected} onChange={() => setSelected(s => allVisibleSelected ? s.filter(id => !pageRows.some(r => r.id === id)) : Array.from(new Set([...s, ...pageRows.map(r => r.id)])))} />
                  </th>
                  {(["id","name","email"] as (keyof User)[]).map(col => (
                    <th key={String(col)} className="px-4 py-3">
                      <button onClick={() => { if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc"); else setSortBy(col); }}
                        className={cx("flex items-center gap-1 font-semibold", sortBy === col ? "text-gray-900" : "text-gray-600 hover:text-gray-800")}
                      >
                        {String(col)}
                        <svg className={cx("h-4 w-4 transition", sortBy === col ? "opacity-100" : "opacity-40")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          {sortBy === col && sortDir === "asc" ? <path d="M12 5l-7 7h14l-7-7z"/> : <path d="M12 19l7-7H5l7 7z"/>}
                        </svg>
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && Array.from({ length: pageSize }).map((_, i) => (
                  <tr key={i} className="animate-pulse border-t border-gray-50">
                    <td className="px-4 py-4"><div className="h-4 w-4 rounded bg-gray-200"/></td>
                    <td className="px-4 py-4"><div className="h-4 w-10 rounded bg-gray-200"/></td>
                    <td className="px-4 py-4"><div className="h-4 w-40 rounded bg-gray-200"/></td>
                    <td className="px-4 py-4"><div className="h-4 w-56 rounded bg-gray-200"/></td>
                    <td className="px-4 py-4 text-right"><div className="ml-auto h-8 w-24 rounded bg-gray-200"/></td>
                  </tr>
                ))}

                {!loading && pageRows.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-16 text-center text-gray-500">No users found.</td></tr>
                )}

                {!loading && pageRows.map(u => (
                  <tr key={u.id} className="group border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3"><input type="checkbox" className="h-4 w-4 rounded border-gray-300" checked={selected.includes(u.id)} onChange={() => setSelected(s => s.includes(u.id) ? s.filter(x => x !== u.id) : [...s, u.id])} /></td>
                    <td className="px-4 py-3 text-gray-500">{u.id}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 cursor-pointer" onClick={() => setShowDetail(u)}>{u.name}</td>
                    <td className="px-4 py-3 text-gray-700">{u.email}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
                        <button onClick={() => openEdit(u)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100">Edit</button>
                        <button onClick={() => removeUser(u.id)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="flex flex-col items-center gap-3 border-t border-gray-200 p-4 md:flex-row md:justify-between">
            <div className="flex items-center gap-2">
              <button className={cx("rounded-lg px-3 py-1.5 text-sm border", selected.length ? "border-red-300 text-red-700 hover:bg-red-50" : "border-gray-200 text-gray-400 cursor-not-allowed")}
                disabled={!selected.length}
                onClick={() => setConfirmOpen(true)}>
                Delete selected ({selected.length})
              </button>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span>Page <strong>{pageSafe}</strong> / <strong>{pages}</strong></span>
              <div className="flex overflow-hidden rounded-xl border border-gray-200">
                <button className="px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={pageSafe === 1} onClick={() => setPage(1)}>{"«"}</button>
                <button className="px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={pageSafe === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>{"‹"}</button>
                <button className="px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={pageSafe === pages} onClick={() => setPage(p => Math.min(pages, p + 1))}>{"›"}</button>
                <button className="px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40" disabled={pageSafe === pages} onClick={() => setPage(pages)}>{"»"}</button>
              </div>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-xl border border-gray-300 bg-white px-2 py-1.5 text-sm">
                {[5,8,10,20,50].map(n => <option key={n} value={n}>{n} / page</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Create/Edit Modal */}
      <AnimatePresence>
        {showForm && (
          <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? "Edit User" : "Create User"}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
                <input {...register("name")} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 outline-none ring-blue-300 focus:border-blue-400 focus:ring" placeholder="Jane Doe" />
                {errors.name && <p className="mt-1 text-xs text-red-600">{errors.name.message}</p>}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
                <input type="email" {...register("email")} className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 outline-none ring-blue-300 focus:border-blue-400 focus:ring" placeholder="jane@example.com" />
                {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                  {isSubmitting ? "Saving…" : (editing ? "Save Changes" : "Create")}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </AnimatePresence>

      {/* Detail Drawer */}
      <AnimatePresence>
        {showDetail && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowDetail(null)} />
            <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 260, damping: 28 }}
              className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl border-l border-gray-200 p-6">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-gray-800">User Details</h3>
                <button onClick={() => setShowDetail(null)} className="rounded-full p-2 hover:bg-gray-100" aria-label="Close">
                  <svg viewBox="0 0 24 24" className="h-5 w-5"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                </button>
              </div>
              <div className="space-y-2">
                <div className="text-sm text-gray-500">ID</div>
                <div className="text-lg font-medium">{showDetail.id}</div>
                <div className="text-sm text-gray-500">Name</div>
                <div className="text-lg font-medium">{showDetail.name}</div>
                <div className="text-sm text-gray-500">Email</div>
                <div className="text-lg font-medium">{showDetail.email}</div>
              </div>
              <div className="mt-6 flex gap-2">
                <button onClick={() => { openEdit(showDetail); setShowDetail(null); }} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 font-medium text-blue-700 hover:bg-blue-100">Edit</button>
                <button onClick={() => { removeUser(showDetail.id); setShowDetail(null); }} className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 font-medium text-red-700 hover:bg-red-100">Delete</button>
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Bulk Delete */}
      <Confirm open={confirmOpen} onCancel={() => setConfirmOpen(false)} onConfirm={removeSelected} title="Delete selected users?" desc={`This will permanently delete ${selected.length} user(s).`} />

      {/* Toasts */}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map(t => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
              className={cx("pointer-events-auto rounded-xl border p-3 shadow-lg backdrop-blur", t.type === "success" && "border-green-200 bg-green-50/80 text-green-800", t.type === "error" && "border-red-200 bg-red-50/80 text-red-800", t.type === "info" && "border-blue-200 bg-blue-50/80 text-blue-800")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold flex-1">{t.msg}</div>
                {t.action && t.actionLabel && (
                  <button onClick={t.action} className="rounded-md border border-current/20 px-2 py-0.5 text-xs">{t.actionLabel}</button>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Error banner */}
      {error && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800 shadow">
          Failed to load: {error} <button onClick={fetchUsers} className="ml-2 underline">Retry</button>
        </div>
      )}
    </div>
  );
}
