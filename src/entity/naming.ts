import { ENTITY_NAMING_CONSTANTS } from '../types';

const EMOJI_RANGE_WEIGHTS = ENTITY_NAMING_CONSTANTS.emojiRanges.map(([min, max]) => max - min + 1);
const EMOJI_TOTAL_WEIGHT = EMOJI_RANGE_WEIGHTS.reduce((a, b) => a + b, 0);
const EMOJI_REGEX = /\p{Extended_Pictographic}/u;

function getRandomEmoji(): string {
  for (let attempt = 0; attempt < ENTITY_NAMING_CONSTANTS.maxEmojiAttempts; attempt++) {
    let rand = Math.random() * EMOJI_TOTAL_WEIGHT;
    for (let i = 0; i < ENTITY_NAMING_CONSTANTS.emojiRanges.length; i++) {
      rand -= EMOJI_RANGE_WEIGHTS[i];
      if (rand <= 0) {
        const [min, max] = ENTITY_NAMING_CONSTANTS.emojiRanges[i];
        const codePoint = min + Math.floor(Math.random() * (max - min + 1));
        const char = String.fromCodePoint(codePoint);
        if (EMOJI_REGEX.test(char)) {
          return char;
        }
        break;
      }
    }
  }
  return ENTITY_NAMING_CONSTANTS.fallbackEmoji;
}

export function generateEntityName(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let name = '';
  for (let i = 0; i < 3; i++) {
    name += letters[Math.floor(Math.random() * 26)];
  }
  for (let i = 0; i < 3; i++) {
    name += Math.floor(Math.random() * 10).toString();
  }
  name += getRandomEmoji() + getRandomEmoji();
  return name;
}
