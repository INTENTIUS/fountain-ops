import { ServiceMonitor, PrometheusRule } from "@intentius/chant-lexicon-k8s";
import { namespace, seams, labels } from "../params";

// The seam decides, and only the seam. `tier.metrics` used to be ANDed in
// here; TierShape has no such field, so this was always undefined and
// monitoring="prometheus-operator" emitted nothing at all, even when set
// explicitly. Gating it on the tier would have been wrong anyway — a tier is
// durability, never features, so "light" is a smaller fountain and not a
// blinder one.
const on = seams.monitoring === "prometheus-operator";

/** Scrapes the metrics port on the Service. Selects the label the Service carries. */
export const serviceMonitor = on
  ? new ServiceMonitor({
      metadata: { name: "fountain", namespace, labels },
      spec: {
        namespaceSelector: { matchNames: [namespace] },
        selector: { matchLabels: { monitoring: "fountain-web" } },
        endpoints: [{ port: "metrics", path: "/metrics", interval: "30s", scrapeTimeout: "10s" }],
      },
    })
  : undefined;

/**
 * Alerts, kept to what the app knows about itself.
 *
 * Node pressure, PVC fill, crash-looping and replica mismatch all ship with
 * kube-prometheus-stack; duplicating them here would just double the paging.
 */
export const alerts = on
  ? new PrometheusRule({
      metadata: { name: "fountain-alerts", namespace, labels },
      spec: {
        groups: [
          {
            name: "fountain-app",
            interval: "30s",
            rules: [
              {
                // The metrics listener is a separate socket inside the same
                // BEAM, so a scrape failure while the pod still looks Ready
                // means the VM itself is in trouble. This doubles as the
                // "up but wedged" canary.
                alert: "FountainMetricsTargetDown",
                expr: `up{namespace="${namespace}"} == 0`,
                for: "5m",
                labels: { severity: "critical" },
                annotations: {
                  summary: "Fountain metrics endpoint is not scrapeable",
                  description: "The pod may pass readiness while the BEAM cannot serve.",
                },
              },
              {
                alert: "FountainHighServerErrorRate",
                expr:
                  `sum(rate(phoenix_router_dispatch_stop_count{namespace="${namespace}", status=~"5.."}[5m]))` +
                  ` / sum(rate(phoenix_router_dispatch_stop_count{namespace="${namespace}"}[5m])) > 0.05`,
                for: "10m",
                labels: { severity: "warning" },
                annotations: {
                  summary: "Over 5% of Fountain responses are 5xx",
                  description: "A single blip will not fire this; 5% sustained for 10m is a real regression.",
                },
              },
              {
                // queue_time is time spent waiting for a pool connection. It
                // climbs when every connection is checked out — the failure
                // that presents as "everything got slow" rather than "one
                // query got slow", and is hard to diagnose without this.
                alert: "FountainDatabasePoolSaturated",
                expr:
                  `histogram_quantile(0.95, sum(rate(fountain_repo_query_queue_time_bucket{namespace="${namespace}"}[5m])) by (le)) > 100`,
                for: "10m",
                labels: { severity: "warning" },
                annotations: {
                  summary: "Fountain is waiting on the database connection pool",
                  description: "Slow queries holding connections, or genuine saturation. Rule out the former before raising POOL_SIZE.",
                },
              },
            ],
          },
          {
            name: "fountain-sandboxes",
            interval: "60s",
            rules: [
              {
                alert: "FountainProvisionFailures",
                expr: `sum(rate(fountain_provision_exception_count{namespace="${namespace}"}[15m])) > 0.05`,
                for: "15m",
                labels: { severity: "warning" },
                annotations: {
                  summary: "Fountain sandbox provisioning is failing",
                  description: "Users see conversations that fail to start. Check SPRITES_TOKEN validity and rate limits, then Sprites API health.",
                },
              },
            ],
          },
        ],
      },
    })
  : undefined;
