---
title: The data plane
description: What an offline conversation proves, and precisely where it stops.
---

fountain reaches the sandboxes its agents run in through one credential and one
base URL. `dataPlane=spritzer` points that URL at
[spritzer](https://github.com/INTENTIUS/spritzer), an emulator of the Sprites
API running in the cluster.

The seam is configuration and nothing else. The app is not built differently and
cannot tell the difference, which is what makes a local run exercise the real
control-plane path instead of a stub of it.

| target | default |
|---|---|
| `k3d` | `spritzer` — offline there is no Sprites account, and a placeholder token against the real API is a 401 nobody sees until they talk to an agent |
| `kubernetes` | `sprites` |

## Provisioning works

Creating a conversation creates a sprite **and populates it**. fountain writes
its `fountain` skill and a `/home/sprite/.env` carrying a scoped token and the
conversation id into the sprite's filesystem, and spritzer then reports that
sprite `running` with both files present.

## The turn does not finish

After provisioning, fountain reattaches to any existing runtime session, and
that call asks spritzer's exec path over plain HTTP. spritzer serves it as a
WebSocket only, so it answers `426` and the turn is abandoned:

```
event: stage  reattach  interrupted  {"reason":"list_sessions_failed","outcome":"turn_orphaned"}
```

Reproducible on every conversation, including straight after a fresh rollout.
Filed as [spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18) — it is
one endpoint, and everything on either side of it already works.

So today the emulated data plane proves the substrate can provision and address
a sandbox, and nothing beyond that.

## What it will never prove

Even once that endpoint lands, three things are absent and no configuration
brings them back:

- **live model reasoning**
- **real tool execution** in the sandbox
- **true VM isolation**

spritzer answers exec with a scripted interpreter whose default is to echo the
command back. A green local conversation is a *plumbing* check. It is not
somewhere to judge agent behaviour or sandbox security, and single-node Postgres
is likewise not somewhere to benchmark durability.

## The conversation gate

`just verify` asks `/health`. A 200 there says the release booted; it does not
say it reached its database, resolved its secrets, provisioned a sandbox or
streamed anything back. This does:

```bash
export FOUNTAIN_PASSWORD=...                       # not on the command line
just verify-conversation you@example.com           # plumbing
just verify-conversation you@example.com strict    # plumbing + a model replied
```

Both make a throwaway agent, open one conversation, and tear both down on the
way out — including when an assertion fails, which is the case that matters.

**`plumbing`** asserts a sandbox was provisioned, a turn ran, events streamed in
order, and the turn exited 0. It catches a broken Secret, an unreachable data
plane, a migration that did not run.

**`strict`** additionally asserts a model replied, and refuses to run against
`dataPlane=spritzer`:

```
  ✗ strict needs a real data plane. This deployment runs the emulator,
    which echoes the runtime command back instead of calling a model,
    so a green run here would prove nothing about a reply.
```

The emulator satisfies every plumbing assertion with no model in the loop at
all, so a gate that cannot tell those apart is worse than no gate. This one
fails closed rather than green.

Against the local default, `plumbing` currently fails at the orphaned turn
above. That is the gate working.

## For real conversations

Set `dataPlane=sprites` and put a real `SPRITES_TOKEN` in the Secret.

:::danger[The token is a platform credential]
`SPRITES_TOKEN` is a **platform** credential, never a tenant one. It must not
reach tenant-visible config, agent Environments or Vaults, or logs. Tenants
bring their own inference keys, encrypted per-tenant under the master key.
:::

Note also that a Fly platform token is **not** a Sprites token. A valid Fly
credential that `api.fly.io/graphql` accepts is rejected by `api.sprites.dev`
with `401 authentication failed`.
