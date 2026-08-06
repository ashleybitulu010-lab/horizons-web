import React, { useMemo } from 'react';

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

function segmentText(text) {
  const value = String(text || '');
  if (typeof Intl.Segmenter !== 'function') return [value];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

export default function EmojiText({ children }) {
  const text = String(children || '');
  const segments = useMemo(() => segmentText(text), [text]);

  return segments.map((segment, index) => (
    EMOJI_PATTERN.test(segment)
      ? <span className="emoji-glyph" key={`${segment}-${index}`}>{segment}</span>
      : <React.Fragment key={`${segment}-${index}`}>{segment}</React.Fragment>
  ));
}
