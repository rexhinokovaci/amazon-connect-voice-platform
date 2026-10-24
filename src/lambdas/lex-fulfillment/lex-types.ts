// Subset of the Lex V2 code hook contract we actually use.
// https://docs.aws.amazon.com/lexv2/latest/dg/lambda-input-format.html

export interface LexSlotValue {
  value: { originalValue: string; interpretedValue?: string; resolvedValues?: string[] };
}

export type LexSlots = Record<string, LexSlotValue | null>;

export interface LexIntent {
  name: string;
  slots: LexSlots;
  state: 'InProgress' | 'ReadyForFulfillment' | 'Fulfilled' | 'Failed' | 'Waiting';
  confirmationState?: 'Confirmed' | 'Denied' | 'None';
}

export interface LexEvent {
  sessionId: string;
  inputTranscript: string;
  invocationSource: 'DialogCodeHook' | 'FulfillmentCodeHook';
  inputMode: 'Text' | 'Speech' | 'DTMF';
  bot: { id: string; name: string; aliasId: string; localeId: string; version: string };
  sessionState: {
    intent: LexIntent;
    sessionAttributes?: Record<string, string>;
    activeContexts?: unknown[];
  };
  requestAttributes?: Record<string, string>;
}

export type DialogAction =
  | { type: 'Close' }
  | { type: 'Delegate' }
  | { type: 'ElicitSlot'; slotToElicit: string }
  | { type: 'ElicitIntent' };

export interface LexResponse {
  sessionState: {
    dialogAction: DialogAction;
    intent?: LexIntent;
    sessionAttributes?: Record<string, string>;
  };
  messages?: Array<{ contentType: 'PlainText' | 'SSML'; content: string }>;
}
