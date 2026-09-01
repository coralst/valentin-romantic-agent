import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * SpringClean's permanent-exemption tags.
 *
 * `auto-delete=no` is the documented signal; `springclean=<any value>` is a
 * second accepted form. Both are applied so the exemption survives either one
 * being narrowed or deprecated.
 */
export const SPRING_CLEAN_EXEMPTION_TAGS: ReadonlyArray<readonly [string, string]> = [
  ['auto-delete', 'no'],
  ['springclean', 'exempt'],
];

/**
 * Keep the Isengard account janitor off every resource in this app.
 *
 * This guards against an **Isengard** mechanism, not an AWS one, which is why
 * no public AWS document describes it and why `cdk deploy` alone never
 * protected us. SpringClean is a Lambda installed in Isengard accounts owned by
 * the Support org; it scans daily and deletes resources that carry no exemption
 * tag — warning email on day 4, deletion on day 7. It calls the service APIs
 * directly, so `DeletionPolicy: Retain` and `RemovalPolicy.RETAIN` do not stop
 * it: CloudFormation is simply never consulted.
 *
 * On 2026-09-01 it deleted `ValentinTable-dev`. `Valentin-Data-dev` still read
 * UPDATE_COMPLETE, still listed the table as a member resource, and the table
 * did not exist — so every `POST /api/demo/login` returned 500 ("Requested
 * resource not found") and nobody could sign in to the deployed app. Point-in-
 * time recovery does not survive its table, so the data was unrecoverable.
 *
 * Applied at **app** scope so a resource added to any stack later inherits the
 * exemption rather than quietly becoming a seven-day fuse.
 *
 * Tags are the first layer, not the only one: the DynamoDB table also carries
 * deletion protection, which refuses `DeleteTable` at the API even with no tag.
 *
 * @see https://w.amazon.com/bin/view/AWS_SpringClean/ — Tags → Retain Indefinitely
 */
export function applySpringCleanExemption(scope: Construct): void {
  for (const [key, value] of SPRING_CLEAN_EXEMPTION_TAGS) {
    cdk.Tags.of(scope).add(key, value);
  }
}
