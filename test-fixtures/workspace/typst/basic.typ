= A Typst Heading

This paragraph should be checked by LanguageTool.

#let title = [Nested title should be checked.]
#let ignored = "This string should not be checked."
#set text(lang: "en")

- A list item should be checked.
+ A numbered item should be checked.

Inline #emph[content should be checked] after a function call.

`raw text should not be checked`

```typ
raw block should not be checked
```

$x + y should not be checked$

// This comment should not be checked.
