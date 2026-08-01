import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface MonitoringStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
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

    // Log groups with 30-day retention
    new logs.LogGroup(this, 'AppLogGroup', {
      logGroupName: `/valentin/${config.env}/app`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    new logs.LogGroup(this, 'AccessLogGroup', {
      logGroupName: `/valentin/${config.env}/access`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.env === 'prod'
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
    });

    // CloudWatch Dashboard
    const dashboard = new cloudwatch.Dashboard(this, 'ValentinDashboard', {
      dashboardName: `Valentin-${config.env}`,
    });

    // ECS CPU/Memory placeholder widgets
    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# Valentin Dashboard (${config.env})\nService health metrics`,
        width: 24,
        height: 2,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '## ECS Metrics\n*Populated after ECS service deployment*',
        width: 12,
        height: 4,
      }),
      new cloudwatch.TextWidget({
        markdown: '## ALB Metrics\n*Populated after ALB deployment*',
        width: 12,
        height: 4,
      }),
    );

    dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: '## DynamoDB\n*Populated after table usage begins*',
        width: 12,
        height: 4,
      }),
      new cloudwatch.TextWidget({
        markdown: '## Custom Metrics\n*Populated after application emits metrics*',
        width: 12,
        height: 4,
      }),
    );

    // Alarm: 5xx > 1% (5min) — placeholder metric until ALB is deployed
    const alb5xxAlarm = new cloudwatch.Alarm(this, 'ALB5xxAlarm', {
      alarmName: `valentin-${config.env}-alb-5xx`,
      alarmDescription: 'ALB 5xx error rate exceeds 1% over 5 minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_Target_5XX_Count',
        dimensionsMap: { LoadBalancer: `valentin-alb-${config.env}` },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xxAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Alarm: DynamoDB throttles
    const dynamoThrottleAlarm = new cloudwatch.Alarm(this, 'DynamoThrottleAlarm', {
      alarmName: `valentin-${config.env}-dynamo-throttle`,
      alarmDescription: 'DynamoDB read/write throttle events detected',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/DynamoDB',
        metricName: 'ThrottledRequests',
        dimensionsMap: { TableName: config.tableName },
        statistic: 'Sum',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dynamoThrottleAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Alarm: ECS CPU > 80% — placeholder until ECS deployed
    const ecsCpuAlarm = new cloudwatch.Alarm(this, 'EcsCpuAlarm', {
      alarmName: `valentin-${config.env}-ecs-cpu`,
      alarmDescription: 'ECS service CPU utilization exceeds 80%',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ServiceName: `valentin-service-${config.env}`,
          ClusterName: `valentin-cluster-${config.env}`,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    ecsCpuAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

    // Alarm: No healthy hosts — placeholder
    const noHealthyHostsAlarm = new cloudwatch.Alarm(this, 'NoHealthyHostsAlarm', {
      alarmName: `valentin-${config.env}-no-healthy-hosts`,
      alarmDescription: 'No healthy hosts registered with target group',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ApplicationELB',
        metricName: 'HealthyHostCount',
        dimensionsMap: {
          TargetGroup: `valentin-tg-${config.env}`,
          LoadBalancer: `valentin-alb-${config.env}`,
        },
        statistic: 'Minimum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    noHealthyHostsAlarm.addAlarmAction(new cdk.aws_cloudwatch_actions.SnsAction(this.alarmTopic));

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
