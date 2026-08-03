import { describe, test, expect } from "vitest";
import { resolveTier } from "../src/lib/tiers";
import { resolveSeams, type Seams } from "../src/lib/seams";
import { shapeFor } from "../src/lib/tiers";

const base: Seams = {
  postgres: "reference",
  secrets: "reference",
  ingress: "ingress",
  tls: "omit",
  backups: "omit",
  monitoring: "omit",
};

describe("tiers", () => {
  test("light and production are single-replica and unclustered", () => {
    expect(resolveTier("light").replicas).toBe(1);
    expect(resolveTier("light").clustered).toBe(false);
    expect(resolveTier("production").clustered).toBe(false);
  });

  test("production-ha is clustered, because >1 replica requires it", () => {
    const ha = resolveTier("production-ha");
    expect(ha.replicas).toBeGreaterThan(1);
    expect(ha.clustered).toBe(true);
  });

  // The whole reason tier and replicas resolve together: a silent island is
  // worse than a build error, because it breaks streaming for some users only.
  test("more replicas than the tier can cluster is refused", () => {
    expect(() => resolveTier("light", 2)).toThrow(/must form an Erlang cluster/);
    expect(() => resolveTier("production", 3)).toThrow(/production-ha/);
  });

  test("an override the tier can support is honoured", () => {
    expect(resolveTier("production-ha", 4).replicas).toBe(4);
  });

  test("zero replicas is refused", () => {
    expect(() => resolveTier("light", 0)).toThrow(/at least 1/);
  });
});

describe("tier profiles", () => {
  test("local is emulated and reaches nothing real", () => {
    const t = shapeFor("local");
    expect(t.emulated).toBe(true);
    expect(t.seams.ingress).toBe("omit");
    expect(t.seams.tls).toBe("omit");
    // The one thing worth exercising offline.
    expect(t.seams.backups).toBe("pg-dump");
  });

  test("minimal-cloud is the cheapest thing that is still a real deployment", () => {
    const t = shapeFor("minimal-cloud");
    expect(t.emulated).toBe(false);
    // TLS is not optional on something public.
    expect(t.seams.tls).toBe("cert-manager");
    expect(t.seams.backups).toBe("pg-dump");
    // A managed database, not one we operate.
    expect(t.seams.postgres).toBe("reference");
    // Off on purpose — the Prometheus stack usually costs more than the app.
    expect(t.seams.monitoring).toBe("omit");
  });

  test("an override replaces one seam and leaves the profile alone", () => {
    const t = shapeFor("minimal-cloud");
    const s = resolveSeams(t.seams, { monitoring: "prometheus-operator" });
    expect(s.monitoring).toBe("prometheus-operator");
    expect(s.tls).toBe("cert-manager");
    expect(s.backups).toBe("pg-dump");
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
