---
title: Secrets
description: One key, and why regenerating it looks exactly like a successful deploy.
---

`just secret` generates the platform secret and **never rotates an existing
one**.

`MASTER_SECRETS_KEY` regenerated over an existing database makes every stored
secret unrecoverable, because every tenant's inference credentials are
encrypted under it. And the deploy that does it looks exactly like a
successful deploy.

So the recipe reads before it writes, and leaves an existing secret alone:

```
secret fountain-secrets already exists — leaving it alone
```

CI asserts that: it stands the deployment up, re-runs `just up`, and compares
`MASTER_SECRETS_KEY` byte for byte.

## Where they come from: the `secrets` seam

| mode | source of truth |
|---|---|
| `reference` | the cluster. Something put a Secret there; this repo reads it by name and says nothing about how it arrived |
| `sops` | **this repo**, as ciphertext. Values live in `secrets/platform.enc.yaml`, reviewable in a diff, decrypted into the cluster by `just secrets-sync` |
| `infisical` | an Infisical server, materialised into a Secret by its operator |

`sops` answers "where do local secrets come from" without a cloud account. The
alternative is `just secret` minting values on the spot, which is fine for one
laptop but does not carry to a second machine or a second operator.

```bash
cp secrets/platform.example.yaml secrets/platform.enc.yaml
$EDITOR secrets/platform.enc.yaml
sops --encrypt --in-place secrets/platform.enc.yaml
just secrets-sync
```

After that, a reviewer sees the keys but not the values:

```yaml
SECRET_KEY_BASE: ENC[AES256_GCM,data:kvni3qRN1jYDM/BFUnxzImnlTe7z...
MASTER_SECRETS_KEY: ENC[AES256_GCM,data:ZHnk2obDBchEEI//fNH1aFAnl...
```

Nothing decrypted is ever written to disk: sops streams to stdout and kubectl
reads it, so a decrypted file cannot be left behind because one is never
created.

:::note[Two things that will bite]
**`POSTGRES_PASSWORD` and `DATABASE_URL` must agree, and nothing checks it.**
`just secret` generates them together so they cannot disagree; with sops they
are yours to keep in step. A mismatch is a password-authentication failure at
boot, which reads like a bad credential rather than like two credentials that
were never the same one.

**sops looks for age keys in a different place per platform.**
`~/Library/Application Support/sops/age/keys.txt` on macOS,
`~/.config/sops/age/keys.txt` elsewhere. `age-keygen -o` and most instructions
write the second, so on a Mac the key exists, is correct, and is not found.
The error is `identity did not match any of the recipients`, which reads like
the wrong key rather than the wrong directory. `just secrets-sync` checks
both.
:::

## Two layers

**Platform secrets** — `MASTER_SECRETS_KEY`, `SECRET_KEY_BASE`, `DATABASE_URL`,
`SPRITES_TOKEN`. Held in a secret store, injected into the release at start.
These are the operator's.

**Per-tenant credentials** — each tenant's own inference keys, encrypted
AES-256-GCM under `MASTER_SECRETS_KEY` and stored in fountain's Postgres. These
are the tenants'. fountain manages them; fountain-ops never touches them, it
only provisions the key that protects them.

The first layer matters because it holds the key that makes the second
readable.

:::danger[Back the master key up separately from the database]
A full database restore cannot decrypt a single tenant credential without the
same `MASTER_SECRETS_KEY` the dump was written under. Losing the key is
equivalent to losing the data, and `just secret` stores it only in the
cluster, so on a real deployment losing the cluster loses the key.

```bash
I_MEAN_IT=1 just master-key | pbcopy
```

Put it somewhere the cluster is not: a password manager, a different account,
anywhere whose failure is uncorrelated with the database's. The opt-in is
required no matter where stdout goes, because a pipe, a CI step and a
script's command substitution are all places a secret should not appear by
accident.
:::

`just restore-drill` proves the newest backup reads back, and ends by saying
what it did not prove: the restored rows are ciphertext without the master key
above. [Backups and restore](/fountain-ops/reference/backups/) has the drill.

## No value is in this repo

No secret value is in this repo, and none ever will be. The generation in
`just secret` is an interim standing in for a real chant capability:
[INTENTIUS/chant#1365](https://github.com/INTENTIUS/chant/issues/1365)
proposes declaring a secret's *provenance* without its value.
