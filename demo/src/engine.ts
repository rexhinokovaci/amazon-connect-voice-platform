import type { ConnectContactFlowEvent, Context } from 'aws-lambda';
import { INTENTS } from '../../src/domain/bot-definition';
import { isOpen } from '../../src/domain/hours';
import type { TenantConfig } from '../../src/domain/tenant-config';
import type { Flow, FlowAction } from '../../src/flows/flow';
import { handler as routerHandler } from '../../src/lambdas/connect-router/handler';
import { handler as lexHandler } from '../../src/lambdas/lex-fulfillment/handler';
import type { LexEvent, LexResponse, LexSlots } from '../../src/lambdas/lex-fulfillment/lex-types';
import { classify, resolveMeterType } from './nlu';

export type EngineEvent =
  | { kind: 'block'; action: FlowAction }
  | { kind: 'say'; text: string }
  | { kind: 'hear'; text: string; intent?: string; confidence?: number }
  | { kind: 'invoke'; target: string; request: unknown; response: unknown; ms: number }
  | { kind: 'end'; outcome: string; detail: string };

export interface CallOptions {
  tenant: TenantConfig;
  flow: Flow;
  ani: string;
  now: Date;
  queueNames: Record<string, string>;
  emit: (e: EngineEvent) => void;
  listen: () => Promise<string>;
}

const ctx = (ms = 3000) => ({ getRemainingTimeInMillis: () => ms }) as unknown as Context;
const MAX_STEPS = 200;

export class CallSimulator {
  private attributes: Record<string, string> = {};
  private external: Record<string, string> = {};
  private lex: { IntentName?: string; SessionAttributes: Record<string, string> } = {
    SessionAttributes: {},
  };
  private targetQueue?: string;
  private priority = '5';
  private readonly contactId = crypto.randomUUID();
  private stopped = false;

  constructor(private readonly o: CallOptions) {}

  hangUp(): void {
    this.stopped = true;
  }

  async run(): Promise<void> {
    const byId = new Map(this.o.flow.Actions.map((a) => [a.Identifier, a]));
    let current: string | undefined = this.o.flow.StartAction;

    for (let steps = 0; current && !this.stopped; steps++) {
      if (steps > MAX_STEPS) throw new Error('flow loop detected');
      const action = byId.get(current);
      if (!action) throw new Error(`missing action ${current}`);
      this.o.emit({ kind: 'block', action });
      current = await this.execute(action);
    }
  }

  private resolve(v: unknown): string {
    if (typeof v !== 'string' || !v.startsWith('$.')) return String(v ?? '');
    const [, ns, ...rest] = v.split('.');
    const key = rest.join('.');
    if (ns === 'External') return this.external[key] ?? '';
    if (ns === 'Attributes') return this.attributes[key] ?? '';
    if (ns === 'Lex') {
      if (key === 'IntentName') return this.lex.IntentName ?? '';
      if (key.startsWith('SessionAttributes.'))
        return this.lex.SessionAttributes[key.slice('SessionAttributes.'.length)] ?? '';
    }
    return '';
  }

  private error(a: FlowAction, type: string): string | undefined {
    const errs = a.Transitions.Errors ?? [];
    return (
      errs.find((e) => e.ErrorType === type) ?? errs.find((e) => e.ErrorType === 'NoMatchingError')
    )?.NextAction;
  }

  private condition(a: FlowAction, value: string): string | undefined {
    const match = a.Transitions.Conditions?.find((c) => c.Condition.Operands.includes(value));
    if (match) return match.NextAction;
    return (
      a.Transitions.Errors?.find((e) => e.ErrorType === 'NoMatchingCondition')?.NextAction ??
      a.Transitions.NextAction
    );
  }

  private async execute(a: FlowAction): Promise<string | undefined> {
    const p = a.Parameters;
    switch (a.Type) {
      case 'UpdateFlowLoggingBehavior':
      case 'UpdateContactTextToSpeechVoice':
      case 'UpdateContactRecordingBehavior':
        return a.Transitions.NextAction;

      case 'CheckHoursOfOperation':
        return this.condition(a, isOpen(this.o.tenant, this.o.now) ? 'True' : 'False');

      case 'MessageParticipant':
        this.o.emit({ kind: 'say', text: String(p.Text) });
        return a.Transitions.NextAction;

      case 'UpdateContactAttributes': {
        for (const [k, v] of Object.entries(p.Attributes as Record<string, string>)) {
          this.attributes[k] = this.resolve(v);
        }
        return a.Transitions.NextAction;
      }

      case 'InvokeLambdaFunction': {
        const params = Object.fromEntries(
          Object.entries((p.LambdaInvocationAttributes ?? {}) as Record<string, string>).map(
            ([k, v]) => [k, this.resolve(v)],
          ),
        );
        const event = this.connectEvent(params);
        const started = performance.now();
        try {
          const res = await routerHandler(event, ctx(Number(p.InvocationTimeLimitSeconds) * 1000));
          this.external = res;
          this.o.emit({
            kind: 'invoke',
            target: 'connect-router',
            request: event,
            response: res,
            ms: performance.now() - started,
          });
          return a.Transitions.NextAction;
        } catch (err) {
          this.o.emit({
            kind: 'invoke',
            target: 'connect-router',
            request: event,
            response: { error: String(err) },
            ms: performance.now() - started,
          });
          return this.error(a, 'NoMatchingError');
        }
      }

      case 'ConnectParticipantWithLexBot': {
        const sessionAttributes = Object.fromEntries(
          Object.entries((p.LexSessionAttributes ?? {}) as Record<string, string>).map(([k, v]) => [
            k,
            this.resolve(v),
          ]),
        );
        const result = await this.lexConversation(String(p.Text), sessionAttributes);
        if (!result) return this.error(a, 'InputTimeLimitExceeded');
        this.lex = { IntentName: result.intent, SessionAttributes: result.attributes };
        return this.condition(a, result.intent);
      }

      case 'Compare':
        return this.condition(a, this.resolve(p.ComparisonValue));

      case 'UpdateContactTargetQueue': {
        const q = this.resolve(p.QueueId);
        if (!q || q.startsWith('${')) return this.error(a, 'NoMatchingError');
        this.targetQueue = q;
        return a.Transitions.NextAction;
      }

      case 'UpdateContactRoutingBehavior':
        this.priority = this.resolve(p.QueuePriority) || '5';
        return a.Transitions.NextAction;

      case 'TransferContactToQueue': {
        const name = this.o.queueNames[this.targetQueue ?? ''] ?? this.targetQueue ?? 'unknown';
        this.o.emit({
          kind: 'end',
          outcome: 'Queued for an agent',
          detail: `${name} · priority ${this.priority}`,
        });
        return undefined;
      }

      case 'TransferParticipantToThirdParty':
        this.o.emit({
          kind: 'end',
          outcome: 'Transferred externally',
          detail: String(p.ThirdPartyPhoneNumber),
        });
        return undefined;

      case 'DisconnectParticipant':
        this.o.emit({
          kind: 'end',
          outcome: 'Call ended in self-service',
          detail: 'Contained - no agent needed',
        });
        return undefined;

      default:
        throw new Error(`demo does not implement ${a.Type}`);
    }
  }

  private connectEvent(params: Record<string, string>): ConnectContactFlowEvent {
    return {
      Name: 'ContactFlowEvent',
      Details: {
        ContactData: {
          ContactId: this.contactId,
          Channel: 'VOICE',
          InitiationMethod: 'INBOUND',
          CustomerEndpoint: { Type: 'TELEPHONE_NUMBER', Address: this.o.ani },
          SystemEndpoint: {
            Type: 'TELEPHONE_NUMBER',
            Address: Object.keys(this.o.tenant.dialledNumbers)[0],
          },
          Attributes: { ...this.attributes },
        },
        Parameters: params,
      },
    } as unknown as ConnectContactFlowEvent;
  }

  /** Simulates the Lex V2 runtime: NLU, slot elicitation and code hooks. */
  private async lexConversation(
    greeting: string,
    attributes: Record<string, string>,
  ): Promise<{ intent: string; attributes: Record<string, string> } | undefined> {
    this.o.emit({ kind: 'say', text: greeting });
    const first = await this.o.listen();
    if (this.stopped) return undefined;
    const { intent, confidence } = classify(first);
    this.o.emit({ kind: 'hear', text: first, intent, confidence });

    const def = INTENTS.find((i) => i.name === intent);
    if (!def) return { intent, attributes };

    const slots: LexSlots = {};
    for (const s of def.slots ?? []) slots[s.name] = null;
    if ('MeterType' in slots) {
      const m = resolveMeterType(first);
      if (m)
        slots.MeterType = { value: { originalValue: m, interpretedValue: m, resolvedValues: [m] } };
    }

    let attrs = { ...attributes };
    const call = async (source: LexEvent['invocationSource']): Promise<LexResponse> => {
      const event: LexEvent = {
        sessionId: this.contactId,
        inputTranscript: first,
        invocationSource: source,
        inputMode: 'Speech',
        bot: {
          id: 'DEMO',
          name: 'ivr',
          aliasId: 'live',
          localeId: this.o.tenant.locale,
          version: '1',
        },
        sessionState: {
          intent: { name: intent, slots: { ...slots }, state: 'InProgress' },
          sessionAttributes: attrs,
        },
      };
      const started = performance.now();
      const res = await lexHandler(event, ctx(5000));
      this.o.emit({
        kind: 'invoke',
        target: `lex-fulfillment (${source})`,
        request: event,
        response: res,
        ms: performance.now() - started,
      });
      attrs = res.sessionState.sessionAttributes ?? attrs;
      return res;
    };

    const say = (res: LexResponse) =>
      res.messages?.forEach((m) => this.o.emit({ kind: 'say', text: m.content }));

    const fill = async (slotName: string, prompt?: string) => {
      if (prompt) this.o.emit({ kind: 'say', text: prompt });
      const heard = await this.o.listen();
      this.o.emit({ kind: 'hear', text: heard });
      const value = slotName === 'MeterType' ? resolveMeterType(heard) : heard;
      slots[slotName] = value
        ? { value: { originalValue: heard, interpretedValue: value, resolvedValues: [value] } }
        : null;
    };
    const promptFor = (name: string) => def.slots?.find((s) => s.name === name)?.prompt;
    const nextMissing = () => def.slots?.find((s) => !slots[s.name]);

    // Each pass: dialog hook until slots are complete, then fulfilment. A
    // fulfilment-time ElicitSlot sends us round again, as Lex would.
    for (let turn = 0; turn < 10 && !this.stopped; turn++) {
      const missing = nextMissing();

      if (def.dialogHook) {
        const res = await call('DialogCodeHook');
        say(res);
        const action = res.sessionState.dialogAction;
        if (action.type === 'Close') return { intent, attributes: attrs };
        if (action.type === 'ElicitSlot') {
          await fill(
            action.slotToElicit,
            res.messages?.length ? undefined : promptFor(action.slotToElicit),
          );
          continue;
        }
        if (missing) {
          await fill(missing.name, missing.prompt);
          continue;
        }
      } else if (missing) {
        await fill(missing.name, missing.prompt);
        continue;
      }

      if (!def.fulfilmentHook) return { intent, attributes: attrs };
      const res = await call('FulfillmentCodeHook');
      say(res);
      const action = res.sessionState.dialogAction;
      if (action.type === 'ElicitSlot') {
        await fill(action.slotToElicit);
        continue;
      }
      return { intent, attributes: attrs };
    }
    return { intent, attributes: attrs };
  }
}
