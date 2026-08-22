import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { EnvironmentConfig } from '../config/environments';

export interface AuthStackProps extends cdk.StackProps {
  config: EnvironmentConfig;
}

/** Username of the shared, pre-seeded account behind the one-click demo button */
export const DEMO_USER_EMAIL = 'demo@valentin.local';

/**
 * Cognito User Pool stack for Valentin authentication.
 *
 * Two app clients, deliberately:
 *
 * - **SpaClient** — public, no secret, authorization-code + PKCE only. This is
 *   what the browser drives through the Hosted UI. It has no password flow at
 *   all, so a stolen client id buys nothing.
 * - **DemoClient** — confidential (has a secret), password flow only, OAuth
 *   disabled. Only the ECS task can use it, and only to sign in the one shared
 *   demo account. This exists because Cognito's Hosted UI password form cannot
 *   be prefilled, and shipping the demo password in the SPA bundle would make
 *   it public forever. The server signs in on the user's behalf and returns
 *   real Cognito tokens, so everything downstream has exactly one code path.
 *
 * Note the scopes: OPENID and PROFILE only. `aws.cognito.signin.user.admin` is
 * deliberately absent — it would let a stolen access token change the user's
 * own password.
 */
export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly demoClient: cognito.UserPoolClient;
  public readonly demoSecret: secretsmanager.Secret;
  public readonly userPoolDomainPrefix: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);

    const env = props.config.env;

    // --- User Pool ---
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `valentin-users-${env}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      autoVerify: {
        email: true,
      },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireSymbols: true,
        requireLowercase: true,
        requireUppercase: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- User Pool Domain ---
    this.userPoolDomainPrefix = `valentin-${env}`;
    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: this.userPoolDomainPrefix,
      },
    });

    // --- App Client (SPA — public, PKCE only) ---
    this.userPoolClient = this.userPool.addClient('SpaClient', {
      userPoolClientName: `valentin-spa-${env}`,
      generateSecret: false,
      authFlows: {
        // SRP is not used by the browser (it drives the Hosted UI), but the
        // refresh-token flow is always available and is what the SPA needs.
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          // Implicit grant puts the access token in the URL fragment, where it
          // lands in browser history. CDK enables it by default when the oAuth
          // block is omitted, which is what this stack did before.
          implicitCodeGrant: false,
        },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: props.config.appUrls.callback,
        logoutUrls: props.config.appUrls.logout,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // --- Demo Client (server-only — password flow, no OAuth) ---
    this.demoClient = this.userPool.addClient('DemoClient', {
      userPoolClientName: `valentin-demo-${env}`,
      // No client secret, deliberately. The only auth flow enabled here is
      // ADMIN_USER_PASSWORD_AUTH, which is reachable solely via
      // cognito-idp:AdminInitiateAuth — an IAM-signed admin API that only the
      // task role may call. USER_PASSWORD_AUTH (the flow callable without AWS
      // credentials) is *not* enabled, so there is no path to this client from
      // a browser holding just the client id. A secret would add a second lock
      // to a door with no handle, at the cost of SECRET_HASH computation and a
      // secret that has to be copied out of Cognito after every deploy.
      generateSecret: false,
      authFlows: {
        adminUserPassword: true,
      },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
    });

    // --- Demo credentials ---
    // The password is generated here and never appears in git, in a log, or in
    // the SPA bundle. scripts/seed-demo-user.sh reads it to create the pool
    // user; the ECS task reads it to sign that user in.
    this.demoSecret = new secretsmanager.Secret(this, 'DemoUserSecret', {
      secretName: `valentin/${env}/demo-user`,
      description: 'Credentials for the shared one-click demo account',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: DEMO_USER_EMAIL }),
        generateStringKey: 'password',
        passwordLength: 24,
        // Cognito's policy requires digits and symbols; keep the symbol set to
        // characters that survive shell and JSON round-trips.
        excludeCharacters: '"\'\\`$&;<>|{}[]()',
        requireEachIncludedType: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // --- Outputs ---
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `valentin-user-pool-id-${env}`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID (SPA)',
      exportName: `valentin-user-pool-client-id-${env}`,
    });

    new cdk.CfnOutput(this, 'DemoClientId', {
      value: this.demoClient.userPoolClientId,
      description: 'Cognito User Pool Client ID (server-only, demo login)',
      exportName: `valentin-demo-client-id-${env}`,
    });

    new cdk.CfnOutput(this, 'UserPoolDomain', {
      value: domain.domainName,
      description: 'Cognito User Pool Domain',
      exportName: `valentin-user-pool-domain-${env}`,
    });

    new cdk.CfnOutput(this, 'DemoSecretArn', {
      value: this.demoSecret.secretArn,
      description: 'Secrets Manager ARN holding the demo account credentials',
      exportName: `valentin-demo-secret-arn-${env}`,
    });

    // Consumed by scripts/seed-demo-user.sh, so the deploy needs no hand-copied ids.
    new cdk.CfnOutput(this, 'DemoUserEmail', {
      value: DEMO_USER_EMAIL,
      description: 'Username of the shared demo account',
    });
  }
}
