import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { IAnnotatedtext } from "annotatedtext";
import { DiagnosticSeverity } from "vscode";
import { ConfigurationManager } from "../../src/ConfigurationManager";
import { ILanguageToolMatch } from "../../src/Interfaces";
import { Linter } from "../../src/Linter";
import { TypstTreeSitterAnnotatedTextBuilder } from "../../src/TypstTreeSitterAnnotatedTextBuilder";

suite("Linter Typst Test Suite", () => {
  const testWorkspace: string = path.resolve(
    __dirname,
    "../../../test-fixtures/workspace",
  );

  suiteSetup(async () => {
    if (process.env.LTL_TREE_SITTER !== "0") {
      const wasmPath = path.resolve(
        __dirname,
        "../../../resources/tree-sitter-typst.wasm",
      );
      await TypstTreeSitterAnnotatedTextBuilder.init(wasmPath);
    }
  });

  const configManager: ConfigurationManager = new ConfigurationManager();
  const linter: Linter = new Linter(configManager);

  function getCheckedText(annotatedText: IAnnotatedtext): string {
    return annotatedText.annotation
      .map((annotation) => annotation.text || "")
      .join("");
  }

  function getUncheckedText(annotatedText: IAnnotatedtext): string {
    return annotatedText.annotation
      .map((annotation) => annotation.markup || "")
      .join("");
  }

  function getInterpretedText(annotatedText: IAnnotatedtext): string {
    return annotatedText.annotation
      .map((annotation) => annotation.text || annotation.interpretAs || "")
      .join("");
  }

  test("Linter should return annotated text for Typst", async () => {
    const text: string = fs.readFileSync(
      path.resolve(__dirname, testWorkspace + "/typst/basic.typ"),
      "utf8",
    );
    const actual: IAnnotatedtext = await linter.buildAnnotatedTypst(text);
    const checkedText = getCheckedText(actual);
    const uncheckedText = getUncheckedText(actual);

    assert.ok(checkedText.includes("A Typst Heading"));
    assert.ok(
      checkedText.includes(
        "This paragraph should be checked by LanguageTool.",
      ),
    );
    assert.ok(checkedText.includes("Nested title should be checked."));
    assert.ok(checkedText.includes("A list item should be checked."));
    assert.ok(checkedText.includes("A numbered item should be checked."));
    assert.ok(checkedText.includes("content should be checked"));

    assert.ok(uncheckedText.includes("This string should not be checked."));
    assert.ok(uncheckedText.includes("raw text should not be checked"));
    assert.ok(uncheckedText.includes("raw block should not be checked"));
    assert.ok(uncheckedText.includes("x + y should not be checked"));
    assert.ok(uncheckedText.includes("This comment should not be checked."));
  });

  test("Linter should keep advanced Typst prose checkable", async () => {
    const text: string = fs.readFileSync(
      path.resolve(__dirname, testWorkspace + "/typst/advanced.typ"),
      "utf8",
    );
    const actual: IAnnotatedtext = await linter.buildAnnotatedTypst(text);
    const checkedText = getCheckedText(actual);
    const uncheckedText = getUncheckedText(actual);
    const interpretedText = getInterpretedText(actual);

    [
      "typesetting system tyypo",
      "moore intuitive",
      "Bulet points",
      "tehe plus",
      "citizesns",
      "equattions",
      "encslosed",
      "Fast Preview with typoo",
      "Advanceed",
      "tablee example",
      "custdom function",
    ].forEach((expectedText) => {
      assert.ok(
        checkedText.includes(expectedText),
        `Expected checked Typst text to include "${expectedText}".`,
      );
    });

    [
      "Typst Feature Showcase",
      "Expert User",
      "Powerful scripting built-in",
      "1. Document Metadata",
    ].forEach((expectedMarkup) => {
      assert.ok(
        uncheckedText.includes(expectedMarkup),
        `Expected Typst markup to include "${expectedMarkup}".`,
      );
    });

    assert.ok(
      /1\. \S+ with number/.test(interpretedText),
      "Expected interpreted Typst heading text to preserve spacing after numbered prefixes.",
    );
  });

  test("Linter should preserve Typst apostrophes inside words", async () => {
    const text: string = fs.readFileSync(
      path.resolve(__dirname, testWorkspace + "/typst/medium.typ"),
      "utf8",
    );
    const actual: IAnnotatedtext = await linter.buildAnnotatedTypst(text);
    const checkedText = getCheckedText(actual);
    const interpretedText = getInterpretedText(actual);

    assert.ok(
      checkedText.includes("B-but I'm "),
      "Expected in-word apostrophe to remain checkable prose.",
    );
    assert.ok(
      interpretedText.includes("B-but I'm "),
      "Expected interpreted Typst text to preserve in-word apostrophe.",
    );
    assert.ok(
      interpretedText.includes('"B-but I\'m the mage!". He replied.'),
      "Expected interpreted Typst text to preserve quote punctuation.",
    );
    assert.ok(
      !interpretedText.includes("B-but I m "),
      "Expected interpreted Typst text not to replace in-word apostrophe with a space.",
    );
  });

  test("Linter should default false friends to hints", () => {
    assert.equal(
      configManager
        .getCategorySeverityOverrides()
        .get("FALSE_FRIENDS"),
      DiagnosticSeverity.Hint,
    );
  });

  test("Linter should apply rule severity overrides before category overrides", () => {
    const config = new ConfigurationManager();
    config.getRuleSeverityOverrides = () =>
      new Map([["FABRIC", DiagnosticSeverity.Error]]);
    config.getCategorySeverityOverrides = () =>
      new Map([["FALSE_FRIENDS", DiagnosticSeverity.Hint]]);
    const overrideLinter = new Linter(config);

    assert.equal(
      overrideLinter.resolveDiagnosticSeverity(
        buildLanguageToolMatch("FABRIC", "FALSE_FRIENDS"),
      ),
      DiagnosticSeverity.Error,
    );
  });

  test("Linter should apply category severity overrides before auto severity", () => {
    const config = new ConfigurationManager();
    config.getDiagnosticSeverityAuto = () => true;
    config.getRuleSeverityOverrides = () => new Map();
    config.getCategorySeverityOverrides = () =>
      new Map([["TYPOGRAPHY", DiagnosticSeverity.Information]]);
    const overrideLinter = new Linter(config);

    assert.equal(
      overrideLinter.resolveDiagnosticSeverity(
        buildLanguageToolMatch("EN_QUOTES", "TYPOGRAPHY"),
      ),
      DiagnosticSeverity.Information,
    );
  });
});

function buildLanguageToolMatch(
  ruleId: string,
  categoryId: string,
): ILanguageToolMatch {
  return {
    context: { length: 0, offset: 0, text: "" },
    contextForSureMatch: 0,
    ignoreForIncompleteSentence: false,
    length: 0,
    message: "",
    offset: 0,
    replacements: [],
    rule: {
      category: { id: categoryId, name: categoryId },
      description: "",
      id: ruleId,
      issueType: "",
    },
    sentence: "",
    shortMessage: "",
    type: { typeName: "" },
  };
}
