/**
 * Single source for the IVR bot's intents. CDK turns this into the Lex V2
 * resource; the browser demo uses it to simulate NLU and slot prompts.
 */

export interface SlotDefinition {
  name: string;
  type: string;
  prompt: string;
}

export interface IntentDefinition {
  name: string;
  utterances: string[];
  slots?: SlotDefinition[];
  dialogHook?: boolean;
  fulfilmentHook?: boolean;
}

export const METER_TYPES: Record<string, string[]> = {
  electricity: ['electric', 'power'],
  gas: ['the gas', 'gas meter'],
};

export const INTENTS: IntentDefinition[] = [
  {
    name: 'CheckBalance',
    utterances: [
      'balance',
      'what do I owe',
      "what's my balance",
      'how much is my bill',
      'how much do I owe you',
      'am I in credit',
      'check my account balance',
      'what is my account balance',
      'is my account up to date',
      "what's on my bill",
      'how much money is on my account',
    ],
    fulfilmentHook: true,
  },
  {
    name: 'SubmitMeterReading',
    utterances: [
      'meter reading',
      'give a meter reading',
      'submit a reading',
      "I'd like to give you my readings",
      'read my {MeterType} meter',
      'I want to submit my {MeterType} reading',
      'I have my readings',
      'send you my meter numbers',
      'enter my readings',
    ],
    slots: [
      {
        name: 'MeterType',
        type: 'MeterTypes',
        prompt: 'Is that for your electricity or your gas meter?',
      },
      {
        name: 'Reading',
        type: 'AMAZON.AlphaNumeric',
        prompt: 'Go ahead and read the black numbers from left to right.',
      },
    ],
    dialogHook: true,
    fulfilmentHook: true,
  },
  {
    name: 'ReportGasEmergency',
    utterances: [
      'gas leak',
      'I can smell gas',
      'smell of gas',
      'there is a gas leak',
      'emergency',
      'I think I have a gas leak',
      'my house smells of gas',
      'carbon monoxide alarm is going off',
    ],
  },
  {
    name: 'ReportPowerCut',
    utterances: [
      'power cut',
      'my power has gone off',
      'no electricity',
      'the lights have gone out',
      'my electric is off',
      'there is a power outage',
    ],
  },
  {
    name: 'PaymentDifficulty',
    utterances: [
      "I can't afford my bill",
      'struggling to pay',
      'payment plan',
      "I can't pay",
      'I need help paying my bill',
      'I am in debt',
    ],
  },
  {
    name: 'MakeComplaint',
    utterances: [
      'complaint',
      'I want to make a complaint',
      'I am not happy with the service',
      'I want to complain',
      'this is unacceptable',
    ],
  },
  {
    name: 'SmartMeterQuery',
    utterances: [
      'smart meter',
      "my smart meter isn't working",
      'smart meter display is blank',
      'book a smart meter installation',
      'in home display',
    ],
  },
  {
    name: 'MovingHome',
    utterances: [
      'moving home',
      "I'm moving house",
      'change of address',
      'moving out',
      'I have just moved in',
      'new tenant',
    ],
  },
  {
    name: 'SpeakToAgent',
    utterances: [
      'agent',
      'advisor',
      'speak to someone',
      'talk to a person',
      'real person please',
      'operator',
      'customer service',
      'human',
    ],
  },
];
