import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Account, AccountRepository, MeterReading, MeterType } from './accounts';

/**
 * Single-table layout, one table per tenant:
 *
 *   PK                    SK                           GSI1PK
 *   ACCOUNT#<id>          PROFILE                      PHONE#<e164>
 *   ACCOUNT#<id>          READING#<meter>#<isoTime>
 *
 * Readings sort by time under the account, so "latest reading" is a single
 * descending Query with Limit 1.
 */
export class DynamoAccountRepository implements AccountRepository {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client = new DynamoDBClient({ maxAttempts: 2 }),
  ) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async findByPhone(phone: string, signal?: AbortSignal): Promise<Account | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': `PHONE#${phone}` },
        Limit: 2,
      }),
      { abortSignal: signal },
    );
    // A shared household number maps to several accounts; don't guess.
    if (!res.Items || res.Items.length !== 1) return undefined;
    return toAccount(res.Items[0]!);
  }

  async findById(accountId: string, signal?: AbortSignal): Promise<Account | undefined> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { PK: `ACCOUNT#${accountId}`, SK: 'PROFILE' },
      }),
      { abortSignal: signal },
    );
    return res.Item ? toAccount(res.Item) : undefined;
  }

  async lastReading(
    accountId: string,
    meterType: MeterType,
    signal?: AbortSignal,
  ): Promise<MeterReading | undefined> {
    const res = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `ACCOUNT#${accountId}`,
          ':sk': `READING#${meterType}#`,
        },
        ScanIndexForward: false,
        Limit: 1,
      }),
      { abortSignal: signal },
    );
    const item = res.Items?.[0];
    if (!item) return undefined;
    return {
      accountId,
      meterType,
      value: Number(item.value),
      readAt: String(item.readAt),
      source: item.source as MeterReading['source'],
    };
  }

  async saveReading(reading: MeterReading, signal?: AbortSignal): Promise<void> {
    await this.doc.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          PK: `ACCOUNT#${reading.accountId}`,
          SK: `READING#${reading.meterType}#${reading.readAt}`,
          ...reading,
        },
        // Retried Lex turns must not create duplicate readings.
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
      { abortSignal: signal },
    );
  }
}

function toAccount(item: Record<string, unknown>): Account {
  return {
    accountId: String(item.accountId),
    firstName: String(item.firstName ?? ''),
    balancePence: Number(item.balancePence ?? 0),
    priorityServicesRegister: item.priorityServicesRegister === true,
    meters: Array.isArray(item.meters) ? (item.meters as MeterType[]) : [],
  };
}
