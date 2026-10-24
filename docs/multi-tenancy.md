# Multi-tenancy

A tenant is a brand with its own phone numbers, opening hours, queues, voice and data. Tenants share code and pipeline but share **no runtime resources**.

## Isolation model

| Layer | Isolation |
|---|---|
| Connect instance | One per tenant per stage |
| Data | Own DynamoDB table, S3 bucket, Kinesis stream and KMS key |
| Lambda | Own functions. Tenant config is baked into the environment at deploy time, so a function can't read another tenant's config. |
| IAM | Grants scoped to the tenant's table and key. Connect may invoke the router only with `SourceArn` = that tenant's instance. |
| Observability | Every log line and metric carries a `tenant` tag. Monitors are templated per tenant. |
| Region | Per tenant. Lets a brand pilot features only available in some regions without moving the others. |

## Configuration management

`config/tenants/<tenant>.json` is the only place tenant behaviour is defined. It's validated by `TenantConfigSchema` in three places:

1. **CI**: unit tests parse every file.
2. **Synth**: `infra/bin/app.ts` refuses to synthesise an invalid config.
3. **Cold start**: the Lambda parses `TENANT_CONFIG` once and fails loudly if it's bad, rather than routing with defaults.

Cross-field rules sit in the schema too. Every intent must route to a queue that exists, the default queue must exist, opening must come before closing, and numbers must be E.164. A typo in a queue key fails the PR, not a live call.

## Adding a tenant

1. Copy an existing file in `config/tenants/` and edit it.
2. `npm test`: schema and infra assertions run against it.
3. `npx cdk diff -c stage=dev -c tenant=<id>` and review it.
4. Deploy dev, associate a test number, place calls.
5. Raise the prod change. The pipeline deploys tenants one at a time, so a bad change stops at the first tenant.

## Changing behaviour for every tenant at once

Code and flow changes roll out per tenant in sequence, dev then staging then prod, with a bake period between prod tenants. The lowest-volume brand goes first.

## Current tenants

| Tenant | Region | Notes |
|---|---|---|
| `brightwell-energy` | eu-west-2 (London) | UK energy retailer. Priority Services Register, gas emergency transfer to 0800 111 999. |
| `drita-energji` | eu-central-1 (Frankfurt) | Albanian electricity supplier, Tirana hours, `+355` numbers. Neither Lex V2 nor Polly offers an Albanian locale, so prompts are English with Albanian queue names. The plan is a DTMF-first menu for callers who don't want English. Check current Lex language support before assuming this still holds. |

Both brands are fictional.
