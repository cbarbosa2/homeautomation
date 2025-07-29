import * as client from "prom-client";
import { serve } from "@std/http/server";

export class PrometheusMetrics {
  private register: client.Registry;
  private server: Deno.HttpServer | null = null;
  private port: number;

  private counters: Map<string, client.Counter> = new Map();
  private gauges: Map<string, client.Gauge> = new Map();
  private histograms: Map<string, client.Histogram> = new Map();

  constructor() {
    this.register = new client.Registry();
    this.port = parseInt(Deno.env.get("PROMETHEUS_PORT") || "9090");
    
    this.setupDefaultMetrics();
  }

  private setupDefaultMetrics(): void {
    client.collectDefaultMetrics({
      register: this.register,
      prefix: "homeautomation_",
    });

    this.createCounter("automation_cycles_total", "Total number of automation cycles");
    this.createCounter("mqtt_messages_received_total", "Total MQTT messages received");
    this.createCounter("mqtt_messages_sent_total", "Total MQTT messages sent");
    this.createCounter("http_requests_total", "Total HTTP requests made", ["method", "status"]);
    this.createCounter("errors_total", "Total errors encountered", ["type"]);
    
    this.createGauge("mqtt_connection_status", "MQTT connection status (1=connected, 0=disconnected)");
    this.createGauge("active_devices", "Number of active devices");
    
    this.createHistogram("http_request_duration_seconds", "HTTP request duration in seconds");
    this.createHistogram("automation_cycle_duration_seconds", "Automation cycle duration in seconds");
  }

  async start(): Promise<void> {
    const handler = (request: Request): Response => {
      if (new URL(request.url).pathname === "/metrics") {
        return new Response(this.register.metrics(), {
          headers: { "Content-Type": this.register.contentType },
        });
      }
      
      if (new URL(request.url).pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    };

    this.server = serve(handler, { port: this.port });
    console.log(`📊 Prometheus metrics server started on port ${this.port}`);
    console.log(`📊 Metrics available at: http://localhost:${this.port}/metrics`);
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
    const histogram = new client.Histogram({
      name: `homeautomation_${name}`,
      help,
      labelNames,
      buckets,
      registers: [this.register],
    });
    
    this.histograms.set(name, histogram);
    return histogram;
  }

  incrementCounter(name: string, labels?: Record<string, string | number>): void {
    const counter = this.counters.get(name);
    if (counter) {
      counter.inc(labels);
    } else {
      console.warn(`Counter '${name}' not found`);
    }
  }

  incrementErrorCounter(errorType: string): void {
    this.incrementCounter("errors_total", { type: errorType });
  }

  setGauge(name: string, value: number, labels?: Record<string, string | number>): void {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.set(labels, value);
    } else {
      console.warn(`Gauge '${name}' not found`);
    }
  }

  observeHistogram(name: string, value: number, labels?: Record<string, string | number>): void {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.observe(labels, value);
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
    this.setGauge("mqtt_connection_status", connected ? 1 : 0);
  }

  recordMqttMessage(direction: "received" | "sent"): void {
    this.incrementCounter(`mqtt_messages_${direction}_total`);
  }

  recordHttpRequest(method: string, status: number, duration: number): void {
    this.incrementCounter("http_requests_total", { method, status: status.toString() });
    this.observeHistogram("http_request_duration_seconds", duration / 1000);
  }

  recordAutomationCycle(duration: number): void {
    this.incrementCounter("automation_cycles_total");
    this.observeHistogram("automation_cycle_duration_seconds", duration / 1000);
  }
}