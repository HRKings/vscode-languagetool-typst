import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { IAnnotatedtext } from "annotatedtext";
import * as vscode from "vscode";
import { Diagnostic, DiagnosticSeverity, Position, Range, Uri } from "vscode";
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

  test("Linter should exclude Typst list markers from checked prose", async () => {
    const text: string = fs.readFileSync(
      path.resolve(__dirname, testWorkspace + "/typst/advanced.typ"),
      "utf8",
    );
    const actual: IAnnotatedtext = await linter.buildAnnotatedTypst(text);
    const checkedText = getCheckedText(actual);

    assert.ok(
      checkedText.includes("And list right after"),
      "Expected Typst list item content to remain checkable.",
    );
    assert.ok(
      !checkedText.includes("- And list right after"),
      "Expected Typst list marker to stay out of checked prose.",
    );
  });

  test("Linter should offer a line ignore quick fix for Typst rules", async () => {
    const uri = Uri.file(
      path.resolve(__dirname, testWorkspace + "/typst/advanced.typ"),
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const diagnostic = new Diagnostic(
      new Range(new Position(36, 0), new Position(36, 1)),
      "dash rule",
      DiagnosticSeverity.Warning,
    ) as Diagnostic & { match: ILanguageToolMatch };
    diagnostic.source = "LanguageTool Typst";
    diagnostic.match = buildLanguageToolMatch("DASH_RULE", "PUNCTUATION");
    diagnostic.match.rule.description = "Dash rule";

    const actions = linter.provideCodeActions(
      document,
      diagnostic.range,
      { diagnostics: [diagnostic] } as never,
      {} as never,
    );
    const lineIgnoreAction = actions.find(
      (action) =>
        action.title === "Ignore 'Dash rule' (DASH_RULE) on this line",
    );

    assert.ok(lineIgnoreAction, "Expected a line ignore quick fix.");
    assert.deepEqual(
      lineIgnoreAction?.edit?.get(document.uri)?.map((edit) => edit.newText),
      [" // @LT-IGNORE:DASH_RULE@"],
      "Expected the quick fix to insert a Typst inline ignore comment.",
    );
  });

  test("Linter should offer a file ignore quick fix for Typst rules", async () => {
    const uri = Uri.file(
      path.resolve(__dirname, testWorkspace + "/typst/advanced.typ"),
    );
    const document = await vscode.workspace.openTextDocument(uri);
    const diagnostic = new Diagnostic(
      new Range(new Position(36, 0), new Position(36, 1)),
      "dash rule",
      DiagnosticSeverity.Warning,
    ) as Diagnostic & { match: ILanguageToolMatch };
    diagnostic.source = "LanguageTool Typst";
    diagnostic.match = buildLanguageToolMatch("DASH_RULE", "PUNCTUATION");
    diagnostic.match.rule.description = "Dash rule";

    const actions = linter.provideCodeActions(
      document,
      diagnostic.range,
      { diagnostics: [diagnostic] } as never,
      {} as never,
    );
    const fileIgnoreAction = actions.find(
      (action) =>
        action.title === "Ignore 'Dash rule' (DASH_RULE) in this file",
    );

    assert.ok(fileIgnoreAction, "Expected a file ignore quick fix.");
    assert.deepEqual(
      fileIgnoreAction?.edit?.get(document.uri)?.map((edit) => edit.newText),
      ["// @LT-IGNORE-FILE:DASH_RULE@\n"],
      "Expected the quick fix to insert a Typst file ignore comment.",
    );
  });

  test("Linter should offer line and file ignores for Typst spelling rules", async () => {
    const document = await vscode.workspace.openTextDocument({
      content: "wordthatdoesntexit\n",
      language: "typst",
    });
    const diagnostic = new Diagnostic(
      new Range(new Position(0, 0), new Position(0, "wordthatdoesntexit".length)),
      "Possible spelling mistake found.",
      DiagnosticSeverity.Warning,
    ) as Diagnostic & { match: ILanguageToolMatch };
    diagnostic.source = "LanguageTool Typst";
    diagnostic.match = buildLanguageToolMatch(
      "MORFOLOGIK_RULE_EN_US",
      "TYPOS",
    );
    diagnostic.match.rule.description = "Possible spelling mistake found.";

    const actions = linter.provideCodeActions(
      document,
      diagnostic.range,
      { diagnostics: [diagnostic] } as never,
      {} as never,
    );
    const lineIgnoreAction = actions.find(
      (action) =>
        action.title === "Ignore this spelling rule on this line",
    );
    const fileIgnoreAction = actions.find(
      (action) =>
        action.title === "Ignore this spelling rule in this file",
    );

    assert.ok(lineIgnoreAction, "Expected a line ignore quick fix.");
    assert.deepEqual(
      lineIgnoreAction?.edit?.get(document.uri)?.map((edit) => edit.newText),
      [" // @LT-IGNORE:MORFOLOGIK_RULE_EN_US(wordthatdoesntexit)@"],
      "Expected the spelling line quick fix to insert a Typst inline ignore comment.",
    );

    assert.ok(fileIgnoreAction, "Expected a file ignore quick fix.");
    assert.deepEqual(
      fileIgnoreAction?.edit?.get(document.uri)?.map((edit) => edit.newText),
      ["// @LT-IGNORE-FILE:MORFOLOGIK_RULE_EN_US(wordthatdoesntexit)@\n"],
      "Expected the spelling file quick fix to insert a Typst file ignore comment.",
    );
  });

  test("Linter should match Typst spelling ignore directives case-insensitively", () => {
    const helper = linter as any;
    const ignored = [
      {
        line: 0,
        ruleId: "MORFOLOGIK_RULE_EN_US",
        scope: "file" as const,
        text: "WordThatDoesntexit",
      },
    ];

    assert.equal(
      helper.checkIfIgnored(
        ignored,
        "MORFOLOGIK_RULE_EN_US",
        "wordthatdoesntexit",
      ),
      true,
      "Expected spelling ignores to match regardless of case.",
    );
  });

  test("Linter should recognize file-wide Typst ignore directives", async () => {
    const document = await vscode.workspace.openTextDocument({
      content:
        "// @LT-IGNORE-FILE:DASH_RULE@\n== Subtitle\n- And list right after\n",
      language: "typst",
    });
    const helper = linter as any;
    const ignoreList = helper.buildIgnoreList(document) as Array<{
      line: number;
      ruleId: string;
      scope: "line" | "file";
    }>;
    helper.ignoreList = ignoreList;
    const fileIgnore = ignoreList.find(
      (item) => item.ruleId === "DASH_RULE" && item.scope === "file",
    );
    const ignoredOnLaterLine = helper.getIgnoreList(
      document,
      new vscode.Position(2, 0),
    ) as Array<{ ruleId: string; scope: "line" | "file" }>;

    assert.ok(fileIgnore, "Expected a file-wide ignore directive to be parsed.");
    assert.ok(
      ignoredOnLaterLine.some(
        (item) => item.ruleId === "DASH_RULE" && item.scope === "file",
      ),
      "Expected a file-wide ignore directive to apply to later lines.",
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
