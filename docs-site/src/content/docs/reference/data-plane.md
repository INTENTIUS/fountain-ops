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

## Whether a turn finishes is a race

Whether a turn completes is a race, not a property of the deployment — but the
race is not the one the stage sequence makes it look like.

Every conversation provisions fresh. `kick_turn/4` opens an exec session for
the runtime command and then writes the prompt into it as stdin. spritzer's
exec is **one-shot**: it runs the command, echoes it back, and closes. Whether
the write reaches the runtime before that close is the whole race.

If the write lands first, the turn runs to `exit_code: 0`. If the close wins,
the runtime is gone before it ever reads the prompt, and the turn ends:

```
event: stage  turn  failed  {"reason":":command_exited (runtime exited 0)"}
```

The conversation resets to `idle`, the turn row gets `failed` with `ended_at`
and the runtime's `exit_code`, and nothing is left running. **A lost race costs
you the turn, not the deployment.**

The `0` is not a contradiction: spritzer's echo really did succeed and exit
cleanly — it just never read the prompt. On a real data plane this is where a
non-zero code and the runtime's last words show up instead, which is the point
of carrying them.

:::caution[Both outcomes are normal, and the split is not a fixed rate]
Measured on one deployment, arm64, fountain `v0.6.1` and spritzer `0.4.1`, 14
conversations of one prompt each:

| | |
|---|---|
| provisioned fresh | **14 of 14** |
| completed | 5 |
| failed as `:command_exited` | 9 |
| turns carrying an `exit_code` | **14 of 14** |
| `ConversationServer` crashes | **0** |
| reattaches | **0** |

The split moves with how fast conversations are opened — on `v0.6.0`, 11 of 16
completed with three seconds between them against 2 of 14 packed back to back —
so treat it as "both happen often", not as a rate. The window is a few
milliseconds either way.
:::

The remaining cause is spritzer's exec lifetime, which is
[spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18): holding the
session open until stdin EOF instead of exiting as soon as the command
produces output is what would let a turn complete reliably here. The `426`
that issue also covers is real and would break the legitimate
reattach-after-restart case, but it is no longer reached by a first turn.

:::note[This used to be much worse]
Before fountain `v0.6.0`, the losing branch did not fail cleanly. The write was
a bare `GenServer.call`, so landing on the exited process exited the *caller* —
it took the ConversationServer down. The supervisor restarted it, the restarted
server found its own sandbox already `ready`, took the reattach branch, and
`list_sessions` got spritzer's `426`, orphaning the turn behind an error that
named nothing real. 27 conversations on `v0.4.1` produced 14 crashes and 14
reattaches, each reattach 1–3ms after its own crash and none without a crash
first.

[#67](https://github.com/INTENTIUS/fountain-ops/issues/67) first read that as a
race on whether the sandbox reached `ready` before dispatch, decided by machine
speed — 5 of 5 orphaned on a laptop, 2 of 2 completed on a runner. Neither
held: the dispatch race never occurs, and the same laptop returns both outcomes
at roughly even odds. Those samples were a coin flip landing the same way
twice. Fixed upstream in
[fountain#603](https://github.com/BinaryBourbon/fountain/issues/603).
:::

The failure says why, too. `v0.6.0` reported the bare mechanism —
`:command_exited`, with `turns.exit_code` left `NULL` on all 17 failed turns of
the run above — so a bad flag, a missing binary and an OOM kill all read
identically. `v0.6.1` drains the runtime's exit and whatever it managed to
print before dying, and attributes both to the turn
([fountain#608](https://github.com/BinaryBourbon/fountain/issues/608)); every
one of the 14 turns above carries an `exit_code` now.

The upstream fix is
[fountain#603](https://github.com/BinaryBourbon/fountain/issues/603): a runtime
that exits before the prompt is written should fail the turn with a reason,
not take the ConversationServer down.

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

Against the local default, `plumbing` fails whenever the turn does — it asserts
`exit_code: 0`, and a `:command_exited` turn has none. That is the gate doing
its job, and it is why `just e2e` wraps it rather than calling it directly:
the e2e gate accepts either legitimate shape and stops only on a third.

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
