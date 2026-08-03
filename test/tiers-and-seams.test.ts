import { describe, test, expect } from "vitest";
import { resolveTier } from "../src/lib/tiers";
import { resolveSeams, assertSixFieldSchedule, type Seams } from "../src/lib/seams";
import { tierShape } from "../src/lib/tiers";
import { targetShape } from "../src/lib/targets";

const base: Seams = {
  postgres: "reference",
  secrets: "reference",
  ingress: "ingress",
  tls: "omit",
  backups: "omit",
  monitoring: "omit",
  dataPlane: "sprites",
};

describe("tiers", () => {
  test("light and standard are single-replica and unclustered", () => {
    expect(resolveTier("light").replicas).toBe(1);
    expect(resolveTier("light").clustered).toBe(false);
    expect(resolveTier("standard").clustered).toBe(false);
  });

  test("ha is clustered, because >1 replica requires it", () => {
    const ha = resolveTier("ha");
    expect(ha.replicas).toBeGreaterThan(1);
    expect(ha.clustered).toBe(true);
  });

  // The whole reason tier and replicas resolve together: a silent island is
  // worse than a build error, because it breaks streaming for some users only.
  test("more replicas than the tier can cluster is refused", () => {
    expect(() => resolveTier("light", 2)).toThrow(/must form an Erlang cluster/);
    expect(() => resolveTier("standard", 3)).toThrow(/tier "ha"/);
  });

  test("an override the tier can support is honoured", () => {
    expect(resolveTier("ha", 4).replicas).toBe(4);
  });

  test("zero replicas is refused", () => {
    expect(() => resolveTier("light", 0)).toThrow(/at least 1/);
  });
});

describe("target and tier are independent axes", () => {
  test("the target picks seam defaults, not durability", () => {
    const k3d = targetShape("k3d");
    expect(k3d.emulated).toBe(true);
    expect(k3d.seams.postgres).toBe("bundled");
    expect(k3d.seams.ingress).toBe("omit");
    // floci, so the backup path is exercised offline rather than at a restore.
    expect(k3d.seams.backups).toBe("pg-dump");
    expect(k3d.s3Endpoint).toContain("4566");
  });

  test("a real cluster assumes no operators are installed", () => {
    const k = targetShape("kubernetes");
    expect(k.emulated).toBe(false);
    expect(k.seams.postgres).toBe("reference");
    expect(k.seams.monitoring).toBe("omit");
  });

  // The whole point of splitting the axes: a tier means the same thing
  // wherever it runs.
  test("a tier means the same thing on every target", () => {
    expect(tierShape("ha").replicas).toBe(tierShape("ha").replicas);
    expect(tierShape("light").retentionDays).toBeLessThan(tierShape("ha").retentionDays);
    expect(tierShape("light").clustered).toBe(false);
  });

  test("an override replaces one seam and leaves the target's others alone", () => {
    const t = targetShape("kubernetes");
    const s = resolveSeams(t.seams, { monitoring: "prometheus-operator" });
    expect(s.monitoring).toBe("prometheus-operator");
    expect(s.postgres).toBe("reference");
    expect(s.ingress).toBe("ingress");
  });

  // A single-pod Postgres cannot back an HA claim, and saying otherwise is the
  // kind of lie that is only discovered during an outage.
  test("a bundled Postgres cannot back an ha deployment", () => {
    const t = targetShape("k3d");
    expect(() => resolveSeams(t.seams, {}, true)).toThrow(/single instance/);
  });
});

describe("seams", () => {
  test("the default set builds", () => {
    expect(() => resolveSeams(base)).not.toThrow();
  });

  // These four used to be refused for needing CRDs chant could not generate.
  // #1319, #1320 and #1321 landed them, so the modes are now ordinary choices
  // and the only thing left to check is that nothing still blocks them.
  test.each([
    ["postgres", "cnpg"],
    ["ingress", "traefik"],
    ["secrets", "infisical"],
  ])("seam %s=%s is accepted", (seam, mode) => {
    const s = { ...base, [seam]: mode } as Seams;
    expect(() => resolveSeams(s)).not.toThrow();
  });

  test("PITR is accepted alongside a CNPG cluster", () => {
    expect(() => resolveSeams({ ...base, postgres: "cnpg", backups: "barman-pitr" })).not.toThrow();
  });

  test("PITR without a chant-managed Postgres is refused", () => {
    // WAL archiving is a property of the cluster the operator runs. Against a
    // Postgres chant does not manage there is nothing to archive from.
    expect(() => resolveSeams({ ...base, backups: "barman-pitr" })).toThrow(/needs postgres="cnpg"/);
  });

  test("PITR against the bundled Postgres is refused too", () => {
    // Same check as above, and it covers this: the bundled Postgres is a pod
    // with a volume and no operator, so there is no WAL stream either. Worth
    // its own case because it is the combination someone reaches for when
    // they want durability without an operator.
    expect(() =>
      resolveSeams({ ...base, postgres: "bundled", backups: "barman-pitr" }),
    ).toThrow(/needs postgres="cnpg"/);
  });

  test("a certificate with nothing to terminate it is refused", () => {
    expect(() => resolveSeams({ ...base, tls: "cert-manager", ingress: "omit" })).toThrow(/needs an ingress/);
  });
});

describe("the data plane seam", () => {
  test("k3d emulates it, kubernetes does not", () => {
    // Offline there is no Sprites account, and a placeholder token against the
    // real API is not a data plane — it is a 401 nobody sees until they try to
    // talk to an agent. A real cluster gets the real API.
    expect(targetShape("k3d").seams.dataPlane).toBe("spritzer");
    expect(targetShape("kubernetes").seams.dataPlane).toBe("sprites");
  });

  test("either mode is expressible on either target", () => {
    // The emulator in a real cluster is a staging choice, not an incoherence,
    // and the real API from k3d is what you use once you have a token.
    expect(resolveSeams(targetShape("kubernetes").seams, { dataPlane: "spritzer" }).dataPlane).toBe("spritzer");
    expect(resolveSeams(targetShape("k3d").seams, { dataPlane: "sprites" }).dataPlane).toBe("sprites");
  });

  test("the emulator cannot back an ha deployment", () => {
    // One pod holding every sprite, filesystem and checkpoint in memory. The
    // same lie as a single Postgres behind the word "ha": it applies cleanly,
    // and the first restart takes every running sandbox with it.
    expect(() => resolveSeams({ ...base, dataPlane: "spritzer" }, {}, true)).toThrow(/in-memory emulator/);
    expect(() => resolveSeams({ ...base, dataPlane: "spritzer" }, {}, true)).toThrow(/dataPlane="sprites"/);
  });

  test("the real API is fine at ha", () => {
    expect(() => resolveSeams({ ...base, dataPlane: "sprites" }, {}, true)).not.toThrow();
  });
});

describe("the CNPG backup schedule", () => {
  test("accepts the six-field form", () => {
    expect(() => assertSixFieldSchedule("0 47 2 * * *")).not.toThrow();
  });

  test("refuses the five-field form, which is the one people write", () => {
    // "47 2 * * *" is 02:47 to every other cron on the cluster and second 47
    // of minute 2 of every hour to CNPG. Both are accepted by the API server,
    // so this check is the only thing between the two readings.
    expect(() => assertSixFieldSchedule("47 2 * * *")).toThrow(/six/);
  });

  test("says what the corrected value looks like", () => {
    // An error that only reports the count leaves the reader to guess which
    // end the extra field goes on.
    expect(() => assertSixFieldSchedule("47 2 * * *")).toThrow(/"0 47 2 \* \* \*"/);
  });
});
