// @ts-check
/// <reference types="node" />

"use strict";

import * as path from "path";
import * as fs from "fs";
import LicensePlugin from "webpack-license-plugin";

class CopyTypstParserWasmPlugin {
  apply(compiler: import("webpack").Compiler) {
    compiler.hooks.afterEmit.tap("CopyTypstParserWasmPlugin", () => {
      fs.copyFileSync(
        require.resolve("@myriaddreamin/typst-ts-parser/wasm"),
        path.resolve(__dirname, "dist", "typst_ts_parser_bg.wasm"),
      );
    });
  }
}

// tslint:disable-next-line: jsdoc-format
/**@type {import("webpack").Configuration}*/
const config = {
  devtool: "source-map",
  entry: "./src/extension.ts",
  externals: {
    vscode: "commonjs vscode",
  },
  module: {
    rules: [
      {
        exclude: /node_modules/,
        test: /\.ts$/,
        use: [
          {
            loader: "ts-loader",
            options: {
              compilerOptions: {
                module: "es6",
              },
            },
          },
        ],
      },
    ],
  },
  output: {
    devtoolModuleFilenameTemplate: "../[resource-path]",
    filename: "extension.js",
    libraryTarget: "commonjs2",
    path: path.resolve(__dirname, "dist"),
  },
  plugins: [
    new LicensePlugin({ outputFilename: "meta/licenses.json" }),
    new CopyTypstParserWasmPlugin(),
  ],
  resolve: {
    extensions: [".ts", ".js"],
  },
  target: "node",
};

module.exports = config;
