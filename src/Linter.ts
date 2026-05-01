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

import { IAnnotatedtext } from "annotatedtext";
import * as Fetch from "node-fetch";
import {
  CancellationToken,
  CodeAction,
  CodeActionContext,
  CodeActionKind,
  CodeActionProvider,
  ConfigurationTarget,
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  languages,
  Position,
  Range,
  TextDocument,
  TextEditor,
  Uri,
  workspace,
  WorkspaceEdit,
} from "vscode";
import { ConfigurationManager } from "./ConfigurationManager";
import * as Constants from "./Constants";
import {
  IIgnoreItem,
  ILanguageToolMatch,
  ILanguageToolReplacement,
  ILanguageToolResponse,
} from "./Interfaces";
import { StatusBarManager } from "./StatusBarManager";
import { TypstAnnotatedTextBuilder } from "./TypstAnnotatedTextBuilder";
import { TypstTreeSitterAnnotatedTextBuilder } from "./TypstTreeSitterAnnotatedTextBuilder";

interface ITypstBuilder {
  build(text: string): Promise<IAnnotatedtext>;
}

const TREE_SITTER_FLAG = process.env.LTL_TREE_SITTER !== "0";

class LTDiagnostic extends Diagnostic {
  match?: ILanguageToolMatch;
}

export class Linter implements CodeActionProvider {
  // Is the rule a Spelling rule?
  // See: https://forum.languagetool.org/t/identify-spelling-rules/4775/3
  public static isSpellingRule(ruleId: string): boolean {
    return (
      ruleId.indexOf("MORFOLOGIK_RULE") !== -1 ||
      ruleId.indexOf("SPELLER_RULE") !== -1 ||
      ruleId.indexOf("HUNSPELL_NO_SUGGEST_RULE") !== -1 ||
      ruleId.indexOf("HUNSPELL_RULE") !== -1 ||
      ruleId.indexOf("FR_SPELLING_RULE") !== -1
    );
  }

  public static isWarningCategory(categoryId: string): boolean {
    return (
      categoryId.indexOf("GRAMMAR") !== -1 ||
      categoryId.indexOf("PUNCTUATION") !== -1 ||
      categoryId.indexOf("TYPOGRAPHY") !== -1
    );
  }

  public diagnosticCollection: DiagnosticCollection;

  private readonly configManager: ConfigurationManager;
  private readonly statusBarManager: StatusBarManager;
  private readonly typstBuilder: ITypstBuilder;
  private timeoutMap: Map<string, NodeJS.Timeout>;
  private ignoreList: IIgnoreItem[] = [];
  private warnedVariantMismatchUris: Set<string> = new Set<string>();

  constructor(configManager: ConfigurationManager) {
    this.configManager = configManager;
    this.timeoutMap = new Map<string, NodeJS.Timeout>();
    this.diagnosticCollection = languages.createDiagnosticCollection(
      Constants.EXTENSION_DISPLAY_NAME,
    );
    this.statusBarManager = new StatusBarManager(configManager);
    this.typstBuilder = TREE_SITTER_FLAG
      ? new TypstTreeSitterAnnotatedTextBuilder()
      : new TypstAnnotatedTextBuilder();
    if (TREE_SITTER_FLAG) {
      Constants.EXTENSION_OUTPUT_CHANNEL.appendLine(
        "TypstTreeSitterAnnotatedTextBuilder selected (LTL_TREE_SITTER=1)",
      );
    }
  }

  // Provide CodeActions for the given Document and Range
  public provideCodeActions(
    document: TextDocument,
    _range: Range,
    context: CodeActionContext,
    _token: CancellationToken,
  ): CodeAction[] {
    const diagnostics = context.diagnostics || [];
    const actions: CodeAction[] = [];
    diagnostics
      .filter(
        (diagnostic) =>
          diagnostic.source === Constants.EXTENSION_DIAGNOSTIC_SOURCE,
      )
      .forEach((diagnostic) => {
        const match: ILanguageToolMatch | undefined = (
          diagnostic as LTDiagnostic
        ).match;
        if (match && Linter.isSpellingRule(match.rule.id)) {
          const spellingActions: CodeAction[] = this.getSpellingRuleActions(
            document,
            diagnostic,
          );
          if (spellingActions.length > 0) {
            spellingActions.forEach((action) => {
              actions.push(action);
            });
          }
        } else {
          this.getRuleActions(document, diagnostic).forEach((action) => {
            actions.push(action);
          });
        }
      });
    return actions;
  }

  // Remove diagnostics for a Document URI
  public clearDiagnostics(uri: Uri): void {
    this.diagnosticCollection.delete(uri);
  }

  // Editor Changed
  public editorChanged(editor: TextEditor | undefined, lint: boolean): void {
    if (!editor) {
      this.statusBarManager.hide();
      return;
    } else {
      this.documentChanged(editor.document, lint);
    }
  }

  // Document Changed
  public documentChanged(
    document: TextDocument | undefined,
    lint: boolean,
  ): void {
    if (!document) {
      this.statusBarManager.hide();
      return;
    } else {
      if (this.configManager.isLanguageSupportedAndEnabled(document)) {
        this.statusBarManager.show();
        if (lint) {
          if (this.configManager.isHideDiagnosticsOnChange()) {
            this.clearDiagnostics(document.uri);
          }
          this.requestLint(document);
        }
      }
    }
  }

  // Suspend Linting
  public toggleSuspendLinting(): boolean {
    const suspended: boolean = this.configManager.toggleSuspendLinting();
    this.statusBarManager.refreshToolTip();
    return suspended;
  }

  // Request a lint for a document
  public requestLint(
    document: TextDocument,
    timeoutDuration: number = Constants.EXTENSION_TIMEOUT_MS,
  ): void {
    if (this.configManager.isLanguageSupportedAndEnabled(document)) {
      this.cancelLint(document);
      const uriString = document.uri.toString();
      const timeout = setTimeout(() => {
        this.lintDocument(document);
      }, timeoutDuration);
      this.timeoutMap.set(uriString, timeout);
    }
  }
  // Cancel lint
  public cancelLint(document: TextDocument): void {
    const uriString: string = document.uri.toString();
    if (this.timeoutMap.has(uriString)) {
      if (this.timeoutMap.has(uriString)) {
        const timeout: NodeJS.Timeout = this.timeoutMap.get(
          uriString,
        ) as NodeJS.Timeout;
        clearTimeout(timeout);
        this.timeoutMap.delete(uriString);
        this.statusBarManager.setIdle();
      }
    }
  }

  // Build annotatedtext from Typst
  public buildAnnotatedTypst(text: string): Promise<IAnnotatedtext> {
    return this.typstBuilder.build(text);
  }

  // Perform Lint on Document
  public async lintDocument(document: TextDocument): Promise<void> {
    if (this.configManager.isLanguageSupportedAndEnabled(document)) {
      this.ignoreList = this.buildIgnoreList(document);
      const annotatedTypstObject = await this.buildAnnotatedTypst(
        document.getText(),
      );
      this.logTypstAnnotatedText(document, annotatedTypstObject);
      const annotatedTypst: string = JSON.stringify(annotatedTypstObject);
      this.lintAnnotatedText(document, annotatedTypst);
      this.statusBarManager.show();
    }
  }

  // Lint Annotated Text
  public lintAnnotatedText(
    document: TextDocument,
    annotatedText: string,
  ): void {
    this.statusBarManager.setChecking();
    const ltPostDataDict: Record<string, string> = this.getPostDataTemplate();
    if (document.languageId === Constants.LANGUAGE_ID_TYPST) {
      ltPostDataDict.disabledRules = this.mergeDisabledRules(
        ltPostDataDict.disabledRules,
        Constants.TYPST_DISABLED_RULES,
      );
    }
    ltPostDataDict.data = annotatedText;
    this.logLanguageToolRequest(document, ltPostDataDict);
    this.callLanguageTool(document, ltPostDataDict);
    this.statusBarManager.setIdle();
  }

  // Private instance methods

  // Set ltPostDataTemplate from Configuration
  private getPostDataTemplate(): Record<string, string> {
    const ltPostDataTemplate: Record<string, string> = {};
    this.configManager.getServiceParameters().forEach((value, key) => {
      ltPostDataTemplate[key] = value;
    });
    return ltPostDataTemplate;
  }

  private mergeDisabledRules(
    configuredRules: string | undefined,
    additionalRules: string[],
  ): string {
    const rules = new Set(
      (configuredRules || "")
        .split(",")
        .map((rule) => rule.trim())
        .filter((rule) => rule.length > 0),
    );
    additionalRules.forEach((rule) => rules.add(rule));
    return Array.from(rules).join(",");
  }

  private debugLog(message: string): void {
    if (!this.configManager.isDebugEnabled()) {
      return;
    }

    Constants.EXTENSION_OUTPUT_CHANNEL.appendLine(
      "[debug] " + new Date().toISOString() + " " + message,
    );
  }

  private logTypstAnnotatedText(
    document: TextDocument,
    annotatedText: IAnnotatedtext,
  ): void {
    if (!this.configManager.isDebugEnabled()) {
      return;
    }

    const textAnnotations = annotatedText.annotation.filter(
      (annotation) => annotation.text !== undefined,
    );
    const markupAnnotations = annotatedText.annotation.filter(
      (annotation) => annotation.markup !== undefined,
    );
    const interpretedText = annotatedText.annotation
      .map((annotation) => annotation.text ?? annotation.interpretAs ?? "")
      .join("");

    this.debugLog(
      `Typst annotated text: uri=${document.uri.toString()} annotations=${
        annotatedText.annotation.length
      } textAnnotations=${textAnnotations.length} markupAnnotations=${
        markupAnnotations.length
      } interpretedLength=${interpretedText.length}`,
    );
    this.debugLog(
      "Typst interpreted text preview: " +
        JSON.stringify(this.truncate(interpretedText, 4000)),
    );

    annotatedText.annotation.forEach((annotation, index) => {
      if (annotation.text === undefined) {
        return;
      }

      const start = document.positionAt(annotation.offset.start);
      const end = document.positionAt(annotation.offset.end);
      this.debugLog(
        `Typst text annotation ${index}: ${this.formatPosition(
          start,
        )}-${this.formatPosition(end)} text=${JSON.stringify(
          this.truncate(annotation.text, 500),
        )}`,
      );
    });
  }

  private logLanguageToolRequest(
    document: TextDocument,
    postData: Record<string, string>,
  ): void {
    if (!this.configManager.isDebugEnabled()) {
      return;
    }

    const dataLength = postData.data ? postData.data.length : 0;
    const parameters = Object.keys(postData)
      .filter((key) => key !== "data" && key !== "apiKey")
      .map((key) => key + "=" + postData[key])
      .join(", ");

    this.debugLog(
      `LanguageTool request: uri=${document.uri.toString()} languageId=${
        document.languageId
      } url=${this.configManager.getUrl() || "--"} dataLength=${dataLength} ${
        parameters ? "parameters=" + parameters : "parameters=--"
      }`,
    );
  }

  private logLanguageToolResponse(
    document: TextDocument,
    response: ILanguageToolResponse,
  ): void {
    if (!this.configManager.isDebugEnabled()) {
      return;
    }

    this.debugLog(
      `LanguageTool response: uri=${document.uri.toString()} matches=${
        response.matches.length
      } language=${response.language?.code || "--"} detected=${
        response.language?.detectedLanguage?.code || "--"
      }`,
    );

    response.matches.forEach((match, index) => {
      const start = document.positionAt(match.offset);
      const end = document.positionAt(match.offset + match.length);
      this.debugLog(
        `LanguageTool match ${index}: ${this.formatPosition(
          start,
        )}-${this.formatPosition(end)} rule=${match.rule.id} category=${
          match.rule.category.id
        } text=${JSON.stringify(
          this.truncate(document.getText(new Range(start, end)), 200),
        )} message=${JSON.stringify(this.truncate(match.message, 300))}`,
      );
    });
  }

  private warnIfVariantMismatch(
    document: TextDocument,
    response: ILanguageToolResponse,
  ): void {
    if (this.configManager.getConfiguredLanguage() !== "auto") {
      return;
    }
    const detected = response.language?.detectedLanguage?.code || "";
    if (!/^en(-|$)/i.test(detected)) {
      return;
    }
    const variants = this.configManager.getPreferredVariants();
    const hasEnVariant = variants
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .some((v) => v.startsWith("en-"));
    if (hasEnVariant) {
      return;
    }
    const uriKey = document.uri.toString();
    if (this.warnedVariantMismatchUris.has(uriKey)) {
      return;
    }
    this.warnedVariantMismatchUris.add(uriKey);
    Constants.EXTENSION_OUTPUT_CHANNEL.appendLine(
      `WARN: detected ${detected} but languageToolTypst.languageTool.preferredVariants has no en-* — LanguageTool used its default English variant. Add e.g. en-US to preferredVariants for consistent results. (uri=${uriKey})`,
    );
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength) + "...";
  }

  private formatPosition(position: Position): string {
    return position.line + 1 + ":" + (position.character + 1);
  }

  // Call to LanguageTool Service
  private callLanguageTool(
    document: TextDocument,
    ltPostDataDict: Record<string, string>,
  ): void {
    const url = this.configManager.getUrl();
    if (url) {
      const formBody = Object.keys(ltPostDataDict)
        .map(
          (key: string) =>
            encodeURIComponent(key) +
            "=" +
            encodeURIComponent(ltPostDataDict[key]),
        )
        .join("&");

      const options: Fetch.RequestInit = {
        body: formBody,
        headers: {
          "Accepts": "application/json",
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        method: "POST",
      };
      Fetch.default(url, options)
        .then((res) => res.json())
        .then((json: ILanguageToolResponse) => {
          this.statusBarManager.setLtSoftware(json.software);
          this.logLanguageToolResponse(document, json);
          this.warnIfVariantMismatch(document, json);
          this.suggest(document, json);
        })
        .catch((err) => {
          Constants.EXTENSION_OUTPUT_CHANNEL.appendLine(
            "Error connecting to " + url,
          );
          Constants.EXTENSION_OUTPUT_CHANNEL.appendLine(err);
        });
    } else {
      Constants.EXTENSION_OUTPUT_CHANNEL.appendLine(
        "No LanguageTool URL provided. Please check your settings and try again.",
      );
      Constants.EXTENSION_OUTPUT_CHANNEL.show(true);
    }
  }

  // Convert LanguageTool Suggestions into QuickFix CodeActions
  private suggest(
    document: TextDocument,
    response: ILanguageToolResponse,
  ): void {
    this.statusBarManager.setLtSoftware(response.software);
    const matches = response.matches;
    const diagnostics: LTDiagnostic[] = [];
    matches.forEach((match: ILanguageToolMatch) => {
      const start: Position = document.positionAt(match.offset);
      const end: Position = document.positionAt(match.offset + match.length);
      const ignored: IIgnoreItem[] = this.getIgnoreList(document, start);
      const diagnosticRange: Range = new Range(start, end);
      const diagnosticMessage: string = match.message;
      const diagnostic: LTDiagnostic = new LTDiagnostic(
        diagnosticRange,
        diagnosticMessage,
        this.resolveDiagnosticSeverity(match),
      );
      diagnostic.source = Constants.EXTENSION_DIAGNOSTIC_SOURCE;
      diagnostic.match = match;
      if (Linter.isSpellingRule(match.rule.id)) {
        if (!this.configManager.isHideRuleIds()) {
          diagnostic.code = match.rule.id;
        }
      } else {
        diagnostic.code = {
          target: this.configManager.getRuleUrl(match.rule.id),
          value: this.configManager.isHideRuleIds()
            ? Constants.SERVICE_RULE_URL_GENERIC_LABEL
            : match.rule.id,
        };
      }
      diagnostics.push(diagnostic);
      if (
        Linter.isSpellingRule(match.rule.id) &&
        this.configManager.isIgnoredWord(document.getText(diagnostic.range)) &&
        this.configManager.showIgnoredWordHints()
      ) {
        diagnostic.severity = DiagnosticSeverity.Hint;
      } else if (
        this.checkIfIgnored(
          ignored,
          match.rule.id,
          document.getText(diagnostic.range),
        )
      ) {
        diagnostic.severity = DiagnosticSeverity.Hint;
      }
    });
    this.diagnosticCollection.set(document.uri, diagnostics);
    this.debugLog(
      `Diagnostics set: uri=${document.uri.toString()} diagnostics=${
        diagnostics.length
      }`,
    );
  }

  public resolveDiagnosticSeverity(
    match: ILanguageToolMatch,
  ): DiagnosticSeverity {
    const ruleSeverity = this.configManager
      .getRuleSeverityOverrides()
      .get(match.rule.id.toUpperCase());
    if (ruleSeverity !== undefined) {
      return ruleSeverity;
    }

    const categorySeverity = this.configManager
      .getCategorySeverityOverrides()
      .get(match.rule.category.id.toUpperCase());
    if (categorySeverity !== undefined) {
      return categorySeverity;
    }

    if (this.configManager.getDiagnosticSeverityAuto()) {
      if (Linter.isSpellingRule(match.rule.id)) {
        return DiagnosticSeverity.Error;
      }
      if (Linter.isWarningCategory(match.rule.category.id)) {
        return DiagnosticSeverity.Warning;
      }
    }

    return this.configManager.getDiagnosticSeverity();
  }

  /**
   * Check if this particular rule is ignored for this line
   *
   * @param ignored List of ignored element at this line
   * @param id The rule of the spelling problem for this match
   * @param line The line number
   * @param text The text of the match
   */
  checkIfIgnored(ignored: IIgnoreItem[], id: string, text: string): boolean {
    if (ignored == null || ignored.length == 0) return false;
    let matchFound = false;
    ignored.forEach((item) => {
      if (matchFound) return;
      if (item.ruleId == id && (!item.text || item.text == text)) {
        matchFound = true;
      }
    });
    return matchFound;
  }

  // Get CodeActions for Spelling Rules
  private getSpellingRuleActions(
    document: TextDocument,
    diagnostic: LTDiagnostic,
  ): CodeAction[] {
    const actions: CodeAction[] = [];
    const match: ILanguageToolMatch | undefined = diagnostic.match;
    const word: string = document.getText(diagnostic.range);
    if (this.configManager.isIgnoredWord(word)) {
      if (this.configManager.showIgnoredWordHints()) {
        if (this.configManager.isGloballyIgnoredWord(word)) {
          const actionTitle: string =
            "Remove '" + word + "' from always ignored words.";
          const action: CodeAction = new CodeAction(
            actionTitle,
            CodeActionKind.QuickFix,
          );
          action.command = {
            arguments: [word],
            command: "languageToolTypst.removeGloballyIgnoredWord",
            title: actionTitle,
          };
          action.diagnostics = [];
          action.diagnostics.push(diagnostic);
          actions.push(action);
        }
        if (this.configManager.isWorkspaceIgnoredWord(word)) {
          const actionTitle: string =
            "Remove '" + word + "' from Workspace ignored words.";
          const action: CodeAction = new CodeAction(
            actionTitle,
            CodeActionKind.QuickFix,
          );
          action.command = {
            arguments: [word],
            command: "languageToolTypst.removeWorkspaceIgnoredWord",
            title: actionTitle,
          };
          action.diagnostics = [];
          action.diagnostics.push(diagnostic);
          actions.push(action);
        }
      }
    } else {
      const usrIgnoreActionTitle: string = "Always ignore '" + word + "'";
      const usrIgnoreAction: CodeAction = new CodeAction(
        usrIgnoreActionTitle,
        CodeActionKind.QuickFix,
      );
      usrIgnoreAction.command = {
        arguments: [word],
        command: "languageToolTypst.ignoreWordGlobally",
        title: usrIgnoreActionTitle,
      };
      usrIgnoreAction.diagnostics = [];
      usrIgnoreAction.diagnostics.push(diagnostic);
      actions.push(usrIgnoreAction);
      if (workspace !== undefined) {
        const wsIgnoreActionTitle: string =
          "Ignore '" + word + "' in Workspace";
        const wsIgnoreAction: CodeAction = new CodeAction(
          wsIgnoreActionTitle,
          CodeActionKind.QuickFix,
        );
        wsIgnoreAction.command = {
          arguments: [word],
          command: "languageToolTypst.ignoreWordInWorkspace",
          title: wsIgnoreActionTitle,
        };
        wsIgnoreAction.diagnostics = [];
        wsIgnoreAction.diagnostics.push(diagnostic);
        actions.push(wsIgnoreAction);
      }
      if (match) {
        this.getReplacementActions(
          document,
          diagnostic,
          match.replacements,
        ).forEach((action: CodeAction) => {
          actions.push(action);
        });
      }
    }
    return actions;
  }

  // Get all Rule CodeActions
  private getRuleActions(
    document: TextDocument,
    diagnostic: LTDiagnostic,
  ): CodeAction[] {
    const match: ILanguageToolMatch | undefined = diagnostic.match;
    const actions: CodeAction[] = [];
    if (match) {
      this.getReplacementActions(
        document,
        diagnostic,
        match.replacements,
      ).forEach((action: CodeAction) => {
        actions.push(action);
      });
      if (match.rule) {
        this.getDisableActions(document, diagnostic).forEach(
          (action: CodeAction) => {
            actions.push(action);
          },
        );
      }
    }
    return actions;
  }

  // Get all edit CodeActions based on Replacements
  private getReplacementActions(
    document: TextDocument,
    diagnostic: Diagnostic,
    replacements: ILanguageToolReplacement[],
  ): CodeAction[] {
    const actions: CodeAction[] = [];
    replacements.forEach((replacement: ILanguageToolReplacement) => {
      const actionTitle: string = "'" + replacement.value + "'";
      const action: CodeAction = new CodeAction(
        actionTitle,
        CodeActionKind.QuickFix,
      );
      const edit: WorkspaceEdit = new WorkspaceEdit();
      edit.replace(document.uri, diagnostic.range, replacement.value);
      action.edit = edit;
      action.diagnostics = [];
      action.diagnostics.push(diagnostic);
      actions.push(action);
    });
    return actions;
  }

  // Get all disable CodeActions based on Rules and Categories
  private getDisableActions(
    document: TextDocument,
    diagnostic: LTDiagnostic,
  ): CodeAction[] {
    const actions: CodeAction[] = [];
    const rule: ILanguageToolMatch["rule"] | undefined = diagnostic.match?.rule;
    if (rule) {
      if (rule.id) {
        const usrDisableRuleTitle: string =
          "Disable '" + rule.description + "' (" + rule.id + ") Globally";
        const usrDisableRuleAction: CodeAction = new CodeAction(
          usrDisableRuleTitle,
          CodeActionKind.QuickFix,
        );
        usrDisableRuleAction.command = {
          arguments: [rule.id, ConfigurationTarget.Global],
          command: "languageToolTypst.disableRule",
          title: usrDisableRuleTitle,
        };
        usrDisableRuleAction.diagnostics = [];
        usrDisableRuleAction.diagnostics.push(diagnostic);
        actions.push(usrDisableRuleAction);

        const lineIgnoreTitle: string =
          "Ignore '" + rule.description + "' (" + rule.id + ") on this line";
        const lineIgnoreAction: CodeAction = new CodeAction(
          lineIgnoreTitle,
          CodeActionKind.QuickFix,
        );
        const lineIgnoreEdit: WorkspaceEdit = new WorkspaceEdit();
        const line = document.lineAt(diagnostic.range.end.line);
        lineIgnoreEdit.insert(
          document.uri,
          line.range.end,
          " // @LT-IGNORE:" + rule.id + "@",
        );
        lineIgnoreAction.edit = lineIgnoreEdit;
        lineIgnoreAction.diagnostics = [];
        lineIgnoreAction.diagnostics.push(diagnostic);
        actions.push(lineIgnoreAction);

        if (workspace !== undefined) {
          const wsDisableRuleTitle: string =
            "Disable '" + rule.description + "' (" + rule.id + ") in Workspace";
          const wsDisableRuleAction: CodeAction = new CodeAction(
            wsDisableRuleTitle,
            CodeActionKind.QuickFix,
          );
          wsDisableRuleAction.command = {
            arguments: [rule.id, ConfigurationTarget.Workspace],
            command: "languageToolTypst.disableRule",
            title: wsDisableRuleTitle,
          };
          wsDisableRuleAction.diagnostics = [];
          wsDisableRuleAction.diagnostics.push(diagnostic);
          actions.push(wsDisableRuleAction);
        }
      }
      if (rule.category) {
        const usrDisableCategoryTitle: string =
          "Disable '" + rule.category.name + "' Globally";
        const usrDisableCategoryAction: CodeAction = new CodeAction(
          usrDisableCategoryTitle,
          CodeActionKind.QuickFix,
        );
        usrDisableCategoryAction.command = {
          arguments: [rule.category.id, ConfigurationTarget.Global],
          command: "languageToolTypst.disableCategory",
          title: usrDisableCategoryTitle,
        };
        usrDisableCategoryAction.diagnostics = [];
        usrDisableCategoryAction.diagnostics.push(diagnostic);
        actions.push(usrDisableCategoryAction);

        if (workspace !== undefined) {
          const wsDisableCategoryTitle: string =
            "Disable '" + rule.category.name + "' in Workspace";
          const wsDisableCategoryAction: CodeAction = new CodeAction(
            wsDisableCategoryTitle,
            CodeActionKind.QuickFix,
          );
          wsDisableCategoryAction.command = {
            arguments: [rule.id, ConfigurationTarget.Workspace],
            command: "languageToolTypst.disableCategory",
            title: wsDisableCategoryTitle,
          };
          wsDisableCategoryAction.diagnostics = [];
          wsDisableCategoryAction.diagnostics.push(diagnostic);
          actions.push(wsDisableCategoryAction);
        }
      }
    }

    return actions;
  }

  /**
   * Get list of ignored elements for this position (current or previous line)
   * @param document The document to scan for
   * @param start
   */
  private getIgnoreList(
    document: TextDocument,
    start: Position,
  ): IIgnoreItem[] {
    const line = start.line;
    const res = Array<IIgnoreItem>();
    this.ignoreList.forEach((item) => {
      if (item.line == line || item.line == line - 1) {
        // all items of current or prev line
        res.push(item);
      }
    });
    return res;
  }

  /**
   * Build up a list of ignore items for the whole file to be linted
   *
   * @param document The TextDocument to analyze
   * @returns a list of IIgnoreItems for each found ignore element
   */
  private buildIgnoreList(document: TextDocument): IIgnoreItem[] {
    const fullText = document.getText();
    const matches = [
      ...fullText.matchAll(
        new RegExp(
          "@(LT-)?IGNORE:(?<id>[_A-Z0-9]+)(\\((?<word>[^)]+)\\))?@",
          "gm",
        ),
      ),
    ];
    if (matches.length == 0) return [];
    const res = Array<IIgnoreItem>();
    matches.forEach((match: RegExpMatchArray) => {
      if (!match.groups) return;
      const item: IIgnoreItem = {
        line: document.positionAt(match.index as number).line,
        ruleId: match.groups ? match.groups["id"] : "",
        text: match.groups ? match.groups["word"] : undefined,
      };
      res.push(item);
    });
    return res;
  }
}
