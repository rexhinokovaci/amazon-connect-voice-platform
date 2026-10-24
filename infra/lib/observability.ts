import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { DatadogLambda } from 'datadog-cdk-constructs-v2';

export interface ObservabilityProps {
  service: string;
  env: string;
  version: string;
  /** Secrets Manager ARN holding the Datadog API key. Omit to skip instrumentation. */
  apiKeySecretArn?: string;
  site?: string;
}

/**
 * Adds the Datadog extension + tracer layers. Kept optional so forks can
 * deploy without a Datadog account; logs and metrics fall back to stdout.
 */
export class Observability extends Construct {
  private readonly datadog?: DatadogLambda;

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);
    if (!props.apiKeySecretArn) return;
    this.datadog = new DatadogLambda(this, 'Datadog', {
      service: props.service,
      env: props.env,
      version: props.version,
      site: props.site ?? 'datadoghq.eu',
      apiKeySecretArn: props.apiKeySecretArn,
      nodeLayerVersion: 125,
      pythonLayerVersion: 107,
      extensionLayerVersion: 83,
      enableDatadogTracing: true,
      enableDatadogLogs: true,
      captureLambdaPayload: false,
      flushMetricsToLogs: true,
    });
  }

  instrument(...fns: lambda.Function[]): void {
    this.datadog?.addLambdaFunctions(fns);
  }
}
