---
title: First login
description: A deploy that serves /health is not yet an instance you can use.
---

Register at `http://localhost:4000/auth/register`, then:

```bash
just verify-email you@example.com
```

## Without a browser

`POST /api/auth/register` does the same thing, which is what a script, a CI step
or an agent needs — the browser form is the only route the rest of this page
describes, and it is not the only one there is.

```bash
curl -sX POST http://localhost:4000/api/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

{"message":"Check your email to verify your account.","user_id":"60e3c0e6-..."}
```

`just verify-email` then works exactly as above, and an API key comes from the
same shape of call:

```bash
curl -sX POST http://localhost:4000/api/auth/token \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"..."}'

{"prefix":"ftn_75cd","key_id":"39a7161a-...","api_key":"ftn_75cda1c2..."}
```

That key is what [the conversation gate](/fountain-ops/reference/data-plane/)
authenticates with, so the whole path from nothing to a running conversation is
reachable without opening a browser once.

## Why this step exists

This deployment sends no mail. `emailDelivery` defaults to `none`, because
without Resend's DNS records mail is silently discarded and a signup that
dead-ends with no visible error is worse than one that never offers to send. So
the verification link never arrives, and cannot.

`just verify-email` is upstream's own escape hatch for exactly that case.

## Skip it and nothing tells you

This is the part worth reading, because the failure does not look like one.
Signing in **appears to work** — the POST returns a redirect to onboarding,
indistinguishable from a good login — and then every page inside the app sends
you back to the login form, with nothing on screen saying why.

| | registered only | after `just verify-email` |
|---|---|---|
| `POST /auth/login` | 302 to onboarding | 302 to onboarding |
| `/onboarding/step_1` | 302 back to login | **200** |
| `/conversations` | 302 back to login | **200** |

A loop with no error. Someone hitting it concludes their password is wrong.

## How it runs

Not `kubectl exec` into the running pod. The recipe runs a separate pod and
lifts its spec from the live Deployment, so the eval gets exactly the env the
app runs with and cannot drift from it.

On `v0.3.0` the separate pod was forced rather than chosen: `Release` tasks
booted the whole application, metrics endpoint on 9568 included — already
bound in the pod that is serving — so the documented `bin/fountain_server
eval` died with `:eaddrinuse` before it reached the database. Since `v0.4.0`
these tasks start only the database connection
([fountain#256](https://github.com/BinaryBourbon/fountain/issues/256)), so
`exec` would work now. The separate pod stays, because leaving the serving pod
alone is worth keeping.

## Admin

```bash
just promote-admin you@example.com
```

`Fountain.Release.promote_admin/1` is upstream's first-admin bootstrap —
before it existed, the deploy guides ended in raw SQL against the production
database. It is in the pin since `v0.4.0`;
[#31](https://github.com/INTENTIUS/fountain-ops/issues/31) tracked waiting for
it. The grant is audit-recorded as `admin.role.granted` with a nil actor, so a
promotion made this way is as visible in the admin audit trail as one made
from the panel.

Verify the account first — admin does not skip email verification, and the
recipe expects a registered address either way.

You do not need admin to use the instance.
