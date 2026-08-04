import { describe, test, expect } from "vitest";
import { resolveTier, sizeShape, defaultSize } from "../src/lib/tiers";
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
  storage: "s3",
};

describe("tiers", () => {

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

describe("the target x tier matrix", () => {
  // #20 tested the claim "any tier runs on any target", found it false, and
  // fixed the README. The same sentence survived in four places in the source
  // (#28) because nothing enforced it. This is the enforcement: the docs now
  // name a specific number, so the number is a test.
  const targets = ["k3d", "kubernetes"] as const;
  const tiers = ["light", "ha"] as const;

  const build = (target: (typeof targets)[number], tier: (typeof tiers)[number]) => {
    const shape = tierShape(tier);
    return resolveSeams(targetShape(target).seams, {}, shape.clustered);
  };

  test("three of the four combinations resolve on their default seams", () => {
    const ok = targets.flatMap((t) =>
      tiers.map((tier) => {
        try {
          build(t, tier);
          return `${t}/${tier}`;
        } catch {
          return null;
        }
      }),
    );
    expect(ok.filter(Boolean)).toEqual([
      "k3d/light",
      "kubernetes/light",
      "kubernetes/ha",
    ]);
  });

  test("k3d + ha is the one refused, and names the seam that fixes it", () => {
    // Not because the axes are coupled — because k3d's defaults cannot carry
    // ha. Naming the seams builds it, which is what makes this a refusal
    // rather than an unsupported combination.
    expect(() => build("k3d", "ha")).toThrow(/postgres="cnpg"/);
  });

  test("k3d + ha needs every emulated seam named, not just postgres", () => {
    // All of k3d's stand-ins are single-pod, so fixing one still leaves the
    // next. The refusals surface one at a time, which is why this is a test:
    // "add postgres=cnpg and it builds" was true when postgres was the only
    // one, and each new emulated seam has quietly falsified it again.
    expect(() =>
      resolveSeams(targetShape("k3d").seams, { postgres: "cnpg" }, true),
    ).toThrow(/dataPlane="sprites"/);

    expect(() =>
      resolveSeams(targetShape("k3d").seams, { postgres: "cnpg", dataPlane: "sprites" }, true),
    ).toThrow(/storage="s3"/);

    expect(() =>
      resolveSeams(
        targetShape("k3d").seams,
        { postgres: "cnpg", dataPlane: "sprites", storage: "s3" },
        true,
      ),
    ).not.toThrow();
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

describe("host and hostname", () => {
  // `host` carries a port because PUBLIC_URL needs one. Everything else that
  // reads it wants a hostname: PHX_HOST is Phoenix's url: [host: ...], an
  // Ingress rule's host, a Certificate's dnsNames, and Traefik's Host()
  // matcher. A port in any of those is wrong, and Phoenix logged it on every
  // boot for as long as they shared one value (#32).
  const hostnameOf = (h: string) => h.split(":")[0];

  test("a port is stripped for the hostname uses", () => {
    expect(hostnameOf("localhost:4000")).toBe("localhost");
    expect(hostnameOf("fountain.example.com:8443")).toBe("fountain.example.com");
  });

  test("a host with no port is unchanged", () => {
    expect(hostnameOf("fountain.example.com")).toBe("fountain.example.com");
  });

  test("no hostname ever contains a colon", () => {
    // The property, rather than the three cases above: whatever `host` is, the
    // value handed to PHX_HOST and the Ingress must not carry an authority.
    for (const h of ["localhost:4000", "fountain.example.com", "a.b.c:1", "x:65535"]) {
      expect(hostnameOf(h)).not.toContain(":");
    }
  });
});

describe("the storage seam", () => {
  test("k3d emulates the bucket, kubernetes does not", () => {
    expect(targetShape("k3d").seams.storage).toBe("floci");
    expect(targetShape("kubernetes").seams.storage).toBe("s3");
  });

  test("an emulated bucket cannot hold an ha deployment's backups", () => {
    // One pod, no volume: a restart is an empty bucket. A backup destination
    // that forgets is worse than none, because it looks like one.
    expect(() => resolveSeams({ ...base, storage: "floci", backups: "pg-dump" }, {}, true)).toThrow(
      /do not survive a restart/,
    );
  });

  test("an emulated bucket with backups off is refused", () => {
    // Otherwise the deployment carries an emulator nothing ever uploads to,
    // which is a pod pretending to be a backup story.
    expect(() => resolveSeams({ ...base, storage: "floci", backups: "omit" }, {})).toThrow(
      /nothing uploads to/,
    );
  });

  test("k3d's own defaults are coherent", () => {
    // The pairing the default path actually uses: pg-dump uploading to floci.
    expect(() => resolveSeams(targetShape("k3d").seams, {})).not.toThrow();
    expect(resolveSeams(targetShape("k3d").seams, {}).backups).toBe("pg-dump");
  });
});

describe("tiers are distinct, and size is not a tier", () => {
  // The reason there are two tiers and not three. `standard` used to sit
  // between them and emit a deployment identical to `light` — same kinds, same
  // replicas, same absence of clustering — differing only in resource requests
  // and retention. A bigger single pod survives exactly the same failures as a
  // smaller one, which is none of them (#21).
  test("every tier differs from every other in shape, not just in size", () => {
    const shapes = (["light", "ha"] as const).map((t) => {
      const s = tierShape(t);
      return `${s.replicas}/${s.clustered}`;
    });
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  test("size changes resources and nothing else", () => {
    // If this ever fails, a sizing knob has grown a structural consequence and
    // has become the thing #21 was about.
    const small = sizeShape("small");
    const large = sizeShape("large");
    expect(small.cpu).not.toBe(large.cpu);
    expect(Object.keys(small).sort()).toEqual(["cpu", "cpuLimit", "memory", "memoryLimit"]);
  });

  test("dropping the middle tier shrank nothing", () => {
    // light and ha keep exactly the resources they carried before, and what
    // `standard` asked for is still reachable by name.
    expect(sizeShape(defaultSize("light")).memory).toBe("512Mi");
    expect(sizeShape(defaultSize("ha")).cpu).toBe("500m");
    expect(sizeShape("medium").memory).toBe("1Gi");
  });

  test("a PodDisruptionBudget only where there is availability to budget", () => {
    // minAvailable: 1 over a single pod blocks every voluntary eviction — a
    // drain hangs forever and the fix is deleting the object that was supposed
    // to protect you. So: only when clustered.
    expect(tierShape("light").clustered).toBe(false);
    expect(tierShape("ha").clustered).toBe(true);
  });
});

describe("the secrets seam", () => {
  test("three modes, and none of them puts a value in source", () => {
    // reference: the cluster is the source of truth.
    // sops:      this repo is, as ciphertext.
    // infisical: an Infisical server is.
    for (const mode of ["reference", "sops", "infisical"] as const) {
      expect(resolveSeams({ ...base, secrets: mode }, {}).secrets).toBe(mode);
    }
  });

  test("sops is expressible on either target", () => {
    // The point of it: it needs no cloud account, so it works where k3d works
    // and where a real cluster works, unchanged.
    expect(resolveSeams(targetShape("k3d").seams, { secrets: "sops" }).secrets).toBe("sops");
    expect(resolveSeams(targetShape("kubernetes").seams, { secrets: "sops" }).secrets).toBe("sops");
  });
});
