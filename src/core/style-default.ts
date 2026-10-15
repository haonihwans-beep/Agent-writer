import type { StyleGuide } from './types.ts';

/**
 * Default writing contract given to every chapter-generation call.
 * The rules are intentionally concrete: vague instructions produce
 * generic prose, specific bans kill the most common AI tells.
 */
export function defaultStyleGuide(): StyleGuide {
  return {
    schema: 'novel.style/1',
    rules: [
      'Write like a working webnovel author shipping a chapter tomorrow, not like a literary model showing off.',
      'Concrete over abstract: name the object, the smell, the sound. No essays inside scenes.',
      'Vary sentence length on purpose. Short punches after long flowing sentences.',
      'Carry the scene through action and dialogue first; interiority only at the moment of decision.',
      'Every scene must end with a reason to keep reading: a new question, a reversal, or a cost paid.',
      'Dialogue does at least two jobs at once (character + plot + subtext). No "as you know" exposition.',
      'Never summarize what the reader just watched happen. Compress only the parts worth skipping.',
      'Use the established canon exactly: names, ages, places, and rules must match the bible.',
      'Stay in the chapter POV; never narrate what the POV character cannot perceive.',
      'No meta commentary, no author notes, no [brackets], no chapter summaries in the prose.',
      'Preference for plain strong verbs; cut adverbs that duplicate the verb.',
      'Sensory grounding: at least three different senses per major scene.',
    ],
    banned: [
      'a testament to',
      'delve',
      'tapestry',
      'symphony of',
      'a chorus of',
      'little did',
      'unbeknownst to',
      'shivers down',
      'in the grand scheme',
      'needless to say',
      'it goes without saying',
      'at the end of the day',
      'the air was thick',
      'hung heavy',
      'a wave of',
      'washed over',
      'a pang of',
      'began to',
      'started to',
      'seemed to',
      'could not help but',
      'let out a breath',
      're:like a phoenix rising',
      're:eyes (that )?(sparkled|gleamed|twinkled)',
      're:a mix of .{0,40}(washed|crashed|swept) over',
      're:\\bit was then\\b',
      're:\\bas if (the|it|he|she|they)\\b',
    ],
    samples: [
      'The tea had gone cold an hour ago. She drank it anyway, watching the gate through the steam, because waiting was the only thing left that the sect still let her do.',
      '"You brought a knife to a blood-oath?" He laughed, the sound too loud for the empty hall. "Good. Then you already understand the price."',
    ],
  };
}
