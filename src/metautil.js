// Copied from metautil v5.5.2 (lib/strings.js, lib/objects.js)
// https://github.com/metarhia/metautil — MIT, Copyright (c) 2017-2026 Metarhia contributors

const inRange = (x, min, max) => x >= min && x <= max;

const isFirstUpper = (s) => !!s && inRange(s[0], 'A', 'Z');

const isFirstLower = (s) => !!s && inRange(s[0], 'a', 'z');

const isFirstLetter = (s) => isFirstUpper(s) || isFirstLower(s);

const toLowerCamel = (s) => s.charAt(0).toLowerCase() + s.slice(1);

const firstKey = (obj) => Object.keys(obj).find(isFirstLetter);

module.exports = {
  inRange,
  isFirstUpper,
  isFirstLower,
  isFirstLetter,
  toLowerCamel,
  firstKey,
};
