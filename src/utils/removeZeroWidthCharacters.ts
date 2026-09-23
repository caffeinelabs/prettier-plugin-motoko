// Derived from https://github.com/spencermountain/out-of-character

// MIT License

// Copyright (c) 2021 spencer kelly

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import charConfigs from './removeZeroWidthCharacters.json';

interface CharConfig {
    actualUnicodeChar: string;
    aka: string;
    code: string;
    htmlcode?: string;
    htmlentity?: string;
    csscode?: string;
    unicode?: string;
    codeEscaped: string;
    escapeChar: string;
    name: string;
    type: string;
    url: string;
    replaceWith?: string;
}

// A static import (not `require`) so ESM bundlers consuming `src/` can resolve it
const data = charConfigs as CharConfig[];

const byCode = data.reduce(
    (h, obj) => {
        h[obj.code] = obj;
        return h;
    },
    {} as Record<string, CharConfig>,
);

const codes = data
    .filter((obj) => obj.replaceWith !== undefined)
    .map((obj) => obj.actualUnicodeChar);
const codeRegex = new RegExp(`(${codes.join('|')})`, 'gu');

const findAll = function (text: string) {
    const matches = [];

    for (const match of text.matchAll(codeRegex)) {
        const char = match[0];
        const offset = match.index!;

        // Find the code details of the matched character
        const codePoint = char.codePointAt(0)!; // Use codePointAt for full Unicode support
        const hex =
            'U+' + codePoint.toString(16).toUpperCase().padStart(4, '0');

        const found = byCode[hex]; // Lookup using the canonical 'U+XXXX' format
        if (found) {
            // Don't report U+200D (Zero Width Joiner) if it's part of an emoji sequence
            if (found.code === 'U+200D' && isEmoji(text, offset)) {
                continue;
            }

            matches.push({
                code: found.code,
                name: found.name,
                offset: offset,
                replacement: found.replaceWith || '',
            });
        }
    }
    return matches;
};

const isVariationSelector = (num: number) => num >= 65024 && num <= 65039;
const isHighSurrogate = (num: number) => num >= 55296 && num <= 56319;
const isLowSurrogate = (num: number) => num >= 56320 && num <= 57343;

const isEmoji = function (text: string, i: number): boolean {
    // Look at code before
    if (text[i - 1]) {
        const code = text.charCodeAt(i - 1);
        if (
            isHighSurrogate(code) ||
            isLowSurrogate(code) ||
            isVariationSelector(code)
        ) {
            return true;
        }
    }
    // Look at code after
    if (text[i + 1]) {
        const code = text.charCodeAt(i + 1);
        if (
            isHighSurrogate(code) ||
            isLowSurrogate(code) ||
            isVariationSelector(code)
        ) {
            return true;
        }
    }
    return false;
};

export default function removeZeroWidthCharacters(text: string): string {
    const matches = findAll(text);
    if (matches.length === 0) {
        return text;
    }
    let result = '';
    let lastIndex = 0;
    const matchesLength = matches.length;
    for (let i = 0; i < matchesLength; i += 1) {
        const match = matches[i];
        result += text.slice(lastIndex, match.offset);
        result += match.replacement;
        lastIndex = match.offset + 1;
    }
    result += text.slice(lastIndex);
    return result;
}
