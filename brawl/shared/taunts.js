// Random one-liners shown in a speech bubble above a player's head when
// they press T. Deliberately obnoxious.

export const TAUNTS = [
  'Skill issue, gooner.',
  'My wheelchair has better mobility than you.',
  'Certified goon moment.',
  'You fight like my uncle after four beers.',
  'L + ratio + no aubergine.',
  'Get gooned, scrub.',
  'Was that your special? Genuinely?',
  'Sit down before you hurt yourself.',
  'I could beat you with the banana alone.',
  'Bro is fighting for his life and losing.',
  'Uninstall. Touch grass. Both.',
  'This is embarrassing for everyone watching.',
  'Free elo, thanks bestie.',
  "You typed g-o-o-n wrong, didn't you.",
  'Grandma mode: activated (by you).',
  'Ratioed in real life.',
  'Blocked? Never heard of her.',
  'Do you need a tutorial? Blink twice.',
  'Absolutely goonlestial performance from you.',
  "Ggs already. I'm going to get a kebab.",
];

// Said instead of a real taunt while you're covered in milkshake — you are
// far too unwell to be talking trash.
export const ICKY_TAUNTS = [
  'mommy help',
  "i don't like mc doneld",
  'my tummy hurts',
  'is this where it ends?',
  'why is it warm',
  'i want to go home',
  'please stop the beam',
  'i can taste the colours',
  "i've made a huge mistake",
  'no more milkshake. no more.',
  'am i still a person',
  'tell my mother i tried',
];

export function randomTaunt() {
  return TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
}

export function randomIckyTaunt() {
  return ICKY_TAUNTS[Math.floor(Math.random() * ICKY_TAUNTS.length)];
}
