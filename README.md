# fountain-ops

Run your own [fountain](https://github.com/BinaryBourbon/fountain). One command stands it up on a laptop; the same build, with a handful of parameters, is how it goes everywhere else. You drive all of it with `just`.

**Docs:** [Stand it up](https://intentius.io/fountain-ops/getting-started/stand-it-up/) ·
[Make it durable](https://intentius.io/fountain-ops/getting-started/make-it-durable/) ·
[Real cluster](https://intentius.io/fountain-ops/getting-started/real-cluster/) ·
[Status](https://intentius.io/fountain-ops/status/)

## On a laptop

About five minutes, most of it pulling images.

**You need:** Docker running, plus `k3d`, `kubectl`, `node`, `npm`, `jq` and `just`. Check all but `just` — you have that already or you could not run it — with `just doctor`, which prints the install line for whatever is missing.

```bash
npm install
just up
```

That creates a k3d cluster, mints the platform secret, builds the manifests, applies them, waits for the rollouts, and proves the app serves:

```
GET /health via an in-cluster probe...
{"status":"ok"}
  ✓ /health answered
```

Then `just forward` and open `http://localhost:4000`. `just down` removes everything it created and nothing it did not.

### First login

Register at `/auth/register` — or `POST /api/auth/register`, if you are not driving a browser — and sign in. That is the whole step: with this deployment's defaults your account self-verifies at registration (no mail is sent here, so a verification link would never arrive), and the instance's first account is promoted to admin, audit-recorded like a grant made from the panel (fountain ADR 0011). Register before exposing the instance — until an admin exists, the role goes to whoever verifies first.

`just verify-email` and `just promote-admin` remain for older image pins (≤ v0.4.0, which ignore these switches), broken mail providers, second admins, and `firstUserAdmin=false`: [Promoting an admin manually](https://intentius.io/fountain-ops/reference/promote-admin/) has them, and what runs underneath. You do not need admin to use the instance.

## Durable

Two app replicas that join into one Erlang cluster, over a Postgres the CNPG operator runs replicated — still on the laptop, so the first `ha` you stand up is not on a cluster that matters:

```bash
just operators
just params="--param tier=ha --param postgres=cnpg --param dataPlane=sprites --param storage=s3" up
```

`tier=ha` is the decision; the other three parameters exist because the laptop defaults are emulators and `ha` refuses to stand on an emulator — leave one off and the error hands you the next. What comes up, what stays placeholder, and why: [Make it durable](https://intentius.io/fountain-ops/getting-started/make-it-durable/).

## On a real cluster

The same build, aimed at a cluster k3d did not create. You bring the database, the Secret, the ingress class and the hostname; each is one `--param`, and [Stand it up on a real cluster](https://intentius.io/fountain-ops/getting-started/real-cluster/) takes the decisions in order. `just preview kubernetes ha` shows the manifests without touching anything, and `just e2e-k8s` re-checks the whole path — light, then ha over it — on a three-node stand-in it creates and deletes itself.

## When it goes wrong

The steps of `just up` are separate targets, because when a deploy fails you want the step, not the whole thing again.

```bash
just status       # everything in the namespace
just logs         # the app, following
just pg-logs      # the database
```

`just up` is safe to re-run. It will not create a second cluster, and it will not mint a second secret over the first.

## Everything else, once, on the site

The README stops here so nothing in it can drift from the pages that are
asserted against reality:

- **[Status](https://intentius.io/fountain-ops/status/)** — what is verified, what only builds, what does not work. Authoritative over every other page, this one included.
- **[What you are deploying](https://intentius.io/fountain-ops/getting-started/overview/)** — the pieces, the four shapes, and the four words the docs lean on (target, tier, size, seam).
- **[The repo](https://intentius.io/fountain-ops/reference/repo-layout/)** — where everything lives, and the one environment variable.
- **[CI and the site](https://intentius.io/fountain-ops/reference/ci/)** — `just check` and `just e2e` are literally what CI runs.

The roadmap is [the issues](https://github.com/INTENTIUS/fountain-ops/issues) — there is no roadmap page to rot.

## Licence

[Apache 2.0](./LICENSE).
