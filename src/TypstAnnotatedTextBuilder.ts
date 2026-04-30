/****
 *    Copyright 2019 David L. Day
 *
 *   Licensed under the Apache License, Version 2.0 (the "License");
 *   you may not use this file except in compliance with the License.
 *   You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 *   Unless required by applicable law or agreed to in writing, software
 *   distributed under the License is distributed on an "AS IS" BASIS,
 *   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *   See the License for the specific language governing permissions and
 *   limitations under the License.
 */

import { IAnnotatedtext, IAnnotation } from "annotatedtext";
import * as fs from "fs";
import * as path from "path";
import initTypstParser, {
  TypstParser,
  TypstParserBuilder,
} from "@myriaddreamin/typst-ts-parser";
import * as typstParserModule from "@myriaddreamin/typst-ts-parser";

interface ITypstSemanticToken {
  offset: number;
  length: number;
  type: string;
  modifiers: number;
}

interface ITypstSemanticTokenLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}

interface ITypstParserModule {
  setImportWasmModule?: (
    importer: (wasmName: string, url: string) => Promise<ArrayBuffer>,
  ) => void;
}

const TOKEN_FIELD_COUNT = 5;
const TOKEN_TYPE_INDEX = 3;
const TOKEN_MODIFIERS_INDEX = 4;

const EXCLUDED_TOKEN_TYPES = new Set<string>([
  "bool",
  "comment",
  "decorator",
  "delim",
  "error",
  "function",
  "keyword",
  "label",
  "link",
  "number",
  "operator",
  "pol",
  "raw",
  "ref",
  "string",
]);

export class TypstAnnotatedTextBuilder {
  private parserPromise: Promise<TypstParser> | undefined;

  public async build(text: string): Promise<IAnnotatedtext> {
    const parser = await this.getParser();
    const legend =
      parser.get_semantic_token_legend() as ITypstSemanticTokenLegend;
    const mathModifier = legend.tokenModifiers.indexOf("math");
    const mathModifierMask = mathModifier === -1 ? 0 : 1 << mathModifier;
    const tokens = this.decodeSemanticTokens(
      text,
      parser.get_semantic_tokens_by_string(text, "utf-16"),
      legend,
    );
    const included = this.getIncludedOffsets(text, tokens, mathModifierMask);
    this.cleanTypstLinks(text, included);
    return this.buildAnnotatedText(text, included);
  }

  private getParser(): Promise<TypstParser> {
    if (!this.parserPromise) {
      this.parserPromise = this.buildParser();
    }
    return this.parserPromise;
  }

  private async buildParser(): Promise<TypstParser> {
    const parserModule = typstParserModule as unknown as ITypstParserModule;
    parserModule.setImportWasmModule?.(async (wasmName: string) => {
      const buffer = fs.readFileSync(this.resolveWasmPath(wasmName));
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    });
    await initTypstParser();
    return new TypstParserBuilder().build();
  }

  private resolveWasmPath(wasmName: string): string {
    const bundledPath = path.resolve(__dirname, wasmName);
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }

    const nodeRequire = eval("require") as NodeRequire;
    return nodeRequire.resolve("@myriaddreamin/typst-ts-parser/wasm");
  }

  private decodeSemanticTokens(
    text: string,
    semanticTokens: Uint32Array,
    legend: ITypstSemanticTokenLegend,
  ): ITypstSemanticToken[] {
    const tokens: ITypstSemanticToken[] = [];
    const lineOffsets = this.getLineOffsets(text);
    let line = 0;
    let character = 0;

    for (let i = 0; i < semanticTokens.length; i += TOKEN_FIELD_COUNT) {
      const deltaLine = semanticTokens[i];
      const deltaStart = semanticTokens[i + 1];
      const length = semanticTokens[i + 2];
      const tokenType = legend.tokenTypes[semanticTokens[i + TOKEN_TYPE_INDEX]];
      const modifiers = semanticTokens[i + TOKEN_MODIFIERS_INDEX];

      line += deltaLine;
      character = deltaLine === 0 ? character + deltaStart : deltaStart;

      const lineOffset = lineOffsets[line];
      if (lineOffset === undefined) {
        continue;
      }

      tokens.push({
        length,
        modifiers,
        offset: lineOffset + character,
        type: tokenType,
      });
    }

    return tokens;
  }

  private getLineOffsets(text: string): number[] {
    const offsets = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        offsets.push(i + 1);
      }
    }
    return offsets;
  }

  private getIncludedOffsets(
    text: string,
    tokens: ITypstSemanticToken[],
    mathModifierMask: number,
  ): boolean[] {
    const excluded = Array<boolean>(text.length).fill(false);
    const included = Array<boolean>(text.length).fill(false);

    tokens.forEach((token) => {
      if (
        EXCLUDED_TOKEN_TYPES.has(token.type) ||
        (mathModifierMask !== 0 && (token.modifiers & mathModifierMask) !== 0)
      ) {
        this.fillRange(excluded, token.offset, token.length, true);
      }
    });

    tokens.forEach((token, index) => {
      if (
        token.type === "text" &&
        (mathModifierMask === 0 || (token.modifiers & mathModifierMask) === 0)
      ) {
        const tokenText = text.slice(token.offset, token.offset + token.length);
        const includeWhitespace =
          tokenText.trim().length !== 0 ||
          this.isProseWhitespace(text, tokens, index, mathModifierMask);
        for (
          let offset = token.offset;
          offset < token.offset + token.length && offset < included.length;
          offset++
        ) {
          included[offset] =
            !excluded[offset] && (includeWhitespace || text[offset] === "\n");
        }
      }
    });

    return included;
  }

  private cleanTypstLinks(text: string, included: boolean[]): void {
    const linkPattern = /\[([^\]\n]+)\]\([^)]+\)/g;
    for (const match of text.matchAll(linkPattern)) {
      if (match.index === undefined) {
        continue;
      }

      const linkStart = match.index;
      const labelStart = linkStart + 1;
      const labelEnd = labelStart + match[1].length;
      const linkEnd = linkStart + match[0].length;

      this.fillRange(included, linkStart, 1, false);
      this.fillRange(included, labelEnd, linkEnd - labelEnd, false);
      this.fillRange(included, labelStart, labelEnd - labelStart, true);
    }
  }

  private isProseWhitespace(
    text: string,
    tokens: ITypstSemanticToken[],
    index: number,
    mathModifierMask: number,
  ): boolean {
    const token = tokens[index];
    const tokenText = text.slice(token.offset, token.offset + token.length);
    if (tokenText.includes("\n")) {
      return false;
    }

    const previous = tokens[index - 1];
    const next = this.findNextPlainTextToken(tokens, index, mathModifierMask);
    if (
      !previous ||
      !next ||
      !this.isPlainTextToken(previous, mathModifierMask) ||
      !this.isPlainTextToken(next, mathModifierMask)
    ) {
      return false;
    }

    const previousText = text.slice(
      previous.offset,
      previous.offset + previous.length,
    );
    const nextText = text.slice(next.offset, next.offset + next.length);
    const previousCharacter = previousText[previousText.length - 1];
    const nextCharacter = nextText[0];
    return (
      (this.isWordCharacter(previousCharacter) ||
        /[,;:]/.test(previousCharacter)) &&
      this.isWordCharacter(nextCharacter)
    );
  }

  private findNextPlainTextToken(
    tokens: ITypstSemanticToken[],
    index: number,
    mathModifierMask: number,
  ): ITypstSemanticToken | undefined {
    for (let i = index + 1; i < tokens.length; i++) {
      if (this.isPlainTextToken(tokens[i], mathModifierMask)) {
        return tokens[i];
      }
    }
    return undefined;
  }

  private isPlainTextToken(
    token: ITypstSemanticToken,
    mathModifierMask: number,
  ): boolean {
    return (
      token.type === "text" &&
      (mathModifierMask === 0 || (token.modifiers & mathModifierMask) === 0)
    );
  }

  private isWordCharacter(character: string | undefined): boolean {
    return character !== undefined && /[\p{L}\p{N}]/u.test(character);
  }

  private fillRange(
    values: boolean[],
    start: number,
    length: number,
    value: boolean,
  ): void {
    for (
      let offset = start;
      offset < start + length && offset < values.length;
      offset++
    ) {
      values[offset] = value;
    }
  }

  private buildAnnotatedText(
    text: string,
    included: boolean[],
  ): IAnnotatedtext {
    const annotation: IAnnotation[] = [];
    if (text.length === 0) {
      return { annotation };
    }

    let start = 0;
    let currentValue = included[0];
    for (let offset = 1; offset < text.length; offset++) {
      if (included[offset] !== currentValue) {
        annotation.push(this.buildAnnotation(text, start, offset, currentValue));
        start = offset;
        currentValue = included[offset];
      }
    }
    annotation.push(this.buildAnnotation(text, start, text.length, currentValue));

    return { annotation };
  }

  private buildAnnotation(
    text: string,
    start: number,
    end: number,
    includeAsText: boolean,
  ): IAnnotation {
    if (includeAsText) {
      return {
        offset: { end, start },
        text: text.slice(start, end),
      };
    }

    return {
      interpretAs: this.interpretMarkup(text, start, end),
      markup: text.slice(start, end),
      offset: { end, start },
    };
  }

  private interpretMarkup(text: string, start: number, end: number): string {
    const markup = text.slice(start, end);
    if (markup === "-" || markup === "+") {
      return "* ";
    }

    const lineBreaks = markup.replace(/[^\n]/g, "");
    if (markup.replace(/\n/g, "").length === 0) {
      return lineBreaks;
    }

    const previous = text[start - 1];
    const next = text[end];
    if (
      this.isWordCharacter(previous) &&
      this.isWordCharacter(next) &&
      !/\s/.test(previous) &&
      !/\s/.test(next)
    ) {
      return lineBreaks + " ";
    }

    return lineBreaks;
  }
}
