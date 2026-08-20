import React, { useState, useEffect, useRef } from "react";
import { PH_LOCATIONS, PH_SCHOOLS, schoolsForCity } from "./data/places.js";

/* ==========================================================
   SmartPath — AI-Powered Career Guidance & Resume Builder
   Built from the project proposal (AI_bro.docx)
   Single file. Phone + desktop. v2
   ========================================================== */

/* ---------------- storage ----------------
   Browser localStorage, wrapped in the same async shape the app already used.
   Keys are namespaced so SmartPath never collides with anything else on the origin.
   Falls back to an in-memory map when localStorage is unavailable (private mode,
   storage disabled), so the app still works for the length of the visit.        */
const NS = "smartpath:";
const memory = new Map();

function backend() {
  try {
    const probe = "__smartpath_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

const store = {
  async get(key) {
    try {
      const ls = backend();
      const raw = ls ? ls.getItem(NS + key) : memory.get(NS + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      const raw = JSON.stringify(value);
      const ls = backend();
      if (ls) ls.setItem(NS + key, raw);
      else memory.set(NS + key, raw);
      return true;
    } catch (e) {
      return false;
    }
  },
};

const blankProfile = {
  fullName: "", gradeLevel: "Grade 12", strand: "STEM", school: "",
  interests: "", strengths: "", favoriteSubjects: "",
  workStyle: "Mix of both", afterSHS: "College", location: "",
};

const blankResume = {
  fullName: "", email: "", phone: "", city: "", school: "", strand: "STEM",
  gradYear: "2026", honors: "", skillsRaw: "", activitiesRaw: "",
  experienceRaw: "", achievementsRaw: "",
  template: "ledger", accent: "#0F7B6C",
};

/* ---------------- AI ----------------
   The browser never sees an API key. It calls our own endpoint, and the
   serverless function in netlify/functions/chat.mjs holds the key, pins the
   model, and talks to Anthropic.                                              */
async function askClaude(messages, system) {
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, system }),
    });
  } catch (e) {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const detail = data && data.error ? data.error : "status " + res.status;
    throw new Error("The AI service could not answer right now (" + detail + ").");
  }

  const text = ((data && data.content) || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("The AI service returned an empty answer.");
  return text;
}

function parseJSON(text) {
  const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("bad json");
  return JSON.parse(clean.slice(s, e + 1));
}

async function askJSON(prompt, system) {
  const raw = await askClaude([{ role: "user", content: prompt }], system);
  try {
    return parseJSON(raw);
  } catch (e) {
    const retry = await askClaude(
      [
        { role: "user", content: prompt },
        { role: "assistant", content: raw },
        { role: "user", content: "That was not valid JSON. Reply with the JSON object only." },
      ],
      system
    );
    return parseJSON(retry);
  }
}

function profileLine(p) {
  return [
    p.fullName ? "Name: " + p.fullName : "",
    "Level: " + p.gradeLevel + ", Strand: " + p.strand,
    p.school ? "School: " + p.school : "",
    p.location ? "Location: " + p.location : "",
    "Interests: " + (p.interests || "not stated"),
    "Strengths: " + (p.strengths || "not stated"),
    "Favorite subjects: " + (p.favoriteSubjects || "not stated"),
    "Prefers working: " + p.workStyle,
    "Plan after Senior High: " + p.afterSHS,
  ].filter(Boolean).join("\n");
}

const GUIDE_SYSTEM =
  "You are SmartPath, a career guidance assistant for Senior High School students (Philippine K-12: STEM, ABM, HUMSS, GAS, TVL strands). " +
  "You are warm, plain-spoken and concrete. You give options and next steps, never guarantees. " +
  "You never promise a job or a college slot. If a student needs a counselor, say so.";

/* ---------------- icons ---------------- */
function Icon({ name, size = 20 }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    home: <><path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" /></>,
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20c.8-4 3.9-6 7.5-6s6.7 2 7.5 6" /></>,
    compass: <><circle cx="12" cy="12" r="8.5" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
    doc: <><path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" /><path d="M9 13h6M9 17h4" /></>,
    mic: <><rect x="9.5" y="3" width="5" height="10" rx="2.5" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>,
    chat: <><path d="M20 15a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" /></>,
    check: <><path d="M4 12.5l5 5L20 6.5" /></>,
    map: <><path d="M3 6.5l6-2.5 6 2.5 6-2.5v14L15 20.5 9 18l-6 2.5z" /><path d="M9 4v14M15 6.5v14" /></>,
    star: <><path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z" /></>,
    down: <><path d="M12 4v12M7 12l5 5 5-5M5 20h14" /></>,
    spark: <><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l3 3M14.7 14.7l3 3M17.7 6.3l-3 3M9.3 14.7l-3 3" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" /></>,
    moon: <><path d="M20 13.5A8.5 8.5 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5z" /></>,
    caret: <><path d="M6 9l6 6 6-6" /></>,
    pin: <><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
    school: <><path d="M12 4l9 4.5-9 4.5-9-4.5z" /><path d="M6.5 11v5.2c0 .9 2.5 2.3 5.5 2.3s5.5-1.4 5.5-2.3V11" /></>,
  };
  return <svg {...p} aria-hidden="true">{paths[name]}</svg>;
}

/* ---------------- small pieces ---------------- */
function Field({ label, hint, children }) {
  return (
    <label className="sp-field">
      <span className="sp-label">{label}</span>
      {children}
      {hint ? <span className="sp-hint">{hint}</span> : null}
    </label>
  );
}

/* A combobox: click it and every option is listed, typing narrows the list,
   and anything not on the list can still be typed in freely. Options arrive as
   [{ group, items: [...] }] so long lists stay navigable. */
function Picker({ label, hint, value, onChange, groups, placeholder, icon }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null); // null = untouched, show everything
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const listRef = useRef(null);

  const filter = query === null ? "" : query.trim().toLowerCase();
  const shown = [];
  for (const g of groups) {
    const items = filter ? g.items.filter((i) => i.toLowerCase().includes(filter)) : g.items;
    if (items.length) shown.push({ group: g.group, items });
  }
  const flat = shown.flatMap((g) => g.items);

  useEffect(() => {
    if (!open) return;
    function away(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector('[data-idx="' + active + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function show() {
    setOpen(true);
    setQuery(null);
    setActive(-1);
    /* On a phone the field is often near the bottom of the screen, so nudge the
       open list into view instead of leaving it behind the tab bar. */
    setTimeout(() => {
      if (listRef.current && listRef.current.scrollIntoView) {
        listRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }, 0);
  }

  function pick(item) {
    onChange(item);
    setOpen(false);
    setQuery(null);
    setActive(-1);
  }

  function onKey(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return show();
      if (!flat.length) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      if (open && active >= 0 && flat[active]) {
        e.preventDefault();
        pick(flat[active]);
      } else {
        setOpen(false);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  let idx = -1;

  return (
    <label className="sp-field sp-picker" ref={wrapRef}>
      <span className="sp-label">{label}</span>
      <div className="sp-picker-box">
        {icon ? <span className="sp-picker-icon"><Icon name={icon} size={16} /></span> : null}
        <input
          className={"sp-input" + (icon ? " sp-input-iconed" : "")}
          value={query === null ? value : query}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onMouseDown={() => { if (!open) show(); }}
          onFocus={show}
          onKeyDown={onKey}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
        />
        <button
          type="button"
          className={"sp-picker-caret" + (open ? " is-open" : "")}
          tabIndex={-1}
          aria-label={open ? "Hide the list" : "Show the whole list"}
          onMouseDown={(e) => { e.preventDefault(); open ? setOpen(false) : show(); }}
        >
          <Icon name="caret" size={16} />
        </button>

      {open ? (
        <div className="sp-picker-list" ref={listRef} role="listbox">
          {shown.length ? (
            shown.map((g) => (
              <div key={g.group} className="sp-picker-group">
                <span className="sp-picker-grouphead">{g.group}</span>
                {g.items.map((item) => {
                  idx += 1;
                  const here = idx;
                  return (
                    <button
                      type="button"
                      key={item}
                      data-idx={here}
                      role="option"
                      aria-selected={item === value}
                      className={
                        "sp-picker-opt" +
                        (here === active ? " is-active" : "") +
                        (item === value ? " is-chosen" : "")
                      }
                      onMouseEnter={() => setActive(here)}
                      onMouseDown={(e) => { e.preventDefault(); pick(item); }}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <p className="sp-picker-none">
              Nothing on the list matches that. Keep typing — your own answer is saved as you write it.
            </p>
          )}
        </div>
      ) : null}
      </div>

      {hint ? <span className="sp-hint">{hint}</span> : null}
    </label>
  );
}

function Notice({ kind, children, onRetry }) {
  if (!children) return null;
  return (
    <div className={"sp-notice " + (kind === "error" ? "sp-notice-error" : "")}>
      <span>{children}</span>
      {onRetry ? <button className="sp-link" onClick={onRetry}>Try again</button> : null}
    </div>
  );
}

function Loading({ label }) {
  return <div className="sp-loading"><span className="sp-pulse" />{label}</div>;
}

function Empty({ title, body, action, onAction }) {
  return (
    <div className="sp-empty">
      <div className="sp-empty-art" aria-hidden="true">
        <svg viewBox="0 0 120 60" width="120" height="60">
          <path d="M8 46 L34 46 L52 20 L86 20 L112 46" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
          <circle cx="8" cy="46" r="5" fill="currentColor" />
          <circle cx="112" cy="46" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </div>
      <h3>{title}</h3>
      <p>{body}</p>
      {action ? <button className="sp-btn sp-btn-primary" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

function Dial({ value, size = 58 }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  const r = (size - 9) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={"0 0 " + size + " " + size} className="sp-dial">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth="6" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--route)" strokeWidth="6"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
        transform={"rotate(-90 " + size / 2 + " " + size / 2 + ")"} className="sp-dial-arc" />
      <text x="50%" y="50%" textAnchor="middle" dy="5" className="sp-dial-txt">{v}</text>
    </svg>
  );
}

function Stars({ n }) {
  return (
    <span className="sp-stars" aria-label={n + " out of 5"}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width="15" height="15" viewBox="0 0 24 24" className={i <= n ? "on" : ""}>
          <path d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9z"
            fill={i <= n ? "var(--signal)" : "none"} stroke="var(--signal)" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      ))}
    </span>
  );
}

/* ---------------- route map hero (signature) ---------------- */
function RouteMap({ done }) {
  const stops = [
    { x: 26, y: 74, key: "profile", label: "You" },
    { x: 82, y: 74, key: "match", label: "Match" },
    { x: 136, y: 30, key: "resume", label: "Resume" },
    { x: 208, y: 30, key: "interview", label: "Prep" },
    { x: 262, y: 74, key: "advice", label: "Ask" },
  ];
  return (
    <svg className="sp-routemap" viewBox="0 0 288 100" role="img" aria-label="Your path through SmartPath">
      <path className="sp-routemap-line" d="M26 74 H82 L136 30 H208 L262 74"
        fill="none" stroke="var(--signal)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      {stops.map((s, i) => (
        <g key={s.key} className="sp-routemap-stop" style={{ animationDelay: 0.5 + i * 0.13 + "s" }}>
          <circle cx={s.x} cy={s.y} r="7.5" fill={done[s.key] ? "var(--route)" : "var(--panel-dot)"} />
          <circle cx={s.x} cy={s.y} r="7.5" fill="none" stroke="#FFFFFF" strokeWidth="2.5" opacity={done[s.key] ? 1 : 0.5} />
          <text x={s.x} y={s.y + 24} textAnchor="middle" className="sp-routemap-label">{s.label}</text>
        </g>
      ))}
    </svg>
  );
}

/* Icon-only theme switch for the app chrome, so the theme is reachable from
   every tab and not only the homepage. */
function ThemeSwitch({ theme, onToggle, className }) {
  const dark = theme === "dark";
  return (
    <button
      className={"sp-themeswitch" + (className ? " " + className : "")}
      onClick={onToggle}
      aria-pressed={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <Icon name={dark ? "sun" : "moon"} size={16} />
    </button>
  );
}

/* ---------------- stations ---------------- */
const STATIONS = [
  { id: "home", name: "Overview", short: "Home", icon: "home" },
  { id: "profile", name: "Your profile", short: "You", icon: "user" },
  { id: "match", name: "Career match", short: "Match", icon: "compass" },
  { id: "resume", name: "Resume", short: "Resume", icon: "doc" },
  { id: "interview", name: "Interview prep", short: "Prep", icon: "mic" },
  { id: "advice", name: "Ask SmartPath", short: "Ask", icon: "chat" },
];

function Rail({ tab, setTab, done, user, onSignOut, theme, onToggleTheme }) {
  return (
    <aside className="sp-rail">
      <div>
        <div className="sp-route-head">
          <div className="sp-route-title">
            <span className="sp-mark">SmartPath</span>
            <ThemeSwitch theme={theme} onToggle={onToggleTheme} className="sp-themeswitch-onpanel" />
          </div>
          <span className="sp-sub">Career guidance &amp; resume builder</span>
        </div>
        <ol className="sp-stations">
          {STATIONS.map((s, i) => (
            <li key={s.id}>
              <button
                className={"sp-station" + (tab === s.id ? " is-active" : "") + (done[s.id] ? " is-done" : "")}
                onClick={() => setTab(s.id)}
                aria-current={tab === s.id ? "page" : undefined}
              >
                <span className="sp-dot">{done[s.id] ? <Icon name="check" size={9} /> : null}</span>
                <span className="sp-station-num">{i === 0 ? "—" : String(i).padStart(2, "0")}</span>
                <span className="sp-station-name">{s.name}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="sp-rail-foot">
        <span className="sp-user">Signed in as {user}</span>
        <button className="sp-link" onClick={onSignOut}>Sign out</button>
      </div>
    </aside>
  );
}

/* ---------------- sign in ---------------- */
function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState("signup");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const u = username.trim().toLowerCase();
    if (u.length < 3) return setMsg("Use a username with at least 3 characters.");
    if (pin.length < 4) return setMsg("Use a passcode with at least 4 characters.");
    setBusy(true); setMsg("");
    const existing = await store.get("account:" + u);
    if (mode === "signup") {
      if (existing) { setBusy(false); return setMsg("That username is taken. Sign in instead, or pick another."); }
      await store.set("account:" + u, { username: u, pin, createdAt: Date.now() });
    } else {
      if (!existing) { setBusy(false); return setMsg("No account with that username. Create one first."); }
      if (existing.pin !== pin) { setBusy(false); return setMsg("That passcode does not match."); }
    }
    await store.set("session", { username: u });
    setBusy(false);
    onSignedIn(u);
  }

  return (
    <div className="sp-auth">
      <div className="sp-auth-art" aria-hidden="true">
        <svg viewBox="0 0 300 700" preserveAspectRatio="xMidYMid slice" className="sp-auth-svg">
          <defs>
            <linearGradient id="spg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F2B134" /><stop offset="100%" stopColor="#0F7B6C" />
            </linearGradient>
          </defs>
          <path d="M150 20 V150 L70 240 V400 L200 520 V680" fill="none" stroke="url(#spg)" strokeWidth="5"
            strokeLinecap="round" strokeLinejoin="round" className="sp-auth-path" />
          {[[150, 20], [150, 150], [70, 240], [70, 400], [200, 520], [200, 680]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="11" fill="#12233C" stroke="#F2B134" strokeWidth="4"
              className="sp-auth-node" style={{ animationDelay: 0.3 + i * 0.14 + "s" }} />
          ))}
        </svg>
      </div>

      <div className="sp-auth-card">
        <span className="sp-eyebrow">Senior High School</span>
        <h1 className="sp-h1">Find the path,<br />then walk in ready.</h1>
        <p className="sp-lede">
          Answer a few questions about yourself. SmartPath suggests careers that fit, builds a
          resume you can hand in, and drills you on interview questions.
        </p>

        <div className="sp-tabs">
          <button className={"sp-tab" + (mode === "signup" ? " is-on" : "")} onClick={() => setMode("signup")}>Create account</button>
          <button className={"sp-tab" + (mode === "signin" ? " is-on" : "")} onClick={() => setMode("signin")}>Sign in</button>
        </div>

        <Field label="Username">
          <input className="sp-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. maria.santos" autoComplete="off" />
        </Field>
        <Field label="Passcode" hint="Make up a new one. Never reuse a real password here.">
          <input className="sp-input" type="password" value={pin} onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="4 characters or more" />
        </Field>

        {msg ? <Notice kind="error">{msg}</Notice> : null}

        <button className="sp-btn sp-btn-primary sp-btn-wide" onClick={submit} disabled={busy}>
          {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>

        <p className="sp-fineprint">
          This sign-in keeps your work separate on this device. It is a school-project login, not
          real security, so keep sensitive details out.
        </p>
      </div>
    </div>
  );
}

/* ---------------- overview ---------------- */
function OverviewTab({ profile, careers, chosen, built, prep, practiced, done, setTab }) {
  const steps = ["profile", "match", "resume", "interview", "advice"];
  const pct = Math.round((steps.filter((s) => done[s]).length / steps.length) * 100);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = (profile.fullName || "").split(" ")[0];

  const cards = [
    { id: "profile", icon: "user", label: "Profile", value: done.profile ? "Complete" : "Not filled in", cta: done.profile ? "Edit" : "Fill it in" },
    { id: "match", icon: "compass", label: "Career match", value: chosen || (careers.length ? careers.length + " suggestions" : "Not run yet"), cta: careers.length ? "Review" : "Match me" },
    { id: "resume", icon: "doc", label: "Resume", value: built && built.objective ? "Ready to download" : "Not written", cta: built && built.objective ? "Open" : "Build it" },
    { id: "interview", icon: "mic", label: "Interview prep", value: practiced ? practiced + " answered" : prep ? "Questions ready" : "Not started", cta: prep ? "Practise" : "Get questions" },
  ];

  return (
    <div className="sp-pane">
      <section className="sp-hero">
        <div className="sp-hero-text">
          <span className="sp-eyebrow sp-eyebrow-light">Your path</span>
          <h2 className="sp-hero-h">
            {greet}{first ? ", " + first : ""}.
          </h2>
          <p className="sp-hero-p">
            {pct === 100
              ? "Every station is done. Re-run any of them whenever something changes."
              : pct === 0
              ? "Start at the first station. It takes about five minutes."
              : "You are " + pct + "% of the way along. Pick up where you stopped."}
          </p>
          <button className="sp-btn sp-btn-signal" onClick={() => setTab(steps.find((s) => !done[s]) || "profile")}>
            {pct === 100 ? "Review your plan" : pct === 0 ? "Start now" : "Continue"}
          </button>
        </div>
        <div className="sp-hero-map">
          <RouteMap done={done} />
        </div>
      </section>

      <div className="sp-stat-row">
        <div className="sp-stat">
          <Dial value={pct} size={64} />
          <div>
            <span className="sp-stat-label">Overall progress</span>
            <span className="sp-stat-value">{steps.filter((s) => done[s]).length} of 5 stations</span>
          </div>
        </div>
      </div>

      <div className="sp-tiles">
        {cards.map((c) => (
          <button key={c.id} className={"sp-tile" + (done[c.id] ? " is-done" : "")} onClick={() => setTab(c.id)}>
            <span className="sp-tile-icon"><Icon name={c.icon} size={18} /></span>
            <span className="sp-tile-label">{c.label}</span>
            <span className="sp-tile-value">{c.value}</span>
            <span className="sp-tile-cta">{c.cta} →</span>
          </button>
        ))}
      </div>

      <div className="sp-quote">
        <Icon name="spark" size={18} />
        <p>
          SmartPath suggests, it does not decide. Bring what you find here to your guidance
          counselor, a teacher, or someone already doing the work.
        </p>
      </div>
    </div>
  );
}

/* ---------------- profile ---------------- */
function ProfileTab({ profile, setProfile, onSaved, goMatch }) {
  const [saved, setSaved] = useState(false);
  function set(k, v) { setProfile({ ...profile, [k]: v }); setSaved(false); }
  const ready = profile.interests.trim().length > 2 && profile.strengths.trim().length > 2;
  const filled = ["fullName", "school", "interests", "strengths", "favoriteSubjects", "location"]
    .filter((k) => (profile[k] || "").trim().length > 1).length;

  return (
    <div className="sp-pane">
      <header className="sp-pane-head">
        <span className="sp-eyebrow">Station 01</span>
        <h2 className="sp-h2">Tell SmartPath about you</h2>
        <p className="sp-lede">
          Everything here feeds the career match, the resume and the interview questions. Write in
          your own words — full sentences are not required.
        </p>
        <div className="sp-meter">
          <span style={{ width: (filled / 6) * 100 + "%" }} />
        </div>
        <span className="sp-hint">{filled} of 6 fields filled</span>
      </header>

      <div className="sp-grid">
        <Field label="Full name">
          <input className="sp-input" value={profile.fullName} onChange={(e) => set("fullName", e.target.value)} placeholder="Maria Santos" />
        </Field>
        <Picker
          label="School"
          icon="school"
          value={profile.school}
          onChange={(v) => set("school", v)}
          groups={schoolsForCity(profile.location)}
          placeholder="Click to see the list, or type your school"
        />
        <Field label="Grade level">
          <select className="sp-input" value={profile.gradeLevel} onChange={(e) => set("gradeLevel", e.target.value)}>
            <option>Grade 11</option><option>Grade 12</option><option>Recently graduated</option>
          </select>
        </Field>
        <Field label="Strand">
          <select className="sp-input" value={profile.strand} onChange={(e) => set("strand", e.target.value)}>
            <option>STEM</option><option>ABM</option><option>HUMSS</option><option>GAS</option>
            <option>TVL — Home Economics</option><option>TVL — ICT</option>
            <option>TVL — Industrial Arts</option><option>TVL — Agri-Fishery</option>
            <option>Arts and Design</option><option>Sports</option><option>Other / not sure</option>
          </select>
        </Field>
        <Picker
          label="City or province"
          icon="pin"
          hint="Keeps suggestions realistic for where you are, and sorts the school list."
          value={profile.location}
          onChange={(v) => set("location", v)}
          groups={PH_LOCATIONS}
          placeholder="Click to see every city and province"
        />
        <Field label="After Senior High you plan to">
          <select className="sp-input" value={profile.afterSHS} onChange={(e) => set("afterSHS", e.target.value)}>
            <option>College</option><option>Work first</option>
            <option>Short course or TESDA training</option><option>Start a small business</option>
            <option>Still deciding</option>
          </select>
        </Field>
      </div>

      <Field label="What are you interested in?" hint="Subjects, hobbies, things you watch or read, problems you like solving.">
        <textarea className="sp-input sp-textarea" rows={3} value={profile.interests}
          onChange={(e) => set("interests", e.target.value)}
          placeholder="I like drawing on my tablet, editing videos for our class, and I follow tech reviewers." />
      </Field>

      <Field label="What are you good at?" hint="What do classmates ask you for help with?">
        <textarea className="sp-input sp-textarea" rows={3} value={profile.strengths}
          onChange={(e) => set("strengths", e.target.value)}
          placeholder="Explaining lessons to friends, organizing group work, staying calm before a deadline." />
      </Field>

      <div className="sp-grid">
        <Field label="Favorite subjects">
          <input className="sp-input" value={profile.favoriteSubjects} onChange={(e) => set("favoriteSubjects", e.target.value)} placeholder="Math, Empowerment Technologies" />
        </Field>
        <Field label="You'd rather work">
          <select className="sp-input" value={profile.workStyle} onChange={(e) => set("workStyle", e.target.value)}>
            <option>Mostly with people</option><option>Mostly on your own</option>
            <option>Mix of both</option><option>Hands-on, moving around</option><option>At a computer</option>
          </select>
        </Field>
      </div>

      <div className="sp-actions">
        <button className="sp-btn" onClick={async () => { await onSaved(); setSaved(true); }}>Save profile</button>
        <button className="sp-btn sp-btn-primary" disabled={!ready} onClick={goMatch}>Continue to career match</button>
        {saved ? <span className="sp-saved"><Icon name="check" size={13} /> Saved</span> : null}
        {!ready ? <span className="sp-hint">Fill in your interests and strengths to continue.</span> : null}
      </div>
    </div>
  );
}

/* ---------------- strand classifier ---------------- */
/* The eight features the AutoTrain model was trained on. The seven ratings are
   1-5; preferred_activity is a category. Keep this list and the ACTIVITIES
   list below in step with netlify/functions/classify.mjs. */
const CLASSIFIER_QUESTIONS = [
  { key: "math_interest", label: "Math", hint: "Numbers, patterns, problem sets" },
  { key: "science_interest", label: "Science", hint: "Experiments, how things work" },
  { key: "business_interest", label: "Business", hint: "Selling, money, running things" },
  { key: "communication_interest", label: "Communication", hint: "Writing, speaking, persuading" },
  { key: "technology_interest", label: "Technology", hint: "Computers, apps, systems" },
  { key: "creative_interest", label: "Creative work", hint: "Drawing, design, music, video" },
  { key: "hands_on_interest", label: "Hands-on work", hint: "Building, repairing, cooking, machines" },
];

/* The student sees `label`; the model receives `value`. AutoTrain's
   preferred_activity column holds snake_case categories — the working sample
   uses "public_speaking".

   ⚠ Only "public_speaking" is confirmed. The other six follow the same
   convention but are NOT verified against the training data, and a decision
   tree given an unseen category mispredicts silently rather than erroring. If
   they differ from your dataset, fix them here and in ACTIVITIES in
   netlify/functions/classify.mjs. */
const CLASSIFIER_ACTIVITIES = [
  { value: "solving_math_problems", label: "Solving math problems" },
  { value: "doing_science_experiments", label: "Doing science experiments" },
  { value: "running_a_business", label: "Running a small business" },
  { value: "public_speaking", label: "Speaking or presenting" },
  { value: "working_with_computers", label: "Working with computers" },
  { value: "drawing_or_designing", label: "Drawing or designing" },
  { value: "building_or_repairing", label: "Building or repairing things" },
];

const ACTIVITY_VALUES = CLASSIFIER_ACTIVITIES.map((a) => a.value);

const RATING_WORDS = ["Not at all", "A little", "Somewhat", "A lot", "Very much"];

const blankQuiz = {
  math_interest: 3,
  science_interest: 3,
  business_interest: 3,
  communication_interest: 3,
  technology_interest: 3,
  creative_interest: 3,
  hands_on_interest: 3,
  preferred_activity: "",
};

/* The model's classes are ABM, GAS, HUMSS, STEM and TVL, while the profile
   dropdown splits TVL into four tracks. Line the others up so the prediction
   can be applied in one click; a bare "TVL" stays unmatched on purpose, since
   picking a track for the student would be inventing an answer the model did
   not give. */
const STRAND_OPTIONS = [
  "STEM", "ABM", "HUMSS", "GAS",
  "TVL — Home Economics", "TVL — ICT", "TVL — Industrial Arts", "TVL — Agri-Fishery",
  "Arts and Design", "Sports",
];

function matchStrandOption(label) {
  const key = String(label || "").trim().toLowerCase();
  if (!key) return null;
  /* "TVL" alone covers four different tracks — leave it for the student. */
  if (key === "tvl") return null;
  const exact = STRAND_OPTIONS.find((o) => o.toLowerCase() === key);
  if (exact) return exact;
  const loose = STRAND_OPTIONS.find(
    (o) => o.toLowerCase().replace(/[^a-z]/g, "") === key.replace(/[^a-z]/g, "")
  );
  return loose || null;
}

function StrandClassifier({ quiz, setQuiz, result, setResult, profile, setProfile, save }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  /* Work saved before the options carried model values holds prose like
     "Writing or speaking", which the model would reject. Treat anything
     that is not a current value as unanswered. */
  const activity = ACTIVITY_VALUES.includes(quiz.preferred_activity) ? quiz.preferred_activity : "";
  const answered = !!activity;

  function set(key, value) {
    const next = { ...quiz, [key]: value };
    setQuiz(next);
    setResult(null);
  }

  async function submit() {
    if (!answered) {
      setError("Pick the activity you would rather do before submitting.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: { ...quiz, preferred_activity: activity } }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && data.error) || "status " + res.status);
      }
      setResult(data);
      await save({ quiz, quizResult: data });
    } catch (e) {
      setError(e.message || "Could not reach the classifier.");
    }
    setBusy(false);
  }

  const suggested = result ? matchStrandOption(result.strand) : null;
  const applied = suggested && profile.strand === suggested;

  return (
    <section className="sp-quiz">
      <button className="sp-quiz-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div>
          <span className="sp-chip-label">Strand classifier</span>
          <h3 className="sp-quiz-title">Which strand suits you?</h3>
          <p className="sp-quiz-sub">
            {result
              ? "The model suggests " + result.strand + ". Open to change your answers."
              : "Eight quick questions, scored by SmartPath's trained model."}
          </p>
        </div>
        <span className={"sp-quiz-caret" + (open ? " is-open" : "")}>
          <Icon name="caret" size={18} />
        </span>
      </button>

      {open ? (
        <div className="sp-quiz-body">
          {CLASSIFIER_QUESTIONS.map((q) => (
            <div key={q.key} className="sp-rating">
              <div className="sp-rating-top">
                <span className="sp-rating-label">{q.label}</span>
                <span className="sp-rating-word">{RATING_WORDS[quiz[q.key] - 1]}</span>
              </div>
              <div className="sp-rating-scale" role="radiogroup" aria-label={q.label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={quiz[q.key] === n}
                    aria-label={RATING_WORDS[n - 1]}
                    className={"sp-rating-dot" + (quiz[q.key] === n ? " is-on" : "")}
                    onClick={() => set(q.key, n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="sp-hint">{q.hint}</span>
            </div>
          ))}

          <Field label="Which would you rather do?" hint="Pick the one closest to how you like to spend time.">
            <select
              className="sp-input"
              value={activity}
              onChange={(e) => set("preferred_activity", e.target.value)}
            >
              <option value="">Choose one…</option>
              {CLASSIFIER_ACTIVITIES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </Field>

          <Notice kind="error" onRetry={error ? submit : null}>{error}</Notice>

          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={submit} disabled={busy || !answered}>
              {busy ? "Scoring…" : result ? "Score again" : "See my strand"}
            </button>
            {!answered ? <span className="sp-hint">Pick an activity to finish.</span> : null}
          </div>
          {busy ? <Loading label="Sending your answers to the model…" /> : null}
        </div>
      ) : null}

      {result ? (
        <div className="sp-quiz-result sp-fade">
          <div className="sp-quiz-verdict">
            <span className="sp-chip-label">Predicted strand</span>
            <strong className="sp-quiz-strand">{result.strand}</strong>
            {typeof result.confidence === "number" ? (
              <span className="sp-quiz-conf">{Math.round(result.confidence * 100)}% confidence</span>
            ) : null}
          </div>

          {(result.ranked || []).length > 1 ? (
            <ul className="sp-quiz-ranked">
              {result.ranked.map((r) => (
                <li key={r.label}>
                  <span className="sp-quiz-rlabel">{r.label}</span>
                  <span className="sp-compare-track">
                    <span
                      className="sp-compare-fill"
                      style={{ width: Math.round(Math.max(0, Math.min(1, r.score || 0)) * 100) + "%" }}
                    />
                  </span>
                  <span className="sp-compare-num">
                    {typeof r.score === "number" ? Math.round(r.score * 100) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {!suggested && String(result.strand).trim().toUpperCase() === "TVL" ? (
            <p className="sp-reality">
              TVL covers four tracks in your profile — Home Economics, ICT, Industrial Arts and
              Agri-Fishery. Open <strong>Your profile</strong> and pick the one closest to what you want to do.
            </p>
          ) : null}

          {suggested ? (
            <div className="sp-actions">
              <button
                className="sp-btn sp-btn-small"
                disabled={applied}
                onClick={async () => {
                  const next = { ...profile, strand: suggested };
                  setProfile(next);
                  await save({ profile: next });
                }}
              >
                {applied ? "Saved to your profile" : "Use " + suggested + " in my profile"}
              </button>
            </div>
          ) : null}

          <p className="sp-fineprint">
            {result.algorithm
              ? "This is a " + result.algorithm + " prediction from a model trained on past student answers, not a decision. "
              : "This is a prediction from a model trained on past student answers, not a decision. "}
            Your interests and the careers below matter more than one label.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- career match ---------------- */
const ROUTES = {
  degree: "4-year degree",
  short: "TESDA or short course",
  work: "Can start from work",
};

function fitLabel(n) {
  if (n >= 85) return "Strong fit";
  if (n >= 75) return "Good fit";
  return "Worth exploring";
}

function fitTone(n) {
  if (n >= 85) return "strong";
  if (n >= 75) return "good";
  return "open";
}

function slug(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function MatchTab({ profile, setProfile, careers, setCareers, chosen, setChosen, roadmap, setRoadmap,
  quiz, setQuiz, quizResult, setQuizResult, save, goResume }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mapBusy, setMapBusy] = useState(false);
  const [onlyNoDegree, setOnlyNoDegree] = useState(false);

  /* Best fit first, and whichever path the student picked stays pinned at the
     top so it does not slide out of view when they re-run the match. */
  const ranked = careers
    .map((c, i) => ({ ...c, order: i }))
    .sort((a, b) => {
      if (chosen && a.title === chosen) return -1;
      if (chosen && b.title === chosen) return 1;
      const d = (Number(b.fit) || 0) - (Number(a.fit) || 0);
      return d !== 0 ? d : a.order - b.order;
    });

  const noDegreeCount = careers.filter((c) => c.route && c.route !== "degree").length;
  const visible = onlyNoDegree ? ranked.filter((c) => c.route && c.route !== "degree") : ranked;

  async function run() {
    setBusy(true); setError("");
    try {
      const out = await askJSON(
        "Suggest careers for this Senior High School student.\n\n" + profileLine(profile) +
          "\n\nReturn JSON only:\n" +
          '{"careers":[{"title":"","fit":85,"route":"degree","why":"2 sentences using their own words","courses":["college course or TESDA/short course"],"skills":["skill to build now"],"firstJobs":["realistic entry-level role"],"reality":"one honest sentence about the hard part"}]}\n' +
          "Exactly 4 careers. Fit numbers 60-95, all different. Keep strings short. " +
          '"route" is exactly one of: "degree" (needs a 4-year college degree), ' +
          '"short" (TESDA, a certificate or a 2-year course), "work" (can start from an entry job or self-study).\n' +
          "At least one career must have a route that is not \"degree\".",
        GUIDE_SYSTEM
      );
      const list = Array.isArray(out.careers) ? out.careers.slice(0, 4) : [];
      if (!list.length) throw new Error("No careers came back.");
      setCareers(list);
      /* If the path they had chosen is not in the new set, clear the choice
         rather than leaving the resume pointed at a career that is gone. */
      const stillThere = list.some((c) => c.title === chosen);
      if (chosen && !stillThere) setChosen("");
      await save({ careers: list, chosen: stillThere ? chosen : "" });
    } catch (e) { setError(e.message || "Something went wrong reaching the AI service."); }
    setBusy(false);
  }

  async function buildRoadmap(title) {
    setMapBusy(true); setError("");
    try {
      const out = await askJSON(
        "Build a practical 12-month plan for a " + profile.gradeLevel +
          " student aiming at: " + title + ".\n\n" + profileLine(profile) +
          "\n\nReturn JSON only:\n" +
          '{"phases":[{"when":"Next month","focus":"short focus","actions":["concrete action they can start with no money"]}]}\n' +
          "Give 4 phases across a year. 2-3 actions each, under 16 words, specific to the Philippines where relevant.",
        GUIDE_SYSTEM
      );
      const rm = { title, phases: out.phases || [] };
      setRoadmap(rm);
      await save({ roadmap: rm });
    } catch (e) { setError(e.message || "Could not build the roadmap."); }
    setMapBusy(false);
  }

  return (
    <div className="sp-pane">
      <header className="sp-pane-head">
        <span className="sp-eyebrow">Station 02</span>
        <h2 className="sp-h2">Careers that fit what you wrote</h2>
        <p className="sp-lede">
          Starting points, not verdicts. Choose one to shape your resume, your roadmap and your
          interview practice — you can switch any time.
        </p>
      </header>

      <StrandClassifier quiz={quiz} setQuiz={setQuiz} result={quizResult} setResult={setQuizResult}
        profile={profile} setProfile={setProfile} save={save} />

      <Notice kind="error" onRetry={error ? run : null}>{error}</Notice>
      {busy ? <Loading label="Reading your profile and matching careers…" /> : null}

      {!busy && !careers.length ? (
        <Empty title="Nothing matched yet" body="Run the match once your profile has your interests and strengths in it."
          action="Match me to careers" onAction={run} />
      ) : null}

      {careers.length ? (
        <>
          {/* All four side by side, so the comparison is one glance rather than
              a scroll through four cards. */}
          <section className="sp-compare">
            <span className="sp-chip-label">How they compare</span>
            {ranked.map((c) => {
              const on = chosen === c.title;
              return (
                <button
                  key={c.title}
                  className={"sp-compare-row" + (on ? " is-chosen" : "")}
                  onClick={() => {
                    const el = document.getElementById("career-" + slug(c.title));
                    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
                  }}
                >
                  <span className="sp-compare-name">
                    {c.title}
                    {on ? <em className="sp-compare-yours">your path</em> : null}
                  </span>
                  <span className="sp-compare-track">
                    <span className="sp-compare-fill" style={{ width: Math.min(100, Math.max(0, Number(c.fit) || 0)) + "%" }} />
                  </span>
                  <span className="sp-compare-num">{Number(c.fit) || 0}</span>
                </button>
              );
            })}
          </section>

          {noDegreeCount ? (
            <div className="sp-filters">
              <button className={"sp-filter" + (!onlyNoDegree ? " is-on" : "")} onClick={() => setOnlyNoDegree(false)}>
                All {careers.length} paths
              </button>
              <button className={"sp-filter" + (onlyNoDegree ? " is-on" : "")} onClick={() => setOnlyNoDegree(true)}>
                No 4-year degree needed ({noDegreeCount})
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {visible.map((c, i) => {
        const on = chosen === c.title;
        const fit = Number(c.fit) || 0;
        return (
          <article
            key={c.title}
            id={"career-" + slug(c.title)}
            className={"sp-card sp-fade" + (on ? " is-chosen" : "")}
            style={{ animationDelay: i * 0.06 + "s" }}
          >
            <div className="sp-card-top">
              <div>
                <span className="sp-rank">{on ? "Your chosen path" : "Match " + String(i + 1).padStart(2, "0")}</span>
                <h3 className="sp-card-title">{c.title}</h3>
                <div className="sp-badges">
                  <span className={"sp-badge sp-badge-" + fitTone(fit)}>{fitLabel(fit)}</span>
                  {c.route ? <span className="sp-badge sp-badge-route">{ROUTES[c.route] || c.route}</span> : null}
                </div>
              </div>
              <Dial value={c.fit} />
            </div>

            <p className="sp-why">{c.why}</p>

            <div className="sp-chipsets">
              <div>
                <span className="sp-chip-label">Study this</span>
                <div className="sp-chips">{(c.courses || []).map((x, j) => <span key={j} className="sp-chip">{x}</span>)}</div>
              </div>
              <div>
                <span className="sp-chip-label">Build these skills</span>
                <div className="sp-chips">{(c.skills || []).map((x, j) => <span key={j} className="sp-chip sp-chip-alt">{x}</span>)}</div>
              </div>
              <div>
                <span className="sp-chip-label">First jobs</span>
                <div className="sp-chips">{(c.firstJobs || []).map((x, j) => <span key={j} className="sp-chip">{x}</span>)}</div>
              </div>
            </div>

            {c.reality ? <p className="sp-reality">Worth knowing: {c.reality}</p> : null}

            <div className="sp-actions">
              <button className={"sp-btn" + (on ? "" : " sp-btn-primary")}
                onClick={async () => { const next = on ? "" : c.title; setChosen(next); await save({ chosen: next }); }}>
                {on ? "Selected path" : "Choose this path"}
              </button>
              {on ? (
                <button className="sp-btn" onClick={() => buildRoadmap(c.title)} disabled={mapBusy}>
                  {mapBusy ? "Planning…" : roadmap && roadmap.title === c.title ? "Redo 12-month plan" : "Make a 12-month plan"}
                </button>
              ) : null}
            </div>
          </article>
        );
      })}

      {roadmap && roadmap.title === chosen && (roadmap.phases || []).length ? (
        <section className="sp-roadmap">
          <div className="sp-roadmap-head">
            <Icon name="map" size={18} />
            <h3>Twelve months toward {roadmap.title}</h3>
          </div>
          <ol className="sp-timeline">
            {roadmap.phases.map((p, i) => (
              <li key={i} className="sp-fade" style={{ animationDelay: i * 0.08 + "s" }}>
                <span className="sp-tl-dot" />
                <span className="sp-tl-when">{p.when}</span>
                <h4 className="sp-tl-focus">{p.focus}</h4>
                <ul>{(p.actions || []).map((a, j) => <li key={j}>{a}</li>)}</ul>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {careers.length && !visible.length ? (
        <p className="sp-hint">No path in this set skips the 4-year degree. Show all paths to see the full list.</p>
      ) : null}

      {careers.length ? (
        <div className="sp-actions">
          <button className="sp-btn" onClick={run} disabled={busy}>{busy ? "Matching…" : "Match again"}</button>
          <button className="sp-btn sp-btn-primary" onClick={goResume}>Build my resume</button>
          {chosen ? <span className="sp-saved"><Icon name="check" size={13} /> {chosen} shapes your resume and practice</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- resume ---------------- */
const TEMPLATES = [
  { id: "ledger", name: "Ledger", note: "Serif, ruled sections. Safe for any office." },
  { id: "signal", name: "Signal", note: "Coloured header band. Reads modern." },
  { id: "compact", name: "Compact", note: "Tight one-pager for short histories." },
];
const ACCENTS = ["#0F7B6C", "#12233C", "#B0431F", "#5B3E90"];

function resumeHTML(r, built) {
  const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (a) => ((a || []).length ? "<ul>" + a.map((b) => "<li>" + esc(b) + "</li>").join("") + "</ul>" : "");
  const sec = (t, b) => (b ? "<h2>" + t + "</h2>" + b : "");
  const contact = [r.city, r.phone, r.email].filter(Boolean).map(esc).join(" &middot; ");
  const a = r.accent || "#0F7B6C";
  const body =
    sec("Objective", built.objective ? "<p>" + esc(built.objective) + "</p>" : "") +
    sec("Education", "<p><strong>" + esc(r.school) + "</strong><br>Senior High School — " + esc(r.strand) +
      " strand, expected " + esc(r.gradYear) + (r.honors ? "<br>" + esc(r.honors) : "") + "</p>") +
    sec("Skills", (built.skills || []).length ? "<p>" + (built.skills || []).map(esc).join(" &middot; ") + "</p>" : "") +
    sec("Experience", list(built.experience)) +
    sec("Activities and Leadership", list(built.activities)) +
    sec("Achievements", list(built.achievements));

  const fonts = {
    ledger: "Georgia,'Times New Roman',serif",
    signal: "'Helvetica Neue',Arial,sans-serif",
    compact: "'Helvetica Neue',Arial,sans-serif",
  };
  const head =
    r.template === "signal"
      ? "<header style='background:" + a + ";color:#fff;padding:26px 30px;margin:-40px -30px 24px'>" +
        "<h1 style='margin:0;font-size:28px;letter-spacing:.5px'>" + esc(r.fullName || "Your name") + "</h1>" +
        "<div style='opacity:.88;font-size:13px;margin-top:5px'>" + contact + "</div></header>"
      : "<h1>" + esc(r.fullName || "Your name") + "</h1><div class='c'>" + contact + "</div>";

  const css =
    "body{font-family:" + fonts[r.template || "ledger"] + ";max-width:720px;margin:40px auto;padding:0 30px;color:#111;line-height:" +
    (r.template === "compact" ? "1.38" : "1.52") + ";font-size:" + (r.template === "compact" ? "13.5px" : "15px") + "}" +
    "h1{font-size:" + (r.template === "compact" ? "23px" : "28px") + ";margin:0 0 4px;letter-spacing:.5px}" +
    ".c{color:#555;font-size:13px;margin-bottom:18px}" +
    "h2{font-size:11.5px;text-transform:uppercase;letter-spacing:1.6px;color:" + a +
    ";border-bottom:1.5px solid " + a + ";padding-bottom:4px;margin:" + (r.template === "compact" ? "16px 0 6px" : "22px 0 8px") + "}" +
    "ul{margin:6px 0;padding-left:18px}li{margin-bottom:3px}p{margin:6px 0}" +
    "@media print{body{margin:0;max-width:none}}";

  return "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>" + esc(r.fullName || "Resume") + " — Resume</title><style>" + css + "</style></head><body>" +
    head + body + "</body></html>";
}

function resumeText(r, built) {
  const L = [];
  L.push((r.fullName || "Your name").toUpperCase());
  L.push([r.city, r.phone, r.email].filter(Boolean).join(" | "));
  if (built.objective) L.push("", "OBJECTIVE", built.objective);
  L.push("", "EDUCATION", r.school + " — Senior High School, " + r.strand + " strand, " + r.gradYear);
  if (r.honors) L.push(r.honors);
  if ((built.skills || []).length) L.push("", "SKILLS", built.skills.join(", "));
  const block = (t, arr) => { if ((arr || []).length) { L.push("", t); arr.forEach((b) => L.push("- " + b)); } };
  block("EXPERIENCE", built.experience);
  block("ACTIVITIES AND LEADERSHIP", built.activities);
  block("ACHIEVEMENTS", built.achievements);
  return L.join("\n");
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ResumeTab({ profile, resume, setResume, built, setBuilt, chosen, save }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [step, setStep] = useState("details");

  useEffect(() => {
    if (!resume.fullName && profile.fullName) {
      setResume({ ...resume, fullName: profile.fullName, school: profile.school, strand: profile.strand, city: profile.location });
    }
    /* eslint-disable-next-line */
  }, []);

  function set(k, v) { setResume({ ...resume, [k]: v }); }
  const has = built && (built.objective || (built.skills || []).length);
  const accent = resume.accent || "#0F7B6C";

  async function build() {
    setBusy(true); setError("");
    try {
      const out = await askJSON(
        "Write resume content for a Senior High School student with little or no work experience. " +
          "Use only what they gave you. Do not invent jobs, awards or numbers.\n\n" + profileLine(profile) +
          "\nTarget path: " + (chosen || "not chosen yet") +
          "\nSchool: " + resume.school + " | Strand: " + resume.strand + " | Graduating: " + resume.gradYear +
          "\nHonors: " + (resume.honors || "none") +
          "\nSkills listed: " + (resume.skillsRaw || "none") +
          "\nActivities: " + (resume.activitiesRaw || "none") +
          "\nWork or volunteer: " + (resume.experienceRaw || "none") +
          "\nAchievements: " + (resume.achievementsRaw || "none") +
          "\n\nReturn JSON only:\n" +
          '{"objective":"2 sentences, first person, no clichés","skills":["6-9 specific skills"],"experience":["past-tense bullet"],"activities":["past-tense bullet"],"achievements":["short bullet"]}\n' +
          "Each bullet starts with a strong verb, under 20 words. Empty array for anything they left blank.\n" +
          "For skills, keep the detail they gave: name the tool and what they do with it " +
          "(\"Canva poster and tarpaulin layouts\", not \"Canva\"). Do not shorten a specific skill " +
          "down to a bare app name, and do not add detail they did not write.",
        "You write clean, honest, entry-level resumes. You never fabricate experience. Plain language, no buzzwords."
      );
      setBuilt(out);
      await save({ resumeBuilt: out, resume });
      setStep("preview");
    } catch (e) { setError(e.message || "Could not build the resume right now."); }
    setBusy(false);
  }

  return (
    <div className="sp-pane">
      <header className="sp-pane-head">
        <span className="sp-eyebrow">Station 03</span>
        <h2 className="sp-h2">Build your resume</h2>
        <p className="sp-lede">
          Type things as you remember them. SmartPath rewrites them into resume bullets — it will
          not invent experience you did not list.
        </p>
      </header>

      <div className="sp-segment">
        <button className={"sp-seg" + (step === "details" ? " is-on" : "")} onClick={() => setStep("details")}>1. Your details</button>
        <button className={"sp-seg" + (step === "preview" ? " is-on" : "")} onClick={() => setStep("preview")} disabled={!has}>2. Design &amp; download</button>
      </div>

      {step === "details" ? (
        <>
          <div className="sp-grid">
            <Field label="Full name"><input className="sp-input" value={resume.fullName} onChange={(e) => set("fullName", e.target.value)} /></Field>
            <Field label="Email"><input className="sp-input" value={resume.email} onChange={(e) => set("email", e.target.value)} placeholder="you@email.com" /></Field>
            <Field label="Phone"><input className="sp-input" value={resume.phone} onChange={(e) => set("phone", e.target.value)} placeholder="09xx xxx xxxx" /></Field>
            <Picker label="City" icon="pin" value={resume.city} onChange={(v) => set("city", v)}
              groups={PH_LOCATIONS} placeholder="Click to see every city and province" />
            <Picker label="School" icon="school" value={resume.school} onChange={(v) => set("school", v)}
              groups={schoolsForCity(resume.city)} placeholder="Click to see the list, or type your school" />
            <Field label="Graduating year"><input className="sp-input" value={resume.gradYear} onChange={(e) => set("gradYear", e.target.value)} /></Field>
          </div>

          <Field label="Honors or academic standing" hint="Leave blank if none. That is normal.">
            <input className="sp-input" value={resume.honors} onChange={(e) => set("honors", e.target.value)} placeholder="With Honors, SY 2024-2025" />
          </Field>
          <Field label="Skills" hint="Name the tool and what you do with it, not just the app name.">
            <textarea className="sp-input sp-textarea" rows={4} value={resume.skillsRaw} onChange={(e) => set("skillsRaw", e.target.value)}
              placeholder="Canva poster and tarpaulin layouts, Excel formulas and charts, video editing in CapCut, Filipino and English, public speaking" />
          </Field>
          <Field label="Activities, clubs, positions" hint="School organizations, church, sports, barangay, online communities.">
            <textarea className="sp-input sp-textarea" rows={3} value={resume.activitiesRaw} onChange={(e) => set("activitiesRaw", e.target.value)}
              placeholder="Secretary of the student council, layout artist for the school paper" />
          </Field>
          <Field label="Work, volunteer or business" hint="Includes helping in a family store or paid gigs. Blank is fine.">
            <textarea className="sp-input sp-textarea" rows={3} value={resume.experienceRaw} onChange={(e) => set("experienceRaw", e.target.value)}
              placeholder="Helped at our sari-sari store on weekends, sold prints of my drawings online" />
          </Field>
          <Field label="Achievements">
            <textarea className="sp-input sp-textarea" rows={2} value={resume.achievementsRaw} onChange={(e) => set("achievementsRaw", e.target.value)}
              placeholder="2nd place, regional science quiz bee 2025" />
          </Field>

          <Notice kind="error" onRetry={error ? build : null}>{error}</Notice>

          <div className="sp-actions">
            <button className="sp-btn sp-btn-primary" onClick={build} disabled={busy}>
              {busy ? "Writing…" : has ? "Rewrite resume" : "Write my resume"}
            </button>
            <button className="sp-btn" onClick={() => save({ resume })}>Save details</button>
          </div>
          {busy ? <Loading label="Turning your notes into resume bullets…" /> : null}
        </>
      ) : null}

      {step === "preview" && has ? (
        <>
          <div className="sp-designbar">
            <div>
              <span className="sp-chip-label">Template</span>
              <div className="sp-templates">
                {TEMPLATES.map((t) => (
                  <button key={t.id} className={"sp-template" + (resume.template === t.id ? " is-on" : "")}
                    onClick={() => { const r = { ...resume, template: t.id }; setResume(r); save({ resume: r }); }}>
                    <span className={"sp-thumb sp-thumb-" + t.id} aria-hidden="true">
                      <i /><i /><i /><i />
                    </span>
                    <strong>{t.name}</strong>
                    <em>{t.note}</em>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="sp-chip-label">Accent colour</span>
              <div className="sp-swatches">
                {ACCENTS.map((c) => (
                  <button key={c} className={"sp-swatch" + (accent === c ? " is-on" : "")} style={{ background: c }}
                    aria-label={"Accent " + c}
                    onClick={() => { const r = { ...resume, accent: c }; setResume(r); save({ resume: r }); }} />
                ))}
              </div>
            </div>
          </div>

          <div className="sp-preview-head">
            <span className="sp-eyebrow">Preview</span>
            <div className="sp-preview-actions">
              <button className="sp-btn sp-btn-small" onClick={() =>
                download((resume.fullName || "resume").replace(/\s+/g, "-").toLowerCase() + "-resume.html", resumeHTML(resume, built), "text/html")}>
                <Icon name="down" size={14} /> Download
              </button>
              <button className="sp-btn sp-btn-small" onClick={async () => {
                try { await navigator.clipboard.writeText(resumeText(resume, built)); setCopied("Copied as plain text"); }
                catch (e) { setCopied("Copying is blocked here — use Download instead"); }
                setTimeout(() => setCopied(""), 2500);
              }}>Copy text</button>
              <button className="sp-btn sp-btn-small" onClick={build} disabled={busy}>{busy ? "…" : "Rewrite"}</button>
            </div>
          </div>
          {copied ? <span className="sp-saved">{copied}</span> : null}

          <div className={"sp-paper sp-paper-" + (resume.template || "ledger")} style={{ "--accent": accent }}>
            {resume.template === "signal" ? (
              <div className="sp-r-band" style={{ background: accent }}>
                <h3 className="sp-r-name">{resume.fullName || "Your name"}</h3>
                <p className="sp-r-contact">{[resume.city, resume.phone, resume.email].filter(Boolean).join(" · ")}</p>
              </div>
            ) : (
              <>
                <h3 className="sp-r-name">{resume.fullName || "Your name"}</h3>
                <p className="sp-r-contact">{[resume.city, resume.phone, resume.email].filter(Boolean).join(" · ")}</p>
              </>
            )}

            {built.objective ? (<><h4 className="sp-r-h">Objective</h4><p className="sp-r-p">{built.objective}</p></>) : null}
            <h4 className="sp-r-h">Education</h4>
            <p className="sp-r-p">
              <strong>{resume.school || "Your school"}</strong><br />
              Senior High School — {resume.strand} strand, expected {resume.gradYear}
              {resume.honors ? (<><br />{resume.honors}</>) : null}
            </p>
            {(built.skills || []).length ? (<><h4 className="sp-r-h">Skills</h4><p className="sp-r-p">{built.skills.join(" · ")}</p></>) : null}
            {[["Experience", built.experience], ["Activities and Leadership", built.activities], ["Achievements", built.achievements]]
              .map(([t, arr]) => (arr || []).length ? (
                <div key={t}>
                  <h4 className="sp-r-h">{t}</h4>
                  <ul className="sp-r-ul">{arr.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
              ) : null)}
          </div>

          <p className="sp-fineprint">
            The download is an HTML file with your chosen template baked in. Open it, then use
            Print → Save as PDF on phone or computer.
          </p>
        </>
      ) : null}
    </div>
  );
}

/* ---------------- interview ---------------- */
function InterviewTab({ profile, chosen, prep, setPrep, scores, setScores, save }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openIdx, setOpenIdx] = useState(-1);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const [secs, setSecs] = useState(0);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function load() {
    setBusy(true); setError("");
    try {
      const out = await askJSON(
        "Prepare interview practice for a Senior High School student applying for " +
          (chosen ? "a role in " + chosen : "an entry-level job or a college interview") + ".\n\n" +
          profileLine(profile) + "\n\nReturn JSON only:\n" +
          '{"tips":["5 short specific tips for a first-time interviewee"],"questions":[{"q":"question","tip":"how to answer in one sentence, using their background"}]}\n' +
          "Give 6 questions: common ones plus 2 specific to that path. Keep strings short.",
        GUIDE_SYSTEM
      );
      setPrep(out);
      await save({ prep: out });
    } catch (e) { setError(e.message || "Could not load interview prep."); }
    setBusy(false);
  }

  async function check(q, idx) {
    if (answer.trim().length < 10) { setResult({ score: 0, note: "Write a bit more first — a sentence or two at least." }); return; }
    setChecking(true); setResult(null); setRunning(false);
    try {
      const out = await askJSON(
        "A Senior High School student is practising for an interview.\n" + profileLine(profile) +
          "\n\nQuestion: " + q + "\nTheir answer: " + answer +
          "\n\nReturn JSON only:\n" +
          '{"score":4,"strong":"what worked, one sentence","fix":"the one thing to change, one sentence","better":"a sharper 2-sentence version in their voice"}\n' +
          "Score 1-5. Be encouraging but honest.",
        GUIDE_SYSTEM
      );
      setResult(out);
      const next = { ...scores, [q]: out.score };
      setScores(next);
      await save({ scores: next });
    } catch (e) { setResult({ score: 0, note: "Could not reach the AI service. Try once more." }); }
    setChecking(false);
  }

  const questions = (prep && prep.questions) || [];
  const answered = Object.keys(scores || {}).length;
  const avg = answered ? (Object.values(scores).reduce((a, b) => a + b, 0) / answered).toFixed(1) : null;
  const mmss = String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");

  return (
    <div className="sp-pane">
      <header className="sp-pane-head">
        <span className="sp-eyebrow">Station 04</span>
        <h2 className="sp-h2">Practice the interview</h2>
        <p className="sp-lede">
          {chosen
            ? "Questions tuned to " + chosen + ". Answer one out loud, then type it and get scored."
            : "Pick a career path first for sharper questions, or practise the general ones now."}
        </p>
        {answered ? (
          <div className="sp-scorebar">
            <span><strong>{answered}</strong> answered</span>
            <span className="sp-scoresep" />
            <span>average <strong>{avg}</strong>/5</span>
            <Stars n={Math.round(avg)} />
          </div>
        ) : null}
      </header>

      <Notice kind="error" onRetry={error ? load : null}>{error}</Notice>
      {busy ? <Loading label="Writing your practice questions…" /> : null}

      {!busy && !questions.length ? (
        <Empty title="No questions yet" body="Generate a set based on your profile and chosen path."
          action="Get my questions" onAction={load} />
      ) : null}

      {prep && (prep.tips || []).length ? (
        <div className="sp-tips">
          <span className="sp-chip-label">Before you walk in</span>
          <ul>{prep.tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
        </div>
      ) : null}

      {questions.map((item, i) => (
        <article key={i} className="sp-card">
          <button className="sp-q" onClick={() => {
            const opening = openIdx !== i;
            setOpenIdx(opening ? i : -1);
            setAnswer(""); setResult(null); setSecs(0); setRunning(false);
          }}>
            <span className="sp-q-num">Q{i + 1}</span>
            <span className="sp-q-text">{item.q}</span>
            {scores[item.q] ? <Stars n={scores[item.q]} /> : null}
            <span className="sp-q-caret">{openIdx === i ? "−" : "+"}</span>
          </button>

          {openIdx === i ? (
            <div className="sp-q-body">
              <p className="sp-reality">How to approach it: {item.tip}</p>
              <div className="sp-timerrow">
                <span className={"sp-timer" + (running ? " is-live" : "")}>{mmss}</span>
                <button className="sp-btn sp-btn-small" onClick={() => setRunning(!running)}>
                  {running ? "Pause" : secs ? "Resume" : "Start timer"}
                </button>
                <button className="sp-btn sp-btn-small" onClick={() => { setSecs(0); setRunning(false); }}>Reset</button>
                <span className="sp-hint">Aim for 60–90 seconds spoken.</span>
              </div>
              <textarea className="sp-input sp-textarea" rows={4} value={answer}
                onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer the way you would say it." />
              <div className="sp-actions">
                <button className="sp-btn sp-btn-primary" onClick={() => check(item.q, i)} disabled={checking}>
                  {checking ? "Reading…" : "Score my answer"}
                </button>
              </div>
              {result ? (
                <div className="sp-feedback">
                  {result.score ? (
                    <>
                      <div className="sp-fb-head"><Stars n={result.score} /><span>{result.score}/5</span></div>
                      <p><strong>Worked:</strong> {result.strong}</p>
                      <p><strong>Fix:</strong> {result.fix}</p>
                      {result.better ? <p className="sp-fb-better"><strong>Try saying:</strong> {result.better}</p> : null}
                    </>
                  ) : (<p>{result.note}</p>)}
                </div>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}

      {questions.length ? (
        <div className="sp-actions">
          <button className="sp-btn" onClick={load} disabled={busy}>New set of questions</button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- advice ---------------- */
function AdviceTab({ profile, chosen, chat, setChat, save }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const seen = useRef({ len: chat.length, busy });

  /* Follow the conversation when it actually grows, rather than on every
     render. Opening this tab used to scroll the page and push the heading out
     of sight before the student had read it. Comparing against the previous
     length (instead of guarding on first paint) also keeps the behaviour the
     same under StrictMode, which runs effects twice in development. */
  useEffect(() => {
    const grew = chat.length > seen.current.len;
    const startedThinking = busy && !seen.current.busy;
    seen.current = { len: chat.length, busy };
    if ((grew || startedThinking) && endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [chat, busy]);

  const starters = [
    "What can I do this school year to prepare?",
    "How do I explain a low grade in an interview?",
    "Is it okay to work first before college?",
    "What scholarships should I look into?",
  ];

  async function send(msg) {
    const content = (msg || text).trim();
    if (!content || busy) return;
    const next = [...chat, { role: "user", content }];
    setChat(next); setText(""); setBusy(true);
    try {
      const reply = await askClaude(
        next.slice(-10),
        GUIDE_SYSTEM + "\n\nThe student's profile:\n" + profileLine(profile) +
          "\nChosen path: " + (chosen || "none yet") +
          "\nKeep answers under 150 words unless they ask for more. No headings."
      );
      const done = [...next, { role: "assistant", content: reply }];
      setChat(done);
      await save({ chat: done });
    } catch (e) {
      setChat([...next, { role: "assistant", content: "I could not reach the AI service just now. Send that again in a moment." }]);
    }
    setBusy(false);
  }

  return (
    <div className="sp-pane sp-pane-chat">
      <header className="sp-pane-head">
        <span className="sp-eyebrow">Station 05</span>
        <h2 className="sp-h2">Ask SmartPath anything</h2>
        <p className="sp-lede">
          Career questions, college worries, what to do next. For personal or mental-health
          concerns, talk to your guidance counselor.
        </p>
        {chat.length ? (
          <button className="sp-link" onClick={async () => { setChat([]); await save({ chat: [] }); }}>Clear conversation</button>
        ) : null}
      </header>

      <div className="sp-chat">
        {!chat.length ? (
          <div className="sp-starters">
            {starters.map((s, i) => <button key={i} className="sp-starter" onClick={() => send(s)}>{s}</button>)}
          </div>
        ) : null}
        {chat.map((m, i) => (
          <div key={i} className={"sp-msg " + (m.role === "user" ? "sp-msg-you" : "sp-msg-ai")}>{m.content}</div>
        ))}
        {busy ? <div className="sp-msg sp-msg-ai sp-msg-wait">Thinking…</div> : null}
        <div ref={endRef} />
      </div>

      <div className="sp-composer">
        <textarea className="sp-input sp-textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type your question…" />
        <button className="sp-btn sp-btn-primary" onClick={() => send()} disabled={busy}>Send</button>
      </div>
    </div>
  );
}

/* ---------------- app ---------------- */
export default function SmartPath() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  /* Theme is a device preference, not a per-account one, so it lives outside
     the signed-in data and survives sign-out. */
  const [theme, setTheme] = useState("light");
  const [tab, setTab] = useState("home");
  const [profile, setProfile] = useState(blankProfile);
  const [careers, setCareers] = useState([]);
  const [chosen, setChosen] = useState("");
  const [roadmap, setRoadmap] = useState(null);
  const [resume, setResume] = useState(blankResume);
  const [built, setBuilt] = useState(null);
  const [prep, setPrep] = useState(null);
  const [scores, setScores] = useState({});
  const [chat, setChat] = useState([]);
  const [quiz, setQuiz] = useState(blankQuiz);
  const [quizResult, setQuizResult] = useState(null);

  useEffect(() => {
    (async () => {
      const saved = await store.get("theme");
      if (saved === "dark" || saved === "light") setTheme(saved);
      else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");

      const s = await store.get("session");
      if (s && s.username) await loadUser(s.username);
      setReady(true);
    })();
    /* eslint-disable-next-line */
  }, []);

  async function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    await store.set("theme", next);
  }

  async function loadUser(u) {
    const d = (await store.get("data:" + u)) || {};
    setProfile({ ...blankProfile, ...(d.profile || {}) });
    setCareers(d.careers || []);
    setChosen(d.chosen || "");
    setRoadmap(d.roadmap || null);
    setResume({ ...blankResume, ...(d.resume || {}) });
    setBuilt(d.resumeBuilt || null);
    setPrep(d.prep || null);
    setScores(d.scores || {});
    setChat(d.chat || []);
    setQuiz({ ...blankQuiz, ...(d.quiz || {}) });
    setQuizResult(d.quizResult || null);
    setUser(u);
    setTab("home");
  }

  async function save(patch) {
    if (!user) return;
    const current = (await store.get("data:" + user)) || {};
    await store.set("data:" + user, {
      ...current, profile, careers, chosen, roadmap, resume,
      resumeBuilt: built, prep, scores, chat, quiz, quizResult, ...(patch || {}),
    });
  }

  async function signOut() {
    await store.set("session", {});
    setUser(null); setProfile(blankProfile); setCareers([]); setChosen("");
    setRoadmap(null); setResume(blankResume); setBuilt(null); setPrep(null);
    setScores({}); setChat([]); setQuiz(blankQuiz); setQuizResult(null); setTab("home");
  }

  const done = {
    home: true,
    profile: profile.interests.length > 2 && profile.strengths.length > 2,
    match: careers.length > 0,
    resume: !!(built && built.objective),
    interview: Object.keys(scores).length > 0,
    advice: chat.length > 0,
  };

  if (!ready)
    return (<div className="sp-root" data-theme={theme}><Styles /><div className="sp-boot"><span className="sp-pulse" /> Loading SmartPath…</div></div>);

  if (!user)
    return (<div className="sp-root" data-theme={theme}><Styles /><AuthScreen onSignedIn={loadUser} /></div>);

  return (
    <div className="sp-root sp-app" data-theme={theme}>
      <Styles />
      <Rail tab={tab} setTab={setTab} done={done} user={user} onSignOut={signOut}
        theme={theme} onToggleTheme={toggleTheme} />

      <div className="sp-mobilebar">
        <span className="sp-mark sp-mark-small">SmartPath</span>
        <div className="sp-mobilebar-actions">
          <ThemeSwitch theme={theme} onToggle={toggleTheme} className="sp-themeswitch-onpanel" />
          <button className="sp-link" onClick={signOut}>Sign out</button>
        </div>
      </div>

      <main className="sp-main" key={tab}>
        {tab === "home" ? (
          <OverviewTab profile={profile} careers={careers} chosen={chosen} built={built}
            prep={prep} practiced={Object.keys(scores).length} done={done} setTab={setTab} />
        ) : null}
        {tab === "profile" ? (
          <ProfileTab profile={profile} setProfile={setProfile} onSaved={() => save({ profile })}
            goMatch={() => { save({ profile }); setTab("match"); }} />
        ) : null}
        {tab === "match" ? (
          <MatchTab profile={profile} setProfile={setProfile} careers={careers} setCareers={setCareers}
            chosen={chosen} setChosen={setChosen} roadmap={roadmap} setRoadmap={setRoadmap}
            quiz={quiz} setQuiz={setQuiz} quizResult={quizResult} setQuizResult={setQuizResult}
            save={save} goResume={() => setTab("resume")} />
        ) : null}
        {tab === "resume" ? (
          <ResumeTab profile={profile} resume={resume} setResume={setResume} built={built}
            setBuilt={setBuilt} chosen={chosen} save={save} />
        ) : null}
        {tab === "interview" ? (
          <InterviewTab profile={profile} chosen={chosen} prep={prep} setPrep={setPrep}
            scores={scores} setScores={setScores} save={save} />
        ) : null}
        {tab === "advice" ? (
          <AdviceTab profile={profile} chosen={chosen} chat={chat} setChat={setChat} save={save} />
        ) : null}
      </main>

      <nav className="sp-tabbar">
        {STATIONS.map((s) => (
          <button key={s.id} className={"sp-tabbtn" + (tab === s.id ? " is-on" : "")} onClick={() => setTab(s.id)}>
            <Icon name={s.icon} size={19} />
            {s.short}
          </button>
        ))}
      </nav>
    </div>
  );
}

/* ---------------- styles ---------------- */
function Styles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');

.sp-root{
  /* text + page */
  --ink:#12233C; --ink-2:#1B3358; --ink-soft:#4A5C77; --paper:#E9EDF2; --card:#FFFFFF;
  --signal:#F2B134; --route:#0F7B6C; --coral:#D8523E; --line:#CBD5E0;
  /* the navy panel stays dark in both themes: rail, hero, primary buttons */
  --panel:#12233C; --panel-2:#1B3358; --panel-dot:#16294A; --on-panel:#FFFFFF;
  /* surfaces that used to be hard-coded */
  --track:#DDE4EB; --chip:#EEF2F6; --btn-hover:#F4F6F9; --btn-line:#12233C;
  --dots:rgba(18,35,60,.055);
  --warm-bg:#FDF3DE; --warm-line:#EBD5A3; --warm-ink:#6A4E12;
  --err-bg:#FBE9E5; --err-line:#EEBBB0; --err-ink:#8A2B19;
  --display:'Archivo',system-ui,sans-serif;
  --body:'Inter',system-ui,-apple-system,sans-serif;
  --mono:'IBM Plex Mono',ui-monospace,monospace;
  background:var(--paper);
  background-image:radial-gradient(circle at 1px 1px, var(--dots) 1px, transparent 0);
  background-size:22px 22px;
  color:var(--ink); font-family:var(--body); min-height:100vh; -webkit-font-smoothing:antialiased;
  transition:background-color .18s ease,color .18s ease;
}

/* dark mode — only the tokens change, no layout rules are duplicated */
.sp-root[data-theme="dark"]{
  --ink:#E6EDF6; --ink-2:#C7D5E6; --ink-soft:#9DB0C9; --paper:#0C1421; --card:#151F31;
  --route:#43C2A6; --line:#2A3852;
  --panel:#172A46; --panel-2:#20375B; --panel-dot:#2E4571; --on-panel:#FFFFFF;
  --track:#25344B; --chip:#1D2A40; --btn-hover:#1E2B41; --btn-line:#3A4C6D;
  --dots:rgba(255,255,255,.05);
  --warm-bg:#2E2413; --warm-line:#5A4720; --warm-ink:#F3D79A;
  --err-bg:#33191A; --err-line:#6B3129; --err-ink:#F6B7A9;
  color-scheme:dark;
}
.sp-root *{box-sizing:border-box}
.sp-root button{font-family:inherit}
.sp-root :focus-visible{outline:3px solid var(--signal); outline-offset:2px}

.sp-boot{display:flex;align-items:center;gap:10px;justify-content:center;height:100vh;color:var(--ink-soft);font-size:14px}
.sp-pulse{width:9px;height:9px;border-radius:50%;background:var(--route);animation:sp-pulse 1.1s ease-in-out infinite}
@keyframes sp-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}
@keyframes sp-fade{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
@keyframes sp-draw{from{stroke-dashoffset:900}to{stroke-dashoffset:0}}
@keyframes sp-pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
.sp-fade{animation:sp-fade .38s ease both}
.sp-main{animation:sp-fade .3s ease both}
@media (prefers-reduced-motion:reduce){
  .sp-pulse,.sp-fade,.sp-main,.sp-routemap-line,.sp-routemap-stop,.sp-auth-path,.sp-auth-node,.sp-dial-arc{animation:none!important;transition:none!important;stroke-dashoffset:0!important;opacity:1!important}
}

/* type */
.sp-h1{font-family:var(--display);font-weight:800;font-size:clamp(30px,6vw,46px);line-height:1.02;letter-spacing:-.02em;margin:10px 0 12px}
.sp-h2{font-family:var(--display);font-weight:800;font-size:clamp(22px,4vw,30px);line-height:1.1;letter-spacing:-.015em;margin:6px 0 8px}
.sp-eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--route)}
.sp-eyebrow-light{color:var(--signal)}
.sp-lede{color:var(--ink-soft);font-size:15px;line-height:1.55;margin:0}
.sp-fineprint{color:var(--ink-soft);font-size:12px;line-height:1.5;margin-top:14px}
.sp-hint{color:var(--ink-soft);font-size:12px;line-height:1.4}
.sp-saved{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:12px;color:var(--route)}

/* auth */
.sp-auth{display:flex;min-height:100vh}
.sp-auth-art{position:relative;flex:0 0 32%;background:var(--panel);overflow:hidden;display:none}
.sp-auth-svg{width:100%;height:100%}
.sp-auth-path{stroke-dasharray:900;animation:sp-draw 1.6s ease .1s both}
.sp-auth-node{animation:sp-pop .5s cubic-bezier(.2,1.4,.4,1) both}
.sp-auth-card{flex:1;max-width:560px;margin:0 auto;padding:40px 22px 60px;display:flex;flex-direction:column;justify-content:center}
@media(min-width:820px){.sp-auth-art{display:block}.sp-auth-card{padding:56px 60px}}

.sp-tabs{display:flex;margin:26px 0 20px;border-bottom:2px solid var(--line)}
.sp-tab{flex:1;background:none;border:none;padding:11px 8px;font-size:14px;font-weight:600;color:var(--ink-soft);cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px}
.sp-tab.is-on{color:var(--ink);border-bottom-color:var(--signal)}

/* fields */
.sp-field{display:block;margin-bottom:16px}
.sp-label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
.sp-input{width:100%;padding:11px 13px;font-size:16px;font-family:var(--body);color:var(--ink);
  background:var(--card);border:1.5px solid var(--line);border-radius:3px;transition:border-color .12s,box-shadow .12s}
.sp-input:focus{border-color:var(--route);box-shadow:0 0 0 3px rgba(15,123,108,.12)}
.sp-textarea{resize:vertical;line-height:1.5}
.sp-grid{display:grid;grid-template-columns:1fr;gap:0 16px}
@media(min-width:640px){.sp-grid{grid-template-columns:1fr 1fr}}
.sp-meter{height:5px;background:var(--track);border-radius:99px;margin:14px 0 5px;overflow:hidden;max-width:280px}
.sp-meter span{display:block;height:100%;background:var(--signal);border-radius:99px;transition:width .3s}

/* buttons */
.sp-btn{display:inline-flex;align-items:center;gap:6px;background:var(--card);color:var(--ink);
  border:1.5px solid var(--btn-line);border-radius:3px;padding:11px 18px;font-size:14px;font-weight:600;
  cursor:pointer;transition:transform .1s,background .12s}
.sp-btn:hover{background:var(--btn-hover)}
.sp-btn:active{transform:translateY(1px)}
.sp-btn:disabled{opacity:.4;cursor:not-allowed}
.sp-btn-primary{background:var(--panel);color:var(--on-panel)}
.sp-btn-primary:hover{background:var(--panel-2)}
.sp-btn-signal{background:var(--signal);border-color:var(--signal);color:#12233C}
.sp-btn-signal:hover{background:#FFC356}
.sp-btn-wide{width:100%;justify-content:center}
.sp-btn-small{padding:7px 12px;font-size:13px}
.sp-link{background:none;border:none;color:var(--route);font-size:13px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline}
.sp-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:16px 0}

/* layout */
.sp-app{display:block;padding-bottom:76px}
.sp-rail{display:none}
.sp-main{max-width:780px;margin:0 auto;padding:18px 16px 40px}
.sp-mobilebar{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;
  background:var(--panel);color:var(--on-panel);position:sticky;top:0;z-index:20}
.sp-mobilebar .sp-link{color:var(--signal)}
/* tab bar */
.sp-tabbar{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--card);
  border-top:1.5px solid var(--line);z-index:30;padding-bottom:env(safe-area-inset-bottom)}
.sp-tabbtn{flex:1;background:none;border:none;padding:8px 1px 10px;font-size:10px;font-weight:600;
  color:var(--ink-soft);cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
.sp-tabbtn.is-on{color:var(--ink)}
.sp-tabbtn.is-on svg{color:var(--route)}

@media(min-width:900px){
  .sp-app{display:grid;grid-template-columns:278px 1fr;padding-bottom:0}
  .sp-rail{display:flex;flex-direction:column;justify-content:space-between;background:var(--panel);
    color:var(--on-panel);padding:30px 24px;min-height:100vh;position:sticky;top:0}
  .sp-mobilebar,.sp-tabbar{display:none}
  .sp-main{padding:44px 44px 80px;margin:0;max-width:860px}
}

/* rail */
.sp-mark{font-family:var(--display);font-weight:800;font-size:21px;letter-spacing:-.02em;display:block}
.sp-route-title .sp-mark{margin-bottom:0}
.sp-mark-small{font-size:16px}
.sp-sub{font-size:12px;color:#9FB0C6;display:block;margin-top:3px}
.sp-route-head{margin-bottom:26px}
.sp-stations{list-style:none;margin:0;padding:0;position:relative}
.sp-stations:before{content:"";position:absolute;left:7px;top:14px;bottom:14px;width:2px;background:#2C4468}
.sp-station{position:relative;display:flex;align-items:center;gap:11px;width:100%;background:none;border:none;
  padding:10px 0;cursor:pointer;color:#9FB0C6;text-align:left}
.sp-dot{width:16px;height:16px;border-radius:50%;background:var(--panel);border:2px solid #46618A;flex:0 0 auto;
  z-index:1;display:flex;align-items:center;justify-content:center;color:#fff;transition:all .15s}
.sp-station.is-done .sp-dot{background:var(--route);border-color:var(--route)}
.sp-station.is-active{color:#fff}
.sp-station.is-active .sp-dot{background:var(--signal);border-color:var(--signal);box-shadow:0 0 0 4px rgba(242,177,52,.22)}
.sp-station-num{font-family:var(--mono);font-size:11px;opacity:.6}
.sp-station-name{font-size:14px;font-weight:600}
.sp-rail-foot{display:flex;flex-direction:column;gap:6px;padding-top:20px;border-top:1px solid #2C4468}
.sp-user{font-size:12px;color:#9FB0C6}
.sp-rail-foot .sp-link{color:var(--signal);align-self:flex-start}

/* hero */
.sp-hero{background:var(--panel);color:var(--on-panel);border-radius:6px;padding:26px 22px;margin-bottom:18px;
  display:grid;gap:16px;position:relative;overflow:hidden}
.sp-hero:after{content:"";position:absolute;right:-40px;top:-40px;width:150px;height:150px;border-radius:50%;
  background:radial-gradient(circle,rgba(242,177,52,.18),transparent 70%)}
.sp-hero-h{font-family:var(--display);font-weight:800;font-size:clamp(23px,5vw,31px);margin:8px 0 8px;letter-spacing:-.02em}
.sp-hero-p{color:#B9C7D9;font-size:14.5px;line-height:1.55;margin:0 0 16px;max-width:44ch}
.sp-hero-map{position:relative;z-index:1}
.sp-routemap{width:100%;max-width:330px;height:auto}
.sp-routemap-line{stroke-dasharray:400;animation:sp-draw 1.3s ease .15s both}
.sp-routemap-stop{animation:sp-pop .45s cubic-bezier(.2,1.4,.4,1) both}
.sp-routemap-label{font-family:var(--mono);font-size:9.5px;fill:#93A6BE;letter-spacing:.06em}
@media(min-width:700px){.sp-hero{grid-template-columns:1.05fr .95fr;align-items:center;padding:34px 32px}}

/* stats + tiles */
.sp-stat-row{margin-bottom:16px}
.sp-stat{display:flex;align-items:center;gap:14px;background:var(--card);border:1.5px solid var(--line);
  border-radius:5px;padding:14px 18px}
.sp-stat-label{display:block;font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft)}
.sp-stat-value{display:block;font-family:var(--display);font-weight:700;font-size:17px;margin-top:3px}
.sp-dial-txt{font-family:var(--mono);font-size:15px;fill:var(--ink);font-weight:600}
.sp-dial-arc{transition:stroke-dashoffset .6s ease}

.sp-tiles{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-bottom:18px}
@media(min-width:760px){.sp-tiles{grid-template-columns:repeat(4,1fr)}}
.sp-tile{text-align:left;background:var(--card);border:1.5px solid var(--line);border-radius:5px;
  padding:14px 13px;cursor:pointer;display:flex;flex-direction:column;gap:5px;transition:border-color .14s,transform .1s}
.sp-tile:hover{border-color:var(--route);transform:translateY(-2px)}
.sp-tile.is-done{border-left:4px solid var(--route)}
.sp-tile-icon{color:var(--route)}
.sp-tile-label{font-family:var(--mono);font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:var(--ink-soft)}
.sp-tile-value{font-size:14px;font-weight:600;line-height:1.35}
.sp-tile-cta{font-size:12px;color:var(--route);font-weight:600;margin-top:3px}

.sp-quote{display:flex;gap:11px;align-items:flex-start;background:var(--warm-bg);border:1px solid var(--warm-line);
  border-radius:5px;padding:14px 16px;color:var(--warm-ink)}
.sp-quote p{margin:0;font-size:13.5px;line-height:1.55}
.sp-quote svg{flex:0 0 auto;margin-top:1px}

/* panes + cards */
.sp-pane-head{margin-bottom:22px}
.sp-pane-chat{display:flex;flex-direction:column}
.sp-card{background:var(--card);border:1.5px solid var(--line);border-radius:5px;padding:18px;margin-bottom:14px}
.sp-card.is-chosen{border-color:var(--route);box-shadow:inset 4px 0 0 var(--route)}
.sp-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
.sp-rank{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft)}
.sp-card-title{font-family:var(--display);font-weight:700;font-size:19px;margin:4px 0 0;letter-spacing:-.01em}
.sp-why{font-size:14px;line-height:1.6;margin:12px 0 14px}
.sp-chipsets{display:grid;gap:11px}
.sp-chip-label{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);display:block;margin-bottom:6px}
.sp-chips{display:flex;flex-wrap:wrap;gap:6px}
.sp-chip{font-size:12.5px;padding:4px 9px;background:var(--chip);border:1px solid var(--line);border-radius:99px}
.sp-chip-alt{background:var(--warm-bg);border-color:var(--warm-line);color:var(--warm-ink)}
.sp-reality{font-size:13px;line-height:1.55;color:var(--ink-soft);margin:13px 0 0;padding-left:11px;border-left:3px solid var(--signal)}

/* roadmap timeline */
.sp-roadmap{background:var(--card);border:1.5px solid var(--line);border-radius:5px;padding:20px 18px;margin:20px 0}
.sp-roadmap-head{display:flex;align-items:center;gap:9px;color:var(--route);margin-bottom:16px}
.sp-roadmap-head h3{font-family:var(--display);font-weight:700;font-size:17px;margin:0;color:var(--ink)}
.sp-timeline{list-style:none;margin:0;padding:0 0 0 22px;position:relative}
.sp-timeline:before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:2px;background:var(--line)}
.sp-timeline>li{position:relative;padding-bottom:18px}
.sp-timeline>li:last-child{padding-bottom:0}
.sp-tl-dot{position:absolute;left:-22px;top:4px;width:12px;height:12px;border-radius:50%;
  background:var(--card);border:3px solid var(--route)}
.sp-tl-when{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--route)}
.sp-tl-focus{font-family:var(--display);font-weight:700;font-size:15.5px;margin:3px 0 6px}
.sp-timeline ul{margin:0;padding-left:17px;font-size:13.5px;line-height:1.55;color:var(--ink-soft)}
.sp-timeline ul li{margin-bottom:3px}

/* notices */
.sp-notice{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13.5px;padding:11px 13px;
  border-radius:3px;background:var(--warm-bg);border:1px solid var(--warm-line);color:var(--warm-ink);margin:12px 0}
.sp-notice-error{background:var(--err-bg);border-color:var(--err-line);color:var(--err-ink)}
.sp-loading{display:flex;align-items:center;gap:9px;font-size:13.5px;color:var(--ink-soft);padding:16px 0}
.sp-empty{background:var(--card);border:1.5px dashed var(--line);border-radius:5px;padding:26px 20px;text-align:center}
.sp-empty-art{color:var(--line);display:flex;justify-content:center;margin-bottom:6px}
.sp-empty h3{font-family:var(--display);font-size:18px;margin:0 0 6px}
.sp-empty p{color:var(--ink-soft);font-size:14px;margin:0 0 16px}

/* resume design */
.sp-segment{display:flex;gap:6px;margin-bottom:20px}
.sp-seg{flex:1;background:var(--card);border:1.5px solid var(--line);border-radius:3px;padding:10px 8px;
  font-size:13px;font-weight:600;color:var(--ink-soft);cursor:pointer}
.sp-seg.is-on{background:var(--panel);border-color:var(--panel);color:var(--on-panel)}
.sp-seg:disabled{opacity:.45;cursor:not-allowed}
.sp-designbar{display:grid;gap:18px;background:var(--card);border:1.5px solid var(--line);
  border-radius:5px;padding:16px;margin-bottom:18px}
.sp-templates{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.sp-template{background:none;border:1.5px solid var(--line);border-radius:4px;padding:9px;cursor:pointer;text-align:left}
.sp-template.is-on{border-color:var(--route);box-shadow:0 0 0 2px rgba(15,123,108,.14)}
.sp-template strong{display:block;font-size:13px;margin-top:7px}
.sp-template em{display:block;font-style:normal;font-size:10.5px;color:var(--ink-soft);line-height:1.35;margin-top:2px}
.sp-thumb{display:block;height:42px;background:var(--chip);border:1px solid var(--line);padding:5px;position:relative}
.sp-thumb i{display:block;background:var(--track);height:3px;margin-bottom:4px;border-radius:1px}
.sp-thumb i:first-child{background:var(--panel);height:5px;width:60%}
.sp-thumb-signal i:first-child{background:var(--route);height:11px;width:100%;margin:-5px -5px 5px;padding:0;width:calc(100% + 10px)}
.sp-thumb-compact i{height:2px;margin-bottom:2.5px}
.sp-swatches{display:flex;gap:8px}
.sp-swatch{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.sp-swatch.is-on{border-color:var(--route);box-shadow:0 0 0 2px var(--card) inset}
.sp-preview-head{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px}
.sp-preview-actions{display:flex;gap:8px;flex-wrap:wrap}

.sp-paper{background:#fff;color:#111;border:1.5px solid var(--line);padding:26px 22px;line-height:1.55;font-family:Georgia,serif;overflow:hidden}
.sp-paper-signal,.sp-paper-compact{font-family:'Helvetica Neue',Arial,sans-serif}
.sp-paper-compact{font-size:13.5px;line-height:1.4;padding:20px 18px}
.sp-r-band{margin:-26px -22px 20px;padding:22px;color:#fff}
.sp-r-band .sp-r-name{color:#fff}
.sp-r-band .sp-r-contact{color:rgba(255,255,255,.86)}
.sp-r-name{font-size:23px;margin:0 0 3px;letter-spacing:.4px;font-family:inherit}
.sp-r-contact{font-size:12.5px;color:#555;margin:0 0 16px}
.sp-r-h{font-family:'Inter',sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:1.4px;
  color:var(--accent);border-bottom:1.5px solid var(--accent);padding-bottom:4px;margin:18px 0 7px}
.sp-paper-compact .sp-r-h{margin:13px 0 5px}
.sp-r-p{font-size:14px;margin:5px 0}
.sp-r-ul{font-size:14px;margin:5px 0;padding-left:19px}
.sp-r-ul li{margin-bottom:4px}

/* interview */
.sp-scorebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:13px;color:var(--ink-soft)}
.sp-scorebar strong{color:var(--ink);font-family:var(--mono)}
.sp-scoresep{width:1px;height:14px;background:var(--line)}
.sp-stars{display:inline-flex;gap:2px;align-items:center}
.sp-tips{background:var(--card);border:1.5px solid var(--line);border-left:4px solid var(--signal);padding:16px 18px;margin-bottom:16px;border-radius:4px}
.sp-tips ul{margin:0;padding-left:18px;font-size:14px;line-height:1.6}
.sp-tips li{margin-bottom:5px}
.sp-q{display:flex;align-items:flex-start;gap:11px;width:100%;background:none;border:none;padding:0;cursor:pointer;text-align:left}
.sp-q-num{font-family:var(--mono);font-size:12px;color:var(--route);padding-top:2px}
.sp-q-text{flex:1;font-size:15px;font-weight:600;line-height:1.45}
.sp-q-caret{font-size:19px;color:var(--ink-soft);line-height:1}
.sp-q-body{margin-top:14px}
.sp-timerrow{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:12px 0}
.sp-timer{font-family:var(--mono);font-size:19px;padding:3px 10px;background:var(--chip);border-radius:3px;border:1.5px solid var(--line)}
.sp-timer.is-live{border-color:var(--route);color:var(--route)}
.sp-feedback{background:var(--chip);border-left:3px solid var(--route);padding:13px 15px;font-size:14px;line-height:1.6;border-radius:2px;margin-top:12px}
.sp-feedback p{margin:0 0 7px}
.sp-fb-head{display:flex;align-items:center;gap:8px;margin-bottom:9px;font-family:var(--mono);font-size:13px}
.sp-fb-better{background:var(--card);padding:9px 11px;border-radius:3px;margin-top:9px}

.sp-themeswitch{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;
  border-radius:50%;background:none;border:1.5px solid var(--line);color:var(--ink-soft);
  cursor:pointer;transition:border-color .14s,color .14s,background .14s;flex:0 0 auto}
.sp-themeswitch:hover{border-color:var(--route);color:var(--route)}
.sp-themeswitch-onpanel{border-color:rgba(255,255,255,.3);color:var(--signal)}
.sp-themeswitch-onpanel:hover{border-color:var(--signal);background:rgba(255,255,255,.1);color:var(--signal)}
.sp-mobilebar-actions{display:flex;align-items:center;gap:12px}
.sp-route-title{display:flex;align-items:center;justify-content:space-between;gap:10px}

/* picker (city / school combobox) */
.sp-picker{position:relative}
.sp-picker-box{position:relative;display:flex;align-items:center}
.sp-picker-icon{position:absolute;left:11px;display:flex;color:var(--ink-soft);pointer-events:none}
.sp-input-iconed{padding-left:34px}
.sp-picker-box .sp-input{padding-right:38px}
.sp-picker-caret{position:absolute;right:4px;display:flex;align-items:center;justify-content:center;
  width:30px;height:30px;background:none;border:none;color:var(--ink-soft);cursor:pointer;
  transition:transform .15s}
.sp-picker-caret.is-open{transform:rotate(180deg);color:var(--route)}
.sp-picker-list{position:absolute;top:100%;left:0;right:0;z-index:40;margin-top:4px;max-height:270px;
  overflow-y:auto;background:var(--card);border:1.5px solid var(--route);border-radius:4px;
  box-shadow:0 12px 28px rgba(6,16,32,.18);scroll-margin-bottom:90px}
.sp-picker-group{padding-bottom:4px}
.sp-picker-grouphead{position:sticky;top:0;display:block;background:var(--chip);color:var(--ink-soft);
  font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;
  padding:6px 12px;border-bottom:1px solid var(--line)}
.sp-picker-opt{display:block;width:100%;text-align:left;background:none;border:none;cursor:pointer;
  padding:9px 12px;font-size:14px;color:var(--ink);font-family:inherit;line-height:1.35}
.sp-picker-opt.is-active{background:var(--chip)}
.sp-picker-opt.is-chosen{color:var(--route);font-weight:600}
.sp-picker-none{margin:0;padding:14px 13px;font-size:13px;line-height:1.5;color:var(--ink-soft)}

/* strand classifier */
.sp-quiz{background:var(--card);border:1.5px solid var(--line);border-left:4px solid var(--signal);
  border-radius:5px;margin-bottom:16px;overflow:hidden}
.sp-quiz-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;width:100%;
  background:none;border:none;padding:16px 18px;cursor:pointer;text-align:left;font-family:inherit}
.sp-quiz-title{font-family:var(--display);font-weight:700;font-size:17px;margin:4px 0 0;color:var(--ink)}
.sp-quiz-sub{margin:5px 0 0;font-size:13px;line-height:1.5;color:var(--ink-soft)}
.sp-quiz-caret{color:var(--ink-soft);display:flex;padding-top:14px;transition:transform .18s}
.sp-quiz-caret.is-open{transform:rotate(180deg);color:var(--route)}
.sp-quiz-body{padding:0 18px 6px;border-top:1px solid var(--line)}
.sp-quiz-body .sp-field:first-of-type{margin-top:4px}

.sp-rating{padding:13px 0;border-bottom:1px solid var(--line)}
.sp-rating-top{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:8px}
.sp-rating-label{font-size:14px;font-weight:600}
.sp-rating-word{font-family:var(--mono);font-size:11px;color:var(--route)}
.sp-rating-scale{display:flex;gap:6px}
.sp-rating-dot{flex:1;min-width:0;height:38px;background:var(--card);border:1.5px solid var(--line);
  border-radius:4px;font-family:var(--mono);font-size:13px;color:var(--ink-soft);cursor:pointer;
  transition:background .12s,border-color .12s,color .12s}
.sp-rating-dot:hover{border-color:var(--route)}
.sp-rating-dot.is-on{background:var(--panel);border-color:var(--panel);color:var(--on-panel)}
.sp-rating .sp-hint{display:block;margin-top:6px}

.sp-quiz-result{padding:16px 18px;border-top:1px solid var(--line);background:var(--chip)}
.sp-quiz-verdict{display:flex;align-items:baseline;flex-wrap:wrap;gap:10px}
.sp-quiz-verdict .sp-chip-label{flex:0 0 100%;margin-bottom:0}
.sp-quiz-strand{font-family:var(--display);font-weight:800;font-size:24px;letter-spacing:-.01em;color:var(--ink)}
.sp-quiz-conf{font-family:var(--mono);font-size:12px;color:var(--route)}
.sp-quiz-ranked{list-style:none;margin:14px 0 0;padding:0;display:grid;gap:8px}
.sp-quiz-ranked li{display:grid;grid-template-columns:minmax(80px,auto) 1fr auto;align-items:center;gap:10px}
.sp-quiz-rlabel{font-size:13px;font-weight:600}
/* the compare strip pins its bar to column 1 on narrow screens; the ranked
   list here is a three-column row at every width, so opt out of that. */
.sp-quiz-ranked .sp-compare-track{grid-column:auto}

/* career match: compare strip, filters, badges */
.sp-compare{background:var(--card);border:1.5px solid var(--line);border-radius:5px;padding:15px 16px;margin-bottom:14px}
.sp-compare-row{display:grid;grid-template-columns:1fr;gap:5px;width:100%;background:none;border:none;
  padding:8px 0 6px;cursor:pointer;text-align:left;border-bottom:1px solid var(--line)}
.sp-compare-row:last-child{border-bottom:none;padding-bottom:0}
.sp-compare-name{font-size:14px;font-weight:600;color:var(--ink);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sp-compare-yours{font-style:normal;font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;
  text-transform:uppercase;color:var(--route);border:1px solid var(--route);border-radius:99px;padding:1px 7px}
.sp-compare-track{height:7px;background:var(--track);border-radius:99px;overflow:hidden;grid-column:1}
.sp-compare-fill{display:block;height:100%;background:var(--route);border-radius:99px;transition:width .5s ease}
.sp-compare-num{font-family:var(--mono);font-size:11px;color:var(--ink-soft)}
@media(min-width:560px){
  .sp-compare-row{grid-template-columns:minmax(120px,1fr) 2fr auto;align-items:center;gap:12px}
  .sp-compare-track{grid-column:auto}
}
.sp-compare-row:hover .sp-compare-name{color:var(--route)}

.sp-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.sp-filter{background:var(--card);border:1.5px solid var(--line);border-radius:99px;padding:7px 14px;
  font-size:12.5px;font-weight:600;color:var(--ink-soft);cursor:pointer;font-family:inherit}
.sp-filter:hover{border-color:var(--route)}
.sp-filter.is-on{background:var(--panel);border-color:var(--panel);color:var(--on-panel)}

.sp-badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.sp-badge{font-family:var(--mono);font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;
  padding:3px 9px;border-radius:99px;border:1px solid var(--line);color:var(--ink-soft)}
.sp-badge-strong{background:var(--route);border-color:var(--route);color:#fff}
.sp-badge-good{border-color:var(--route);color:var(--route)}
.sp-badge-open{border-color:var(--line);color:var(--ink-soft)}
.sp-badge-route{background:var(--warm-bg);border-color:var(--warm-line);color:var(--warm-ink)}

/* chat */
.sp-chat{display:flex;flex-direction:column;gap:10px;min-height:180px;margin-bottom:14px}
.sp-msg{max-width:88%;padding:11px 14px;font-size:14.5px;line-height:1.55;border-radius:5px;white-space:pre-wrap;animation:sp-fade .25s ease both}
.sp-msg-you{align-self:flex-end;background:var(--panel);color:var(--on-panel);border-bottom-right-radius:1px}
.sp-msg-ai{align-self:flex-start;background:var(--card);border:1.5px solid var(--line);border-bottom-left-radius:1px}
.sp-msg-wait{color:var(--ink-soft);font-style:italic}
.sp-starters{display:flex;flex-wrap:wrap;gap:8px}
.sp-starter{background:var(--card);border:1.5px solid var(--line);border-radius:99px;padding:8px 14px;font-size:13px;cursor:pointer;color:var(--ink)}
.sp-starter:hover{border-color:var(--route)}
.sp-composer{display:flex;gap:9px;align-items:flex-end;position:sticky;bottom:0;background:var(--paper);padding:10px 0}
.sp-composer textarea{flex:1}
`}</style>
  );
}
