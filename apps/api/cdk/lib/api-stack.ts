import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Dashboard,
  GraphWidget,
  MathExpression,
  Metric,
  SingleValueWidget,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { AccessLogFormat } from 'aws-cdk-lib/aws-apigateway';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import { CfnSchedule } from 'aws-cdk-lib/aws-scheduler';
import {
  CfnStage,
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  type HttpRoute,
  HttpStage,
  LogGroupLogDestination,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  Code,
  DockerImageCode,
  DockerImageFunction,
  Function as LambdaFunction,
  Runtime,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { StringParameter, ParameterTier } from 'aws-cdk-lib/aws-ssm';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import { type TravisConfig, foundationModelId, limitsJson } from './config.js';
import { LOG_RETENTION, pinLambdaLogGroups } from './logs.js';

export const CHAT_FLAG_PARAM = '/travis/chat/budget-exhausted';
export const DAILY_USAGE_ALARM_NAME = 'travis-chat-daily-usage';
export const METRICS_NAMESPACE = 'TravisPropertyIntelligence';

export interface TravisApiProps extends StackProps {
  config: TravisConfig;
  /** Docker build context holding Dockerfile, dist/*.mjs and build/db/travis.duckdb (apps/api by default). */
  imageDirectory: string;
}

/** Runs when the daily-usage alarm fires (via SNS) and sets the chat kill switch. Node 22 runtime, SDK v3 included. */
const BUDGET_FLAG_SETTER = `
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const ssm = new SSMClient({});
exports.handler = async (event) => {
  let set = false;
  for (const record of event.Records ?? []) {
    let message;
    try { message = JSON.parse(record.Sns.Message); } catch { continue; }
    if (message.AlarmName === process.env.DAILY_USAGE_ALARM_NAME && message.NewStateValue === 'ALARM') set = true;
  }
  if (!set) return { set: false };
  await ssm.send(new PutParameterCommand({ Name: process.env.CHAT_FLAG_PARAM, Value: 'true', Type: 'String', Overwrite: true }));
  console.log(JSON.stringify({ _aws: { Timestamp: Date.now(), CloudWatchMetrics: [{ Namespace: process.env.METRICS_NAMESPACE, Dimensions: [[]], Metrics: [{ Name: 'ChatBudgetFlagSet', Unit: 'Count' }] }] }, ChatBudgetFlagSet: 1 }));
  return { set: true };
};
`;

export class TravisApi extends Stack {
  constructor(scope: Construct, id: string, props: TravisApiProps) {
    super(scope, id, { ...props, terminationProtection: true });
    const { config } = props;
    Tags.of(this).add('project_name', config.projectName);

    // --- Private deploy bucket (captures and deploy inputs live here, never behind CloudFront) ---
    const deployBucket = new Bucket(this, 'DeployBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { id: 'abort-incomplete-multipart', abortIncompleteMultipartUploadAfter: Duration.days(7) },
        { id: 'expire-tmp', prefix: 'tmp/', expiration: Duration.days(30) },
      ],
    });

    // --- One image, two functions ---
    const image = new DockerImageAsset(this, 'Image', {
      directory: props.imageDirectory,
      platform: Platform.LINUX_ARM64,
    });

    const sharedEnv = {
      DUCKDB_PATH: '/opt/db/travis.duckdb',
      DUCKDB_EXTENSION_DIR: '/opt/duckdb_extensions',
      DUCKDB_MEMORY_LIMIT: config.duckdb.memoryLimit,
      DUCKDB_THREADS: String(config.duckdb.threads),
      LIMITS_JSON: limitsJson(config),
      POWERTOOLS_METRICS_NAMESPACE: METRICS_NAMESPACE,
    };

    const apiLogs = new LogGroup(this, 'ApiFunctionLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const chatLogs = new LogGroup(this, 'ChatFunctionLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const apiFn = new DockerImageFunction(this, 'ApiFunction', {
      code: DockerImageCode.fromEcr(image.repository, {
        tagOrDigest: image.imageTag,
        cmd: ['api.handler'],
      }),
      architecture: Architecture.ARM_64,
      memorySize: config.memoryMb.api,
      timeout: Duration.seconds(25),
      tracing: Tracing.ACTIVE,
      logGroup: apiLogs,
      environment: { ...sharedEnv, POWERTOOLS_SERVICE_NAME: 'travis-api' },
    });

    const chatFn = new DockerImageFunction(this, 'ChatFunction', {
      code: DockerImageCode.fromEcr(image.repository, {
        tagOrDigest: image.imageTag,
        cmd: ['chat.handler'],
      }),
      architecture: Architecture.ARM_64,
      memorySize: config.memoryMb.chat,
      timeout: Duration.seconds(28),
      tracing: Tracing.ACTIVE,
      logGroup: chatLogs,
      reservedConcurrentExecutions:
        config.chatReservedConcurrency > 0 ? config.chatReservedConcurrency : undefined,
      environment: {
        ...sharedEnv,
        POWERTOOLS_SERVICE_NAME: 'travis-chat',
        CHAT_FLAG_PARAM,
        BEDROCK_MODEL_ID: config.bedrockModelId,
      },
    });

    // --- Kill switch flag and IAM for chat (the only Bedrock grant) ---
    const flag = new StringParameter(this, 'ChatBudgetFlag', {
      parameterName: CHAT_FLAG_PARAM,
      stringValue: 'false',
      tier: ParameterTier.STANDARD,
      description:
        'true while the daily chat budget is exhausted; chat answers 503 budget_exhausted',
    });

    const modelId = foundationModelId(config);
    chatFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'BedrockInvokeProfileAndFoundationModels',
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:${config.region}:${config.account}:inference-profile/${config.bedrockModelId}`,
          ...config.bedrockRoutingRegions.map(
            (r) => `arn:aws:bedrock:${r}::foundation-model/${modelId}`,
          ),
        ],
      }),
    );
    chatFn.addToRolePolicy(
      new PolicyStatement({
        sid: 'ReadBudgetFlag',
        effect: Effect.ALLOW,
        actions: ['ssm:GetParameter'],
        resources: [flag.parameterArn],
      }),
    );

    // --- HTTP API ---
    const api = new HttpApi(this, 'HttpApi', {
      apiName: 'travis-property-intelligence',
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', apiFn),
      corsPreflight: {
        allowOrigins: ['*'],
        allowHeaders: ['content-type', 'mcp-protocol-version'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        exposeHeaders: ['x-request-id', 'apigw-requestid'],
        allowCredentials: false,
        maxAge: Duration.hours(1),
      },
    });
    const routes: HttpRoute[] = [];
    routes.push(
      ...api.addRoutes({
        path: '/v1/agent/chat',
        methods: [HttpMethod.POST],
        integration: new HttpLambdaIntegration('ChatIntegration', chatFn),
      }),
    );
    routes.push(
      ...api.addRoutes({
        path: '/v1/permits/text-search',
        methods: [HttpMethod.GET],
        integration: new HttpLambdaIntegration('TextSearchIntegration', apiFn),
      }),
    );
    routes.push(
      ...api.addRoutes({
        path: '/v1/mcp',
        methods: [HttpMethod.POST],
        integration: new HttpLambdaIntegration('McpIntegration', apiFn),
      }),
    );

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const stage = new HttpStage(this, 'DefaultStage', {
      httpApi: api,
      autoDeploy: true,
      throttle: { rateLimit: config.throttle.stage.rate, burstLimit: config.throttle.stage.burst },
      detailedMetricsEnabled: true,
      accessLogSettings: {
        destination: new LogGroupLogDestination(accessLogs),
        format: AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            requestTime: '$context.requestTime',
            routeKey: '$context.routeKey',
            httpMethod: '$context.httpMethod',
            path: '$context.path',
            status: '$context.status',
            responseLatency: '$context.responseLatency',
            integrationLatency: '$context.integrationLatency',
            integrationStatus: '$context.integrationStatus',
            integrationErrorMessage: '$context.integrationErrorMessage',
            errorMessage: '$context.error.message',
          }),
        ),
      },
    });
    const routeSettings: Record<string, Record<string, unknown>> = {};
    for (const [routeKey, limit] of Object.entries(config.throttle.routes)) {
      routeSettings[routeKey] = {
        ThrottlingRateLimit: limit.rate,
        ThrottlingBurstLimit: limit.burst,
        DetailedMetricsEnabled: true,
      };
    }
    (stage.node.defaultChild as CfnStage).routeSettings = routeSettings;
    // RouteSettings name routes by key; CloudFormation rejects the stage if they do not exist yet.
    for (const route of routes) stage.node.addDependency(route);

    // --- Alerting: one topic, email only ---
    const topic = new Topic(this, 'AlarmTopic', {
      displayName: 'Travis property intelligence alarms',
    });
    for (const email of config.alarmEmails) topic.addSubscription(new EmailSubscription(email));
    const alarmAction = new SnsAction(topic);

    const flagWriterLogs = new LogGroup(this, 'BudgetFlagSetterLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const flagSetter = new LambdaFunction(this, 'BudgetFlagSetter', {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      code: Code.fromInline(BUDGET_FLAG_SETTER),
      timeout: Duration.seconds(10),
      logGroup: flagWriterLogs,
      environment: {
        CHAT_FLAG_PARAM,
        DAILY_USAGE_ALARM_NAME,
        METRICS_NAMESPACE,
      },
    });
    flagSetter.addToRolePolicy(
      new PolicyStatement({ actions: ['ssm:PutParameter'], resources: [flag.parameterArn] }),
    );
    flagSetter.addEventSource(new SnsEventSource(topic));

    const schedulerRole = new Role(this, 'FlagClearSchedulerRole', {
      assumedBy: new ServicePrincipal('scheduler.amazonaws.com'),
    });
    schedulerRole.addToPolicy(
      new PolicyStatement({ actions: ['ssm:PutParameter'], resources: [flag.parameterArn] }),
    );
    new CfnSchedule(this, 'ClearBudgetFlagDaily', {
      description: 'Clears the chat budget kill switch at 00:00 UTC',
      scheduleExpression: 'cron(0 0 * * ? *)',
      scheduleExpressionTimezone: 'UTC',
      flexibleTimeWindow: { mode: 'OFF' },
      target: {
        arn: 'arn:aws:scheduler:::aws-sdk:ssm:putParameter',
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({
          Name: CHAT_FLAG_PARAM,
          Value: 'false',
          Type: 'String',
          Overwrite: true,
        }),
      },
    });

    // --- Alarms (8 of the 10 allowed; all self-resolving) ---
    const five = Duration.minutes(5);
    const mk = (id: string, alarm: ConstructorParameters<typeof Alarm>[2]) => {
      const a = new Alarm(this, id, { treatMissingData: TreatMissingData.NOT_BREACHING, ...alarm });
      a.addAlarmAction(alarmAction);
      a.addOkAction(alarmAction);
      return a;
    };
    const stage5xx = new Metric({
      namespace: 'AWS/ApiGateway',
      metricName: '5xx',
      dimensionsMap: { ApiId: api.apiId, Stage: '$default' },
      statistic: 'Sum',
      period: five,
    });
    mk('Stage5xxAlarm', {
      metric: stage5xx,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    for (const [label, fn] of [
      ['Api', apiFn],
      ['Chat', chatFn],
    ] as const) {
      mk(`${label}ErrorsAlarm`, {
        metric: fn.metricErrors({ period: five }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
      mk(`${label}ThrottlesAlarm`, {
        metric: fn.metricThrottles({ period: five }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      });
    }
    mk('ChatErrorRateAlarm', {
      metric: new MathExpression({
        expression: 'IF(invocations > 0, 100 * errors / invocations, 0)',
        usingMetrics: {
          errors: chatFn.metricErrors({ period: five }),
          invocations: chatFn.metricInvocations({ period: five }),
        },
        period: five,
      }),
      threshold: 20,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    mk('ChatDailyUsageAlarm', {
      alarmName: DAILY_USAGE_ALARM_NAME,
      alarmDescription: 'Chat invocations in a UTC day; sets the budget kill switch through SNS',
      metric: chatFn.metricInvocations({ period: Duration.days(1), statistic: 'Sum' }),
      threshold: config.dailyChatRequestLimit,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
    });
    mk('BudgetFlagSetAlarm', {
      alarmDescription:
        'The chat budget kill switch was set; clears itself an hour later, the flag at 00:00 UTC',
      metric: new Metric({
        namespace: METRICS_NAMESPACE,
        metricName: 'ChatBudgetFlagSet',
        statistic: 'Sum',
        period: Duration.hours(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });

    // --- Dashboard ---
    const apiMetric = (name: string, statistic = 'Sum') =>
      new Metric({
        namespace: 'AWS/ApiGateway',
        metricName: name,
        dimensionsMap: { ApiId: api.apiId, Stage: '$default' },
        statistic,
        period: five,
      });
    new Dashboard(this, 'Dashboard', {
      dashboardName: 'travis-property-intelligence',
      widgets: [
        [
          new GraphWidget({
            title: 'Requests, 4xx, 5xx',
            left: [apiMetric('Count'), apiMetric('4xx'), apiMetric('5xx')],
            width: 12,
          }),
          new GraphWidget({
            title: 'API latency (p95 ms)',
            left: [apiMetric('Latency', 'p95'), apiMetric('IntegrationLatency', 'p95')],
            width: 12,
          }),
        ],
        [
          new GraphWidget({
            title: 'Invocations',
            left: [
              apiFn.metricInvocations({ period: five }),
              chatFn.metricInvocations({ period: five }),
            ],
            width: 8,
          }),
          new GraphWidget({
            title: 'Errors and throttles',
            left: [
              apiFn.metricErrors({ period: five }),
              chatFn.metricErrors({ period: five }),
              apiFn.metricThrottles({ period: five }),
              chatFn.metricThrottles({ period: five }),
            ],
            width: 8,
          }),
          new GraphWidget({
            title: 'Duration (p95 ms)',
            left: [
              apiFn.metricDuration({ period: five, statistic: 'p95' }),
              chatFn.metricDuration({ period: five, statistic: 'p95' }),
            ],
            width: 8,
          }),
        ],
        [
          new SingleValueWidget({
            title: 'Chat invocations today (limit ' + config.dailyChatRequestLimit + ')',
            metrics: [chatFn.metricInvocations({ period: Duration.days(1) })],
            width: 12,
          }),
          new SingleValueWidget({
            title: 'Budget flag set events (last hour)',
            metrics: [
              new Metric({
                namespace: METRICS_NAMESPACE,
                metricName: 'ChatBudgetFlagSet',
                statistic: 'Sum',
                period: Duration.hours(1),
              }),
            ],
            width: 12,
          }),
        ],
      ],
    });

    // --- Outputs ---
    new CfnOutput(this, 'ApiBase', {
      value: api.apiEndpoint,
      description: 'API_BASE: the $default execute-api URL',
    });
    new CfnOutput(this, 'ApiFunctionName', { value: apiFn.functionName });
    new CfnOutput(this, 'ChatFunctionName', { value: chatFn.functionName });
    new CfnOutput(this, 'DeployBucketName', { value: deployBucket.bucketName });
    new CfnOutput(this, 'AccessLogGroupName', { value: accessLogs.logGroupName });
    new CfnOutput(this, 'ApiLogGroupName', { value: apiLogs.logGroupName });
    new CfnOutput(this, 'ChatLogGroupName', { value: chatLogs.logGroupName });

    pinLambdaLogGroups(this);
  }
}

export const defaultImageDirectory = (cdkDir: string): string => join(cdkDir, '..');
