---
title: First login
description: A deploy that serves /health is not yet an instance you can use.
---

Register at `http://localhost:4000/auth/register`, then:

```bash
just verify-email you@example.com
```

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

Not `kubectl exec` into the running pod. `Release.verify_email/1` calls
`ensure_all_started`, which boots the whole application including the metrics
endpoint on 9568 — already bound in the pod that is serving — so the documented
`bin/fountain_server eval` dies with `:eaddrinuse` before it reaches the
database.

The recipe runs a separate pod and lifts its spec from the live Deployment, so
the eval gets exactly the env the app runs with and cannot drift from it.

## Admin

Making an account an admin needs `Fountain.Release.promote_admin/1`, which is on
upstream's `main` and **not in the pinned `v0.3.0`**. Nothing here exposes it
yet — [#31](https://github.com/INTENTIUS/fountain-ops/issues/31).

You do not need admin to use the instance.
