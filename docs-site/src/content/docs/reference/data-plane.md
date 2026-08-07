---
title: The data plane
description: What an offline conversation proves, and precisely where it stops.
---

fountain reaches the sandboxes its agents run in through one credential and one
base URL. `dataPlane=spritzer` points that URL at
[spritzer](https://github.com/INTENTIUS/spritzer), an emulator of the Sprites
API running in the cluster.

The seam is pure configuration. The app is not built differently and cannot
tell the difference, so a local run exercises the real control-plane path
instead of a stub of it.

| target | default |
|---|---|
| `k3d` | `spritzer`. Offline there is no Sprites account, and a placeholder token against the real API is a 401 nobody sees until they talk to an agent |
| `kubernetes` | `sprites` |

## Provisioning works

Creating a conversation creates a sprite **and populates it**. fountain writes
its `fountain` skill and a `/home/sprite/.env` carrying a scoped token and the
conversation id into the sprite's filesystem, and spritzer then reports that
sprite `running` with both files present.

## No turn finishes against the emulator, since fountain v0.6.0

Which way a turn *fails* is decided by which branch fountain takes, and that
is a race, not a property of the deployment. From `conversation_server.ex`:

```elixir
case sandbox.status do
  "ready"                             -> reattach(...)
  s when s in ["pending", "starting"] -> fresh_provision(...)
end
```

If provisioning marks the sandbox `ready` before the ConversationServer
dispatches, fountain reattaches. Reattach calls `list_sessions` over plain
HTTP, which spritzer serves as a WebSocket only, so it answers `426` and the
turn is abandoned:

```
event: stage  reattach  interrupted  {"reason":"list_sessions_failed","outcome":"turn_orphaned"}
```

If dispatch gets there first, the sandbox is still `pending`, fountain
provisions fresh — and the turn now fails anyway, differently. The emulator's
runtime echoes the command and exits without ever writing a prompt, and
fountain v0.6.0 stopped counting that as a completed turn (fountain#606):

```
event: stage  turn  failed  {"reason":":command_exited"}
```

That is the right upstream behavior meeting the emulator's boundary, not a
regression: a runtime that dies before the prompt was never a turn. On pins
≤ v0.5.x the fresh path completed with `exit_code: 0`, and even that was only
the echo. `just verify-conversation` accepts whichever terminal shape the
pinned image produces and says which one you got.

:::caution[A faster machine is more likely to fail]
The race is won by speed, so this gets *more* likely on better hardware.
Measured with identical image digests on both sides:

| | |
|---|---|
| M-series laptop | reattach taken, turn orphaned — **5 of 5** |
| GitHub runner | no reattach, turn completed — **2 of 2** |

It is consistent on any one machine, so it reads as deterministic until you
try another one.
[#67](https://github.com/INTENTIUS/fountain-ops/issues/67) has the full probe.
:::

[spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18) is the `426`
itself, and it is a real bug: it would break the legitimate reattach the
branch was written for, after a BEAM restart. But it is not the reason a
*first* turn fails. That a fresh conversation reaches the reattach branch at
all is the upstream problem.

So the emulated data plane proves the substrate can provision and address a
sandbox. When the turn does complete, what completed is spritzer echoing the
command back; see below.

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

## An account and a key, headless

`POST /api/auth/register` registers the same way the form does — under this
deployment's defaults the account self-verifies at registration, and the
instance's first account becomes the admin (fountain ADR 0011) — which is what
a script, a CI step or an agent needs:

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

That key is what the conversation gate below authenticates with, so the whole
path from nothing to a running conversation is reachable without opening a
browser — and without a single `kubectl` command.

## The conversation gate

`just verify` asks `/health`. A 200 there says the release booted; it does not
say it reached its database, resolved its secrets, provisioned a sandbox or
streamed anything back. `just verify-conversation` checks the rest:

```bash
export FOUNTAIN_PASSWORD=...                       # not on the command line
just verify-conversation you@example.com           # plumbing
just verify-conversation you@example.com strict    # plumbing + a model replied
```

Both make a throwaway agent, open one conversation, and tear both down on the
way out, including when an assertion fails, which is the case that matters.

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
fails closed.

Against the local default, `plumbing` currently fails at the orphaned turn
above, which is the gate doing its job.

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
