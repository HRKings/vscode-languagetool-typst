import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { IAnnotatedtext } from "annotatedtext";
import { ConfigurationManager } from "../../src/ConfigurationManager";
import { Linter } from "../../src/Linter";

suite("Linter Typst Test Suite", () => {
  const configManager: ConfigurationManager = new ConfigurationManager();
  const linter: Linter = new Linter(configManager);
  const testWorkspace: string = path.resolve(
    __dirname,
    "../../../test-fixtures/workspace",
  );

  test("Linter should return annotated text for Typst", async () => {
    const text: string = fs.readFileSync(
      path.resolve(__dirname, testWorkspace + "/typst/basic.typ"),
      "utf8",
    );
    const actual: IAnnotatedtext = await linter.buildAnnotatedTypst(text);
    const checkedText = actual.annotation
      .map((annotation) => annotation.text || "")
      .join("");
    const uncheckedText = actual.annotation
      .map((annotation) => annotation.markup || "")
      .join("");

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
});
