import * as client from "prom-client";
import { PROMETHEUS_PORT } from "./constants.ts";
// Using Deno's built-in HTTP server

// Metric name constants
export const METRICS = {
  COUNTERS: {
    AUTOMATION_CYCLES: "automation_cycles_total",
    MQTT_MESSAGES_RECEIVED: "mqtt_messages_received_total", 
    MQTT_MESSAGES_SENT: "mqtt_messages_sent_total",
    HTTP_REQUESTS: "http_requests_total",
    ERRORS: "errors_total",
  },
  GAUGES: {
    MQTT_CONNECTION_STATUS: "mqtt_connection_status",
    ACTIVE_DEVICES: "active_devices",
  },
  HISTOGRAMS: {
    HTTP_REQUEST_DURATION: "http_request_duration_seconds",
    AUTOMATION_CYCLE_DURATION: "automation_cycle_duration_seconds",
  },
} as const;

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
      prefix: "homeautomation_",
    });

    this.createCounter(METRICS.COUNTERS.AUTOMATION_CYCLES, "Total number of automation cycles");
    this.createCounter(METRICS.COUNTERS.MQTT_MESSAGES_RECEIVED, "Total MQTT messages received");
    this.createCounter(METRICS.COUNTERS.MQTT_MESSAGES_SENT, "Total MQTT messages sent");
    this.createCounter(METRICS.COUNTERS.HTTP_REQUESTS, "Total HTTP requests made", ["method", "status"]);
    this.createCounter(METRICS.COUNTERS.ERRORS, "Total errors encountered", ["type"]);
    
    this.createGauge(METRICS.GAUGES.MQTT_CONNECTION_STATUS, "MQTT connection status (1=connected, 0=disconnected)");
    this.createGauge(METRICS.GAUGES.ACTIVE_DEVICES, "Number of active devices");
    
    this.createHistogram(METRICS.HISTOGRAMS.HTTP_REQUEST_DURATION, "HTTP request duration in seconds");
    this.createHistogram(METRICS.HISTOGRAMS.AUTOMATION_CYCLE_DURATION, "Automation cycle duration in seconds");
  }

  async start(): Promise<void> {
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

    console.log(`📊 Prometheus metrics server starting on port ${PROMETHEUS_PORT}`);
    this.server = Deno.serve({ port: PROMETHEUS_PORT }, handler);
    console.log(`📊 Metrics available at: http://localhost:${PROMETHEUS_PORT}/metrics`);
  }

  async stop(): Promise<void> {
    if (this.server) {
      await this.server.shutdown();
      console.log("📊 Prometheus metrics server stopped");
    }
  }

  createCounter(name: string, help: string, labelNames: string[] = []): client.Counter {
    const counter = new client.Counter({
      name: `homeautomation_${name}`,
      help,
      labelNames,
      registers: [this.register],
    });
    
    this.counters.set(name, counter);
    return counter;
  }

  createGauge(name: string, help: string, labelNames: string[] = []): client.Gauge {
    const gauge = new client.Gauge({
      name: `homeautomation_${name}`,
      help,
      labelNames,
      registers: [this.register],
    });
    
    this.gauges.set(name, gauge);
    return gauge;
  }

  createHistogram(name: string, help: string, labelNames: string[] = [], buckets?: number[]): client.Histogram {
    const histogramConfig = {
      name: `homeautomation_${name}`,
      help,
      labelNames,
      registers: [this.register],
      ...(buckets && { buckets }),
    };
    
    const histogram = new client.Histogram(histogramConfig);
    
    this.histograms.set(name, histogram);
    return histogram;
  }

  incrementCounter(name: string, labels?: Record<string, string | number>): void {
    const counter = this.counters.get(name);
    if (counter) {
      if (labels) {
        counter.inc(labels);
      } else {
        counter.inc();
      }
    } else {
      console.warn(`Counter '${name}' not found`);
    }
  }

  incrementErrorCounter(errorType: string): void {
    this.incrementCounter(METRICS.COUNTERS.ERRORS, { type: errorType });
  }

  setGauge(name: string, value: number, labels?: Record<string, string | number>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      if (labels) {
        gauge.set(labels, value);
      } else {
        gauge.set(value);
      }
    } else {
      console.warn(`Gauge '${name}' not found`);
    }
  }

  observeHistogram(name: string, value: number, labels?: Record<string, string | number>): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      if (labels) {
        histogram.observe(labels, value);
      } else {
        histogram.observe(value);
      }
    } else {
      console.warn(`Histogram '${name}' not found`);
    }
  }

  startTimer(name: string): () => void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      return histogram.startTimer();
    } else {
      console.warn(`Histogram '${name}' not found`);
      return () => {};
    }
  }

  recordMqttConnection(connected: boolean): void {
    this.setGauge(METRICS.GAUGES.MQTT_CONNECTION_STATUS, connected ? 1 : 0);
  }

  recordMqttMessage(direction: "received" | "sent"): void {
    const metricName = direction === "received" 
      ? METRICS.COUNTERS.MQTT_MESSAGES_RECEIVED 
      : METRICS.COUNTERS.MQTT_MESSAGES_SENT;
    this.incrementCounter(metricName);
  }

  recordHttpRequest(method: string, status: number, duration: number): void {
    this.incrementCounter(METRICS.COUNTERS.HTTP_REQUESTS, { method, status: status.toString() });
    this.observeHistogram(METRICS.HISTOGRAMS.HTTP_REQUEST_DURATION, duration / 1000);
  }

  recordAutomationCycle(duration: number): void {
    this.incrementCounter(METRICS.COUNTERS.AUTOMATION_CYCLES);
    this.observeHistogram(METRICS.HISTOGRAMS.AUTOMATION_CYCLE_DURATION, duration / 1000);
  }
}