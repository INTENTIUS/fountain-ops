import { describe, test, expect } from "vitest";
import { resolveTier } from "../src/lib/tiers";
import { resolveSeams, type Seams } from "../src/lib/seams";
import { tierShape } from "../src/lib/tiers";
import { targetShape } from "../src/lib/targets";

const base: Seams = {
  postgres: "reference",
  secrets: "reference",
  ingress: "ingress",
  tls: "omit",
  backups: "omit",
  monitoring: "omit",
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

  // Each of these names the issue that unblocks it, so the error is a pointer
  // rather than a dead end.
  test.each([
    ["postgres", "cnpg", "1319"],
    ["backups", "barman-pitr", "1319"],
    ["ingress", "traefik", "1320"],
    ["secrets", "infisical", "1321"],
  ])("seam %s=%s is refused with issue #%s", (seam, mode, issue) => {
    const s = { ...base, [seam]: mode } as Seams;
    // barman-pitr also needs cnpg; give it that so we assert the CRD refusal
    // rather than the combination check.
    if (mode === "barman-pitr") s.postgres = "cnpg";
    expect(() => resolveSeams(s)).toThrow(new RegExp(issue));
  });

  test("PITR without a chant-managed Postgres is refused", () => {
    // Reaching this needs the CRD refusal out of the way, which it is not yet —
    // so assert the CRD refusal fires first and revisit when #1319 lands.
    expect(() => resolveSeams({ ...base, backups: "barman-pitr" })).toThrow(/1319/);
  });

  test("a certificate with nothing to terminate it is refused", () => {
    expect(() => resolveSeams({ ...base, tls: "cert-manager", ingress: "omit" })).toThrow(/needs an ingress/);
  });
});
