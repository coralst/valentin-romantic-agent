import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface MonitoringStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
  /**
   * Real constructs rather than resource names. CloudWatch identifies ALB
   * resources by their full name (`app/valentin-alb-dev/<id>`,
   * `targetgroup/valentin-tg-dev/<id>`), not the bare name. Hand-writing
   * dimensionsMap produced alarms that silently watched nothing; the metric
   * helpers on these constructs generate the correct dimensions.
   */
  loadBalancer: elbv2.ApplicationLoadBalancer;
  targetGroup: elbv2.ApplicationTargetGroup;
  service: ecs.FargateService;
  table: dynamodb.ITable;
}

export class MonitoringStack extends cdk.Stack {
  public readonly alarmTopic: sns.ITopic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    const { config } = props;

    // SNS topic for alarm notifications
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: `valentin-alarms-${config.env}`,
      displayName: `Valentin Alarms (${config.env})`,
    });

    const alarmAction = new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic);

    // --- Metrics ---
    const alb5xx = props.loadBalancer.metrics.httpCodeTarget(
      elbv2.HttpCodeTarget.TARGET_5XX_COUNT,
      { statistic: 'Sum', period: cdk.Duration.minutes(5) },
    );

    const requestCount = props.loadBalancer.metrics.requestCount({
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const targetResponseTime = props.loadBalancer.metrics.targetResponseTime({
      statistic: 'p95',
      period: cdk.Duration.minutes(5),
    });

    const healthyHosts = props.targetGroup.metrics.healthyHostCount({
      statistic: 'Minimum',
      period: cdk.Duration.minutes(1),
    });

    const cpuUtilization = props.service.metricCpuUtilization({
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const memoryUtilization = props.service.metricMemoryUtilization({
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const dynamoThrottles = props.table.metricThrottledRequestsForOperations({
      operations: [
        dynamodb.Operation.GET_ITEM,
        dynamodb.Operation.PUT_ITEM,
        dynamodb.Operation.UPDATE_ITEM,
        dynamodb.Operation.DELETE_ITEM,
        dynamodb.Operation.QUERY,
        dynamodb.Operation.BATCH_GET_ITEM,
        dynamodb.Operation.BATCH_WRITE_ITEM,
      ],
      period: cdk.Duration.minutes(5),
    });

    // --- Alarms ---
    const alb5xxAlarm = new cloudwatch.Alarm(this, 'ALB5xxAlarm', {
      alarmName: `valentin-${config.env}-alb-5xx`,
      alarmDescription: 'ALB 5xx responses from targets over 5 minutes',
      metric: alb5xx,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xxAlarm.addAlarmAction(alarmAction);

    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoThrottleAlarm', {
      alarmName: `valentin-${config.env}-dynamo-throttle`,
      alarmDescription: 'DynamoDB read/write throttle events detected',
      metric: dynamoThrottles,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dynamoThrottleAlarm.addAlarmAction(alarmAction);

    const ecsCpuAlarm = new cloudwatch.Alarm(this, 'EcsCpuAlarm', {
      alarmName: `valentin-${config.env}-ecs-cpu`,
      alarmDescription: 'ECS service CPU utilization exceeds 80%',
      metric: cpuUtilization,
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ecsCpuAlarm.addAlarmAction(alarmAction);

    // BREACHING is correct here — an absent HealthyHostCount datapoint means
    // the target group is gone, which is the condition we want to catch. This
    // alarm sat in a permanent false ALARM state only because the hand-written
    // dimensions never matched a real metric, so no datapoints ever arrived.
    const noHealthyHostsAlarm = new cloudwatch.Alarm(this, 'NoHealthyHostsAlarm', {
      alarmName: `valentin-${config.env}-no-healthy-hosts`,
      alarmDescription: 'No healthy hosts registered with target group',
      metric: healthyHosts,
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    noHealthyHostsAlarm.addAlarmAction(alarmAction);

    // --- Dashboard ---
    const dashboard = new cloudwatch.Dashboard(this, 'ValentinDashboard', {
      dashboardName: `Valentin-${config.env}`,
    });

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# Valentin Dashboard (${config.env})`,
        width: 24,
        height: 1,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS Utilization',
        left: [cpuUtilization, memoryUtilization],
        width: 12,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'ALB Requests and 5xx',
        left: [requestCount],
        right: [alb5xx],
        width: 12,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Target Response Time (p95)',
        left: [targetResponseTime],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Healthy Hosts',
        left: [healthyHosts],
        width: 8,
        height: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'DynamoDB Throttles',
        left: [dynamoThrottles],
        width: 8,
        height: 6,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.AlarmStatusWidget({
        title: 'Alarm Status',
        alarms: [alb5xxAlarm, dynamoThrottleAlarm, ecsCpuAlarm, noHealthyHostsAlarm],
        width: 24,
        height: 3,
      }),
    );

    // Outputs
    new cdk.CfnOutput(this, 'AlarmTopicArn', {
      value: this.alarmTopic.topicArn,
      exportName: `Valentin-AlarmTopicArn-${config.env}`,
    });

    new cdk.CfnOutput(this, 'DashboardName', {
      value: dashboard.dashboardName,
      exportName: `Valentin-DashboardName-${config.env}`,
    });
  }
}
