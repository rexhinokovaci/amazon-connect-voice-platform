# Writing for voice

Prompts written for a screen fail on a phone. This applies to Lex prompts and Polly SSML as much as to a speech-to-speech model's system prompt.

## IVR prompts (Lex / Polly)

- **One question per turn.** "Is that for your electricity or your gas meter?" works. "Which meter, and can you read it now?" gets half an answer.
- **Put the options last.** The caller remembers the last thing they heard.
- **Read numbers back the way people say them.** `12345` is read back as "1 2 3 4 5", digit by digit. Readings and account numbers aren't quantities. See `submitMeterReading` in the fulfilment handler.
- **Don't apologise twice.** "Sorry, I didn't catch that" once is fine. A second apology wears thin, so the second retry goes to an agent instead.
- **Keep the safety message first.** In the gas emergency path the instruction ("don't use switches, open windows") comes before the transfer, because the transfer can fail.

## Speech-to-speech system prompts

A text agent's prompt mostly controls *what* gets said. A voice agent's prompt also has to control *how long* and *in what shape*, because the caller can't scan back.

What works with Nova Sonic:

```text
You are the phone assistant for Brightwell Energy, speaking with a customer on a call.

Speak in short sentences. Two sentences per turn unless the customer asks for detail.
Never read out lists longer than three items; offer to go through them one at a time.
Say numbers the way a person would on the phone: amounts as pounds and pence,
reference numbers digit by digit.

Before using a tool that looks up or changes account data, say a short holding phrase
like "One moment while I check that." Do not say anything else until the tool returns.

If the customer mentions a smell of gas, stop what you are doing, tell them to leave
the property without using switches, and call transfer_to_emergency immediately.

If you are unsure what the customer wants after two attempts, offer to transfer them
to a person.
```

Notes on why:

- **Length limits matter more than tone instructions.** A model that rambles is the most common complaint in voice. Tone mostly follows from the voice you pick.
- **Holding phrases hide tool latency.** Saying "One moment" costs nothing, and it turns a 600 ms tool call from dead air into a normal pause.
- **Safety rules go in plain imperative language** and come with a tool to call. The tool is what makes them reliable.
- **No markdown or emoji.** The model won't speak them, but they still take up tokens and sometimes leak into the speech as "asterisk".

## Testing voice prompts

Text evals miss most voice failures. What we do instead:

1. Synthesised caller audio (Polly, several voices and accents) through the real pipeline, with assertions on tool calls and transcript content.
2. Listen to ten real recordings a week, picked at random, with a checklist: turn length, interruptions handled, numbers read correctly.
3. Track `barge_in_rate` and `turns_per_contact`. A rising barge-in rate usually means the responses have got too long.
