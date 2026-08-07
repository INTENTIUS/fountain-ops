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

## Turns complete

At `fountain v0.6.1` and `spritzer 0.5.0`, every turn completes. fountain opens
an exec session for the runtime command and writes the prompt into it as stdin;
spritzer holds the session open, echoes the prompt back on stdout, and exits 0
on EOF:

```
event: output  claude --dangerously-skip-permissions --print --verbose --output-format stream-json …
event: output  Reply with the single word: fountain
event: stage   turn  done  {"exit_code":0}
```

That second line is the prompt making the round trip. It is the difference
between provisioning a sandbox and holding a conversation — and it is still
the **echo**, never a model. See [what it will never prove](#what-it-will-never-prove).

Measured: 34 of 34 conversations, including batches fired back to back, which
is the pacing that used to fail most.

:::note[This was a race for a long time, and was described wrongly three times]
Until recently a turn against the emulator usually did not finish, and three
separate attempts to write down why were wrong in three different ways. The
history is worth keeping, because each error had the same shape.

**What was actually broken.** fountain wrote the prompt with a bare
`GenServer.call` into spritzer's exec session. spritzer's exec was one-shot: it
echoed the command and closed. When the close won, the call landed on a dead
process and exited the *caller*, taking the ConversationServer down. The
supervisor restarted it, the restarted server found its sandbox already `ready`
and took the reattach branch, and `list_sessions` — an unupgraded GET — came
back `426`. The turn was orphaned behind an error that named nothing real.

**How it was mis-described.** First as an architecture split, arm64 versus
amd64. Then as a race on whether the sandbox reached `ready` before dispatch,
"decided by machine speed", from 5-of-5 and 2-of-2 samples — the dispatch race
never happened at all, and the same laptop returned both outcomes at even odds.
Then, after fountain v0.6.0 started failing those turns cleanly, as "no turn
finishes against the emulator, by upstream design" — while v0.6.0 was in fact
completing 13 of 30. Every one of those was a small sample of a coin flip read
as a property.

**What closed it.** [fountain#603](https://github.com/BinaryBourbon/fountain/issues/603)
stopped the lost write from crashing the server, so a doomed turn failed
cleanly instead of orphaning.
[spritzer#19](https://github.com/INTENTIUS/spritzer/pull/19) made an unupgraded
GET on the exec path answer the session list rather than `426`. And
[spritzer#20](https://github.com/INTENTIUS/spritzer/pull/20) ended the race
outright: an unrecognised command holds its exec session open until stdin EOF,
so the prompt reaches a process that is still there. Known verbs still exit
immediately, which is what chant's Fly activities depend on.

Both spritzer fixes merged three weeks before they shipped — `0.4.1` was the
latest release and carried neither, so every deployment kept reproducing a bug
that was already fixed on main. That is its own lesson:
[#67](https://github.com/INTENTIUS/fountain-ops/issues/67) has the full trail.
:::

So the emulated data plane proves the substrate can provision a sandbox,
address it, and carry a prompt into it and a reply back out.

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

Against the local default, `plumbing` passes: the turn completes and the prompt
comes back. An orphaned turn or a `:command_exited` fails the build now — both
were outcomes once and are regressions today.

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
