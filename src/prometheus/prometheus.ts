import * as client from "prom-client";
import { PROMETHEUS_PORT } from "../constants.ts";
import { MetricInfo, METRICS } from "./metrics.ts";
// Using Deno's built-in HTTP server

export class PrometheusMetrics {
  private register: client.Registry;
  private server: Deno.HttpServer | null = null;

  private counters: Map<string, client.Counter> = new Map();
  private gauges: Map<string, client.Gauge> = new Map();
  private histograms: Map<string, client.Histogram> = new Map();

  constructor() {
    this.register = new client.Registry();
    this.setupDefaultMetrics();
  }

  private setupDefaultMetrics(): void {
    client.collectDefaultMetrics({
      register: this.register,
      prefix: "",
    });

    // Create all counters using the METRICS.COUNTERS structure
    Object.values(METRICS.COUNTERS).forEach((counter) => {
      this.createCounter(
        counter.name,
        counter.description,
        "labels" in counter ? [...counter.labels] : []
      );
    });

    // Create all gauges using the METRICS.GAUGES structure
    Object.values(METRICS.GAUGES).forEach((gauge) => {
      this.createGauge(
        gauge.name,
        gauge.description,
        "labels" in gauge ? [...gauge.labels] : []
      );
    });

    // Create all histograms using the METRICS.HISTOGRAMS structure
    Object.values(METRICS.HISTOGRAMS).forEach((histogram) => {
      this.createHistogram(
        histogram.name,
        histogram.description,
        "labels" in histogram ? [...(histogram.labels as string[])] : []
      );
    });
  }

  start(): void {
    const handler = async (request: Request): Promise<Response> => {
      if (new URL(request.url).pathname === "/metrics") {
        const metrics = await this.register.metrics();
        return new Response(metrics, {
          headers: { "Content-Type": this.register.contentType },
        });
      }

      if (new URL(request.url).pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    };

    console.log(
      `📊 Prometheus metrics server starting on port ${PROMETHEUS_PORT}`
    );
    this.server = Deno.serve({ port: PROMETHEUS_PORT }, handler);
    console.log(
      `📊 Metrics available at: http://localhost:${PROMETHEUS_PORT}/metrics`
    );
  }

  async stop(): Promise<void> {
    if (this.server) {
      try {
        // Force shutdown after 5 seconds
        const shutdownPromise = this.server.shutdown();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Shutdown timeout")), 5000)
        );

        await Promise.race([shutdownPromise, timeoutPromise]);
        console.log("📊 Prometheus metrics server stopped");
      } catch (_) {
        console.log("📊 Prometheus metrics server force stopped");
        // Force exit if graceful shutdown fails
      }
    }
  }

  createCounter(
    name: string,
    help: string,
    labelNames: string[] = []
  ): client.Counter {
    const counter = new client.Counter({
      name: name,
      help,
      labelNames,
      registers: [this.register],
    });

    this.counters.set(name, counter);
    return counter;
  }

  createGauge(
    name: string,
    help: string,
    labelNames: string[] = []
  ): client.Gauge {
    const gauge = new client.Gauge({
      name: name,
      help,
      labelNames,
      registers: [this.register],
    });

    this.gauges.set(name, gauge);
    return gauge;
  }

  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[]
  ): client.Histogram {
    const histogramConfig = {
      name: name,
      help,
      labelNames,
      registers: [this.register],
      ...(buckets && { buckets }),
    };

    const histogram = new client.Histogram(histogramConfig);

    this.histograms.set(name, histogram);
    return histogram;
  }

  incrementCounter(
    counterKey: keyof typeof METRICS.COUNTERS,
    labels?: Record<string, string | number>
  ): void {
    const counterInfo = METRICS.COUNTERS[counterKey]!;
    const counter = this.counters.get(counterInfo.name);
    if (counter) {
      if (labels) {
        counter.inc(labels);
      } else {
        counter.inc();
      }
    } else {
      console.warn(`Counter '${counterInfo.name}' not found`);
    }
  }

  incrementErrorCounter(errorType: string): void {
    this.incrementCounter("ERRORS", { type: errorType });
  }

  setGauge(
    gaugeInfo: MetricInfo,
    value: number,
    labels?: Record<string, string | number>
  ): void {
    const gauge = this.gauges.get(gaugeInfo.name);
    if (gauge) {
      if (labels) {
        gauge.set(labels, value);
      } else {
        gauge.set(value);
      }
    } else {
      console.warn(`Gauge '${gaugeInfo.name}' not found`);
    }
  }

  observeHistogram(
    histogramKey: keyof typeof METRICS.HISTOGRAMS,
    value: number,
    labels?: Record<string, string | number>
  ): void {
    const histogramInfo = METRICS.HISTOGRAMS[histogramKey]!;
    const histogram = this.histograms.get(histogramInfo.name);
    if (histogram) {
      if (labels) {
        histogram.observe(labels, value);
      } else {
        histogram.observe(value);
      }
    } else {
      console.warn(`Histogram '${histogramInfo.name}' not found`);
    }
  }

  startTimer(histogramKey: keyof typeof METRICS.HISTOGRAMS): () => void {
    const histogramInfo = METRICS.HISTOGRAMS[histogramKey]!;
    const histogram = this.histograms.get(histogramInfo.name);
    if (histogram) {
      return histogram.startTimer();
    } else {
      console.warn(`Histogram '${histogramInfo.name}' not found`);
      return () => {};
    }
  }

  recordMqttConnection(connected: boolean): void {
    this.setGauge(METRICS.GAUGES.MQTT_CONNECTION_STATUS, connected ? 1 : 0);
  }

  recordMqttMessage(direction: "received" | "sent"): void {
    const metricKey: keyof typeof METRICS.COUNTERS =
      direction === "received"
        ? "MQTT_MESSAGES_RECEIVED"
        : "MQTT_MESSAGES_SENT";
    this.incrementCounter(metricKey);
  }

  recordHttpRequest(method: string, status: number, duration: number): void {
    this.incrementCounter("HTTP_REQUESTS", {
      method,
      status: status.toString(),
    });
    this.observeHistogram("HTTP_REQUEST_DURATION", duration / 1000);
  }

  recordAutomationCycle(duration: number): void {
    this.incrementCounter("AUTOMATION_CYCLES");
    this.observeHistogram("AUTOMATION_CYCLE_DURATION", duration / 1000);
  }

  // Utility methods for working with METRICS
  // getGaugeInfo(gaugeKey: keyof typeof METRICS.GAUGES): MetricInfo {
  //   return METRICS.GAUGES[gaugeKey]!;
  // }

  // getCounterInfo(counterKey: keyof typeof METRICS.COUNTERS): MetricInfo {
  //   return METRICS.COUNTERS[counterKey]!;
  // }

  // getHistogramInfo(histogramKey: keyof typeof METRICS.HISTOGRAMS): MetricInfo {
  //   return METRICS.HISTOGRAMS[histogramKey]!;
  // }

  // Get all metric information as arrays
  // getAllGaugeInfo() {
  //   return Object.entries(METRICS.GAUGES).map(([key, gauge]) => ({
  //     key,
  //     ...gauge,
  //   }));
  // }

  // getAllCounterInfo() {
  //   return Object.entries(METRICS.COUNTERS).map(([key, counter]) => ({
  //     key,
  //     ...counter,
  //   }));
  // }

  // getAllHistogramInfo() {
  //   return Object.entries(METRICS.HISTOGRAMS).map(([key, histogram]) => ({
  //     key,
  //     ...histogram,
  //   }));
  // }
}
