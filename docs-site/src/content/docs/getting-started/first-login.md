---
title: First login
description: A deploy that serves /health is not yet an instance you can use.
---

Register at `http://localhost:4000/auth/register`, then:

```bash
just verify-email you@example.com
```

## Without a browser

`POST /api/auth/register` does the same thing, which is what a script, a CI
step or an agent needs. The rest of this page talks about the browser form,
but it is not the only route.

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
reachable without opening a browser.

## Why this step exists

This deployment sends no mail. `emailDelivery` defaults to `none`, because
without Resend's DNS records mail is silently discarded, and a signup that
dead-ends with no visible error is worse than one that never offers to send.
The verification link is never going to arrive.

`just verify-email` is upstream's own escape hatch for exactly that case.

## If you skip it

The failure does not look like one. Signing in appears to work: the POST
returns a redirect to onboarding, indistinguishable from a good login. Then
every page inside the app sends you back to the login form, with nothing on
screen saying why.

| | registered only | after `just verify-email` |
|---|---|---|
| `POST /auth/login` | 302 to onboarding | 302 to onboarding |
| `/onboarding/step_1` | 302 back to login | **200** |
| `/conversations` | 302 back to login | **200** |

Someone hitting that loop usually concludes their password is wrong.

## How it runs

The recipe does not `kubectl exec` into the running pod. It runs a separate
pod and lifts its spec from the live Deployment, so the eval gets exactly the
env the app runs with and cannot drift from it, and the serving pod is left
alone.

## Admin

```bash
just promote-admin you@example.com
```

`Fountain.Release.promote_admin/1` is upstream's first-admin bootstrap.
The grant is audit-recorded as `admin.role.granted` with a nil actor,
so a promotion made this way is as visible in the admin audit trail as one
made from the panel.

Verify the account first: admin does not skip email verification, and the
recipe expects a registered address either way.

You do not need admin to use the instance.
