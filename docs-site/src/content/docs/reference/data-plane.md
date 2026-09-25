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

A third value, `wisp`, points the same URL at a Sprites-compatible server
somebody else runs; see [A wisp endpoint](#a-wisp-endpoint). Whichever is in
use, the Deployment says so in its `fountain-ops/data-plane` and
`fountain-ops/sprites-base-url` annotations, and `just up` ends by printing
both.

## Provisioning works

Creating a conversation creates a sprite **and populates it**. fountain writes
its `fountain` skill and a `/home/sprite/.env` carrying a scoped token and the
conversation id into the sprite's filesystem, and spritzer then reports that
sprite `running` with both files present.

## Turns complete, in container mode

`spritzerExec=container`, the default from spritzer `0.6.0`
([spritzer#22](https://github.com/INTENTIUS/spritzer/issues/22)), makes every
sprite a pod in the `fountain` namespace (`sprite-<name>`, from
`spritzerSpriteImage`, `node:22-bookworm` by default) and runs the real
command in it. spritzer gets a ServiceAccount with a Role that can create,
read, delete and exec into pods in that namespace, and nothing cluster-wide.
Sprite pods run as root, so a namespace under the restricted Pod Security
Standard rejects them.

What runs in the pod is whatever fountain's runtime launches, and two have been
seen:

- `fountain-fixture`, fountain `v0.21.0`'s deterministic ACP runtime, enabled
  for one account with `--param acpFixtureUserId=<user id>`. A real ACP process
  that needs no model. A turn completes: `initialize`, `session/new`, the
  prompt, a file written in the pod, `end_turn`. `just e2e` asserts exactly
  this on every run, and reads the file back out of the pod with `kubectl exec`.
- `claude`, the default runtime. `claude-agent-acp` is installed into the pod,
  answers `initialize` and opens a session, then stops at model selection
  (`Could not select model claude-sonnet-4-6 … check account access`) because
  the instance has no inference credential. With one, that is a real turn.

One thing does not work yet: an Environment with `networking_type: limited`
fails at the network stage, because fountain rejects spritzer's answer to the
network policy call (`{:network_policy, {:invalid, {:http, 200, %{"rules" =>
[…]}}}}`), with an empty allowlist or one host. `unrestricted` provisions.

Checkpoints answer `501` in container mode
([spritzer#23](https://github.com/INTENTIUS/spritzer/issues/23)).

## Turns stop at the handshake, in interpreter mode

With `spritzerExec=interpreter` (or spritzer `0.5.0`) and fountain `v0.9.0` or
later, a turn is dispatched into the sandbox and then fails.

fountain speaks the [Agent Client Protocol](https://agentclientprotocol.com/)
to its runtimes from `v0.9.0`
([fountain#671](https://github.com/BinaryBourbon/fountain/pull/671)), and
[#674](https://github.com/BinaryBourbon/fountain/pull/674) deleted the spawn
path it replaced — an agent comes back `acp: true` however you create it. So
the turn no longer writes a prompt into a command's stdin. It runs
`claude-agent-acp` and opens a JSON-RPC session:

```
event: output  env FOUNTAIN_CONVERSATION_ID=… claude-agent-acp
event: stage   turn  failed  {"reason":"acp: {:acp_error, :initialize,
                              %{\"code\" => -32601,
                                \"message\" => \"initialize is not supported\"}}"}
```

spritzer's exec is a scripted interpreter that echoes command lines. It has
never spoken JSON-RPC and `0.5.0`, its newest release, does not either, so
`initialize` is refused and the turn ends there. This is deterministic rather
than a race, and it is upstream of everything here: no parameter, pin or
manifest in this repo changes it. spritzer has to answer `initialize`.

What still holds, and is still asserted on every `just e2e`: the sandbox is
provisioned and populated, the turn is dispatched into it, and the runtime's
output streams back out. That is the substrate working. It is one round trip
short of a conversation.

The evidence for the old ending stands where it was measured and does not
carry forward — 34 of 34 conversations completed at `fountain v0.6.1` +
`spritzer 0.5.0`, over the spawn path below, which no longer exists. It reads
like history now because it is:

```
event: output  claude --dangerously-skip-permissions --print --verbose --output-format stream-json …
event: output  Reply with the single word: fountain
event: stage   turn  done  {"exit_code":0}
```

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
address it, and dispatch a turn into it. Carrying a prompt in and a reply back
out is the part that stopped working when the protocol changed.

## What it will never prove

Container mode runs real commands, so real tool execution is back. Two things
are still absent:

- **live model reasoning**, unless the instance has an inference credential;
  the fixture is deterministic by design
- **true VM isolation**: a sprite is a root container on the cluster's nodes,
  not a Firecracker VM

A green local conversation on the fixture is an end-to-end ACP check. It is not
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
just verify-conversation you@example.com fixture   # a completed ACP turn on a spritzer pod
```

All three make a throwaway agent, open one conversation, and tear both down on the
way out, including when an assertion fails, which is the case that matters.

**`plumbing`** asserts a sandbox was provisioned, a turn ran, events streamed in
order, and the turn exited 0. It catches a broken Secret, an unreachable data
plane, a migration that did not run.

**`strict`** additionally asserts a model replied, and refuses to run against
spritzer's interpreter, which satisfies every plumbing assertion with no model
in the loop at all. Container mode runs the real runtime, so `strict` is
allowed there and needs an inference credential to pass.

**`fixture`** needs spritzer in container mode and the account named by
`acpFixtureUserId`. It makes a persistent agent on `fountain-fixture`, sends
the fixture's `write` scenario with a fresh nonce, and asserts the turn ended
`end_turn`, the fixture reported the write, and a `sprite-*` pod holds the file:

```
  data plane: spritzer (container)
  ✓ fixture: a turn completed (end_turn) on spritzer pod sprite-fountain-1f627f19-61bdcacd,
    and its artifact reads back from the pod. ACP end to end, no model.
```

On the local default, `plumbing` fails without an inference credential,
because the `claude` runtime stops at model selection. That is the honest
answer for a runtime with no model; `fixture` is the local gate.

## For real conversations

Set `dataPlane=sprites` and put a real `SPRITES_TOKEN` in the Secret, or use a
wisp endpoint.

## A wisp endpoint

[wisp](https://github.com/arugula-salad/wisp) is a Sprites-compatible server on
Firecracker, public at `https://wisp.widgets.wtf` and runnable on any Linux host
with `/dev/kvm`. It is the production model for a studio box, and the laptop
tier accepts it:

```bash
P="--param dataPlane=wisp --param spritesBaseUrl=https://wisp.widgets.wtf"
just params="$P" sprites-token     # the wisp token; prompts, or reads $SPRITES_TOKEN
just params="$P" up
```

fountain gets `SPRITES_BASE_URL` set to `spritesBaseUrl` and `SPRITES_TOKEN`
from the `SPRITES_TOKEN` key of the Secret `spritesTokenSecret` names
(`fountain-sprites-token` unless told otherwise). That explicit entry overrides
the placeholder the platform Secret carries on k3d, so the platform Secret is
never rewritten. Nothing is deployed for the data plane.

What is refused, at build time:

```
dataPlane="wisp" needs spritesBaseUrl — the Sprites-compatible endpoint, e.g.
  --param spritesBaseUrl=https://wisp.widgets.wtf. Without it fountain falls back
  to https://api.sprites.dev and sends the wisp token there.
spritesBaseUrl is only read with dataPlane="wisp" — dataPlane="sprites" is Fly's
  own API at https://api.sprites.dev. ...
spritesBaseUrl "https://tok@wisp.widgets.wtf" carries a query, fragment or credentials. ...
```

and at apply time, before anything is applied, a missing token Secret:

```
  ✗ dataPlane=wisp needs the endpoint's token in Secret fountain-sprites-token (key SPRITES_TOKEN),
    and there is none in namespace fountain.
```

`verify-conversation` treats `wisp` as a real data plane: the turn has to exit
0, the emulator's handshake exemption does not apply, and `strict` is allowed.

What has been checked, and what has not. On k3d, `dataPlane=wisp` was pointed at
a second spritzer standing in for a wisp host: the app received the stand-in's
URL and the token from its Secret (not the platform Secret's placeholder),
provisioned a sandbox there, dispatched a turn into it, and
`verify-conversation` then failed the turn for not exiting 0, which is what it
should say about spritzer 0.5.0 on a plane that gets no exemption. No real wisp
host has been used from here. Two things only that can show: that wisp accepts
fountain's calls with a real token, and whether a turn needs the sprite to reach
fountain back at `PUBLIC_URL`, which from a public wisp host a laptop's
`http://localhost:4000` is not. The hand check, and its transcript, belong on
[#121](https://github.com/INTENTIUS/fountain-ops/issues/121).

:::danger[The token is a platform credential]
`SPRITES_TOKEN` is a **platform** credential, never a tenant one. It must not
reach tenant-visible config, agent Environments or Vaults, or logs. Tenants
bring their own inference keys, encrypted per-tenant under the master key.
:::

Note also that a Fly platform token is **not** a Sprites token. A valid Fly
credential that `api.fly.io/graphql` accepts is rejected by `api.sprites.dev`
with `401 authentication failed`.
