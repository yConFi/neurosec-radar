# NeuroSec Radar · web

Next.js 16 (App Router) + Supabase Auth (`@supabase/ssr`). Single-owner app: every
read goes through Row Level Security (`private.is_owner()`).

```bash
npm install
cp .env.example .env.local   # fill NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (+ ANTHROPIC_API_KEY for the chat)
npm run dev
```

Deployed on Vercel (root directory `web/`, functions in `cdg1` next to Supabase eu-west-3).

`ANTHROPIC_API_KEY` is server-only (used by `POST /api/chat`); on Vercel it goes in Project Settings → Environment Variables, never with a `NEXT_PUBLIC_` prefix.
