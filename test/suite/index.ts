import * as fs from "node:fs";
import * as path from "node:path";
import { glob } from "glob";
import Mocha from "mocha";

export function run(): Promise<void> {
  // Create the mocha test
  const mocha = new Mocha({
    color: true,
    ui: "tdd",
  });

  const testsRoot = path.resolve(__dirname, "..");

  return new Promise((c, e) => {
    const sourceTestsRoot = path.resolve(__dirname, "../../../test");
    const files = glob
      .sync("**/**.test.js", { cwd: testsRoot })
      .filter((file) => {
        const sourceFile = path.resolve(
          sourceTestsRoot,
          file.replace(/\.js$/, ".ts"),
        );
        return fs.existsSync(sourceFile);
      });

    // Add files to the test suite
    for (const f of files) {
      mocha.addFile(path.resolve(testsRoot, f));
    }

    try {
      // Run the mocha test
      mocha.run((failures) => {
        if (failures > 0) {
          e(new Error(`${failures} tests failed.`));
        } else {
          c();
        }
      });
    } catch (err) {
      e(err);
    }
  });
}
