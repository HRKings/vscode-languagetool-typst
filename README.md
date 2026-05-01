# vscode-languagetool-typst

LanguageTool grammar, style, and spell checking for Typst documents in Visual
Studio Code.

This extension is derived from
[davidlday/vscode-languagetool-linter](https://github.com/davidlday/vscode-languagetool-linter),
which provided the original VS Code LanguageTool integration, service
management, diagnostics, replacement suggestions, and configuration surface. This
fork narrows the project around Typst prose linting and uses a custom
[tree-sitter-typst-prose](https://github.com/HRKings/tree-sitter-typst-prose)
grammar to distinguish prose from Typst syntax before sending text to
[LanguageTool](https://languagetool.org).

In memory of [Adam Voss](https://github.com/adamvoss), original creator of the
[LanguageTool for Visual Studio Code](https://github.com/languagetool-language-server/vscode-languagetool)
extension.

## Features

- Issue highlighting with hover description.
- Replacement suggestions.
- Checks Typst prose while skipping Typst markup, comments, raw code, math, and
  scripting fragments.
- Parses `.typ` files with
  [tree-sitter-typst-prose](https://github.com/HRKings/tree-sitter-typst-prose),
  a custom Typst grammar tuned for prose extraction.
- Uses annotated text requests so LanguageTool diagnostics map back to the
  original `.typ` file.
- Disables LanguageTool's quote typography rule for Typst because straight
  source delimiters often conflict with Typst source syntax.

## Setup

The defaults are probably not going to work for you, but they are there to make
sure using
[LanguageTool's Public API](https://dev.languagetool.org/public-http-api) is
done by choice. See
[this issue](https://github.com/wysiib/linter-languagetool/issues/33) on the
[Atom LanguageTool Linter](https://atom.io/packages/linter-languagetool) for an
explanation why.

The defaults assume the following:

1. You do not want to use the
   [LanguageTool's Public API](https://dev.languagetool.org/public-http-api)
2. You're running
   [LanguageTool HTTP Server](https://dev.languagetool.org/http-server) on your
   machine using the default port of 8081.
   - You can run a local LanguageTool server using the
     [unofficial Docker image](https://github.com/silvio/docker-languagetool)
     with `docker run --rm -p 8081:8010 silviof/docker-languagetool`. See
     [silvio/docker-languagetool](https://github.com/silvio/docker-languagetool)
     for more information.

3. You do not want to have this extension manage your local
   [LanguageTool HTTP Server](https://dev.languagetool.org/http-server) service.

If this doesn't work for you, here are your options.

### Option 1: Use an External Service

This could either be a locally running instance of LanguageTool, or the service
running somewhere else.

1. Set the URL in “LanguageTool Typst > External: URL” (i.e.
   `http://localhost:8081`).
1. Set “LanguageTool Typst: Service Type” to `external`.

![External URL](images/external.gif)

### Option 2: Use an Extension-Managed Service

Works well if you're only using LanguageTool in Visual Studio Code.

1. Install LanguageTool locally.
1. Set “LanguageTool Typst > Managed: Jar File” to the location of the
   `languagetool-server.jar` file.
1. Set “LanguageTool Typst: Service Type” to `managed`.

![Managed Service](images/managed.gif)

### Option 3: Public API Service

Make sure you read and understand
[LanguageTool's Public API](https://dev.languagetool.org/public-http-api) before
doing this.

1. Set “LanguageTool Typst: Service Type” to `public`.

![Public API](images/public.gif)

## Development

This project uses [Bun](https://bun.sh/) for dependency installation, scripts,
and packaging.

```sh
bun install
bun run compile
bunx vsce package
```

## Configuration Notes

Settings for this extension live under the `languageToolTypst.*` namespace so it
can be installed alongside the original LanguageTool linter without sharing
configuration state.

You can override diagnostic severity by LanguageTool rule ID or category ID:

```json
{
  "languageToolTypst.ruleSeverityOverrides": {
    "FABRIC": "hint"
  },
  "languageToolTypst.categorySeverityOverrides": {
    "FALSE_FRIENDS": "hint",
    "TYPOGRAPHY": "information"
  }
}
```

Rule overrides take precedence over category overrides. Both take precedence over
automatic severity.

Most configuration items should be safe, but there are three you should pay
particular attention to:

1. _Public Api_: This will use
   [LanguageTool's Public API](https://dev.languagetool.org/public-http-api)
   service. If you violate their conditions, they'll block your IP address.
2. _Lint on Change_: This will make a call to the LanguageTool API on every
   change. If you mix this with the _Public Api_, you're more likely to violate
   their conditions and get your IP address blocked.
3. _LanguageTool: Preferred Variants_: If you set this, then _LanguageTool:
   Language_ must be set to `auto`. If it isn't, the service will throw an
   error.

## Ignore rules inline

You have the chance to ignore specific rules inline to not bloat up your ignore
list for single words:

    // @IGNORE:UPPERCASE_SENTENCE_START@
    soll heißen, dass die Nachricht von mir ist, die Koordinaten hat
    ein kleiner Computer, den Sigrún mir zur Verfügung gestellt hat aus
    dem irdischen
    ‚World Geodetic System 1984‘ // @IGNORE:GERMAN_SPELLER_RULE(Geodetic)@

This example will ignore the missing capital letter at the beginning (soll →
Soll) and an unknown word ('Geodetic')

The optional match word is useful if the same rule is applied to several words
in the sentence.

The rules can be applied to the current line, for example at the end, or at the
line before.

Syntax:

    @LT-IGNORE:<rulename>(<text-match>)@

The and the `text-match` is optional.

## Credits

This project is based on
[davidlday/vscode-languagetool-linter](https://github.com/davidlday/vscode-languagetool-linter).
The following projects also provided excellent guidance or core functionality.

<!-- markdownlint-disable no-inline-html -->

- [LanguageTool](https://languagetool.org) (of course!)
- [Atom Linter LanguageTool](https://github.com/wysiib/linter-languagetool/)
- [LT<sub>e</sub>X](https://github.com/valentjn/vscode-ltex) — a fork of
  [LanguageTool for Visual Studio Code](https://github.com/languagetool-language-server/vscode-languagetool)
- [VS Code Write Good Extension](https://github.com/TravisTheTechie/vscode-write-good/)
- [Fall: Not Yet Another Parser Generator](https://github.com/matklad/fall)
- [typst-ts-parser](https://www.npmjs.com/package/@myriaddreamin/typst-ts-parser)
- [tree-sitter-typst-prose](https://github.com/HRKings/tree-sitter-typst-prose)

<!-- markdownlint-enable no-inline-html -->
