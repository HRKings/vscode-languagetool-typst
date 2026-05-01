// 1. Document Metadata & Global Settings
#set document(
  title: "Typst Feature Showcase",
  author: "Expert User",
  keywords: ("Typst", "Example", "Typesetting")
)
#set page(paper: "a4", margin: (x: 2cm, y: 2.5cm), numbering: "1 / 1")
#set text(font: "Linux Libertine", size: 11pt)

// 2. Headings & Outline
#outline(indent: auto)
#pagebreak()

= Introduction
Typst is a markup-based #link("https://typst.app/")[typesetting system tyypo] designed to be moore intuitive than LaTeX.

== 1. Subbtitle with number

// 3. Basic Formatting
This text features *bold emphasis*, _italics_, and #underline[underlining].
- Bulet points use the hyphen `-`.
+ Numbered lists use tehe plus `+`.

// 4. Mathematical Notation (Math Mode)
Typst treats equations as first-class citizesns.
In-line math $a^2 + b^2 = c^2$ or block equattions:
$ Q = rho A v + sum_{i=1}^n delta_i $

// 5. Code Blocks & Syntax Highlighting
Raw text is encslosed in backticks.
```python
def hello_typst():
    print("Powerful scripting built-in")
```

== 2. Subtitle
- And list right after

// 6. Visuals & Tables
#figure(
  table(
    columns: (1fr, 1fr),
    inset: 10pt,
    align: horizon,
    [*Featuure*], [*Status*],
    [Fast Preview with typoo], [Built-in],
    [Scripting], [Advanceed],
  ),
  caption: [A simple tablee example],
)

// 7. Scripting & Show Rules (The "Power" Features)
#let alert(content) = text(fill: red, weight: "bold", content)
This is an #alert[alert] created with a custdom function.
