# JanSamadhaan - AI Powered Societal Innovation and Problem Solving Platform

Express API implementing all six modules. Data is stored in `data/db.json`; uploads go to `data/uploads/`.

## Run
    npm install
    npm start            # http://localhost:3000   (health: /healthz)
##website link:
[ https://jansamadhaan-dvxv.onrender.com/]

Env vars: `PORT`, `GOV_CODE` (default gov-demo, needed to register a reviewer), `IVR_KEY` (default ivr-demo).
`public/index.html` is the standalone browser demo (it does not call this API yet).

## Modules -> endpoints
| Module | Endpoints |
|---|---|
| 1 Digital Complaint & User Mgmt | POST /api/auth/register, /api/auth/login, POST /api/complaints (multipart, evidence <= 25 MB, type allow-list), GET /api/complaints |
| 2 Toll-Free & Voice | POST /api/voice/ivr (header x-ivr-key; body from, language, transcript, location) - point the telephony provider's webhook here |
| 3 AI Content Analysis | runs on every submission (category, confidence, urgency); GET /api/review, POST /api/complaints/:id/review |
| 4 Verification & Intelligence | duplicate linking + content flags on submit; GET /api/verification, POST /api/complaints/:id/verify |
| 5 Alert & Response | GET /api/alerts (urgency >= 60), POST /:id/assign, /acknowledge, /escalate, /advance |
| 6 Admin Dashboard & Integration | GET /api/stats, GET /api/export |

## Example
    curl -X POST localhost:3000/api/auth/register -H 'content-type: application/json' -d '{"name":"anjali","password":"secret123"}'
    TOKEN=$(curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"name":"anjali","password":"secret123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
    curl -X POST localhost:3000/api/complaints -H "authorization: Bearer $TOKEN" -F title="Streetlights off" -F description="8 streetlights not working for 3 weeks, women feel unsafe at night" -F location="Metro Gate 2"

## Notes
The AI step is rule-based (keywords + text overlap); replace `classify()` / `sim()` with a trained model or embedding service. Auth is a simple token scheme, not Clerk. Add HTTPS and a real database before public use.
