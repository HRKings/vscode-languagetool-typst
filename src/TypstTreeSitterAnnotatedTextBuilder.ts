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
import { Language, Node, Parser } from "web-tree-sitter";

const PROSE_LEAF_TYPES = new Set(["text"]);
const PARBREAK_TYPES = new Set(["parbreak"]);
// Structural marker nodes emitted by the prose-focus grammar fork. These
// represent list/bullet markers (`-`, `+`, `1.`, `•`, `—`, …) and are
// excluded from prose so LanguageTool doesn't flag them.
const MARKER_TYPES = new Set(["item_marker", "prose_marker"]);
const RECURSE_TYPES = new Set([
  "source_file",
  "section",
  "content",
  "heading",
  "code",
  "call",
  "item",
]);

export class TypstTreeSitterAnnotatedTextBuilder {
  private static initPromise: Promise<void> | undefined;
  private static parser: Parser | undefined;

  public static async init(wasmPath: string): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = (async () => {
      await Parser.init();
      const wasm = fs.readFileSync(wasmPath);
      const language = await Language.load(wasm);
      const parser = new Parser();
      parser.setLanguage(language);
      this.parser = parser;
    })();
    return this.initPromise;
  }

  public static isReady(): boolean {
    return this.parser !== undefined;
  }

  public async build(text: string): Promise<IAnnotatedtext> {
    const parser = TypstTreeSitterAnnotatedTextBuilder.parser;
    if (!parser) {
      throw new Error("TypstTreeSitterAnnotatedTextBuilder not initialized");
    }

    const included: boolean[] = new Array(text.length).fill(false);
    const tree = parser.parse(text);
    if (tree && tree.rootNode) {
      this.classify(tree.rootNode, included, text);
    }
    return this.buildAnnotatedText(text, included);
  }

  private classify(node: Node, included: boolean[], text: string): void {
    const type = node.type;

    if (PROSE_LEAF_TYPES.has(type)) {
      this.fillRange(included, node.startIndex, node.endIndex, true);
      return;
    }

    if (MARKER_TYPES.has(type) || PARBREAK_TYPES.has(type)) {
      return;
    }

    if (RECURSE_TYPES.has(type) || node.namedChildCount > 0) {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child) {
          this.classify(child, included, text);
        }
      }
    }
  }

  private fillRange(
    values: boolean[],
    start: number,
    end: number,
    value: boolean,
  ): void {
    for (let offset = start; offset < end && offset < values.length; offset++) {
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
    annotation.push(
      this.buildAnnotation(text, start, text.length, currentValue),
    );

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
    const slice = text.slice(start, end);
    if (!/\S/.test(slice)) {
      return slice.replace(/[^\S\n]+/g, " ");
    }
    const newlines = slice.match(/\n/g)?.join("") ?? "";
    if (newlines.length > 0) {
      return newlines;
    }
    return this.isWordCharacter(text[end]) ? " " : "";
  }

  private isWordCharacter(character: string | undefined): boolean {
    return character !== undefined && /[\p{L}\p{N}]/u.test(character);
  }
}
