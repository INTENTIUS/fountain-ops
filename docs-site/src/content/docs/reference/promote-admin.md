---
title: Promoting an admin manually
description: The release tasks under just promote-admin and just verify-email, and how to run them on a cluster that has no justfile.
---

The default deployment never needs this page. With `firstUserAdmin=true` the
first verified account on an instance with no admin is promoted in-app, and
with `emailDelivery=none` accounts self-verify at registration (both fountain
ADR 0011) — so registering **is** the bootstrap, and it is covered where it
happens, in [Stand it up locally](/fountain-ops/getting-started/stand-it-up/#first-login).
This page is the manual path, for the cases the bootstrap does not cover.

## When you need it

- **`firstUserAdmin=false`** — you kept the manual path on purpose, and the
  grant is yours to make.
- **A second admin**, without opening the panel.
- **Lock-out recovery** — the account that holds the role is unreachable.
- **Old pins, or broken mail** — images ≤ v0.4.0 ignore both switches, and a
  real mail provider (`emailDelivery=resend|smtp`) that is down never delivers
  the verification link. These are the `verify-email` cases.

## The recipes

```bash
just verify-email you@example.com     # only: pins ≤ v0.4.0, or a broken mail provider
just promote-admin you@example.com
```

**`promote-admin`** grants the admin role, audit-recorded as
`admin.role.granted` with a nil actor — as visible in the admin audit trail as
a grant made from the panel. Run against an account that already holds the
role it reports "was already an admin", and that is success: the e2e uses
exactly that report as its proof the in-app bootstrap fired. There is no
revoke target on purpose — revoking is done from the panel, by an admin.

**`verify-email`** marks a registered account's email verified without any
mail. On pins ≤ v0.4.0 skipping it does not look like an error: login appears
to work, then every authenticated page bounces back to the login form with
nothing on screen saying why.

Both validate the address shape before touching anything, and both decide
success from the printed line rather than the exit code — the release task
reports a missing account by printing its complaint and returning an error
tuple, which sets no exit status. A missing account is reported as a failure
with the register-first instruction.

On a cluster this repo did not create, both sit behind the foreign-cluster
guard: `export ALLOW_FOREIGN_CLUSTER=1` when you mean it, as covered in
[Stand it up on a real cluster](/fountain-ops/getting-started/real-cluster/#the-foreign-cluster-guard).

## What is underneath

Upstream release tasks — `Fountain.Release.promote_admin/1` and
`Fountain.Release.verify_email/1` (fountain#275; ADR 0011 later moved
first-admin in-app) — run with `bin/fountain_server eval` in a throwaway pod.
They replaced the raw SQL both upstream deploy guides used to end in.

A separate pod, not `kubectl exec` into the one serving. On v0.3.0 that was
forced: Release tasks booted the whole application — including the metrics
endpoint on 9568, already bound in the pod that is serving — so the documented
eval died with `:eaddrinuse` before it reached the database. v0.4.0 starts
only the Repo for these tasks (fountain#256), so exec would work now; the
separate pod stays because it leaves the serving pod alone, and a pod that
runs and exits is a cleaner unit than a shell inside one that must keep
serving.

The pod spec is lifted from the live Deployment rather than restated, so the
eval gets exactly the environment the app runs with — the same Secret, the
same `DATABASE_URL` — and cannot drift from it. Probes and ports come off,
because this serves nothing and exits.

## By hand, without the justfile

The recipes are `kubectl` and `jq`, so they reproduce anywhere the Deployment
does:

```bash
spec="$(kubectl get deploy fountain -n fountain -o json | jq -c --arg e "you@example.com" '
  .spec.template.spec
  | .restartPolicy = "Never"
  | .containers |= [ .[0]
      | .name = "eval"
      | .command = ["/app/bin/fountain_server", "eval", "Fountain.Release.promote_admin(\"\($e)\")"]
      | del(.args, .livenessProbe, .readinessProbe, .startupProbe, .ports)
    ]')"

kubectl run "fountain-promote-admin-$$" --rm -i --restart=Never -n fountain \
  --image=unused --quiet --overrides="{\"apiVersion\":\"v1\",\"spec\":$spec}"
```

Success is the printed line — `Granted admin to …`, or `… is already an
admin` — not the exit code, for the reason above. Swap `promote_admin` for
`verify_email` and this is the other recipe.
