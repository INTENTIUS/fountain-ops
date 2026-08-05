---
title: First login
description: Register. With this deployment's defaults, that is the whole step.
---

Register at `http://localhost:4000/auth/register` and sign in. Done — your
account is verified, and as the instance's first account it is the admin.

Both halves of that are upstream behavior (fountain ADR 0011) that this
deployment's defaults switch on:

- `emailDelivery=none` means the app **self-verifies accounts at
  registration** — a verification link that can never be delivered gates
  nothing, so the app stopped pretending otherwise.
- `firstUserAdmin=true` sets `FIRST_USER_ADMIN=true` in the pod spec: while
  the instance has no admin, the first account to become verified is
  promoted. The grant is audit-recorded as `admin.role.granted` with a nil
  actor, exactly as visible in the admin audit trail as one made from the
  panel.

Register **before** exposing the instance to a network you don't trust —
until an admin exists, the role goes to whoever verifies first. (Registration
is open by default for the same reason; close it with
`registrationEnabled=false` once your account exists.) You do not need admin
to use the instance.

## Without a browser

`POST /api/auth/register` does the same thing, which is what a script, a CI
step or an agent needs:

```bash
curl -sX POST http://localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

{"message":"Account created. You can sign in now.","user_id":"60e3c0e6-..."}
```

An API key comes from the same shape of call:

```bash
curl -sX POST http://localhost:4000/api/auth/token \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

{"prefix":"ftn_75cd","key_id":"39a7161a-...","api_key":"ftn_75cda1c2..."}
```

That key is what [the conversation gate](/fountain-ops/reference/data-plane/)
authenticates with, so the whole path from nothing to a running conversation is
reachable without opening a browser — and without a single `kubectl` command.

## The escape hatches

Two recipes used to *be* this page, when first login took three tools and a
failure mode. They remain for the cases the happy path doesn't cover:

```bash
just verify-email you@example.com
just promote-admin you@example.com
```

- **`just verify-email`** — for a pin at `v0.4.0` or earlier (which ignores
  the self-verify behavior), or an instance whose real mail provider
  (`emailDelivery=resend|smtp`) is broken. On older pins, skipping it does
  not look like an error: login appears to work, then every authenticated
  page bounces back to the login form with nothing on screen saying why.
- **`just promote-admin`** — the manual path if you set
  `firstUserAdmin=false`, or for granting a *second* admin without opening
  the panel. Run against the auto-promoted first account it reports "was
  already an admin", which doubles as proof the in-app bootstrap fired — the
  e2e asserts exactly that.

Both run a separate pod whose spec is lifted from the live Deployment, so the
eval gets exactly the env the app runs with and the serving pod is left alone.

## What this mode costs

With `emailDelivery=none`, password-reset email cannot be delivered either —
a forgotten password is not recoverable in-app. For an instance whose
accounts matter, configure real mail (`emailDelivery=resend|smtp`) or prefer
OAuth sign-in.
