// JanSamadhaan API - all six modules in one Express service (JSON-file storage).
const express = require('express'), multer = require('multer'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000, GOV_CODE = process.env.GOV_CODE || 'gov-demo', IVR_KEY = process.env.IVR_KEY || 'ivr-demo';
const MAX = 25 * 1024 * 1024, THRESH = 0.6;
const ALLOWED = ['image/jpeg','image/png','image/webp','application/pdf','audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','video/mp4','video/webm'];
const STAGES = ['Reported','AI analysed','Sanctioned','Matched with innovators','Prototype','Pilot','Deployed'];
const DATA = path.join(__dirname, 'data'), DBF = path.join(DATA, 'db.json'), UP = path.join(DATA, 'uploads');
fs.mkdirSync(UP, { recursive: true });
let db = fs.existsSync(DBF) ? JSON.parse(fs.readFileSync(DBF, 'utf8')) : { users: [], sessions: {}, complaints: [], log: [] };
const save = () => fs.writeFileSync(DBF, JSON.stringify(db, null, 1));

// ---- Module 3: AI analysis (rule-based stand-in; swap for a trained model) ----
const DOMAINS = {
 'Roads & Infrastructure':['road','pothole','bridge','footpath','streetlight','traffic','junction','pavement'],
 'Waste & Sanitation':['garbage','waste','dump','sewage','toilet','sanitation','stink','bin','litter'],
 'Water & Drainage':['water','flood','drain','pipeline','leak','tap','tank','drinking','rain','waterlogging'],
 'Electricity & Lights':['electric','power','light','lamp','transformer','voltage','outage','wire'],
 'Public Safety':['unsafe','accident','crime','women','dark','theft','harass','fire','night','danger'],
 'Healthcare':['hospital','clinic','doctor','ambulance','medicine','fever','health','patients'],
 'Education':['school','teacher','students','classroom','college','books']};
const DEPT = {'Roads & Infrastructure':'Public Works Dept','Waste & Sanitation':'Municipal Sanitation','Water & Drainage':'Water Supply & Drainage Board','Electricity & Lights':'Electricity Board','Public Safety':'Police & Safety Cell','Healthcare':'Health Dept','Education':'Education Dept'};
const URG = {fire:30,flood:25,accident:25,ambulance:25,children:15,women:12,hospital:15,unsafe:15,dark:10,weeks:10,months:14,daily:8,patients:15,disease:20,sewage:12};
const STOP = new Set('the a an and of to in on is are was for with near from has have had by at it this that there their we they our been very many not no'.split(' '));
const toks = t => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
function classify(text) {
  const t = text.toLowerCase(), hits = {}; let tot = 0;
  for (const [d, ws] of Object.entries(DOMAINS)) { hits[d] = ws.filter(w => t.includes(w)); tot += hits[d].length; }
  const top = Object.entries(hits).sort((a, b) => b[1].length - a[1].length)[0];
  if (!tot) return { category: 'Other', confidence: 0.3, matched: [] };
  const n = top[1].length;
  return { category: top[0], confidence: +Math.min(0.98, 0.35 + 0.65 * (n / tot) * Math.min(1, n / 2)).toFixed(2), matched: top[1] };
}
const urgency = t => { t = t.toLowerCase(); let s = 20; for (const [k, v] of Object.entries(URG)) if (t.includes(k)) s += v; return Math.min(100, s); };
const sim = (a, b) => { const A = new Set(toks(a)), B = new Set(toks(b)); const i = [...A].filter(x => B.has(x)).length; return i / (A.size + B.size - i || 1); };
// ---- Module 4: verification & intelligence ----
function flagsOf(d) {
  const f = [];
  if (d.length < 25) f.push('Description is very short');
  if (/(.)\1{5,}/.test(d)) f.push('Repeated characters');
  if (d.length > 20 && d === d.toUpperCase()) f.push('Written in all capitals');
  if (db.complaints.some(o => o.description === d)) f.push('Exact copy of an earlier report');
  return f;
}
function createComplaint({ title, description, location, anonymous, language, channel, owner, evidence }) {
  const text = `${title} ${description} ${location}`, c = classify(text);
  let dup = null, best = 0;
  db.complaints.forEach(o => { const s = sim(text, `${o.title} ${o.description} ${o.location}`); if (s > best) { best = s; dup = o; } });
  const flags = flagsOf(description);
  const rec = { id: 'CMP-' + (1000 + db.complaints.length + 1), title, description, location, anonymous: !!anonymous, language: language || 'en', channel,
    owner, evidence: evidence || null, category: c.category, confidence: c.confidence, matched: c.matched, urgency: urgency(text),
    duplicateOf: best >= 0.3 && dup ? dup.id : null, similarity: +best.toFixed(2), flags,
    status: flags.length ? 'Flagged' : c.confidence >= THRESH ? 'AI verified' : 'Manual review',
    department: DEPT[c.category] || 'District Collector Office', stage: 1, assignee: null, acknowledged: false, escalated: false, createdAt: new Date().toISOString() };
  db.complaints.unshift(rec); notify(`SMS to reporter: ${rec.id} registered`); save(); return rec;
}
const notify = m => db.log.unshift(`${new Date().toISOString()} ${m}`);
const view = (c, gov) => ({ ...c, owner: gov || !c.anonymous ? c.owner : undefined });

// ---- Module 1: auth & users ----
const hash = (p, s) => crypto.scryptSync(p, s, 32).toString('hex');
const app = express(); app.use(express.json());
app.get('/healthz', (_q, r) => r.json({ status: 'ok' }));
app.post('/api/auth/register', (q, r) => {
  const { name, password, role } = q.body || {};
  if (!name || !password || password.length < 6) return r.status(400).json({ error: 'Name and a password of 6+ characters are required.' });
  if (db.users.some(u => u.name === name)) return r.status(409).json({ error: 'That name is already registered.' });
  if (role === 'gov' && q.body.govCode !== GOV_CODE) return r.status(403).json({ error: 'Invalid government access code.' });
  const salt = crypto.randomBytes(8).toString('hex'); db.users.push({ name, salt, hash: hash(password, salt), role: role === 'gov' ? 'gov' : 'citizen' }); save();
  r.status(201).json({ ok: true });
});
app.post('/api/auth/login', (q, r) => {
  const u = db.users.find(x => x.name === (q.body || {}).name);
  if (!u || hash(q.body.password || '', u.salt) !== u.hash) return r.status(401).json({ error: 'Wrong name or password.' });
  const token = crypto.randomBytes(24).toString('hex'); db.sessions[token] = u.name; save(); r.json({ token, role: u.role });
});
const auth = (q, r, n) => { const u = db.users.find(x => x.name === db.sessions[(q.get('authorization') || '').replace('Bearer ', '')]); if (!u) return r.status(401).json({ error: 'Sign in first.' }); q.user = u; n(); };
const gov = (q, r, n) => q.user.role === 'gov' ? n() : r.status(403).json({ error: 'Government reviewers only.' });
const find = (q, r) => { const c = db.complaints.find(x => x.id === q.params.id); if (!c) r.status(404).json({ error: 'Complaint not found.' }); return c; };

// ---- Modules 1 & 3: digital complaint with evidence ----
const upload = multer({ storage: multer.diskStorage({ destination: UP, filename: (_q, f, cb) => cb(null, Date.now() + '-' + f.originalname.replace(/[^\w.-]/g, '_')) }),
  limits: { fileSize: MAX }, fileFilter: (_q, f, cb) => ALLOWED.includes(f.mimetype) ? cb(null, true) : cb(new Error('FILETYPE')) });
app.post('/api/complaints', auth, (q, r) => upload.single('evidence')(q, r, e => {
  if (e) return r.status(400).json({ error: e.message === 'FILETYPE' ? 'This file type is not accepted.' : e.code === 'LIMIT_FILE_SIZE' ? 'The file is larger than 25 MB.' : e.message });
  const { title, description, location, anonymous, language } = q.body;
  if (!title || !description || !location) return r.status(400).json({ error: 'Title, description and location are required.' });
  r.status(201).json(createComplaint({ title, description, location, anonymous: anonymous === 'true', language, channel: 'web', owner: q.user.name, evidence: q.file ? q.file.filename : null }));
}));
// ---- Module 2: toll-free / IVR webhook (point the telephony provider here) ----
app.post('/api/voice/ivr', (q, r) => {
  if (q.get('x-ivr-key') !== IVR_KEY) return r.status(401).json({ error: 'Invalid IVR key.' });
  const { from, language, transcript, location } = q.body || {};
  if (!transcript) return r.status(400).json({ error: 'Transcript is required.' });
  const c = createComplaint({ title: transcript.slice(0, 60), description: transcript, location: location || 'Not stated', language, channel: 'voice', owner: from || 'caller' });
  r.status(201).json({ complaintId: c.id, say: `Your complaint ${c.id} is registered.` });
});
app.get('/api/complaints', auth, (q, r) => r.json(db.complaints.filter(c => q.user.role === 'gov' || c.owner === q.user.name).map(c => view(c, q.user.role === 'gov'))));
app.get('/api/complaints/:id', auth, (q, r) => { const c = find(q, r); if (c) r.json(view(c, q.user.role === 'gov')); });
app.post('/api/complaints/:id/advance', auth, gov, (q, r) => { const c = find(q, r); if (!c) return; if (c.stage < 7) c.stage++; notify(`${c.id} moved to ${STAGES[c.stage - 1]}`); save(); r.json(c); });
// ---- Module 3 review queue ----
app.get('/api/review', auth, gov, (_q, r) => r.json(db.complaints.filter(c => c.status === 'Manual review')));
app.post('/api/complaints/:id/review', auth, gov, (q, r) => { const c = find(q, r); if (!c) return;
  if (q.body.action === 'reject') c.status = 'Rejected'; else { c.category = q.body.category || c.category; c.department = DEPT[c.category] || c.department; c.status = 'Reviewed'; c.confidence = 1; }
  save(); r.json(c); });
// ---- Module 4: verification desk ----
app.get('/api/verification', auth, gov, (_q, r) => r.json(db.complaints.filter(c => !['Verified', 'Reviewed', 'Rejected'].includes(c.status) && (c.flags.length || c.duplicateOf))));
app.post('/api/complaints/:id/verify', auth, gov, (q, r) => { const c = find(q, r); if (!c) return; c.status = q.body.genuine === false ? 'Rejected' : 'Verified'; save(); r.json(c); });
// ---- Module 5: alerts & response ----
app.get('/api/alerts', auth, gov, (_q, r) => r.json({ alerts: db.complaints.filter(c => c.urgency >= 60 && c.status !== 'Rejected'), notifications: db.log.slice(0, 50) }));
app.post('/api/complaints/:id/assign', auth, gov, (q, r) => { const c = find(q, r); if (!c) return; c.assignee = c.department; if (c.stage < 3) c.stage = 3; notify(`SMS to reporter: ${c.id} assigned to ${c.department}`); save(); r.json(c); });
app.post('/api/complaints/:id/acknowledge', auth, gov, (q, r) => { const c = find(q, r); if (!c) return; c.acknowledged = true; notify(`Alert ${c.id} acknowledged by ${c.department}`); save(); r.json(c); });
app.post('/api/complaints/:id/escalate', auth, gov, (q, r) => { const c = find(q, r); if (!c) return; c.escalated = true; notify(`Alert ${c.id} escalated to District Collector`); save(); r.json(c); });
// ---- Module 6: admin dashboard & integration ----
app.get('/api/stats', auth, (_q, r) => {
  const by = (k) => db.complaints.reduce((m, c) => (m[c[k]] = (m[c[k]] || 0) + 1, m), {});
  r.json({ total: db.complaints.length, duplicates: db.complaints.filter(c => c.duplicateOf).length, manualReview: db.complaints.filter(c => c.status === 'Manual review').length,
    unacknowledgedAlerts: db.complaints.filter(c => c.urgency >= 60 && !c.acknowledged).length, escalated: db.complaints.filter(c => c.escalated).length,
    byCategory: by('category'), byDepartment: by('department'), byStatus: by('status'), byStage: db.complaints.reduce((m, c) => (m[STAGES[c.stage - 1]] = (m[STAGES[c.stage - 1]] || 0) + 1, m), {}) });
});
app.get('/api/export', auth, gov, (_q, r) => r.json(db.complaints.map(c => ({ id: c.id, category: c.category, urgency: c.urgency, status: c.status, stage: STAGES[c.stage - 1], department: c.department, location: c.location }))));
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log(`JanSamadhaan API on http://localhost:${PORT}`));
